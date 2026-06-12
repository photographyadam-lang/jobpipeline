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
const { parseJobFile, sanitizeForFilename } = require('./src/models/job');
const { parseStackRank } = require('./src/models/stackRank');

// ── Constants ──────────────────────────────────────────────────────────────────

const ROOT_DIR = process.env.PIPELINE_BASE_DIR || __dirname;
const CONFIG_DIR = path.join(ROOT_DIR, 'config');
const RESUMES_DIR = path.join(ROOT_DIR, 'resumes');
const JOBS_DIR = path.join(ROOT_DIR, 'jobs');

const REQUIRED_CONFIGS = [
  'scoring_prompt.md',
  'resume_prompt.md',
  'cover_letter_prompt.md',
  'quality_prompt.md',
];

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Compute the application package output directory path.
 *
 * Mirrors the identical function in review.js and generate.js so that all
 * scripts resolve to the same output directory for a given company + title.
 *
 * @param {string} resumesDir - Path to the resumes directory.
 * @param {string} dateStr - Date string in "YYYY-MM-DD" format.
 * @param {string} company - Company name.
 * @param {string} title - Job title.
 * @returns {string} Full path to the output directory.
 */
function getOutputDir(resumesDir, dateStr, company, title) {
  const safeCompany = sanitizeForFilename(company, 60);
  const safeTitle = sanitizeForFilename(title, 60);
  const folderName = `${safeCompany} - ${safeTitle}`;
  return path.join(resumesDir, dateStr, folderName);
}

/**
 * Extract the QA evaluation score percentage from forensic_audit.md content.
 *
 * Scans for patterns like "85%" or "Score: 85/100" in the audit narrative.
 * Returns the first numeric percentage value found, or null if none is present.
 *
 * @param {string} auditContent - The full text of forensic_audit.md.
 * @returns {number|null} The QA score as a percentage (0-100), or null.
 */
function extractQaScore(auditContent) {
  if (!auditContent) return null;

  // Try "XX%" pattern
  const pctMatch = auditContent.match(/(\d{2,3})\s*%/);
  if (pctMatch) {
    const val = parseInt(pctMatch[1], 10);
    if (val >= 0 && val <= 100) return val;
  }

  // Try "XX/100" pattern
  const fracMatch = auditContent.match(/(\d{2,3})\s*\/\s*100/);
  if (fracMatch) {
    const val = parseInt(fracMatch[1], 10);
    if (val >= 0 && val <= 100) return val;
  }

  return null;
}

/**
 * Extract the list of unlinked filler block descriptions from the
 * "## Filler & Over-Qualification Analysis" section of forensic_audit.md.
 *
 * Captures all non-empty lines of text between that heading and the next
 * "## " heading or end of string. Returns the raw paragraph text blocks.
 *
 * @param {string} auditContent - The full text of forensic_audit.md.
 * @returns {string[]} Array of filler block description strings.
 */
function extractFillerBlocks(auditContent) {
  if (!auditContent) return [];

  // Find the Filler & Over-Qualification Analysis section
  const sectionMatch = auditContent.match(
    /## Filler & Over-Qualification Analysis\n([\s\S]*?)(?=\n## |$)/
  );
  if (!sectionMatch) return [];

  const sectionText = sectionMatch[1].trim();
  if (!sectionText) return [];

  // Split into bullet points or paragraphs, filter empty lines
  const blocks = sectionText
    .split(/\n(?=\s*[\-\*]|\s*\d+\.)/)
    .map(function (line) { return line.trim(); })
    .filter(function (line) { return line.length > 0; });

  return blocks.length > 0 ? blocks : [sectionText];
}

/**
 * Extract the names of critical keywords that have a frequency count of 0
 * from the "## Keyword Frequency Table" section of forensic_audit.md.
 *
 * Parses the markdown table rows: | keyword | count |
 *
 * @param {string} auditContent - The full text of forensic_audit.md.
 * @returns {string[]} Array of keyword names with count 0.
 */
