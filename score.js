'use strict';

require('dotenv').config();

const { parseArgs } = require('util');
const path = require('path');

const { JobParseError, DeepSeekResponseError, ConfigMissingError } = require('./src/lib/errors');
const logger = require('./src/lib/logger');
const { formatDateString } = require('./src/lib/dateUtils');
const { broadcastEvent } = require('./src/lib/eventBroadcaster');
const fileStore = require('./src/lib/fileStore');
const { callDeepSeek } = require('./src/lib/deepseek');
const { deduplicateJobs } = require('./src/lib/deduplicator');
const { rankJobs } = require('./src/lib/ranker');
const { buildScoringPrompt } = require('./src/lib/promptBuilder');
const { parseJobFile } = require('./src/models/job');
const { parseScoreResponse, createScoredJob } = require('./src/models/scoredJob');
const { formatStackRank } = require('./src/models/stackRank');

// ── Constants ──────────────────────────────────────────────────────────────────
// PIPELINE_BASE_DIR env var allows E2E tests to override the base directory.
// Defaults to __dirname (project root) for normal usage.
const ROOT_DIR = process.env.PIPELINE_BASE_DIR || __dirname;
const CONFIG_DIR = path.join(ROOT_DIR, 'config');
const JOBS_DIR = path.join(ROOT_DIR, 'jobs');
const RESUMES_DIR = path.join(ROOT_DIR, 'resumes');

const REQUIRED_CONFIGS = ['scoring_prompt.md', 'adam_buteux_career.md'];

