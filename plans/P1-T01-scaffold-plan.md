# P1-T01 Plan: Scaffold, Tooling, and Shared Utilities

## Overview

Build the complete project skeleton for the job-pipeline application. This includes directory structure, package management, linting/testing configuration, environment templates, and four core shared utility modules.

## Source Specification

All deliverables are **exactly** as specified in:
- [`job-pipeline-tasks-v5.md`](../job-pipeline-tasks-v5.md) — Section T01 (lines 115-288)
- [`job-pipeline-spec-v5.md`](../job-pipeline-spec-v5.md) — Sections 3, 6, 17, 18
- [`AGENTS.md`](../AGENTS.md) — All mandatory constraints

---

## Step 1: Create Directory Structure

**Action:** Create all required subdirectories via PowerShell.

Directories needed:
```
config/
src/models/
src/lib/
server/
scripts/
tests/fixtures/
tests/helpers/
tests/unit/
tests/integration/
tests/e2e/
jobs/
archive/
resumes/
```

**Command:** `mkdir config, src/models, src/lib, server, scripts, tests/fixtures, tests/helpers, tests/unit, tests/integration, tests/e2e, jobs, archive, resumes`

---

## Step 2: Create `package.json`

**Constraints from [`AGENTS.md`](../AGENTS.md:33):**
- Runtime modules: `express`, `dotenv` only. No other production dependencies.
- Dev modules: `jest`, `eslint`, `@eslint/js`, `msw`, `jsdom`, `terser` only.
- **Forbidden:** `axios`, `nock`, `supertest`, `tmp`, `tmp-promise`, `minimist`, `yargs`.
- CommonJS throughout (`require`/`module.exports`).
- Add `"type": "commonjs"` explicitly.

**Scripts** from Appendix A (lines 1997-2012):
```json
{
  "lint": "eslint src/ score.js generate.js cleanup.js apply.js server/server.js",
  "test": "jest --coverage",
  "test:unit": "jest tests/unit/",
  "test:integration": "jest tests/integration/",
  "test:e2e": "jest tests/e2e/",
  "start": "node server/server.js",
  "score": "node score.js",
  "generate": "node generate.js",
  "cleanup": "node cleanup.js",
  "apply": "node apply.js",
  "build:bookmarklet": "node scripts/minify-bookmarklet.js"
}
```

**Dependencies** from spec Section 17 (line 747):
```json
{
  "dependencies": {
    "express": "^4.18.0",
    "dotenv": "^16.0.0"
  },
  "devDependencies": {
    "jest": "^29.0.0",
    "eslint": "^9.0.0",
    "@eslint/js": "^9.0.0",
    "msw": "^2.0.0",
    "jsdom": "^24.0.0",
    "terser": "^5.0.0"
  }
}
```

---

## Step 3: Create `eslint.config.js`

**Requirements:**
- Flat config format (ESLint v9 style)
- Uses `@eslint/js` recommended rules
- Node.js globals
- CommonJS environment

```javascript
const js = require('@eslint/js');

module.exports = [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        // Node.js globals
        require: 'readonly',
        module: 'readonly',
        exports: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        console: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        global: 'readonly',
        URL: 'readonly',
        fetch: 'readonly',
        AbortSignal: 'readonly',
        TextEncoder: 'readonly',
        TextDecoder: 'readonly',
      }
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-console': 'warn',  // Warn about bare console use (must use logger.js)
    }
  },
  {
    ignores: [
      'node_modules/',
      'server/bookmarklet.min.js',
    ]
  }
];
```

---

## Step 4: Create `jest.config.js`

**From task spec lines 72-83:**
```javascript
module.exports = {
  testEnvironment: 'node',
  testPathIgnorePatterns: ['/node_modules/', '/tests/fixtures/', '/tests/helpers/'],
  collectCoverageFrom: [
    'src/**/*.js',
    'score.js', 'generate.js', 'cleanup.js', 'apply.js', 'server/server.js'
  ],
  // Per-file thresholds added per task. Global 80% enforced at T16.
  coverageThreshold: {
    // No global threshold yet — added at Phase 5 (P5-T01 / T16)
  },
};
```

**Key:** `testPathIgnorePatterns` MUST include `/tests/fixtures/` and `/tests/helpers/`.

---

## Step 5: Create `.env.example` and `.gitignore`

### `.env.example`
```
DEEPSEEK_API_KEY=your_api_key_here
PIPELINE_PORT=3000
```

### `.gitignore` (from spec Section 18, line 765)
```
.env
jobs/
archive/
resumes/
config/
node_modules/
server/bookmarklet.min.js
```

**Note:** `applications.json` is NOT gitignored — it's part of the permanent record.

---

## Step 6: Create `src/lib/errors.js`

**Exact code from task spec lines 147-171.**

Three custom error classes:
1. **`JobParseError`** — `constructor(message, filename)`, has `this.name = 'JobParseError'`, has `this.filename`
2. **`DeepSeekResponseError`** — `constructor(message, statusCode)`, has `this.name = 'DeepSeekResponseError'`, has `this.statusCode`
3. **`ConfigMissingError`** — `constructor(filename)`, message = `Config file not found: ${filename}`, has `this.name = 'ConfigMissingError'`, has `this.filename`

---

## Step 7: Create `src/lib/logger.js`

**From task spec lines 173-184.**

```javascript
const timestamp = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
const logger = {
  info:  (prefix, msg) => console.log(`${timestamp()} ${prefix} ${msg}`),
  error: (prefix, msg) => console.error(`${timestamp()} ${prefix} ERROR: ${msg}`),
  warn:  (prefix, msg) => console.warn(`${timestamp()} ${prefix} WARN: ${msg}`),
};
```