function extractZeroFreqKeywords(auditContent) {
  if (!auditContent) return [];

  // Find the Keyword Frequency Table section
  const sectionMatch = auditContent.match(
    /## Keyword Frequency Table\n([\s\S]*?)(?=\n## |$)/
  );
  if (!sectionMatch) return [];

  const sectionText = sectionMatch[1];

  // Parse table rows: | keyword | count |
  // Skip header and separator rows (first two lines after heading)
  const tableLines = sectionText.split('\n');
  const zeroFreqKeywords = [];

  for (let i = 0; i < tableLines.length; i++) {
    const line = tableLines[i].trim();
    // Match markdown table row: | content | content |
    const rowMatch = line.match(/^\|\s*(.+?)\s*\|\s*(\d+)\s*\|$/);
    if (rowMatch) {
      const count = parseInt(rowMatch[2], 10);
      if (count === 0) {
        zeroFreqKeywords.push(rowMatch[1].trim());
      }
    }
  }

  return zeroFreqKeywords;
}

/**
 * Build a compact Batch Performance Matrix markdown table from per-job
 * extracted data.
 *
 * Columns: Rank, Company, Title, Score, QA Score %, Filler Warnings, Zero-Freq Keywords
 *
 * Context Compression Constraint: This function MUST NOT include raw resume
 * or cover letter text — only structured summary data.
 *
 * @param {object[]} optimizedData - Array of per-job extracted data objects.
 *   Each object: { rank, company, title, score, qaScore, fillerBlocks, zeroFreqKeywords }
 * @returns {string} Compact markdown summary table.
 */
function buildBatchMatrix(optimizedData) {
  if (!optimizedData || optimizedData.length === 0) {
    return 'No qualifying job data available.';
  }

  const lines = [];

  lines.push('## Batch Performance Matrix');
  lines.push('');
  lines.push('| Rank | Company | Title | Score | QA Score % | Filler Warnings | Zero-Freq Keywords |');
  lines.push('|------|---------|-------|-------|------------|-----------------|--------------------|');

  for (const entry of optimizedData) {
    const qaScoreStr = entry.qaScore !== null ? entry.qaScore + '%' : '—';
    const fillerStr = entry.fillerBlocks.length > 0
      ? entry.fillerBlocks.slice(0, 3).join('; ') + (entry.fillerBlocks.length > 3 ? ' ...' : '')
      : '—';
    const kwStr = entry.zeroFreqKeywords.length > 0
      ? entry.zeroFreqKeywords.slice(0, 5).join(', ') + (entry.zeroFreqKeywords.length > 5 ? ' ...' : '')
      : '—';

    // Truncate long strings for table readability
    const truncFiller = fillerStr.length > 80 ? fillerStr.slice(0, 77) + '...' : fillerStr;
    const truncKw = kwStr.length > 60 ? kwStr.slice(0, 57) + '...' : kwStr;

    lines.push(
      '| ' + entry.rank + ' | ' +
      escapePipe(entry.company) + ' | ' +
      escapePipe(entry.title) + ' | ' +
      entry.score + '/10 | ' +
      qaScoreStr + ' | ' +
      truncFiller + ' | ' +
      truncKw + ' |'
    );
  }

  lines.push('');
  return lines.join('\n');
}

/**
 * Build the user prompt for the meta-analysis LLM call.
 *
 * Combines the Batch Performance Matrix with the raw content of all 4 config
 * prompt files. Instructs DeepSeek to analyze gap patterns and output
 * actionable optimization recommendations.
 *
 * @param {string} batchMatrix - The formatted Batch Performance Matrix markdown.
 * @param {string} scoringPrompt - Content of config/scoring_prompt.md.
 * @param {string} resumePrompt - Content of config/resume_prompt.md.
 * @param {string} clPrompt - Content of config/cover_letter_prompt.md.
 * @param {string} qualityPrompt - Content of config/quality_prompt.md.
 * @returns {string} Formatted user prompt.
 */
