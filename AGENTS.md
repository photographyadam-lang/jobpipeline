# Agent Rules

> Rules for AI coding agents working on this project.
> Read this file at the start of every session before reading
> SESSIONSTATE.md.

---

## General rules

- Rule 1: Read SESSIONSTATE.md before starting any task
- Rule 2: Do not begin work if ## Active task is blank or [none]
- Rule 3: Only work on the task in ## Active task — do not skip ahead
- Rule 4: Do not modify files listed in ## Out of scope

---

## Project-specific rules

### What this project is

A local Node.js pipeline that harvests LinkedIn job descriptions, scores them with DeepSeek,
stack ranks them, generates resumes and cover letters, and serves a real-time SSE dashboard.
Full specification: `job-pipeline-spec-v5.md`. Full task detail: `job-pipeline-tasks-v5.md`.

---

### Environment

- **OS:** Windows. Use `path.join()` everywhere — never hardcode `/` as a path separator.
- **Shell:** PowerShell.
- **Node.js:** v24.11.1 — CommonJS (`require`/`module.exports`) throughout, no ESM.
- **Runtime modules:** `express`, `dotenv` only. No other production dependencies.
- **Dev modules:** `jest`, `eslint`, `@eslint/js`, `msw`, `jsdom`, `terser` only.
- **Forbidden packages:** `axios`, `nock`, `supertest`, `tmp`, `tmp-promise`, `minimist`, `yargs`.

---

### Architecture — non-negotiable

**Pure functions in `src/models/` and most of `src/lib/`.**
Every transformation (parsing, formatting, ranking, prompt assembly) is a pure function.
No side effects in models.

**Side effects in exactly one place each:**

| Side effect | Only module |
| ----------- | ----------- |
| Filesystem read/write | `src/lib/fileStore.js` |
| DeepSeek API calls | `src/lib/deepseek.js` |
| Event broadcasting | `src/lib/eventBroadcaster.js` |
| HTTP server | `server/server.js` |
| Terminal output | `src/lib/logger.js` |

**Orchestrators contain only wiring.**
`score.js`, `generate.js`, `cleanup.js`, `apply.js` call functions from `src/` in sequence.
If logic is tempted to go in an orchestrator, it belongs in `src/`.

---

### Mandatory coding constraints

Every constraint below is verified by code review before a task is accepted.

1. **`require('dotenv').config()` is the literal first line** of every CLI script
   (`score.js`, `generate.js`, `cleanup.js`, `apply.js`) and `server/server.js`.
   Without it, `process.env.DEEPSEEK_API_KEY` is always `undefined`.

2. **No bare `console` calls.** Use `src/lib/logger.js` only.
   Grep: `grep -r "console\." src/ score.js generate.js cleanup.js apply.js server/server.js`

3. **`fs.promises` only in `fileStore.js`.** No `fs.readFileSync`, `fs.writeFileSync`,
   or callback-style `fs.readFile` anywhere.

4. **No `Promise.all` on DeepSeek calls.** All DeepSeek calls in `score.js` and `generate.js`
   are awaited individually in a `for` loop. Rate limits are real.
   Grep: `grep -n "Promise.all" score.js generate.js`

5. **`util.parseArgs` for all CLI flags.** No `minimist`, `yargs`, or manual `process.argv`
   slicing. Import: `const { parseArgs } = require('util');`

6. **Date strings for file paths — never `toISOString()`.** Always use
   `formatDateString(new Date())` from `src/lib/dateUtils.js`. The raw `values.date` string
   from `--date` flag is used as-is for paths — never pass through `new Date(values.date)`.

7. **`PIPELINE_PORT` env var controls server port.** Both `server.js` and
   `eventBroadcaster.js` read `process.env.PIPELINE_PORT` (default `'3000'`).
   Tests set `PIPELINE_PORT=3001`.

8. **`eventBroadcaster` must never throw.** Entire body wrapped in `try/catch`.
   Pipeline cannot fail because the dashboard is unavailable.

9. **`config/` files are never created or modified.** Agent checks for existence,
   throws `ConfigMissingError` if absent, and stops.

10. **`server.js` exports `createApp(jobsDir)` factory.** Only starts server when
    `require.main === module`.

11. **`applications.json` read once before the generate loop, written once after.**
    `readApplications` and `writeApplications` are never called inside the per-job loop.

12. **Job files read once before the generate loop into a Map.**
    `readJobFiles` is never called inside the per-job loop.
    `const jobFileMap = new Map(allJobFiles.map(f => [f.filename, f.content]));`

