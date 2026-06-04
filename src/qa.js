'use strict';

require('dotenv').config();

const { parseArgs } = require('util');
const path = require('path');
const fs = require('fs');

const logger = require('./lib/logger');
const { formatDateString } = require('./lib/dateUtils');
const { broadcastEvent } = require('./lib/eventBroadcaster');
const fileStore = require('./lib/fileStore');
const { callDeepSeek } = require('./lib/deepseek');

// ── Constants ──────────────────────────────────────────────────────────────────
// CONFIG_DIR is anchored to process.cwd() so that config file resolution is safe
// regardless of where this script lives under src/. This avoids false negatives
// from __dirname resolving to src/ instead of the project root.
const CONFIG_DIR = path.resolve(process.cwd(), 'config');
const RESUMES_DIR = path.resolve(process.cwd(), 'resumes');

const REQUIRED_CONFIGS = [
  'qa_prompt.md',
  'adam_buteux_career.md',
  'pillar_library.md',
  'Writing_Style_Guide.md',
  'authenticity-SKILL.md',
];

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Strip control characters (U+0000–U+001F) that are NOT valid JSON whitespace.
 *
 * Valid JSON whitespace: 0x09 (tab), 0x0A (LF), 0x0D (CR), 0x20 (space).
 * Everything else in the control-char range is illegal inside a JSON string
 * and will cause JSON.parse to throw.
 *
 * Uses a character-code loop instead of a regex literal to avoid the
 * ESLint no-control-regex restriction.
 *
 * @param {string} text
 * @returns {string}
 */
function stripControlChars(text) {
  let result = '';
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    // Keep tabs (0x09), line-feeds (0x0A), carriage-returns (0x0D),
    // and anything >= 0x20 (space and above).
    if (code < 0x20 && code !== 0x09 && code !== 0x0A && code !== 0x0D) {
      continue;
    }
    result += text[i];
  }
  return result;
}

/**
 * Attempt to repair the most common JSON breakage seen in LLM responses:
 * unescaped double-quotes and unescaped newlines embedded inside string values.
 *
 * This uses a simple state-machine pass: it tracks whether we are inside a
 * string value (and whether that string is being escaped), and when it
 * encounters a bare newline or a likely-rogue double-quote inside a string
 * it escapes it.
 *
 * This is a best-effort repair — it does NOT guarantee valid JSON. Consumers
 * MUST still fall back to regex extraction if this pass does not produce
 * parseable JSON.
 *
 * @param {string} text - A JSON-ish string (after stripControlChars).
 * @returns {string} Repaired JSON string for a second parse attempt.
 */
function repairJsonStrings(text) {
  const chars = text.split('');
  const out = [];
  let inString = false;
  let isEscaped = false;

  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    const prev = i > 0 ? chars[i - 1] : '';

    if (!inString) {
      // Toggle string mode on unescaped double-quote
      if (ch === '"' && prev !== '\\') {
        inString = true;
        isEscaped = false;
      }
      out.push(ch);
      continue;
    }

    // We are inside a string value.
    if (ch === '\\' && !isEscaped) {
      isEscaped = true;
      out.push(ch);
      continue;
    }

    if (isEscaped) {
      isEscaped = false;
      out.push(ch);
      continue;
    }

    // Rogue unescaped double-quote inside string — escape it
    if (ch === '"') {
      // Check if this is likely the closing quote: if followed by whitespace
      // then a structural char (,:}]), treat it as closing.
      const rest = text.slice(i + 1).trimStart();
      if (rest.length > 0 && ',:}]'.includes(rest[0])) {
        inString = false;
        out.push(ch);
        continue;
      }
      // Otherwise escape it
      out.push('\\"');
      continue;
    }

    // Bare newline or carriage-return inside string — replace with \n or \r
    if (ch === '\n') {
      out.push('\\n');
      continue;
    }
    if (ch === '\r') {
      out.push('\\r');
      continue;
    }

    // Tab inside string — valid in JSON but convert to \t for safety
    if (ch === '\t') {
      out.push('\\t');
      continue;
    }

    out.push(ch);
  }

  return out.join('');
}

/**
 * Strip markdown code fences from a raw LLM response string.
 *
 * DeepSeek may wrap JSON in ```json ... ``` fences despite being instructed
 * not to. This safely removes leading/trailing fences. It also runs a
 * defensive pre-cleaner that strips illegal control characters and attempts
 * to repair the most common quoting / newline issues that cause JSON.parse
 * to crash.
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
  cleaned = cleaned.trim();
  // Defensive pre-cleaner: strip illegal control characters
  cleaned = stripControlChars(cleaned);
  return cleaned;
}

/**
 * Fallback regex extraction of the three structural QA keys when JSON.parse
 * fails even after pre-cleaning and repair attempts.
 *
 * The LLM response is expected to contain:
 *   "critique_summary":  "<string>"
 *   "adjustments_made":  [...]   (JSON array of strings)
 *   "sanitized_content": "<string>"
 *
 * @param {string} text - Raw (or pre-cleaned) response text.
 * @returns {{ critique_summary: string, adjustments_made: string[], sanitized_content: string }|null}
 *   Extracted values, or null if the required keys cannot be found.
 */
