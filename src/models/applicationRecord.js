'use strict';

const { sanitizeForFilename } = require('./job');

/**
 * Valid status values for an ApplicationRecord.
 * All states an application can be in throughout its lifecycle.
 *
 * @type {string[]}
 */
const VALID_STATUSES = ['generated', 'applied', 'interviewing', 'rejected', 'offer', 'withdrawn'];

/**
 * Create a new ApplicationRecord from a ScoredJob at document generation time.
 *
 * Quality fields (resumeQuality, coverLetterQuality, qualityNote) start as null.
 * They are populated later by generate.js after the DeepSeek quality call.
 * pillarsSelected starts as an empty array — populated by the quality call.
 *
 * @param {object} scoredJob - A ScoredJob object (JobFile fields + score/fitSignal/gap/rank/actionFlag).
 * @param {string} outputPath - Sanitized output directory path (e.g. "resumes/2026-05-30/Company - Title/").
 * @param {string} dateStr - Date string in "YYYY-MM-DD" format.
 * @returns {object} ApplicationRecord with initialized default values.
 */
function createApplicationRecord(scoredJob, outputPath, dateStr) {
  return {
    id: generateRecordId(dateStr, scoredJob.company, scoredJob.title),
    company: scoredJob.company,
    title: scoredJob.title,
    url: scoredJob.url,
    linkedInJobId: scoredJob.linkedInJobId,
    score: scoredJob.score,
    actionFlag: scoredJob.actionFlag,
    resumeQuality: null,
    coverLetterQuality: null,
    qualityNote: null,
    pillarsSelected: [],
    coverLetterParas: null,
    outputPath,
    dateGenerated: dateStr,
    dateApplied: null,
    applicationMethod: null,
    status: 'generated',
    notes: '',
  };
}

/**
 * Validate whether a status string is a permitted value.
 *
 * @param {string} status - The status string to validate.
 * @returns {boolean} True if status is in VALID_STATUSES, false otherwise.
 */
function isValidStatus(status) {
  return VALID_STATUSES.includes(status);
}

/**
 * Generate a unique, deterministic record identifier slug.
 *
 * Uses sanitizeForFilename on both company and title to ensure the
 * resulting slug is filesystem-safe and free of special characters.
 *
 * Example: generateRecordId('2026-05-30', 'AT&T', 'Senior Engineer')
 * returns: '2026-05-30-ATT-Senior-Engineer'
 *
 * @param {string} dateStr - Date string in "YYYY-MM-DD" format.
 * @param {string} company - Company name.
 * @param {string} title - Job title.
 * @returns {string} Filesystem-safe unique slug.
 */
function generateRecordId(dateStr, company, title) {
  const safeCompany = sanitizeForFilename(company, 60);
  const safeTitle = sanitizeForFilename(title, 60);
  return `${dateStr}-${safeCompany}-${safeTitle}`;
}

module.exports = {
  VALID_STATUSES,
  createApplicationRecord,
  isValidStatus,
  generateRecordId,
};
