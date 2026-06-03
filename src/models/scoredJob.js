'use strict';

const { DeepSeekResponseError } = require('../lib/errors');

/**
 * Parse a raw DeepSeek scoring response JSON string into a structured object.
 *
 * @param {string} rawResponse - Raw JSON string from DeepSeek.
 * @returns {{ score: number, fitSignal: string, gap: string }}
 * @throws {DeepSeekResponseError} On any validation failure.
 */
function parseScoreResponse(rawResponse) {
  let parsed;

  // 1. Must be valid, parsable JSON
  try {
    parsed = JSON.parse(rawResponse);
  } catch {
    throw new DeepSeekResponseError('Response is not valid JSON');
  }

  // 2. score must be present
  if (parsed.score === undefined || parsed.score === null) {
    throw new DeepSeekResponseError('Score field is missing');
  }

  // 3. score must be an integer
  if (!Number.isInteger(parsed.score)) {
    throw new DeepSeekResponseError('Score must be an integer');
  }

  // 4. score must be within 1-10 range
  if (parsed.score < 1 || parsed.score > 10) {
    throw new DeepSeekResponseError('Score out of range (must be 1-10)');
  }

  // 5. fit_signal must be present and non-empty
  if (!parsed.fit_signal || (typeof parsed.fit_signal === 'string' && parsed.fit_signal.trim() === '')) {
    throw new DeepSeekResponseError('Fit signal is missing or empty');
  }

  // 6. gap must be present and non-empty
  if (!parsed.gap || (typeof parsed.gap === 'string' && parsed.gap.trim() === '')) {
    throw new DeepSeekResponseError('Gap is missing or empty');
  }

  return {
    score: parsed.score,
    fitSignal: parsed.fit_signal,
    gap: parsed.gap,
  };
}

/**
 * Combine a valid JobFile object with parsed scoring attributes into a ScoredJob.
 *
 * @param {object} job - A valid JobFile object.
 * @param {{ score: number, fitSignal: string, gap: string }} scoreResult - Parsed score fields.
 * @returns {object} ScoredJob with rank and actionFlag set to null.
 */
function createScoredJob(job, scoreResult) {
  return {
    ...job,
    score: scoreResult.score,
    fitSignal: scoreResult.fitSignal,
    gap: scoreResult.gap,
    rank: null,
    actionFlag: null,
  };
}

module.exports = { parseScoreResponse, createScoredJob };
