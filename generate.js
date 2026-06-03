'use strict';

require('dotenv').config();

const { parseArgs } = require('util');
const path = require('path');
const { promises: fs } = require('fs');

const { ConfigMissingError } = require('./src/lib/errors');
const logger = require('./src/lib/logger');
const { formatDateString } = require('./src/lib/dateUtils');
const { broadcastEvent } = require('./src/lib/eventBroadcaster');
const fileStore = require('./src/lib/fileStore');
const { callDeepSeek } = require('./src/lib/deepseek');
const { buildResumePrompt, buildCoverLetterPrompt, buildQualityPrompt } = require('./src/lib/promptBuilder');
const { parseJobFile } = require('./src/models/job');
const { parseStackRank, formatSubmissionRecord } = require('./src/models/stackRank');
const { createApplicationRecord } = require('./src/models/applicationRecord');

// ── Constants ──────────────────────────────────────────────────────────────────
// PIPELINE_BASE_DIR env var allows E2E tests to override the base directory.
// Defaults to __dirname (project root) for normal usage.
const ROOT_DIR = process.env.PIPELINE_BASE_DIR || __dirname;
const CONFIG_DIR = path.join(ROOT_DIR, 'config');
const JOBS_DIR = path.join(ROOT_DIR, 'jobs');
const RESUMES_DIR = path.join(ROOT_DIR, 'resumes');

const REQUIRED_CONFIGS = [
  'resume_prompt.md',
  'cover_letter_prompt.md',
  'adam_buteux_career.md',
  'pillar_library.md',
  'quality_prompt.md',
];

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Extract fitSignal and gap from the raw stack rank markdown for a given job entry.
 *
 * parseStackRank returns structured metadata but does not include fitSignal or gap.
 * These are embedded in the per-entry body text as "**Fit:**" and "**Gap:**".
 *
 * @param {string} stackRankContent - Full stack rank markdown content.
 * @param {string} company - Company name to match.
 * @param {string} title - Job title to match.
 * @returns {{ fitSignal: string, gap: string }}
 */
function extractFitGap(stackRankContent, company, title) {
  const escCompany = company.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const escTitle = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const headingRegex = new RegExp(
    `## \\d+\\. \\[\\d+/10\\] \\[.*?\\] — ${escCompany} \\| ${escTitle}\\n([\\s\\S]*?)(?=\\n---|$)`
  );
  const match = stackRankContent.match(headingRegex);
  if (!match) return { fitSignal: '', gap: '' };
  const body = match[1];
  const fitMatch = body.match(/\*\*Fit:\*\* (.+)/);
  const gapMatch = body.match(/\*\*Gap:\*\* (.+)/);
  return {
    fitSignal: fitMatch ? fitMatch[1].trim() : '',
    gap: gapMatch ? gapMatch[1].trim() : '',
  };
}

/**
 * Build an object with the fields needed by prompt builders and submission records.
 *
 * @param {object} qualifyingJob - A StackRankEntry from parseStackRank.
 * @param {object} jobFile - A parsed JobFile (from parseJobFile).
 * @param {string} fitSignal - Fit signal text from stack rank.
 * @param {string} gap - Gap text from stack rank.
 * @returns {object} A ScoredJob-like object.
 */
function buildScoredJobLike(qualifyingJob, jobFile, fitSignal, gap) {
  return {
    ...jobFile,
    score: qualifyingJob.score,
    fitSignal,
    gap,
    rank: qualifyingJob.rank,
    actionFlag: qualifyingJob.actionFlag,
  };
}

/**
 * Compute the application package output directory path.
 *
 * @param {string} resumesDir - Path to the resumes directory.
 * @param {string} dateStr - Date string in "YYYY-MM-DD" format.
 * @param {string} company - Company name.
 * @param {string} title - Job title.
 * @returns {string} Full path to the output directory.
 */