---

### Testing constraints

- **`msw` not `nock`.** `nock` does not intercept Node.js native `fetch`.
  Use `msw` v2 (`msw/node`) for all HTTP mocking.

- **`fs.mkdtemp` not `tmp` package.** The `tmp` package has cleanup failures on Windows.
  ```javascript
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'job-pipeline-test-'));
  // afterEach:
  await fs.rm(tmpDir, { recursive: true, force: true });
  ```

- **No `supertest`.** Use `createApp(jobsDir)` factory + native `fetch` against a random port.
  ```javascript
  const httpServer = createApp(tmpJobsDir).listen(0);
  await new Promise(r => httpServer.once('listening', r));
  const base = `http://localhost:${httpServer.address().port}`;
  ```

- **Child process env injection** (for E2E tests spawning CLI scripts):
  ```javascript
  execSync('node score.js', {
    env: {
      ...process.env,
      DEEPSEEK_API_KEY: 'test-key',
      PIPELINE_PORT: '3001',
      NODE_OPTIONS: '--require ./tests/helpers/msw-setup.js'
    }
  });
  ```

- **`tests/fixtures/` and `tests/helpers/` excluded from Jest test discovery.**
  `jest.config.js` must have `testPathIgnorePatterns` covering both paths.

- **Fixtures are the contract.** If a model's output does not match a fixture,
  fix the model — never modify the fixture.

- **Per-file coverage thresholds** during Phases 1–4. Global 80% threshold
  added to `jest.config.js` only at Phase 5 (P5-T01).

---

### Task acceptance checklist

Run these before marking any task complete:

```
npm run lint                         # must exit 0
npm test                             # must exit 0, all prior tests green
grep -r "console\." src/ score.js generate.js cleanup.js apply.js server/server.js
grep -n "Promise.all" score.js generate.js   # for P4-T01 and P4-T02 only
grep -rn "readFileSync\|writeFileSync" src/  # for P3-T01
```

For P4-T05 (dashboard) and P4-T06 (bookmarklet): manual test required.
Document result with date, browser/tool, and outcome before marking complete.

---

### Files the agent must never touch

| Path | Reason |
| ---- | ------ |
| `config/` (any file) | Human-authored. Agent reads, never writes. |
| `applications.json` | Permanent record. Appended via `fileStore.writeApplications` only. |
| `.env` | Contains secrets. Read via dotenv, never modified. |
| `tests/fixtures/` | Test contracts. Never modified to make tests pass. |

---

### Key data types (quick reference)

```javascript
// JobFile
{ title, company, location, employmentType, salary /*string|null*/,
  url, linkedInJobId /*string|null*/, harvested /*Date*/, description, filename }

// ScoredJob  (all JobFile fields plus:)
{ score /*1-10*/, fitSignal, gap,
  rank /*number|null*/, actionFlag /*'DEEP_TAILOR'|'AUTO_GENERATED'|'NO_DOCS'|null*/ }

// ApplicationRecord
{ id, company, title, url, linkedInJobId, score, actionFlag,
  resumeQuality /*number|null*/, coverLetterQuality /*number|null*/,
  qualityNote /*string|null*/, pillarsSelected /*string[]*/, coverLetterParas /*number|null*/,
  outputPath, dateGenerated, dateApplied /*null*/, applicationMethod /*null*/,
  status /*'generated'|'applied'|'interviewing'|'rejected'|'offer'|'withdrawn'*/,
  notes /*''*/ }

// StackRankEntry (from parseStackRank)
{ rank, score, actionFlag, company, title, url, linkedInJobId, sourceFilename }
```

---

### SSE event reference (`doc_generated` must include `sourceFilename`)

| Event type | Key fields |
| ---------- | ---------- |
| `job_harvested` | `company, title, filename, url` |
| `scoring_started` | `total, date` |
| `job_scored` | `rank, score, company, title, actionFlag, fitSignal, gap, sourceFilename, salary, location, url, linkedInJobId` |
| `scoring_complete` | `scored, scoreMean, scoreMin, scoreMax, distribution` |
| `generation_started` | `total` |
| `doc_generated` | `company, title, sourceFilename, resumeQuality, coverLetterQuality, qualityNote, pillarsSelected, coverLetterParas` |
| `generation_complete` | `generated` |

The dashboard matches quality scores to stack rank rows by `sourceFilename` — not by
company+title strings. `sourceFilename` in `doc_generated` is not optional.
