'use strict';

const { formatDateString, formatDateTimeString } = require('../lib/dateUtils');

/**
 * Map actionFlag constant to emoji-prefixed display text.
 * @param {string} flag - Action flag value.
 * @returns {string} Emoji + text label.
 */
function formatActionFlag(flag) {
  switch (flag) {
    case 'DEEP_TAILOR': return '🔴 DEEP TAILOR';
    case 'AUTO_GENERATED': return '🟡 AUTO-GENERATED';
    case 'NO_DOCS': return '⚪ NO DOCS';
    default: return flag || '';
  }
}

/**
 * Get short emoji for actionFlag (used in submission record).
 * @param {string} flag
 * @returns {string}
 */
function flagEmoji(flag) {
  switch (flag) {
    case 'DEEP_TAILOR': return '🔴';
    case 'AUTO_GENERATED': return '🟡';
    case 'NO_DOCS': return '⚪';
    default: return '';
  }
}

/**
 * Format an array of ranked ScoredJobs into the stack rank markdown string.
 *
 * @param {object[]} rankedJobs - Array of ScoredJob objects (with rank and actionFlag populated).
 * @param {Date} date - Date object for the header.
 * @param {object[]} fuzzyWarnings - Array of { job1, job2, reason } from deduplicator.
 * @param {{ scoreMean: number|null, scoreMin: number|null, scoreMax: number|null, distribution: object }} stats
 * @returns {string} Full stack rank markdown.
 */
function formatStackRank(rankedJobs, date, fuzzyWarnings, stats) {
  const lines = [];

  // -- Header --
  lines.push(`# Stack Rank — ${formatDateString(date)}`);
  lines.push('');

  const docsToGenerate = rankedJobs.filter(j => j.actionFlag !== 'NO_DOCS').length;
  const nowStr = formatDateTimeString(new Date());
  lines.push(`*Generated: ${nowStr} | Jobs scored: ${rankedJobs.length} | Documents to generate: ${docsToGenerate}*`);

  const mean = stats.scoreMean !== null && stats.scoreMean !== undefined
    ? Number(stats.scoreMean).toFixed(1)
    : '—';
  const min = stats.scoreMin !== null && stats.scoreMin !== undefined ? stats.scoreMin : '—';
  const max = stats.scoreMax !== null && stats.scoreMax !== undefined ? stats.scoreMax : '—';
  const dist = stats.distribution || {};
  const distStr = `distribution: 1-3: ${dist['1-3'] ?? 0} | 4-5: ${dist['4-5'] ?? 0} | 6-7: ${dist['6-7'] ?? 0} | 8-10: ${dist['8-10'] ?? 0}`;
  lines.push(`*Score stats: mean ${mean} | range ${min}–${max} | ${distStr}*`);

  // -- Fuzzy warnings --
  if (fuzzyWarnings && fuzzyWarnings.length > 0) {
    lines.push('');
    for (const warning of fuzzyWarnings) {
      const company = warning.job1 ? warning.job1.company : '';
      const title = warning.job1 ? warning.job1.title : '';
      lines.push(`⚠️ **Possible duplicate:** "${company} — ${title}" appears at 2 different URLs. Verify before generating.`);
    }
  }

  // -- Job entries --
  for (const job of rankedJobs) {
    lines.push('');
    const flagText = formatActionFlag(job.actionFlag);
    lines.push(`## ${job.rank}. [${job.score}/10] [${flagText}] — ${job.company} | ${job.title}`);
    lines.push(`**Source file:** ${job.filename}`);
    lines.push(`**LinkedIn Job ID:** ${job.linkedInJobId ?? 'Not available'}`);
    lines.push(`**URL:** ${job.url}`);

    // Build location line — omit Salary if null
    let locLine = `**Location:** ${job.location} | **Employment Type:** ${job.employmentType}`;
    if (job.salary !== null && job.salary !== undefined) {
      locLine += ` | **Salary:** ${job.salary}`;
    }
    lines.push(locLine);

    const harvestedStr = job.harvested instanceof Date
      ? formatDateTimeString(job.harvested)
      : String(job.harvested);
    lines.push(`**Harvested:** ${harvestedStr}`);

    lines.push('');
    lines.push(`**Fit:** ${job.fitSignal}`);
    lines.push(`**Gap:** ${job.gap}`);
    lines.push('');
    lines.push('---');
  }

  return lines.join('\n');
}

/**
 * Parse a stack rank markdown string into structured entries.
 * Returns only entries with actionFlag DEEP_TAILOR or AUTO_GENERATED.
 *
 * @param {string} markdown - Full stack rank markdown content.
 * @returns {{ rank: number, score: number, actionFlag: string, company: string, title: string, url: string, linkedInJobId: string|null, sourceFilename: string }[]}
 */