function getOutputDir(resumesDir, dateStr, company, title) {
  const { sanitizeForFilename } = require('./src/models/job');
  const safeCompany = sanitizeForFilename(company, 60);
  const safeTitle = sanitizeForFilename(title, 60);
  const folderName = `${safeCompany} - ${safeTitle}`;
  return path.join(resumesDir, dateStr, folderName);
}

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
  let careerContents, pillarContents, resumeSystemPrompt, clSystemPrompt, qualitySystemPrompt;
  const missingConfigs = [];
  for (const cfg of REQUIRED_CONFIGS) {
    try {
      const contents = await fileStore.readConfig(CONFIG_DIR, cfg);
      // Assign to the correct variable based on filename
      switch (cfg) {
        case 'adam_buteux_career.md':
          careerContents = contents;
          break;
        case 'pillar_library.md':
          pillarContents = contents;
          break;
        case 'resume_prompt.md':
          resumeSystemPrompt = contents;
          break;
        case 'cover_letter_prompt.md':
          clSystemPrompt = contents;
          break;
        case 'quality_prompt.md':
          qualitySystemPrompt = contents;
          break;
      }
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
      logger.error('[generate]', `Missing config file: config/${cfg}`);
    }
    process.exit(1);
  }

  // 3. Read stack rank for the target date
  let stackRankContent;
  try {
    stackRankContent = await fileStore.readStackRank(RESUMES_DIR, dateStr);
  } catch (err) {
    logger.error('[generate]', `No stack rank for ${dateStr}. Run: node score.js --date=${dateStr}`);
    process.exit(1);
  }

  // 4. Parse qualifying jobs (DEEP_TAILOR and AUTO_GENERATED only)
  const qualifyingJobs = parseStackRank(stackRankContent);
  if (qualifyingJobs.length === 0) {
    logger.info('[generate]', 'No qualifying jobs found in stack rank — nothing to generate.');
    process.exit(0);
  }

  // 5. OPTIMIZED I/O CAPTURE — read applications.json ONCE before the loop
  const existingRecords = await fileStore.readApplications(ROOT_DIR);

  // 6. OPTIMIZED I/O CAPTURE — read job files ONCE before the loop into a Map
  const allJobFiles = await fileStore.readJobFiles(JOBS_DIR);
  const jobFileMap = new Map(allJobFiles.map(f => [f.filename, f.content]));

  // 7. Accumulation array for new records
  const newRecords = [];

  // 8. Broadcast lifecycle start
  await broadcastEvent('generation_started', { total: qualifyingJobs.length });

  // 9. SEQUENTIAL core processing loop — NO Promise.all
  const totalJobs = qualifyingJobs.length;
  let totalTimeMs = 0;

  for (let i = 0; i < totalJobs; i++) {
    const qualifyingJob = qualifyingJobs[i];
    const jobStartTime = Date.now();

    // a. Retrieve source content from the in-memory map
    const jobContent = jobFileMap.get(qualifyingJob.sourceFilename);
    if (!jobContent) {
      logger.warn(
        '[generate]',
        `Source file ${qualifyingJob.sourceFilename} not found for ${qualifyingJob.company} — ${qualifyingJob.title} — cleanup may have run. Skipping.`
      );
      broadcastEvent('doc_skipped', {
        company: qualifyingJob.company,
        title: qualifyingJob.title,
        reason: 'Source file not found',
      });
      continue;
    }

    // Parse the job file to get the full JobFile (with description)
    let jobFile;
    try {
      jobFile = parseJobFile(jobContent, qualifyingJob.sourceFilename);
    } catch (err) {
      logger.warn(
        '[generate]',
        `Failed to parse ${qualifyingJob.sourceFilename}: ${err.message}. Skipping ${qualifyingJob.company} — ${qualifyingJob.title}.`
      );
      broadcastEvent('doc_skipped', {
        company: qualifyingJob.company,
        title: qualifyingJob.title,
        reason: `Parse error: ${err.message}`,
      });
      continue;
    }

    // Extract fitSignal and gap from the stack rank
    const { fitSignal, gap } = extractFitGap(stackRankContent, qualifyingJob.company, qualifyingJob.title);

    // Build a ScoredJob-like object for prompt builders
    const scoredJob = buildScoredJobLike(qualifyingJob, jobFile, fitSignal, gap);

    // b. Compute output directory and check if it already exists (idempotent)
    const outputDir = getOutputDir(RESUMES_DIR, dateStr, qualifyingJob.company, qualifyingJob.title);
    try {
      await fs.access(outputDir);
      // Directory exists — skip generation
      logger.info(
        '[generate]',
        `Skipping ${qualifyingJob.company} — ${qualifyingJob.title} — output already exists`
      );
      continue;
    } catch (err) {
      if (err.code !== 'ENOENT') {
        throw err;
      }
    }

    // c. Call 1 — Resume generation
    let resumeContent;
    try {
      resumeContent = await callDeepSeek(
        resumeSystemPrompt,
        buildResumePrompt(careerContents, pillarContents, scoredJob),
        { maxTokens: 2000, timeoutMs: 60000 }
      );
    } catch (err) {
      logger.error(
        '[generate]',
        `DeepSeek error on resume for ${qualifyingJob.company} — ${qualifyingJob.title}: ${err.message}`
      );
      broadcastEvent('doc_skipped', {
        company: qualifyingJob.company,
        title: qualifyingJob.title,
        reason: `Resume generation failed: ${err.message}`,
      });
      continue;
    }

    // d. Call 2 — Cover letter generation
    let coverLetterContent;
    try {
      coverLetterContent = await callDeepSeek(
        clSystemPrompt,
        buildCoverLetterPrompt(careerContents, scoredJob, resumeContent),
        { maxTokens: 800, timeoutMs: 60000 }
      );
    } catch (err) {
      logger.error(
        '[generate]',
        `DeepSeek error on cover letter for ${qualifyingJob.company} — ${qualifyingJob.title}: ${err.message}`
      );
      // Resume written, CL failed — set null and proceed to quality
      coverLetterContent = null;
    }

    // e. Call 3 — Quality assessment (wrapped in separate try/catch)
    let qualityResult = null;
    try {
      const rawQuality = await callDeepSeek(
        qualitySystemPrompt,
        buildQualityPrompt(scoredJob, resumeContent, coverLetterContent || ''),
        { maxTokens: 200, timeoutMs: 30000 }
      );
      qualityResult = JSON.parse(rawQuality);
    } catch (err) {
      logger.warn(
        '[generate]',
        `Quality assessment failed for ${qualifyingJob.company} — ${qualifyingJob.title}: ${err.message}. Proceeding with null quality.`
      );
      // qualityResult stays null — quality fields remain null in record
    }

    // f. Write application docs to disk
    const coverLetterToWrite = coverLetterContent || '';
    await fileStore.writeApplicationDocs(
      RESUMES_DIR,
      dateStr,
      qualifyingJob.company,
      qualifyingJob.title,
      resumeContent,
      coverLetterToWrite
    );

    // g. Create ApplicationRecord and populate quality fields
    const record = createApplicationRecord(scoredJob, outputDir, dateStr);
    if (qualityResult) {
      record.resumeQuality =
        typeof qualityResult.resume_quality === 'number' ? qualityResult.resume_quality : null;
      record.coverLetterQuality =
        typeof qualityResult.cover_letter_quality === 'number' ? qualityResult.cover_letter_quality : null;
      record.qualityNote = qualityResult.quality_note || null;
      record.pillarsSelected = Array.isArray(qualityResult.pillars_selected) ? qualityResult.pillars_selected : [];
      record.coverLetterParas =
        typeof qualityResult.cover_letter_paras === 'number' ? qualityResult.cover_letter_paras : null;
    }

    // h. Write submission record
    await fileStore.writeSubmissionRecord(outputDir, formatSubmissionRecord(record, scoredJob));

    // i. Accumulate into in-memory array
    newRecords.push(record);

    // j. Broadcast doc_generated event (must include sourceFilename)
    broadcastEvent('doc_generated', {
      company: qualifyingJob.company,
      title: qualifyingJob.title,
      sourceFilename: qualifyingJob.sourceFilename,
      resumeQuality: record.resumeQuality,
      coverLetterQuality: record.coverLetterQuality,
      qualityNote: record.qualityNote,
      pillarsSelected: record.pillarsSelected,
      coverLetterParas: record.coverLetterParas,
    });

    // k. Low quality warning
    if (
      (record.resumeQuality !== null && record.resumeQuality < 6) ||
      (record.coverLetterQuality !== null && record.coverLetterQuality < 6)
    ) {
      logger.warn(
        '[generate]',
        `⚠️ Low quality: ${qualifyingJob.company} — ${qualifyingJob.title}`
      );
    }

    // l. Log progress with estimated duration remaining
    const elapsedMs = Date.now() - jobStartTime;
    totalTimeMs += elapsedMs;
    const avgMsPerJob = totalTimeMs / (i + 1);
    const remaining = totalJobs - (i + 1);
    const etaSecs = Math.round((avgMsPerJob * remaining) / 1000);
    logger.info(
      '[generate]',
      `${i + 1}/${totalJobs}: ${qualifyingJob.company} — ${qualifyingJob.title} (est. ${etaSecs}s remaining)`
    );
  }

  // 10. Database commit — write applications.json ONCE after the loop
  await fileStore.writeApplications(ROOT_DIR, [...existingRecords, ...newRecords]);

  // 11. Broadcast completion
  broadcastEvent('generation_complete', { generated: newRecords.length });

  // 12. Log final success banner
  logger.info(
    '[generate]',
    `Done. ${newRecords.length} packages written to resumes/${dateStr}/`
  );
})();