// ── Main ───────────────────────────────────────────────────────────────────────
(async function main() {
  // 1. Parse CLI arguments
  const { values } = parseArgs({
    options: {
      date: { type: 'string' },
    },
    allowPositionals: true,
  });
  const dateStr = values.date || formatDateString(new Date());

  // 2. Validate config files exist
  const missingConfigs = [];
  for (const cfg of REQUIRED_CONFIGS) {
    try {
      await fileStore.readConfig(CONFIG_DIR, cfg);
    } catch (err) {
      if (err instanceof ConfigMissingError) {
        missingConfigs.push(cfg);
      } else {
        throw err;
      }
    }
  }
  if (missingConfigs.length > 0) {
    for (const cfg of missingConfigs) {
      logger.error('[score]', `Missing config file: config/${cfg}`);
    }
    process.exit(1);
  }

  // 3. Read career contents (needed for prompt building)
  const careerContents = await fileStore.readConfig(CONFIG_DIR, 'adam_buteux_career.md');

  // 4. Read scoring system prompt
  const scoringSystemPrompt = await fileStore.readConfig(CONFIG_DIR, 'scoring_prompt.md');

  // 5. Read job files
  const allJobFiles = await fileStore.readJobFiles(JOBS_DIR);
  if (allJobFiles.length === 0) {
    logger.info('[score]', 'No job files found in jobs/ — nothing to score.');
    process.exit(0);
  }

  // 6. Parse each job file — skip malformed files
  const parsedJobs = [];
  for (const { filename, content } of allJobFiles) {
    try {
      const job = parseJobFile(content, filename);
      parsedJobs.push(job);
    } catch (err) {
      if (err instanceof JobParseError) {
        logger.warn('[score]', `Skipping ${filename}: ${err.message}`);
      } else {
        throw err;
      }
    }
  }

  if (parsedJobs.length === 0) {
    logger.info('[score]', 'All job files were malformed — nothing to score.');
    process.exit(0);
  }

  // 7. Deduplicate
  const { unique, duplicates, fuzzyWarnings } = deduplicateJobs(parsedJobs);

  for (const dup of duplicates) {
    logger.warn('[score]', `Duplicate skipped: ${dup.skipped.company} — ${dup.skipped.title} (retaining newer harvest: ${dup.kept.company} — ${dup.kept.title})`);
  }
  for (const warn of fuzzyWarnings) {
    logger.warn('[score]', `Fuzzy: ${warn.reason}`);
  }

  // 8. Broadcast scoring_started
  await broadcastEvent('scoring_started', { total: unique.length, date: dateStr });

  // 9. SEQUENTIAL scoring loop — NO Promise.all
  const scoredJobs = [];
  const totalJobs = unique.length;
  let totalTimeMs = 0;

  for (let i = 0; i < totalJobs; i++) {
    const job = unique[i];
    const jobStartTime = Date.now();

    // a. Build scoring prompt
    const userPrompt = buildScoringPrompt(careerContents, job);

    // b. Call DeepSeek
    let rawResponse;
    try {
      rawResponse = await callDeepSeek(scoringSystemPrompt, userPrompt, { maxTokens: 1024 });
    } catch (err) {
      logger.error('[score]', `DeepSeek error for ${job.filename}: ${err.message}`);
      broadcastEvent('job_skipped', { filename: job.filename, reason: err.message });
      continue;
    }

    // c. Parse score response
    let scoreResult;
    try {
      scoreResult = parseScoreResponse(rawResponse);
    } catch (err) {
      logger.error('[score]', `Parse error for ${job.filename}: ${err.message}`);
      broadcastEvent('job_skipped', { filename: job.filename, reason: err.message });
      continue;
    }

    // d. Create scored job
    const scoredJob = createScoredJob(job, scoreResult);
    scoredJobs.push(scoredJob);

    // e. Broadcast progress
    broadcastEvent('job_scored', {
      rank: null,
      score: scoredJob.score,
      company: scoredJob.company,
      title: scoredJob.title,
      actionFlag: null,
      fitSignal: scoredJob.fitSignal,
      gap: scoredJob.gap,
      criticalKeywords: scoredJob.criticalKeywords,
      overQualified: scoredJob.overQualified,
      sourceFilename: scoredJob.filename,
      salary: scoredJob.salary,
      location: scoredJob.location,
      url: scoredJob.url,
      linkedInJobId: scoredJob.linkedInJobId,
    });

    // f. Log progress with ETA
    const elapsedMs = Date.now() - jobStartTime;
    totalTimeMs += elapsedMs;
    const avgMsPerJob = totalTimeMs / (i + 1);
    const remaining = totalJobs - (i + 1);
    const etaSecs = Math.round((avgMsPerJob * remaining) / 1000);
    logger.info('[score]', `${i + 1}/${totalJobs}: ${scoredJob.company} — ${scoredJob.title} (est. ${etaSecs}s remaining)`);
  }

  if (scoredJobs.length === 0) {
    logger.info('[score]', 'No jobs were successfully scored.');
    process.exit(0);
  }

  // 10. Prioritization ranking
  const rankedJobs = rankJobs(scoredJobs);

  // 11. Compute stats
  const scores = rankedJobs.map(j => j.score);
  const scoreSum = scores.reduce((a, b) => a + b, 0);
  const scoreMean = parseFloat((scoreSum / scores.length).toFixed(1));
  const scoreMin = Math.min(...scores);
  const scoreMax = Math.max(...scores);
  const distribution = {
    '1-3': scores.filter(s => s >= 1 && s <= 3).length,
    '4-5': scores.filter(s => s >= 4 && s <= 5).length,
    '6-7': scores.filter(s => s >= 6 && s <= 7).length,
    '8-10': scores.filter(s => s >= 8 && s <= 10).length,
  };

  // 12. Format stack rank with reconstructed date for correct header
  const [year, month, day] = dateStr.split('-').map(Number);
  const targetHeaderDate = new Date(year, month - 1, day);
  const stackRankContent = formatStackRank(rankedJobs, targetHeaderDate, fuzzyWarnings, {
    scoreMean,
    scoreMin,
    scoreMax,
    distribution,
  });

  // 13. Write stack rank file
  const writtenPath = await fileStore.writeStackRank(RESUMES_DIR, dateStr, stackRankContent);

  // 14. Broadcast scoring_complete
  broadcastEvent('scoring_complete', {
    scored: rankedJobs.length,
    scoreMean,
    scoreMin,
    scoreMax,
    distribution,
  });

  // 15. Log completion
  logger.info('[score]', `Done. ${rankedJobs.length} jobs scored → ${writtenPath}`);
})();