function buildOptimizePrompt(batchMatrix, scoringPrompt, resumePrompt, clPrompt, qualityPrompt) {
  const lines = [];

  lines.push('# Prompt Performance Optimization Analysis');
  lines.push('');
  lines.push('## Instructions');
  lines.push('');
  lines.push('You are an expert prompt engineer analyzing a job-pipeline system\'s prompt ' +
    'configurations against real-world forensic audit results. Your task is to:');
  lines.push('');
  lines.push('1. Analyze the Batch Performance Matrix below — it contains structured quality ' +
    'data from high-scoring roles (score >= 7/10) including QA evaluation scores, ' +
    'filler/over-qualification warnings from forensic audits, and zero-frequency keywords.');
  lines.push('2. Review all 4 system prompt configurations provided below.');
  lines.push('3. Identify specific gaps, weaknesses, or optimization opportunities in the prompts ' +
    'that correlate with the observed audit findings.');
  lines.push('4. Output actionable, specific recommendations for manual edits to the prompt files.');
  lines.push('');
  lines.push('CRITICAL RULES:');
  lines.push('- Do NOT suggest architecture changes to the pipeline scripts — only prompt content changes.');
  lines.push('- Be specific: reference exact lines or sections of prompts that need modification.');
  lines.push('- For each recommendation, explain WHICH audit finding triggers it and WHY the change ' +
    'would improve quality.');
  lines.push('- Prioritize recommendations by impact (high/medium/low).');
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push(batchMatrix);
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## Current System Prompts');
  lines.push('');
  lines.push('### 1. Scoring Prompt (config/scoring_prompt.md)');
  lines.push('');
  lines.push(scoringPrompt);
  lines.push('');
  lines.push('### 2. Resume Prompt (config/resume_prompt.md)');
  lines.push('');
  lines.push(resumePrompt);
  lines.push('');
  lines.push('### 3. Cover Letter Prompt (config/cover_letter_prompt.md)');
  lines.push('');
  lines.push(clPrompt);
  lines.push('');
  lines.push('### 4. Quality Assessment Prompt (config/quality_prompt.md)');
  lines.push('');
  lines.push(qualityPrompt);
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## Output Format');
  lines.push('');
  lines.push('Respond with a clean markdown document containing exactly these sections:');
  lines.push('');
  lines.push('## Executive Summary');
  lines.push('Brief overview of the overall prompt health and key findings.');
  lines.push('');
  lines.push('## Per-Prompt Recommendations');
  lines.push('### Scoring Prompt');
  lines.push('- Recommendation 1 (High/Medium/Low): [description]');
  lines.push('  - Trigger: [which audit finding]');
  lines.push('  - Suggested Change: [specific text or structural change]');
  lines.push('');
  lines.push('### Resume Prompt');
  lines.push('- ...');
  lines.push('');
  lines.push('### Cover Letter Prompt');
  lines.push('- ...');
  lines.push('');
  lines.push('### Quality Assessment Prompt');
  lines.push('- ...');
  lines.push('');
  lines.push('## Cross-Cutting Themes');
  lines.push('Patterns or issues that span multiple prompts.');
  lines.push('');
  lines.push('## Priority Action Items');
  lines.push('Top 3-5 changes to make immediately, ordered by expected impact.');

  return lines.join('\n');
}

/**
 * Escape pipe characters for markdown table cell content.
 *
 * @param {string} str - Raw string to escape.
 * @returns {string} String with pipes escaped.
 */
