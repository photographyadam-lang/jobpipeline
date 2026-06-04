# QA In-Place File Sanitizer — Implementation Plan

## Overview

Create a new CLI script `src/qa.js` that discovers all generated resumes and cover letters for a given date, sends each through DeepSeek with a forensic QA system prompt, overwrites the files with sanitized content, and writes an aggregate `qa_report.md`.

## Files to Create / Modify

| File | Action | Purpose |
|------|--------|---------|
| `config/qa.md` → `config/qa_prompt.md` | Rename | Naming symmetry with other prompt configs |
| `config/Writing_Style_Guide.md` | Create | Linguistic boundary parameters for LLM context |
| `config/authenticity-SKILL.md` | Create | Identity attribution and technical de-escalation rules |
| `src/lib/fileStore.js` | Extend | Add `readDateDir` + `writeQaReport` functions |
| `src/qa.js` | Create | Main orchestrator script |
| `package.json` | Modify | Add `"qa": "node src/qa.js"` script |

## Step-by-Step Implementation

### Step 1 — Rename config file

Rename [`config/qa.md`](config/qa.md) → [`config/qa_prompt.md`](config/qa_prompt.md) using `fs.rename` or a simple `git mv`. Content is already the correct QA system prompt.

### Step 2 — Create config/Writing_Style_Guide.md

New file with linguistic constraints:
- Core Principle: Specificity Over Polish
- Strict Attribution & Verb Controls (banned: utilize, leverage, facilitate, etc.)
- Banned Sentence Shapes (antithesis pattern, rule-of-three cadence, summarizing kicker)
- Punctuation Ceiling (max 3 em dashes per resume, 2 per cover letter)

### Step 3 — Create config/authenticity-SKILL.md

New file with identity de-escalation rules:
- Structural Identity Rule (never claim "Product Manager" unless in verified timeline)
- Technical Contribution Audit (dial back overclaims to match true operational parameters)
- Domain term verification protocol

### Step 4 — Extend `src/lib/fileStore.js`

Add two new functions following existing patterns (`fs.promises` only):

```javascript
/**
 * List all application document files (resume.md, cover_letter.md) within
 * a dated output directory. Returns flat array of { filePath, relativePath, docType } objects.
 *
 * @param {string} resumesDir - Path to the resumes directory.
 * @param {string} dateStr - Date string in "YYYY-MM-DD" format.
 * @returns {Promise<{ filePath: string, relativePath: string, docType: 'resume'|'cover_letter' }[]>}
 * @throws {Error} If the date directory does not exist (ENOENT propagated).
 */
async function readDateDir(resumesDir, dateStr) { ... }

/**
 * Write the aggregate QA report markdown file to a dated output directory.
 *
 * @param {string} resumesDir - Path to the resumes directory.
 * @param {string} dateStr - Date string in "YYYY-MM-DD" format.
 * @param {string} content - Markdown report content.
 * @returns {Promise<string>} The full path written.
 */
async function writeQaReport(resumesDir, dateStr, content) { ... }
```

Export both from `module.exports`.

### Step 5 — Create `src/qa.js` (main orchestrator)

Follows the exact patterns of [`score.js`](score.js) and [`generate.js`](generate.js):

```javascript
'use strict';
require('dotenv').config();                    // Rule: literal first line

const { parseArgs } = require('util');        // Rule: util.parseArgs, not minimist/yargs
const path = require('path');

const { ConfigMissingError } = require('./src/lib/errors');
const logger = require('./src/lib/logger');   // Rule: no bare console.log
const { formatDateString } = require('./src/lib/dateUtils');
const { broadcastEvent } = require('./src/lib/eventBroadcaster');
const fileStore = require('./src/lib/fileStore');
const { callDeepSeek } = require('./src/lib/deepseek');
```

**CLI argument parsing:**
- `--date` optional string flag, default `formatDateString(new Date())`
- Positional arguments allowed

**Config validation (5 required files):**
1. `qa_prompt.md`
2. `adam_buteux_career.md`
3. `pillar_library.md`
4. `Writing_Style_Guide.md`
5. `authenticity-SKILL.md`

Uses existing [`fileStore.readConfig()`](src/lib/fileStore.js:117) pattern — throws `ConfigMissingError` if absent, lists missing files and `process.exit(1)`.

**File discovery:**
- Call `fileStore.readDateDir(RESUMES_DIR, dateStr)` to collect all `resume.md` and `cover_letter.md` files
- If directory is empty or missing, `logger.info` and `process.exit(0)`

**Build reference context block** (the user prompt base containing all reference guides):

```
ADAM_BUTEUX_CAREER:
[career contents]

PILLAR_LIBRARY:
[pillar contents]

WRITING_STYLE_GUIDE:
[style guide contents]

AUTHENTICITY_SKILL:
[authenticity contents]
```

**Sequential processing loop** (NO `Promise.all` — Rule):

For each document file:

1. **Build full user prompt** = reference context + `DRAFT_CONTENT:` + file content
2. **Call DeepSeek** via `callDeepSeek(qaSystemPrompt, userPrompt, { maxTokens: 4096, timeoutMs: 120000 })`
   - Use `qa_prompt.md` as the system prompt
   - High token limit (4096) since sanitized content can be long
   - 120s timeout for large documents