**Architect review decision (approved):** Use the literal spec template (Option A) — `toISOString()` with `replace('T', ' ')` and `.slice(0, 19)`. This is acceptable because:

1. The logger timestamp is used **only for terminal display**, never for file path construction.
2. `dateUtils.js`'s `formatDateTimeString` provides only minutes precision (`HH:MM`), but the logger regex requires seconds precision (`HH:MM:SS`).
3. The acceptance criteria checks only the format regex, not timezone correctness.
4. Using local-time arithmetic would duplicate `dateUtils` code unnecessarily.

---

## Step 8: Create `src/lib/dateUtils.js`

**From task spec lines 188-207.**

```javascript
function formatDateString(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatDateTimeString(date) {
  const h = String(date.getHours()).padStart(2, '0');
  const mi = String(date.getMinutes()).padStart(2, '0');
  return `${formatDateString(date)} ${h}:${mi}`;
}
```

**Critical constraints from AGENTS.md:**
- NEVER use `toISOString()` — that gives UTC and will shift dates in negative-offset timezones.
- Always use local time getters (`getFullYear()`, `getMonth()`, `getDate()`, etc.)

**Test validation:** `formatDateString(new Date(2026, 4, 30))` must return `'2026-05-30'` (month is 0-indexed in JS).

---

## Step 9: Create `src/lib/eventBroadcaster.js`

**From task spec lines 209-227.**

```javascript
async function broadcastEvent(type, data) {
  const port = process.env.PIPELINE_PORT || '3000';
  try {
    await fetch(`http://localhost:${port}/event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, data, timestamp: new Date().toISOString() }),
      signal: AbortSignal.timeout(2000),
    });
  } catch { /* silent — dashboard may not be running */ }
}
```

**Key constraints:**
- **Must NEVER throw** — entire body in `try/catch`
- Reads port from `process.env.PIPELINE_PORT` (default `'3000'`)
- 2-second timeout via `AbortSignal.timeout(2000)`
- Fire-and-forget: no `.then()` or waiting on the response

---

## Step 10: Create `tests/unit/scaffold.test.js`

**Test blocks from task spec lines 250-286:**

### `JobParseError` tests
1. `is instanceof Error`
2. `has name "JobParseError"`
3. `has filename property matching constructor argument`
4. `message is set correctly`

### `DeepSeekResponseError` tests
1. `is instanceof Error`
2. `has name "DeepSeekResponseError"`
3. `has statusCode property`

### `ConfigMissingError` tests
1. `is instanceof Error`
2. `message contains the filename`
3. `filename property equals constructor argument`

### `logger` tests
1. `info output matches YYYY-MM-DD HH:MM:SS format` — regex `^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}`
2. `info includes prefix and message` — full match regex with prefix and msg

### `dateUtils` tests
1. `formatDateString returns YYYY-MM-DD in local time` — `new Date(2026, 4, 30)` → `'2026-05-30'`
2. `formatDateString handles month padding (January = 01)` — `new Date(2026, 0, 5)` → `'2026-01-05'`
3. `formatDateString handles day padding (1st = 01)` — `new Date(2026, 0, 1)` → `'2026-01-01'`
4. `formatDateTimeString returns YYYY-MM-DD HH:MM` — `new Date(2026, 4, 30, 14, 32)` → `'2026-05-30 14:32'`

### `eventBroadcaster` tests
1. `resolves without throwing when no server is running`
2. `resolves without throwing on timeout`
3. `uses PIPELINE_PORT env var in URL` — set `process.env.PIPELINE_PORT = '9999'`, verify fetch URL uses port 9999

**Test implementation note for eventBroadcaster tests:**
- For test 3 (port usage), we need to intercept the fetch. Since we can't use `nock`, we could either:
  a. Use `msw` (not yet set up as a shared helper — that's Task T16)
  b. Monkey-patch `global.fetch` temporarily in the test
  c. Use `jest.spyOn(global, 'fetch')` to verify the URL

  Option (c) is cleanest for this scaffold test without needing msw setup.

---

## Step 11: `npm install`

Run `npm install` and verify no errors. The install should produce no warnings about missing peer deps or forbidden packages.

---

## Step 12: Lint and Test

Run `npm run lint` — must exit 0.
Run `npm test` — must exit 0, all tests in `scaffold.test.js` green.

---

## Step 13: Update SESSIONSTATE.md

Move P1-T01 from "Active task" to "Completed tasks" with commit message summary.

---

## Step 14: Session Report

Document:
1. Files Created/Modified
2. Verification Results (Lint + Test outputs)
3. Any structural notes matching the acceptance criteria

---

## Acceptance Checklist (from SESSIONSTATE.md)

- [x] `JobParseError` is instanceof Error with `name` and `filename` properties
- [x] `DeepSeekResponseError` is instanceof Error with `name` and `statusCode` properties
- [x] `ConfigMissingError` message contains the filename argument
- [x] `logger.info('[test]', 'msg')` output matches regex `^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}`
- [x] `formatDateString(new Date(2026, 4, 30))` returns `'2026-05-30'` (month is 0-indexed)
- [x] `formatDateString` does not call `toISOString()` internally (code review)
- [x] `broadcastEvent('test', {})` resolves without throwing when no server is running
- [x] `broadcastEvent` uses `process.env.PIPELINE_PORT` in its fetch URL
- [x] `npm install` completes without errors
- [x] `npm run lint` exits 0
- [x] `npm test` exits 0 and runs `scaffold.test.js`
- [x] `jest.config.js` excludes `tests/fixtures/` and `tests/helpers/` from test discovery