function extractJsonKeys(text) {
  const cr = text.match(/"critique_summary"\s*:\s*"((?:[^"\\]|\\.)*)"/s);
  const sd = text.match(/"sanitized_content"\s*:\s*"((?:[^"\\]|\\.)*)"/s);

  if (!cr || !sd) {
    return null; // required keys missing — cannot recover
  }

  let adjustments = [];
  const am = text.match(/"adjustments_made"\s*:\s*(\[[\s\S]*?\])\s*[,}\n]/);
  if (am) {
    try {
      adjustments = JSON.parse(am[1]);
    } catch {
      // If the array itself is broken, attempt line-by-line extraction
      const items = am[1].match(/"((?:[^"\\]|\\.)*)"/g);
      if (items) {
        adjustments = items.map(s => {
          try { return JSON.parse(s); } catch { return s.replace(/^"|"$/g, ''); }
        });
      }
    }
    if (!Array.isArray(adjustments)) {
      adjustments = [];
    }
  }

  return {
    critique_summary: cr[1].replace(/\\n/g, '\n').replace(/\\"/g, '"'),
    adjustments_made: adjustments,
    sanitized_content: sd[1].replace(/\\n/g, '\n').replace(/\\"/g, '"'),
  };
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

  // 2. Validate and load config files
  // Use fs.existsSync() — not async fs.promises or lstatSync — because OneDrive
  // virtualized files (NTFS Reparse Points) can cause false negatives with
  // isSymbolicLink() / lstatSync() checks.
  const configContents = {};
  const missingConfigs = [];
  for (const cfg of REQUIRED_CONFIGS) {
    const cfgPath = path.resolve(CONFIG_DIR, cfg);
    if (!fs.existsSync(cfgPath)) {
      missingConfigs.push(cfg);
      continue;
    }
    configContents[cfg] = await fileStore.readConfig(CONFIG_DIR, cfg);
  }
  if (missingConfigs.length > 0) {
    for (const cfg of missingConfigs) {
      logger.error('[qa]', `Missing config file: config/${cfg}`);
    }
    process.exit(1);
  }

  // 3. Discover application documents in the target date directory
  let docFiles;
  try {
    docFiles = await fileStore.readDateDir(RESUMES_DIR, dateStr);
  } catch (err) {
    if (err.code === 'ENOENT') {
      logger.info('[qa]', `No directory found: resumes/${dateStr}/`);
      process.exit(0);
    }
    throw err;
  }

  if (docFiles.length === 0) {
    logger.info('[qa]', `No application documents found in resumes/${dateStr}/`);
    process.exit(0);
  }

  logger.info('[qa]', `Found ${docFiles.length} document(s) in resumes/${dateStr}/`);

  // 4. Build the QA system prompt (from qa_prompt.md)
  const qaSystemPrompt = configContents['qa_prompt.md'];

  // 5. Build the reference context block (shared across all user prompts)
  const referenceContext = [
    'ADAM_BUTEUX_CAREER:',
    '',
    configContents['adam_buteux_career.md'],
    '',
    'PILLAR_LIBRARY:',
    '',
    configContents['pillar_library.md'],
    '',
    'WRITING_STYLE_GUIDE:',
    '',
    configContents['Writing_Style_Guide.md'],
    '',
    'AUTHENTICITY_SKILL:',
    '',
    configContents['authenticity-SKILL.md'],
  ].join('\n');

  // 6. Broadcast lifecycle start
  await broadcastEvent('qa_started', {
    date: dateStr,
    total: docFiles.length,
  });

  // 7. SEQUENTIAL processing loop — NO Promise.all
  const results = [];
  const totalFiles = docFiles.length;

  for (let i = 0; i < totalFiles; i++) {
    const doc = docFiles[i];
    const jobStartTime = Date.now();

    logger.info('[qa]', `Auditing ${doc.relativePath} (${i + 1}/${totalFiles})`);

    // a. Read the current file content
    let fileContent;
    try {
      fileContent = await fileStore.readDocFile(doc.filePath);
    } catch (err) {
      logger.error('[qa]', `Failed to read ${doc.relativePath}: ${err.message}`);
      results.push({
        file: doc.relativePath,
        error: err.message,
        critique_summary: 'File could not be read — document not sanitized.',
        adjustments_made: [],
      });
      continue;
    }

    // b. Build the full user prompt
    const userPrompt = [
      referenceContext,
      '',
      'DRAFT_CONTENT:',
      '',
      fileContent,
    ].join('\n');

    // c. Call DeepSeek
    let rawResponse;
    try {
      rawResponse = await callDeepSeek(qaSystemPrompt, userPrompt, {
        maxTokens: 4096,
        timeoutMs: 120000,
      });
    } catch (err) {
      logger.error('[qa]', `DeepSeek error for ${doc.relativePath}: ${err.message}`);
      results.push({
        file: doc.relativePath,
        error: err.message,
        critique_summary: 'LLM call failed — document not sanitized.',
        adjustments_made: [],
      });
      continue;
    }

    // d. Parse JSON response — strip code fences, pre-clean, with fallback
    let parsed;
    try {
      const cleaned = stripCodeFences(rawResponse);
      parsed = JSON.parse(cleaned);
    } catch (_firstErr) {
      // First fallback: attempt repair of unescaped quotes/newlines
      try {
        const repaired = repairJsonStrings(stripCodeFences(rawResponse));
        parsed = JSON.parse(repaired);
        logger.warn('[qa]', `  ⚠ JSON repair succeeded for ${doc.relativePath}`);
      } catch {
        // Second fallback: regex extraction of structural keys
        const extracted = extractJsonKeys(rawResponse);
        if (extracted) {
          logger.warn('[qa]', `  ⚠ Regex fallback used for ${doc.relativePath}`);
          parsed = {
            document_type: 'Unknown (recovered)',
            ...extracted,
          };
        } else {
          logger.error('[qa]', `JSON parse error for ${doc.relativePath}: ${_firstErr.message}`);
          results.push({
            file: doc.relativePath,
            error: `JSON parse error: ${_firstErr.message}`,
            critique_summary: 'LLM response could not be parsed — document not sanitized.',
            adjustments_made: [],
          });
          continue;
        }
      }
    }

    // e. In-place write — overwrite the source file with sanitized content
    if (parsed.sanitized_content && typeof parsed.sanitized_content === 'string') {
      await fileStore.writeDocFile(doc.filePath, parsed.sanitized_content);
      logger.info('[qa]', `  ✓ Updated ${doc.relativePath}`);
    } else {
      logger.warn('[qa]', `  ⚠ No sanitized_content in response for ${doc.relativePath}`);
    }

    // f. Accumulate result
    results.push({
      file: doc.relativePath,
      document_type: parsed.document_type || 'Unknown',
      critique_summary: parsed.critique_summary || 'No critique provided.',
      adjustments_made: Array.isArray(parsed.adjustments_made) ? parsed.adjustments_made : [],
    });

    // g. Broadcast per-file progress
    broadcastEvent('doc_audited', {
      file: doc.relativePath,
      document_type: parsed.document_type || 'Unknown',
      critique_summary: parsed.critique_summary || '',
    });

    // h. Log progress
    const elapsedMs = Date.now() - jobStartTime;
    const remaining = totalFiles - (i + 1);
    logger.info('[qa]', `  Done (${elapsedMs}ms) — ${remaining} remaining`);
  }

  // 8. Compute summary stats
  const erroredFiles = results.filter(r => r.error).length;
  const cleanFiles = results.length - erroredFiles;

  // 9. Build the aggregate report
  const reportLines = [];
  reportLines.push(`# Application Quality Assurance Audit Report — ${dateStr}`);
  reportLines.push('');
  reportLines.push('## Executive Summary');
  reportLines.push('');
  reportLines.push(
    `A total of ${results.length} application documents were audited ` +
    `for identity attribution, metric inflation, and banned writing patterns. ` +
    `Of these, ${cleanFiles} passed through the sanitization pipeline successfully ` +
    `while ${erroredFiles} encountered processing errors.`
  );
  reportLines.push('');
  reportLines.push('## File Adjustments Breakdown');
  reportLines.push('');

  for (const r of results) {
    reportLines.push(`### File: ${r.file}`);
    reportLines.push('');
    reportLines.push(`**Critique:** ${r.critique_summary}`);
    reportLines.push('');
    reportLines.push('**Modifications Executed:**');
    reportLines.push('');
    if (r.adjustments_made.length > 0) {
      for (const adj of r.adjustments_made) {
        reportLines.push(`- ${adj}`);
      }
    } else {
      reportLines.push('- No modifications recorded.');
    }
    reportLines.push('');
  }

  const reportContent = reportLines.join('\n');

  // 10. Write the aggregate QA report
  const reportPath = await fileStore.writeQaReport(RESUMES_DIR, dateStr, reportContent);

  // 11. Broadcast completion
  broadcastEvent('qa_complete', {
    total: results.length,
    clean: cleanFiles,
    errors: erroredFiles,
    reportPath,
  });

  // 12. Log final summary
  logger.info('[qa]', `QA report written to resumes/${dateStr}/qa_report.md`);
  logger.info('[qa]', `Done. ${cleanFiles} files sanitized, ${erroredFiles} errors.`);
})();
