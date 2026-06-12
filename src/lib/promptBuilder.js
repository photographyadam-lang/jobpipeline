'use strict';

/**
 * Pure functions that assemble user-side prompt messages for the DeepSeek API.
 *
 * These functions perform zero disk I/O, network requests, or console output.
 * All content strings are passed in by the calling orchestrator — nothing is
 * read from files inside this module.
 *
 * System prompts come from config/ files and are passed through unchanged
 * by the orchestrator — they are not assembled here.
 */

/**
 * Build the user-side message for the DeepSeek scoring call.
 *
 * The output must include the exact section labels "CANDIDATE PROFILE:"
 * and "JOB DESCRIPTION:" so the downstream parser can anchor on them.
 *
 * @param {string} careerContents - Full contents of the career profile markdown.
 * @param {object} jobFile - A JobFile object (must have a `description` field).
 * @returns {string} Formatted user message.
 * @throws {Error} If either argument is missing or empty.
 */
function buildScoringPrompt(careerContents, jobFile) {
  if (!careerContents || typeof careerContents !== 'string') {
    throw new Error('buildScoringPrompt: careerContents must be a non-empty string');
  }
  if (!jobFile || typeof jobFile !== 'object') {
    throw new Error('buildScoringPrompt: jobFile must be a valid JobFile object');
  }
  if (!jobFile.description || typeof jobFile.description !== 'string') {
    throw new Error('buildScoringPrompt: jobFile.description must be a non-empty string');
  }

  return [
    'CANDIDATE PROFILE:',
    '',
    careerContents,
    '',
    'JOB DESCRIPTION:',
    '',
    jobFile.description,
  ].join('\n');
}

/**
 * Build the user-side message for the DeepSeek resume generation call.
 *
 * Payload contains the career asset, pillar library text block, the source job
 * description text, and both the fitSignal and gap properties extracted from
 * the scored job model.
 *
 * @param {string} careerContents - Full contents of the career profile markdown.
 * @param {string} pillarContents - Full contents of the pillar library markdown.
 * @param {object} scoredJob - A ScoredJob object (must have description, fitSignal, gap).
 * @returns {string} Formatted user message.
 * @throws {Error} If any argument is missing or invalid.
 */
function buildResumePrompt(careerContents, pillarContents, scoredJob, outputInstruction) {
  if (!careerContents || typeof careerContents !== 'string') {
    throw new Error('buildResumePrompt: careerContents must be a non-empty string');
  }
  if (!pillarContents || typeof pillarContents !== 'string') {
    throw new Error('buildResumePrompt: pillarContents must be a non-empty string');
  }
  if (!scoredJob || typeof scoredJob !== 'object') {
    throw new Error('buildResumePrompt: scoredJob must be a valid ScoredJob object');
  }
  if (!scoredJob.description || typeof scoredJob.description !== 'string') {
    throw new Error('buildResumePrompt: scoredJob.description must be a non-empty string');
  }
  if (typeof scoredJob.fitSignal !== 'string') {
    throw new Error('buildResumePrompt: scoredJob.fitSignal must be a string');
  }
  if (typeof scoredJob.gap !== 'string') {
    throw new Error('buildResumePrompt: scoredJob.gap must be a string');
  }

  const parts = [
    'CAREER HISTORY:',
    '',
    careerContents,
    '',
    'PILLAR LIBRARY:',
    '',
    pillarContents,
    '',
    'JOB DESCRIPTION:',
    '',
    scoredJob.description,
    '',
    'FIT SIGNAL:',
    scoredJob.fitSignal,
    '',
    'GAP:',
    scoredJob.gap,
  ];

  if (scoredJob.criticalKeywords) {
    parts.push('', 'CRITICAL KEYWORDS TO WEAVE:', '');
    parts.push(scoredJob.criticalKeywords);
  }

  if (outputInstruction) {
    parts.push('', outputInstruction);
  }

  return parts.join('\n');
}

/**
 * Build the user-side message for the DeepSeek cover letter generation call.
 *
 * Receives the career history, target job details, and the freshly generated
 * resume content markdown string so the cover letter parameters are locked to
 * the updated resume layout.
 *
 * @param {string} careerContents - Full contents of the career profile markdown.
 * @param {object} scoredJob - A ScoredJob object (must have description).
 * @param {string} resumeContent - The already-generated resume markdown string.
 * @returns {string} Formatted user message.
 * @throws {Error} If any argument is missing or invalid.
 */
function buildCoverLetterPrompt(careerContents, scoredJob, resumeContent) {
  if (!careerContents || typeof careerContents !== 'string') {
    throw new Error('buildCoverLetterPrompt: careerContents must be a non-empty string');
  }
  if (!scoredJob || typeof scoredJob !== 'object') {
    throw new Error('buildCoverLetterPrompt: scoredJob must be a valid ScoredJob object');
  }
  if (!scoredJob.description || typeof scoredJob.description !== 'string') {
    throw new Error('buildCoverLetterPrompt: scoredJob.description must be a non-empty string');
  }
  if (!resumeContent || typeof resumeContent !== 'string') {
    throw new Error('buildCoverLetterPrompt: resumeContent must be a non-empty string');
  }

  const parts = [
    'CAREER HISTORY:',
    '',
    careerContents,
    '',
    'JOB DESCRIPTION:',
    '',
    scoredJob.description,
  ];

  if (scoredJob.criticalKeywords) {
    parts.push('', 'CRITICAL KEYWORDS TO WEAVE:', '');
    parts.push(scoredJob.criticalKeywords);
  }

  parts.push('', 'GENERATED RESUME:', '', resumeContent);

  return parts.join('\n');
}

/**
 * Build the user-side message for the DeepSeek document quality rating call.
 *
 * Aggregates the source job description text, the generated resume content,
 * and the generated cover letter string.
 *
 * @param {object} scoredJob - A ScoredJob object (must have description).
 * @param {string} resumeContent - The generated resume markdown string.
 * @param {string} coverLetterContent - The generated cover letter string.
 * @returns {string} Formatted user message.
 * @throws {Error} If any argument is missing or invalid.
 */
function buildQualityPrompt(scoredJob, resumeContent, coverLetterContent) {
  if (!scoredJob || typeof scoredJob !== 'object') {
    throw new Error('buildQualityPrompt: scoredJob must be a valid ScoredJob object');
  }
  if (!scoredJob.description || typeof scoredJob.description !== 'string') {
    throw new Error('buildQualityPrompt: scoredJob.description must be a non-empty string');
  }
  if (!resumeContent || typeof resumeContent !== 'string') {
    throw new Error('buildQualityPrompt: resumeContent must be a non-empty string');
  }
  if (!coverLetterContent || typeof coverLetterContent !== 'string') {
    throw new Error('buildQualityPrompt: coverLetterContent must be a non-empty string');
  }

  const parts = [
    'JOB DESCRIPTION:',
    '',
    scoredJob.description,
  ];

  if (scoredJob.criticalKeywords) {
    parts.push('', 'CRITICAL KEYWORDS TO WEAVE:', '');
    parts.push(scoredJob.criticalKeywords);
  }

  parts.push('', 'GENERATED RESUME:', '', resumeContent);
  parts.push('', 'GENERATED COVER LETTER:', '', coverLetterContent);

  return parts.join('\n');
}

module.exports = {
  buildScoringPrompt,
  buildResumePrompt,
  buildCoverLetterPrompt,
  buildQualityPrompt,
};