function escapePipe(str) {
  if (typeof str !== 'string') return String(str ?? '');
  return str.replace(/\|/g, '\\|');
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
  const configContents = {};
  const missingConfigs = [];
  for (const cfg of REQUIRED_CONFIGS) {
    try {
      configContents[cfg] = await fileStore.readConfig(CONFIG_DIR, cfg);
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
      logger.error('[optimize]', `Missing config file: config/${cfg}`);
    }
    process.exit(1);
  }

  // 3. Read stack rank for the target date
  let stackRankContent;
  try {
    stackRankContent = await fileStore.readStackRank(RESUMES_DIR, dateStr);
  } catch (err) {
    logger.error('[optimize]', `No stack rank for ${dateStr}. Run: node score.js --date=${dateStr}`);
    process.exit(1);
  }

  // 4. Parse all stack rank entries
  const allEntries = parseStackRank(stackRankContent);
  if (allEntries.length === 0) {
    logger.info('[optimize]', 'No qualifying jobs found in stack rank — nothing to analyze.');
    process.exit(0);
  }

  // 5. High-Pass Filter: score >= 7 only
  const highScoreEntries = allEntries.filter(function (entry) {
    return entry.score >= 7;
  });

  if (highScoreEntries.length === 0) {
    logger.info('[optimize]', 'No jobs with score >= 7 found — nothing to analyze.');
    process.exit(0);
  }

  logger.info(
    '[optimize]',
    `Filtered ${allEntries.length} jobs → ${highScoreEntries.length} with score >= 7`
  );

  // 6. Broadcast lifecycle start
  await broadcastEvent('optimize_started', { total: highScoreEntries.length, date: dateStr });

  // 7. OPTIMIZED I/O CAPTURE — read job files ONCE before the loop into a Map
  let allJobFiles;
  try {
    allJobFiles = await fileStore.readJobFiles(JOBS_DIR);
  } catch (err) {
    logger.error('[optimize]', `Failed to read job files from ${JOBS_DIR}: ${err.message}`);
    process.exit(1);
  }
  const jobFileMap = new Map(allJobFiles.map(function (f) { return [f.filename, f.content]; }));

  // 8. Try to read the aggregate QA report (optional — may not exist)
  let qaReportContent = null;
  try {
    qaReportContent = await fileStore.readQaReport(RESUMES_DIR, dateStr);
  } catch (err) {
    // QA report is optional — continue without it
    logger.info('[optimize]', 'No qa_report.md found — proceeding without aggregate QA data.');
  }

  // 9. Read QA scores from the aggregate qa_report.md if available
  //    Parse per-job QA score percentages from the report
  const qaScoresBySource = new Map();
  if (qaReportContent) {
    // Try to extract per-job QA scores using pattern: sourceFilename or company+title → score
    // QA report format may vary, so use flexible matching
    const scoreLines = qaReportContent.match(/.*?(\d{2,3})\s*\/\s*100.*?resume.*?/gi);
    if (scoreLines) {
      for (const line of scoreLines) {
        const pctMatch = line.match(/(\d{2,3})\s*\/\s*100/);
        if (pctMatch) {
          const val = parseInt(pctMatch[1], 10);
          // Store as a generic score — no source filename mapping from qa_report
          // This is best-effort; individual forensic_audit.md files are the primary source
        }
      }
    }
  }

  // 10. SEQUENTIAL per-job data extraction loop — NO Promise.all
  const optimizedData = [];
  const totalJobs = highScoreEntries.length;
  let totalTimeMs = 0;

  for (let i = 0; i < totalJobs; i++) {
    const entry = highScoreEntries[i];
    const jobStartTime = Date.now();

    // a. Retrieve source content from the in-memory map
    const jobContent = jobFileMap.get(entry.sourceFilename);
    if (!jobContent) {
      logger.warn(
        '[optimize]',
        `Source file ${entry.sourceFilename} not found for ${entry.company} — ${entry.title} — cleanup may have run. Skipping.`
      );
      broadcastEvent('job_skipped', {
        company: entry.company,
        title: entry.title,
        reason: 'Source file not found',
      });
      continue;
    }

    // Parse the job file to get the full JobFile (with description)
    let jobFile;
    try {
      jobFile = parseJobFile(jobContent, entry.sourceFilename);
    } catch (err) {
      logger.warn(
        '[optimize]',
        `Failed to parse ${entry.sourceFilename}: ${err.message}. Skipping ${entry.company} — ${entry.title}.`
      );
      broadcastEvent('job_skipped', {
        company: entry.company,
        title: entry.title,
        reason: `Parse error: ${err.message}`,
      });
      continue;
    }

    // b. Compute output directory
    const outputDir = getOutputDir(RESUMES_DIR, dateStr, entry.company, entry.title);

    // c. Read forensic_audit.md
    let auditContent;
    try {
      auditContent = await fileStore.readForensicAudit(
        RESUMES_DIR,
        dateStr,
        entry.company,
        entry.title
      );
    } catch (err) {
      if (err.code === 'ENOENT') {
        logger.warn(
          '[optimize]',
          `forensic_audit.md not found for ${entry.company} — ${entry.title} — run review.js first. Skipping.`
        );
        broadcastEvent('job_skipped', {
          company: entry.company,
          title: entry.title,
          reason: 'forensic_audit.md not found — run review.js first',
        });
        continue;
      }
      throw err;
    }

    // d. Extract data from forensic_audit.md
    const qaScore = extractQaScore(auditContent);
    const fillerBlocks = extractFillerBlocks(auditContent);
    const zeroFreqKeywords = extractZeroFreqKeywords(auditContent);

    // e. Accumulate
    optimizedData.push({
      rank: entry.rank,
      company: entry.company,
      title: entry.title,
      score: entry.score,
      qaScore,
      fillerBlocks,
      zeroFreqKeywords,
    });

    // f. Broadcast job_optimized event
    broadcastEvent('job_optimized', {
      company: entry.company,
      title: entry.title,
      sourceFilename: entry.sourceFilename,
      qaScore,
      fillerCount: fillerBlocks.length,
      zeroFreqCount: zeroFreqKeywords.length,
    });

    // g. Log progress with ETA
    const elapsedMs = Date.now() - jobStartTime;
    totalTimeMs += elapsedMs;
    const avgMsPerJob = totalTimeMs / (i + 1);
    const remaining = totalJobs - (i + 1);
    const etaSecs = Math.round((avgMsPerJob * remaining) / 1000);
    logger.info(
      '[optimize]',
      `${i + 1}/${totalJobs}: ${entry.company} — ${entry.title} (${qaScore !== null ? 'QA: ' + qaScore + '%' : 'no QA score'}, ` +
      `${zeroFreqKeywords.length} zero-freq keywords) (est. ${etaSecs}s remaining)`
    );
  }

  if (optimizedData.length === 0) {
    logger.info('[optimize]', 'No jobs had forensic audit data available — nothing to analyze.');
    broadcastEvent('optimize_complete', { optimized: 0 });
    process.exit(0);
  }

  // 11. Compile Batch Performance Matrix
  const batchMatrix = buildBatchMatrix(optimizedData);
  logger.info('[optimize]', `Compiled batch matrix for ${optimizedData.length} qualifying roles`);

  // 12. Ingest prompt configurations (already read in step 2)
  const scoringPrompt = configContents['scoring_prompt.md'];
  const resumePrompt = configContents['resume_prompt.md'];
  const clPrompt = configContents['cover_letter_prompt.md'];
  const qualityPrompt = configContents['quality_prompt.md'];

  // 13. Single DeepSeek meta-analysis call
  const optimizeSystemPrompt = [
    'You are an elite prompt engineering analyst. Your task is to analyze a set of',
    'job-pipeline system prompts against real-world forensic audit outcomes from',
    'high-scoring job applications (score >= 7/10).',
    '',
    'You will receive:',
    '1. A Batch Performance Matrix — structured data about QA scores, filler/',
    '   over-qualification warnings, and zero-frequency keywords from actual',
    '   generated documents.',
    '2. The full text of all 4 system prompts used in the pipeline.',
    '',
    'Your job is to identify correlations between prompt gaps and audit findings,',
    'then recommend specific, actionable prompt edits. Be precise — reference',
    'exact sections or behaviors in the prompts that need change.',
    '',
    'Output your analysis as a clean markdown document following the exact format',
    'specified in the user message below.',
  ].join('\n');

  const userPrompt = buildOptimizePrompt(
    batchMatrix,
    scoringPrompt,
    resumePrompt,
    clPrompt,
    qualityPrompt
  );

  let llmResponse;
  try {
    logger.info('[optimize]', 'Calling DeepSeek for meta-analysis...');
    llmResponse = await callDeepSeek(optimizeSystemPrompt, userPrompt, {
      maxTokens: 4096,
      timeoutMs: 60000,
    });
  } catch (err) {
    logger.error('[optimize]', `DeepSeek meta-analysis failed: ${err.message}`);
    broadcastEvent('optimize_complete', { optimized: 0, error: err.message });
    process.exit(1);
  }

  // DIAGNOSTIC: Log response length and check for truncation
  const responseLen = llmResponse ? llmResponse.length : 0;
  const lastChars = llmResponse ? llmResponse.slice(-60) : '';
  const endsAbruptly = lastChars.match(/[a-zA-Z]$/);  // ends mid-word
  logger.info('[optimize]', `DeepSeek response: ${responseLen} chars, maxTokens=2000${endsAbruptly ? ', WARNING: response ends mid-word (likely truncated)' : ''}`);

  // 14. Format the response — prepend header metadata if not present
  const diagnosticsContent = [
    `# Prompt Diagnostics — ${dateStr}`,
    '',
    `*Generated: ${new Date().toISOString().replace('T', ' ').slice(0, 19)}*`,
    `*Jobs analyzed: ${optimizedData.length}*`,
    '',
    '---',
    '',
    llmResponse.trim(),
    '',
  ].join('\n');

  // 15. Write diagnostics report to disk
  const writtenPath = await fileStore.writePromptDiagnostics(RESUMES_DIR, dateStr, diagnosticsContent);

  // 16. Broadcast optimize_complete
  broadcastEvent('optimize_complete', { optimized: optimizedData.length });

  // 17. Log completion
  logger.info(
    '[optimize]',
    `Done. ${optimizedData.length} jobs analyzed → ${writtenPath}`
  );
})();
