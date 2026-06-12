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
const { countKeywordFrequencies } = require('./src/lib/reviewUtils');
const { parseJobFile, sanitizeForFilename } = require('./src/models/job');
const { parseStackRank } = require('./src/models/stackRank');

// ── Constants ──────────────────────────────────────────────────────────────────

const ROOT_DIR = process.env.PIPELINE_BASE_DIR || __dirname;
const RESUMES_DIR = path.join(ROOT_DIR, 'resumes');
const JOBS_DIR = path.join(ROOT_DIR, 'jobs');

/**
 * System prompt for the Forensic Audit Narrative LLM call.
 *
 * Directs DeepSeek to act as an elite recruiter, perform a 6-second identity
 * projection scan of the generated resume and cover letter, then ruthlessly
 * flag unlinked filler sections and over-qualification risks.
 */
const FORENSIC_AUDIT_SYSTEM_PROMPT = [
  'You are an elite executive recruiter conducting a ruthless forensic audit of',
  'a candidate\'s application package against a target job description.',
  '',
  'Analyze the following inputs and produce a structured critique:',
  '',
  '1. **Identity Projection (6-Second Scan):** What professional identity does',
  '   this application project in the first 6 seconds? Is the narrative cohesive?',
  '   Does the candidate come across as a privacy/compliance leader, a software',
  '   engineer, a generalist, or something else? Be brutally honest.',
  '',
  '2. **Filler & Over-Qualification Analysis:** Identify specific sections or',
  '   bullet points in the resume or cover letter that read as unlinked "filler"',
  '   — content that does not connect to the job\'s requirements. Also flag any',
  '   areas where the candidate\'s background may appear over-qualified or',
  '   mismatched for the target role level.',
  '',
  'Output your analysis as clean, concise markdown paragraphs under exactly two',
  'sections: "## Identity Projection" and "## Filler & Over-Qualification Analysis".',
  'Do not include a preamble, conclusion, or markdown code fences.',
].join('\n');

/**
 * System prompt for the Keyword Extraction LLM call.
 *
 * Instructs DeepSeek to extract the top 10 most critical operational and
 * technical keywords from the job description and return them as a raw JSON
 * array of strings. No markdown fences, no extra prose.
 *
 * Explicitly prefers single technical acronyms, regulatory frameworks, and
 * core verbs/nouns over long compound multi-word phrases to maximize the
 * probability of exact matches in the generated resume text.
 */
const KEYWORD_EXTRACTION_SYSTEM_PROMPT = [
  'You are a keyword extraction utility. From the job description provided below,',
  'extract exactly the 10 most critical operational and technical keywords.',
  '',
  'Rules:',
  '- Return ONLY a raw JSON array of 10 strings.',
  '- Do NOT include markdown code fences, backticks, or any explanatory text.',
  '- Example format: ["keyword1","keyword2","keyword3","keyword4","keyword5","keyword6","keyword7","keyword8","keyword9","keyword10"]',
  '- Extract SINGLE technical acronyms (e.g., GDPR, SOC 2, QMS, AI, KYC, CCPA),',
  '  specific regulatory frameworks, or core verbs/nouns (e.g., Governance,',
  '  Compliance, Framer, Python, Auditing).',
  '- AVOID long compound multi-word phrases like "Quality Management System" or',
  '  "Data Protection Impact Assessment" — prefer the acronym or distilled token.',
  '- Keywords should be 1-3 words maximum. Prefer 1-word tokens.',
  '- Output exactly 10 items — no more, no fewer.',
].join('\n');

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Strip markdown code fences from a raw LLM response string.
 *
 * DeepSeek may wrap JSON in ```json ... ``` fences despite being instructed
 * not to. This safely removes leading/trailing fences.
 *
 * @param {string} raw - The raw response string from callDeepSeek.
 * @returns {string} Cleaned string ready for JSON.parse.
 */