function parseStackRank(markdown) {
  const entries = [];

  // Match each job entry block: starts with "## \d+." and ends before the next "## \d+." or end of string.
  // Use a regex that captures the entire entry from the heading line to the "---" delimiter.
  const entryRegex = /## (\d+)\. \[(\d+)\/10\] \[(🔴|🟡|⚪) (.+?)\] — (.+?) \| (.+?)\n([\s\S]*?)(?=\n---|$)/g;

  let match;
  while ((match = entryRegex.exec(markdown)) !== null) {
    const rank = parseInt(match[1], 10);
    const score = parseInt(match[2], 10);
    const emoji = match[3];
    const company = match[5].trim();
    const title = match[6].trim();
    const body = match[7];

    // Determine actionFlag from emoji
    let actionFlag = null;
    if (emoji === '🔴') actionFlag = 'DEEP_TAILOR';
    else if (emoji === '🟡') actionFlag = 'AUTO_GENERATED';
    else actionFlag = 'NO_DOCS';

    // Filter: only DEEP_TAILOR and AUTO_GENERATED
    if (actionFlag !== 'DEEP_TAILOR' && actionFlag !== 'AUTO_GENERATED') {
      continue;
    }

    // Extract metadata fields from body
    const sourceFileMatch = body.match(/\*\*Source file:\*\* (.+)/);
    const linkedInIdMatch = body.match(/\*\*LinkedIn Job ID:\*\* (.+)/);
    const urlMatch = body.match(/\*\*URL:\*\* (.+)/);

    const sourceFilename = sourceFileMatch ? sourceFileMatch[1].trim() : '';
    const linkedInJobId = linkedInIdMatch && linkedInIdMatch[1].trim() !== 'Not available'
      ? linkedInIdMatch[1].trim()
      : null;
    const url = urlMatch ? urlMatch[1].trim() : '';

    entries.push({
      rank,
      score,
      actionFlag,
      company,
      title,
      url,
      linkedInJobId,
      sourceFilename,
    });
  }

  return entries;
}

/**
 * Format an ApplicationRecord + ScoredJob into the submission_record.md string.
 *
 * @param {object} record - ApplicationRecord object.
 * @param {object} scoredJob - ScoredJob object (for fitSignal, gap, filename).
 * @returns {string} Formatted submission record markdown.
 */
function formatSubmissionRecord(record, scoredJob) {
  const lines = [];

  // -- Header --
  lines.push(`# Submission Record — ${record.company} | ${record.title}`);
  lines.push('');
  lines.push(`**Generated:** ${record.dateGenerated}`);
  lines.push(`**Source JD:** archive/${record.dateGenerated}/${scoredJob.filename}`);
  lines.push(`**LinkedIn Job ID:** ${record.linkedInJobId ?? 'Not available'}`);
  const flagDisplay = `${flagEmoji(record.actionFlag)} ${formatActionFlag(record.actionFlag)}`;
  lines.push(`**Score:** ${record.score}/10 | ${flagDisplay}`);
  lines.push(`**Fit:** ${scoredJob.fitSignal}`);
  lines.push(`**Gap:** ${scoredJob.gap}`);

  // -- Pillars Selected --
  lines.push('');
  lines.push('## Pillars Selected');
  const pillars = record.pillarsSelected && record.pillarsSelected.length > 0
    ? record.pillarsSelected.join(' | ')
    : '—';
  lines.push(pillars);

  // -- Cover Letter Structure --
  lines.push('');
  lines.push('## Cover Letter Structure');
  if (record.coverLetterParas !== null && record.coverLetterParas !== undefined) {
    lines.push(`${record.coverLetterParas} paragraphs (body paras)`);
  } else {
    lines.push('—');
  }

  // -- Quality Assessment --
  lines.push('');
  lines.push('## Quality Assessment');
  const rq = record.resumeQuality !== null && record.resumeQuality !== undefined ? `${record.resumeQuality}/10` : '—';
  const clq = record.coverLetterQuality !== null && record.coverLetterQuality !== undefined ? `${record.coverLetterQuality}/10` : '—';
  lines.push(`**Resume:** ${rq} | **Cover Letter:** ${clq}`);
  lines.push(`**Note:** ${record.qualityNote ?? '—'}`);

  // -- Application Status --
  lines.push('');
  lines.push('## Application Status');
  lines.push(`**Date applied:** ${record.dateApplied ?? '—'}`);
  lines.push(`**Method:** ${record.applicationMethod ?? '—'}`);
  lines.push(`**Notes:** ${record.notes ?? '—'}`);

  return lines.join('\n');
}

module.exports = { formatStackRank, parseStackRank, formatSubmissionRecord };
