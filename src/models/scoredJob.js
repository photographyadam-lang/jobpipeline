'use strict';

const { DeepSeekResponseError } = require('../lib/errors');

/**
 * Parse a raw DeepSeek scoring response JSON string into a structured object.
 *
 * @param {string} rawResponse - Raw JSON string from DeepSeek.
 * @returns {{ score: number, fitSignal: string, gap: string, mustHaves: string, targetArchetype: string, matchedPillars: string[], criticalKeywords: string, overQualified: boolean }}
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

  // 7. must_haves — warn + default on failure, never throw
  let mustHaves = '—';
  if (typeof parsed.must_haves === 'string' && parsed.must_haves.trim() !== '') {
    mustHaves = parsed.must_haves;
  } else {
    process.emitWarning('must_haves is missing or empty — defaulting to em-dash');
  }

  // 8. target_archetype — warn + default on failure, never throw
  let targetArchetype = '—';
  if (typeof parsed.target_archetype === 'string' && parsed.target_archetype.trim() !== '') {
    targetArchetype = parsed.target_archetype;
  } else {
    process.emitWarning('target_archetype is missing or empty — defaulting to em-dash');
  }

  // 9. matched_pillars — warn + default on failure, never throw
  let matchedPillars = [];
  if (Array.isArray(parsed.matched_pillars)) {
    matchedPillars = parsed.matched_pillars;
  } else {
    process.emitWarning('matched_pillars is missing or not an array — defaulting to empty array');
  }

  // 10. critical_keywords — warn + default on failure, never throw
  let criticalKeywords = '';
  if (typeof parsed.critical_keywords === 'string' && parsed.critical_keywords.trim() !== '') {
    criticalKeywords = parsed.critical_keywords;
  } else {
    process.emitWarning('critical_keywords is missing or empty — defaulting to empty string');
  }

  // 11. over_qualified — warn + default on failure, never throw
  let overQualified = false;
  if (typeof parsed.over_qualified === 'boolean') {
    overQualified = parsed.over_qualified;
  } else if (parsed.over_qualified !== undefined && parsed.over_qualified !== null) {
    // Coerce truthy/falsy non-boolean values (e.g., "true", 1)
    overQualified = Boolean(parsed.over_qualified);
    process.emitWarning(`over_qualified received non-boolean value — coerced to ${overQualified}`);
  } else {
    process.emitWarning('over_qualified is missing — defaulting to false');
  }

  return {
    score: parsed.score,
    fitSignal: parsed.fit_signal,
    gap: parsed.gap,
    mustHaves: mustHaves,
    targetArchetype: targetArchetype,
    matchedPillars: matchedPillars,
    criticalKeywords: criticalKeywords,
    overQualified: overQualified,
  };
}

/**
 * Combine a valid JobFile object with parsed scoring attributes into a ScoredJob.
 *
 * @param {object} job - A valid JobFile object.
 * @param {{ score: number, fitSignal: string, gap: string, mustHaves: string, targetArchetype: string, matchedPillars: string[], criticalKeywords: string, overQualified: boolean }} scoreResult - Parsed score fields.
 * @returns {object} ScoredJob with rank and actionFlag set to null.
 */
function createScoredJob(job, scoreResult) {
  return {
    ...job,
    ...scoreResult,
    rank: null,
    actionFlag: null,
  };
}

module.exports = { parseScoreResponse, createScoredJob };
