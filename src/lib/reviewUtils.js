'use strict';

/**
 * Smart Suffix Stripper — normalize plural forms by clipping trailing s/es/ies
 * suffixes, while respecting an over-stripping guardrail list of domain terms
 * that end natively in 's' and must NOT be clipped.
 *
 * These terms are common in GRC/tech domains and would produce false stem
 * matches if the suffix clipper ran on them (e.g., "process" → "proce").
 */
const NATIVE_S_TERMS = new Set([
  'business',
  'process',
  'access',
  'analysis',
  'basis',
  'crisis',
  'diagnosis',
  'hypothesis',
  'thesis',
  'status',
  'focus',
  'campus',
  'atlas',
  'bias',
  'gas',
  'canvas',
]);

/**
 * Normalize a string for keyword matching: lowercase, strip leading/trailing
 * punctuation, strip possessives, and normalize pluralization markers.
 *
 * The over-stripping guardrail ensures that domain-critical terms ending
 * naturally in 's' (e.g., business, process, access, analysis) are skipped
 * by the suffix-clipping routine so their root words remain intact.
 *
 * @param {string} str - Input string to normalize.
 * @returns {string} Normalized string ready for matching.
 */
function normalizeKeyword(str) {
  if (!str || typeof str !== 'string') {
    return '';
  }

  let s = str.toLowerCase().trim();

  // Strip leading punctuation (including hyphens and em-dashes)
  s = s.replace(/^[.,;:!?()'"\s\-\u2014]+/, '');
  // Strip trailing punctuation (including hyphens and em-dashes)
  s = s.replace(/[.,;:!?()'"\s\-\u2014]+$/, '');
  // Strip trailing possessive "'s"
  s = s.replace(/'s$/, '');

  // ── Over-Stripping Guardrail ──────────────────────────────────────────
  // If the normalized word is in the native-s exception list, skip suffix
  // clipping entirely so that e.g. "process" remains "process", not "proce".
  if (NATIVE_S_TERMS.has(s)) {
    return s;
  }

  // ── Pluralization normalization ───────────────────────────────────────
  // "ies" → "y"  (e.g., "policies" → "policy", "strategies" → "strategy")
  if (s.endsWith('ies') && s.length > 4) {
    return s.slice(0, -3) + 'y';
  }
  // "es" → ""   (e.g., "frameworks" → "framework", "breaches" → "breach")
  // Skip words ending in "ces" (e.g., "process" was already caught by
  // guardrail, but "traces" → "trace" is safe)
  if (s.endsWith('es') && s.length > 4 && !s.endsWith('ces')) {
    return s.slice(0, -2);
  }
  // trailing "s" → ""  (e.g., "tools" → "tool", "frameworks" → "framework")
  // Skip words ending in "ss" (e.g., "access" was caught by guardrail)
  if (s.endsWith('s') && !s.endsWith('ss') && s.length > 3) {
    return s.slice(0, -1);
  }

  return s;
}

/**
 * Normalize a content string word-by-word so that pluralization and
 * punctuation normalization apply to every token, not just the last word.
 *
 * Splits on word boundaries, normalizes each word via normalizeKeyword(),
 * then rejoins with a single space.
 *
 * @param {string} content - Raw content string to normalize.
 * @returns {string} Word-by-word normalized content.
 */
function normalizeContent(content) {
  if (!content || typeof content !== 'string') {
    return '';
  }
  // Split on any non-word characters, preserving contractions and hyphens
  // by using \b boundaries instead of simple space-splitting.
  const words = content.match(/\b\w+\b/g) || [];
  const normalized = words.map(function (w) { return normalizeKeyword(w); });
  return normalized.join(' ');
}

/**
 * Perform a case-insensitive frequency count of keywords against text content.
 *
 * Each keyword is normalized via normalizeKeyword() before matching against
 * content that has been normalized word-by-word via normalizeContent().
 * Uses word-boundary-aware regex for exact substring matching to avoid false
 * partial matches.
 *
 * @param {string[]} keywords - Array of keyword strings to search for.
 * @param {string} content - Text content to scan (e.g., the generated resume.md).
 * @returns {{ keyword: string, count: number }[]} Sorted by count descending.
 */
function countKeywordFrequencies(keywords, content) {
  if (!Array.isArray(keywords) || keywords.length === 0) {
    return [];
  }

  const normalizedContent = normalizeContent(content);
  const results = [];

  for (let i = 0; i < keywords.length; i++) {
    const kw = keywords[i];
    const normalizedKw = normalizeKeyword(kw);
    if (!normalizedKw) {
      results.push({ keyword: kw, count: 0 });
      continue;
    }

    const escaped = normalizedKw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp('\\b' + escaped + '\\b', 'gi');
    const matches = normalizedContent.match(regex);
    results.push({ keyword: kw, count: matches ? matches.length : 0 });
  }

  // Sort by count descending
  results.sort(function (a, b) { return b.count - a.count; });
  return results;
}

module.exports = {
  normalizeKeyword,
  countKeywordFrequencies,
};