3. **Parse JSON response** with robust fence stripping:
   ```javascript
   let cleaned = rawResponse.trim();
   if (cleaned.startsWith('```')) {
     cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
   }
   const parsed = JSON.parse(cleaned);
   ```
4. **In-place write**: If `parsed.sanitized_content` is a non-empty string, overwrite the source file completely
5. **Accumulate result**: Push `{ file, document_type, critique_summary, adjustments_made }` to results array
6. **On error** (DeepSeek or JSON parse): Log error, push error result with `critique_summary: 'LLM call failed'`, continue to next file

**Generate `qa_report.md`:**

After all files processed, write the report to `resumes/{dateStr}/qa_report.md`:

```markdown
# Application Quality Assurance Audit Report — {dateStr}

## Executive Summary

A total of {N} application documents were audited for identity attribution,
metric inflation, and banned writing patterns. Of these, {clean} passed
through the sanitization pipeline successfully while {errored} encountered
processing errors.

## File Adjustments Breakdown

### File: {relativePath}

**Critique:** {critique_summary}

**Modifications Executed:**

- {adjustment 1}
- {adjustment 2}
```

**Log completion:**
```javascript
logger.info('[qa]', `QA report written to resumes/${dateStr}/qa_report.md`);
logger.info('[qa]', `Done. ${cleanFiles} files sanitized, ${erroredFiles} errors.`);
```

### Step 6 — Update `package.json`

Add to `"scripts"`:
```json
"qa": "node src/qa.js"
```

## Architecture Diagram

```
CLI: npm run qa [-- --date=2026-06-02]
        │
        ▼
   ┌──────────┐      ┌─────────────────────┐
   │ parseArgs │ ──►  │ dateStr = arg or    │
   └──────────┘      │ formatDateString()   │
                      └──────────┬──────────┘
                                 ▼
                      ┌─────────────────────┐
                      │ Validate 5 configs  │──► ConfigMissingError → exit(1)
                      │ via fileStore       │
                      └──────────┬──────────┘
                                 ▼
                      ┌─────────────────────┐
                      │ readDateDir() to    │
                      │ discover resume.md  │
                      │ + cover_letter.md   │
                      └──────────┬──────────┘
                                 ▼
                      ┌─────────────────────┐
                      │ FOR each file        │ ◄── SEQUENTIAL, no Promise.all
                      │   (sequential loop)  │
                      └──────────┬──────────┘
                                 │
                    ┌────────────┴────────────┐
                    │                         │
                    ▼                         ▼
          ┌──────────────────┐      ┌──────────────────┐
          │ Build user prompt│      │ Build user prompt │
          │ = reference docs │      │ = reference docs  │
          │ + DRAFT_CONTENT  │      │ + DRAFT_CONTENT   │
          └────────┬─────────┘      └────────┬─────────┘
                   │                         │
                   ▼                         ▼
          ┌──────────────────┐      ┌──────────────────┐
          │ callDeepSeek(    │      │ callDeepSeek(    │
          │   qa_prompt.md,  │      │   qa_prompt.md,  │
          │   userPrompt    │      │   userPrompt     │
          │ )               │      │ )                │
          └────────┬─────────┘      └────────┬─────────┘
                   │                         │
                   ▼                         ▼
          ┌──────────────────┐      ┌──────────────────┐
          │ Strip ``` fences │      │ Strip ``` fences │
          │ JSON.parse()    │      │ JSON.parse()     │
          └────────┬─────────┘      └────────┬─────────┘
                   │                         │
                   ▼                         ▼
          ┌──────────────────┐      ┌──────────────────┐
          │ fs.writeFile(    │      │ fs.writeFile(    │
          │   sanitized_     │      │   sanitized_     │
          │   content)       │      │   content)       │
          └────────┬─────────┘      └────────┬─────────┘
                   │                         │
                   └────────────┬────────────┘
                                ▼
                     ┌─────────────────────┐
                     │ writeQaReport()     │
                     │ → qa_report.md      │
                     └─────────────────────┘
```

## Testing Considerations

- Unit test for the JSON fence-stripping logic (extract to a pure helper or test inline)
- Integration test for `readDateDir` + `writeQaReport` in `fileStore.js`
- E2E test: spawn `node src/qa.js` with msw intercepting DeepSeek, seeded doc files in a temp `resumes/{date}/` dir, assert `qa_report.md` written and files updated
- Use `tests/fixtures/` pattern for sample resume/cover letter docs to QA
- Add per-file coverage thresholds to `jest.config.js` for `src/qa.js`
- Ensure `tests/helpers/msw-setup.js` or a new `msw-qa-setup.js` handles the QA endpoint response

## Key Constraints (from AGENTS.md)

| # | Constraint | How enforced |
|---|-----------|-------------|
| 1 | `require('dotenv').config()` is literal first line | Lint check in code review |
| 2 | No bare `console.log` — use `logger` | `grep -r "console\." src/qa.js` |
| 3 | `fs.promises` only in `fileStore.js` | New functions added to fileStore |
| 4 | No `Promise.all` on DeepSeek calls | Sequential `for` loop |
| 5 | `util.parseArgs` for CLI | Used for `--date` flag |
| 6 | Date strings not `toISOString()` | `formatDateString(new Date())` |
| 8 | `eventBroadcaster` never throws | Fire-and-forget calls |
| 9 | Config files never created/modified by agent | Read-only via `fileStore.readConfig` |