function stripCodeFences(raw) {
  let cleaned = raw.trim();
  // Remove leading ```json or ``` (with optional whitespace)
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/i, '').replace(/\s*```$/i, '');
  }
  return cleaned.trim();
}

/**
 * Compute the application package output directory path.
 *
 * Mirrors the identical function in generate.js so that both scripts resolve
 * to the same output directory for a given company + title.
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
 * Build the user prompt for the Forensic Audit Narrative LLM call.
 *
 * Aggregates the full job description, stack rank metadata, and the
 * generated resume + cover letter text.
 *
 * @param {string} jobDescription - Full job description text.
 * @param {object} jobMeta - Stack rank metadata (company, title, rank, score, actionFlag, url).
 * @param {string} resumeContent - Content of generated resume.md.
 * @param {string} coverLetterContent - Content of generated cover_letter.md.
 * @returns {string} Formatted user prompt.
 */
function buildAuditUserPrompt(jobDescription, jobMeta, resumeContent, coverLetterContent) {
  return [
    'TARGET JOB DESCRIPTION:',
    '',
    jobDescription,
    '',
    'STACK RANK METADATA:',
    `- Company: ${jobMeta.company}`,
    `- Title: ${jobMeta.title}`,
    `- Rank: ${jobMeta.rank}`,
    `- Score: ${jobMeta.score}/10`,
    `- Action Flag: ${jobMeta.actionFlag}`,
    `- URL: ${jobMeta.url}`,
    '',
    'GENERATED RESUME:',
    '',
    resumeContent,
    '',
    'GENERATED COVER LETTER:',
    '',
    coverLetterContent,
  ].join('\n');
}

/**
 * Build the user prompt for the Keyword Extraction LLM call.
 *
 * Passes only the job description text.
 *
 * @param {string} jobDescription - Full job description text.
 * @returns {string} Formatted user prompt.
 */
function buildKeywordUserPrompt(jobDescription) {
  return [
    'Extract the top 10 keywords from the following job description:',
    '',
    jobDescription,
  ].join('\n');
}

// countKeywordFrequencies has been extracted to src/lib/reviewUtils.js
// and is imported at the top of this file.

/**
 * Build the full forensic_audit.md markdown content.
 *
 * Combines the LLM-generated audit narrative with the programmatic keyword
 * frequency table.
 *
 * @param {object} jobMeta - Stack rank metadata.
 * @param {string} auditNarrative - The full narrative from the Forensic Audit LLM call.
 * @param {{ keyword: string, count: number }[]} keywordTable - Programmatic keyword counts.
 * @returns {string} Complete markdown content for forensic_audit.md.
 */
function formatForensicAudit(jobMeta, auditNarrative, keywordTable) {
  const lines = [];

  // Header
  lines.push(`# Forensic Audit — ${jobMeta.company} | ${jobMeta.title}`);
  lines.push('');

  // ── Job Metadata ─────────────────────────────────────────────────────────
  lines.push('## Job Information');
  lines.push('');
  lines.push('| Field | Value |');
  lines.push('|-------|-------|');
  lines.push(`| **Company** | ${jobMeta.company} |`);
  lines.push(`| **Title** | ${jobMeta.title} |`);
  lines.push(`| **Location** | ${jobMeta.location || 'N/A'} |`);
  lines.push(`| **Salary** | ${jobMeta.salary || 'N/A'} |`);
  lines.push(`| **Stack Rank** | ${jobMeta.rank != null ? '#' + jobMeta.rank : 'N/A'} |`);
  lines.push(`| **Score** | ${jobMeta.score != null ? jobMeta.score + '/10' : 'N/A'} |`);
  lines.push(`| **Action Flag** | ${jobMeta.actionFlag || 'N/A'} |`);
  lines.push(`| **URL** | ${jobMeta.url || 'N/A'} |`);
  lines.push(`| **LinkedIn Job ID** | ${jobMeta.linkedInJobId || 'N/A'} |`);
  lines.push('');

  // Audit narrative
  lines.push(auditNarrative.trim());
  lines.push('');

  // Keyword frequency table
  lines.push('## Keyword Frequency Table');
  lines.push('');
  lines.push('| Keyword | Frequency |');
  lines.push('|---------|-----------|');

  for (const entry of keywordTable) {
    lines.push(`| ${entry.keyword} | ${entry.count} |`);
  }

  lines.push('');
  return lines.join('\n');
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

  // 2. Read stack rank for the target date
  let stackRankContent;
  try {
    stackRankContent = await fileStore.readStackRank(RESUMES_DIR, dateStr);
  } catch (err) {
    logger.error('[review]', `No stack rank for ${dateStr}. Run: node score.js --date=${dateStr}`);
    process.exit(1);
  }

  // 3. Parse qualifying jobs (DEEP_TAILOR and AUTO_GENERATED only)
  const qualifyingJobs = parseStackRank(stackRankContent);
  if (qualifyingJobs.length === 0) {
    logger.info('[review]', 'No qualifying jobs found in stack rank — nothing to review.');
    process.exit(0);
  }

  // 4. OPTIMIZED I/O CAPTURE — read job files ONCE before the loop into a Map
  let allJobFiles;
  try {
    allJobFiles = await fileStore.readJobFiles(JOBS_DIR);
  } catch (err) {
    logger.error('[review]', `Failed to read job files from ${JOBS_DIR}: ${err.message}`);
    process.exit(1);
  }
  const jobFileMap = new Map(allJobFiles.map(function (f) { return [f.filename, f.content]; }));

  // 5. Broadcast lifecycle start
  await broadcastEvent('review_started', { total: qualifyingJobs.length, date: dateStr });

  // 6. SEQUENTIAL core processing loop — NO Promise.all
  const totalJobs = qualifyingJobs.length;
  let totalTimeMs = 0;

  for (let i = 0; i < totalJobs; i++) {
    const qualifyingJob = qualifyingJobs[i];
    const jobStartTime = Date.now();

    // a. Retrieve source content from the in-memory map
    const jobContent = jobFileMap.get(qualifyingJob.sourceFilename);
    if (!jobContent) {
      logger.warn(
        '[review]',
        `Source file ${qualifyingJob.sourceFilename} not found for ${qualifyingJob.company} — ${qualifyingJob.title} — cleanup may have run. Skipping.`
      );
      broadcastEvent('job_skipped', {
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
        '[review]',
        `Failed to parse ${qualifyingJob.sourceFilename}: ${err.message}. Skipping ${qualifyingJob.company} — ${qualifyingJob.title}.`
      );
      broadcastEvent('job_skipped', {
        company: qualifyingJob.company,
        title: qualifyingJob.title,
        reason: `Parse error: ${err.message}`,
      });
      continue;
    }

    // b. Compute output directory and read generated docs
    const outputDir = getOutputDir(RESUMES_DIR, dateStr, qualifyingJob.company, qualifyingJob.title);

    let resumeContent;
    let coverLetterContent;
    try {
      resumeContent = await fs.readFile(path.join(outputDir, 'resume.md'), 'utf-8');
      coverLetterContent = await fs.readFile(path.join(outputDir, 'cover_letter.md'), 'utf-8');
    } catch (err) {
      if (err.code === 'ENOENT') {
        logger.warn(
          '[review]',
          `Generated docs not found for ${qualifyingJob.company} — ${qualifyingJob.title} — run generate.js first. Skipping.`
        );
        broadcastEvent('job_skipped', {
          company: qualifyingJob.company,
          title: qualifyingJob.title,
          reason: 'Generated docs not found — run generate.js first',
        });
        continue;
      }
      throw err;
    }

    // Build metadata object for the LLM prompt
    const jobMeta = {
      company: qualifyingJob.company,
      title: qualifyingJob.title,
      rank: qualifyingJob.rank,
      score: qualifyingJob.score,
      actionFlag: qualifyingJob.actionFlag,
      url: jobFile.url,
      linkedInJobId: jobFile.linkedInJobId,
      location: jobFile.location,
      salary: jobFile.salary,
    };

    // c. LLM Call 1 — Forensic Audit Narrative
    let auditNarrative;
    try {
      auditNarrative = await callDeepSeek(
        FORENSIC_AUDIT_SYSTEM_PROMPT,
        buildAuditUserPrompt(jobFile.description, jobMeta, resumeContent, coverLetterContent),
        { maxTokens: 1500, timeoutMs: 60000 }
      );
    } catch (err) {
      logger.error(
        '[review]',
        `DeepSeek error on forensic audit for ${qualifyingJob.company} — ${qualifyingJob.title}: ${err.message}`
      );
      broadcastEvent('job_skipped', {
        company: qualifyingJob.company,
        title: qualifyingJob.title,
        reason: `Forensic audit failed: ${err.message}`,
      });
      continue;
    }

    // d. LLM Call 2 — Keyword Extraction
    let rawKeywordResponse;
    try {
      rawKeywordResponse = await callDeepSeek(
        KEYWORD_EXTRACTION_SYSTEM_PROMPT,
        buildKeywordUserPrompt(jobFile.description),
        { maxTokens: 500, timeoutMs: 30000 }
      );
    } catch (err) {
      logger.error(
        '[review]',
        `DeepSeek error on keyword extraction for ${qualifyingJob.company} — ${qualifyingJob.title}: ${err.message}`
      );
      broadcastEvent('job_skipped', {
        company: qualifyingJob.company,
        title: qualifyingJob.title,
        reason: `Keyword extraction failed: ${err.message}`,
      });
      continue;
    }

    // e. Parse keyword JSON — strip code fences, then JSON.parse
    let keywords;
    try {
      const cleaned = stripCodeFences(rawKeywordResponse);
      keywords = JSON.parse(cleaned);
      // Validate it's an array of strings with length 10
      if (!Array.isArray(keywords) || keywords.length === 0) {
        throw new Error('Parsed response is not a non-empty array');
      }
      // Ensure all elements are strings
      keywords = keywords.map(function (k) { return String(k).trim(); }).filter(function (k) { return k.length > 0; });
      if (keywords.length === 0) {
        throw new Error('No valid keyword strings after sanitization');
      }
    } catch (err) {
      logger.warn(
        '[review]',
        `Failed to parse keyword JSON for ${qualifyingJob.company} — ${qualifyingJob.title}: ${err.message}. Proceeding with empty keyword table.`
      );
      keywords = [];
    }

    // f. Programmatic keyword frequency counting
    const keywordTable = countKeywordFrequencies(keywords, resumeContent);

    // g. Format and write forensic_audit.md
    const auditContent = formatForensicAudit(jobMeta, auditNarrative, keywordTable);
    const auditPath = await fileStore.writeForensicAudit(
      RESUMES_DIR,
      dateStr,
      qualifyingJob.company,
      qualifyingJob.title,
      auditContent
    );

    // h. Broadcast job_reviewed event
    broadcastEvent('job_reviewed', {
      company: qualifyingJob.company,
      title: qualifyingJob.title,
      sourceFilename: qualifyingJob.sourceFilename,
      keywordCount: keywords.length,
    });

    // i. Log progress with estimated duration remaining
    const elapsedMs = Date.now() - jobStartTime;
    totalTimeMs += elapsedMs;
    const avgMsPerJob = totalTimeMs / (i + 1);
    const remaining = totalJobs - (i + 1);
    const etaSecs = Math.round((avgMsPerJob * remaining) / 1000);
    logger.info(
      '[review]',
      `${i + 1}/${totalJobs}: ${qualifyingJob.company} — ${qualifyingJob.title} (est. ${etaSecs}s remaining)`
    );
  }

  // 7. Broadcast completion
  broadcastEvent('review_complete', { reviewed: totalJobs });

  // 8. Log final success banner
  logger.info(
    '[review]',
    `Done. ${totalJobs} jobs processed. Audit reports written to resumes/${dateStr}/`
  );
})();
