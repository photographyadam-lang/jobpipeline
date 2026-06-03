# Job Pipeline — Phase Task List

> Tasks are ordered by dependency. Do not start a task until all
> prerequisites are met. Reference `job-pipeline-spec-v5.md` and
> `job-pipeline-tasks-v5.md` for full detail on each task.

---

## Phase structure

| Phase | Description | Status |
| ----- | ----------- | ------ |
| **Phase 1 — Foundation** | Project scaffold, tooling, shared utilities, and test fixtures | Pending |
| **Phase 2 — Core Models** | Pure function models: JobFile, ScoredJob, StackRank, ApplicationRecord | Pending |
| **Phase 3 — Adapters** | Side-effect adapters: fileStore, deduplicator, ranker, promptBuilder, deepseek | Pending |
| **Phase 4 — Orchestrators + Server** | CLI scripts, server, dashboard, bookmarklet, status tracker | Pending |
| **Phase 5 — Integration** | End-to-end pipeline test and global coverage gate | Pending |

---

# Phase 1 — Foundation

**Status:** ✅ Complete

Establishes the project skeleton, tooling, shared utility modules, and all static test fixture files. Nothing in later phases can be built until this phase is green. The four utility modules created here (errors, logger, dateUtils, eventBroadcaster) are imported by every subsequent module.

---

## Phase 1 tasks

### P1-T01 · Scaffold, tooling, and shared utilities

**Status:** ✅ Complete
**Complexity:** medium
**What:** Create the full project skeleton: `package.json`, `eslint.config.js`, `jest.config.js`,
  `.env.example`, `.gitignore`, `README.md`, and all subdirectories. Also create four shared
  utility modules: `src/lib/errors.js` (custom error classes), `src/lib/logger.js` (timestamped
  logger), `src/lib/dateUtils.js` (local-time date formatters), and `src/lib/eventBroadcaster.js`
  (fire-and-forget SSE event poster).
**Prerequisite:** None.
**Hard deps:** None
**Files:** `package.json` (new), `eslint.config.js` (new), `jest.config.js` (new), `.env.example` (new),
  `.gitignore` (new), `README.md` (new), `src/lib/errors.js` (new), `src/lib/logger.js` (new),
  `src/lib/dateUtils.js` (new), `src/lib/eventBroadcaster.js` (new), `tests/unit/scaffold.test.js` (new)
**Reviewer:** Yes
**Key constraints:**

- `jest.config.js` must set `testPathIgnorePatterns: ['/node_modules/', '/tests/fixtures/', '/tests/helpers/']`
- `formatDateString` in `dateUtils.js` must use local time — never `toISOString()` which gives UTC
- `broadcastEvent` in `eventBroadcaster.js` must never throw — entire body wrapped in try/catch
- `eventBroadcaster.js` reads port from `process.env.PIPELINE_PORT` (default `'3000'`)
- No `axios`, `nock`, `supertest`, `tmp`, `minimist`, or `yargs` in `package.json`
- devDependencies: `jest`, `eslint`, `@eslint/js`, `msw`, `jsdom`, `terser` only

**Done when:**

- `npm install` completes without errors
- `npm run lint` exits 0
- `npm test` exits 0 and runs `scaffold.test.js`
- `jest.config.js` excludes `tests/fixtures/` and `tests/helpers/` from test discovery
- `JobParseError` is instanceof Error with `name` and `filename` properties
- `DeepSeekResponseError` is instanceof Error with `name` and `statusCode` properties
- `ConfigMissingError` message contains the filename argument
- `logger.info('[test]', 'msg')` output matches regex `^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}`
- `formatDateString(new Date(2026, 4, 30))` returns `'2026-05-30'` (month is 0-indexed)
- `formatDateString` does not call `toISOString()` internally (code review)
- `broadcastEvent('test', {})` resolves without throwing when no server is running
- `broadcastEvent` uses `process.env.PIPELINE_PORT` in its fetch URL

---

### P1-T02 · Test fixtures

**Status:** ✅ Complete
**Complexity:** low
**What:** Create all 10 static test fixture files in `tests/fixtures/`. These are the contract
  that all model and adapter tests assert against. Fixtures include: two distinct job files,
  a URL-duplicate job file, a fuzzy-duplicate job file, trimmed career and pillar library files,
  valid and invalid DeepSeek scoring responses, valid and invalid quality responses, a structured
  resume response, and a cover letter response.
**Prerequisite:** P1-T01 complete.
**Hard deps:** P1-T01
**Files:** `tests/fixtures/sample_job_1.md` (new), `tests/fixtures/sample_job_2.md` (new),
  `tests/fixtures/sample_job_duplicate.md` (new), `tests/fixtures/sample_job_fuzzy_duplicate.md` (new),
  `tests/fixtures/sample_career.md` (new), `tests/fixtures/sample_pillar_library.md` (new),
  `tests/fixtures/sample_deepseek_score_response.json` (new),
  `tests/fixtures/sample_deepseek_score_invalid.json` (new),
  `tests/fixtures/sample_deepseek_quality_response.json` (new),
  `tests/fixtures/sample_deepseek_quality_invalid.json` (new),
  `tests/fixtures/sample_deepseek_resume_response.txt` (new),
  `tests/fixtures/sample_deepseek_cover_letter_response.txt` (new)
**Reviewer:** Yes
**Key constraints:**

- `sample_job_1.md` and `sample_job_duplicate.md` must have identical URLs; duplicate must have an earlier `Harvested:` timestamp
- `sample_job_1.md` and `sample_job_fuzzy_duplicate.md` must have different URLs but the same company and title
- `sample_job_2.md` must have `Salary: Not specified` to test the null salary path
- `sample_deepseek_resume_response.txt` must contain all five section headers: `## Summary`, `## Professional Experience`, `## Independent Projects`, `## Education`, `## Certifications`
- Fixtures are never modified to make tests pass — fix the model instead

**Done when:**

- All 12 fixture files exist and are valid UTF-8
- `sample_job_1.md` and `sample_job_duplicate.md` have identical URLs
- `sample_job_duplicate.md` has an earlier `Harvested:` timestamp than `sample_job_1.md`
- `sample_job_1.md` and `sample_job_fuzzy_duplicate.md` have different URLs but same company+title
- `sample_job_2.md` salary field is `Not specified`
- `sample_deepseek_score_response.json` is valid JSON with `score`, `fit_signal`, `gap`
- `sample_deepseek_score_invalid.json` is valid JSON but missing `score`
- `sample_deepseek_quality_response.json` has all 5 fields: `resume_quality`, `cover_letter_quality`, `pillars_selected`, `cover_letter_paras`, `quality_note`
- `sample_deepseek_resume_response.txt` contains all 5 required section headers
- `sample_deepseek_cover_letter_response.txt` starts with `# Cover Letter —`
- `npm test` passes (fixtures are not scanned as test files)

---

### Dependency graph

```
P1-T01
  └── P1-T02
```

---

# Phase 2 — Core Models

**Status:** ✅ Complete

Pure function modules only — no side effects. Each module takes typed inputs and returns typed outputs. All are independently testable with fixtures. This phase establishes the data types that flow through the entire pipeline.

---

## Phase 2 tasks

### P2-T01 · `job.js` — JobFile model

**Status:** ✅ Complete
**Complexity:** medium
**What:** Create `src/models/job.js` exporting: `parseJobFile(markdown, filename)` which parses a
  harvested `.md` string into a `JobFile` object; `sanitizeForFilename(str, maxLength)` which
  makes strings filesystem-safe; `formatJobFile(job)` which serialises back to canonical `.md`;
  and `extractLinkedInJobId(url)` which extracts the numeric job ID from a LinkedIn URL.
**Prerequisite:** Phase 1 complete.
**Hard deps:** P1-T02
**Files:** `src/models/job.js` (new), `tests/unit/job.test.js` (new)
**Reviewer:** Yes
**Key constraints:**

- `salary` field must be `null` (not the string `"Not specified"`) when the metadata field is absent or "Not specified"
- `sanitizeForFilename` must: replace spaces with hyphens, remove `& ( ) / , ' " @ # $ % ^ * ! ? < > | \ : ;`, collapse consecutive hyphens, trim leading/trailing hyphens, truncate to `maxLength`
- `extractLinkedInJobId` must match pattern `/jobs/view/([0-9]+)/` — return numeric string or `null`
- `JobParseError` (from `errors.js`) thrown with filename when required sections are missing
- Round-trip must hold: `parseJobFile(formatJobFile(job), filename)` returns equivalent object

**Done when:**

- `parseJobFile` returns correct `JobFile` from `sample_job_1.md` including `linkedInJobId: '3987654321'`
- `salary` is `null` for `sample_job_2.md` (salary is "Not specified")
- `url` has query parameters stripped
- `sanitizeForFilename('AT&T', 60)` returns `'ATT'`
- `sanitizeForFilename('Johnson & Johnson', 60)` returns `'Johnson-Johnson'`
- `sanitizeForFilename('A--B', 60)` returns `'A-B'`
- `extractLinkedInJobId('https://www.linkedin.com/jobs/view/3987654321/')` returns `'3987654321'`
- `extractLinkedInJobId('https://example.com/job/123')` returns `null`
- Throws `JobParseError` with filename when `## Metadata` section missing
- Throws `JobParseError` when URL field empty
- Throws `JobParseError` when `## Job Description` section missing
- Round-trip passes
- `npm run lint` passes; `npm test` passes; `job.js` coverage ≥ 90%

---

### P2-T02 · `scoredJob.js` — ScoredJob model

**Status:** ✅ Complete
**Complexity:** low
**What:** Create `src/models/scoredJob.js` exporting: `parseScoreResponse(rawResponse)` which
  parses a DeepSeek JSON scoring response string into `{ score, fitSignal, gap }`; and
  `createScoredJob(job, scoreResult)` which combines a `JobFile` with score fields into a
  `ScoredJob`. `rank` and `actionFlag` are always `null` at creation — set later by `rankJobs()`.
**Prerequisite:** P2-T01 complete.
**Hard deps:** P2-T01
**Files:** `src/models/scoredJob.js` (new), `tests/unit/scoredJob.test.js` (new)
**Reviewer:** Skip
**Key constraints:**

- `parseScoreResponse` must throw `DeepSeekResponseError` when: input is not valid JSON, `score` is missing, `score` is not an integer 1–10, `fitSignal` is missing, `gap` is missing
- `createScoredJob` must spread all `JobFile` fields into the result
- `rank` and `actionFlag` must be `null` on creation

**Done when:**

- `parseScoreResponse` parses `sample_deepseek_score_response.json` correctly
- Throws `DeepSeekResponseError` on non-JSON input
- Throws on `score: 0`, `score: 11`, `score: 7.5`, missing `fitSignal`, missing `gap`
- `createScoredJob` includes all `JobFile` fields, sets `rank: null`, `actionFlag: null`
- `npm run lint` passes; `npm test` passes; `scoredJob.js` coverage ≥ 90%

---

### P2-T03 · `stackRank.js` — StackRank formatter and parser

**Status:** ✅ Complete
**Complexity:** medium
**What:** Create `src/models/stackRank.js` exporting: `formatStackRank(rankedJobs, date, fuzzyWarnings, stats)`
  which produces the full stack rank markdown string; `parseStackRank(markdown)` which extracts
  qualifying job entries from the markdown; and `formatSubmissionRecord(record, scoredJob)` which
  produces the per-application `submission_record.md` content.
**Prerequisite:** P2-T02 complete.
**Hard deps:** P2-T02
**Files:** `src/models/stackRank.js` (new), `tests/unit/stackRank.test.js` (new)
**Reviewer:** Yes
**Key constraints:**

- `formatStackRank` signature is `(rankedJobs, date, fuzzyWarnings, stats)` — four parameters, not two
- `fuzzyWarnings` renders as `⚠️ **Possible duplicate:**` blocks between affected entries
- Salary line is omitted entirely when `job.salary` is `null`
- Header includes stats line: `*Score stats: mean X.X | range Y–Z | distribution: ...*`
- `parseStackRank` returns only `DEEP_TAILOR` and `AUTO_GENERATED` entries
- Each entry includes `sourceFilename` and `linkedInJobId`
- `formatSubmissionRecord` output must contain all five section headers: `# Submission Record —`, `## Pillars Selected`, `## Cover Letter Structure`, `## Quality Assessment`, `## Application Status`
- `formatSubmissionRecord` renders `null` quality fields as `—` placeholders, not errors

**Done when:**

- `formatStackRank` renders correct rank order, action flags, Source file, LinkedIn Job ID fields
- Salary line omitted when null
- Stats line present in header
- Fuzzy warning rendered when `fuzzyWarnings` is non-empty; absent when empty
- `parseStackRank` returns only qualifying entries with `sourceFilename` and `linkedInJobId`
- Round-trip: `parseStackRank(formatStackRank(...))` returns correct entries
- `formatSubmissionRecord` contains all 5 required section headers
- `formatSubmissionRecord` handles null quality fields without throwing
- `npm run lint` passes; `npm test` passes; `stackRank.js` coverage ≥ 90%

---

### P2-T04 · `applicationRecord.js` — ApplicationRecord model

**Status:** ✅ Complete
**Complexity:** low
**What:** Create `src/models/applicationRecord.js` exporting: `createApplicationRecord(scoredJob, outputPath, dateStr)`
  which creates a new record at generation time with all quality fields as `null`; `isValidStatus(status)`
  which validates status strings; `generateRecordId(dateStr, company, title)` which creates a
  consistent slug; and the `VALID_STATUSES` constant array.
**Prerequisite:** P2-T02 complete.
**Hard deps:** P2-T02
**Files:** `src/models/applicationRecord.js` (new), `tests/unit/applicationRecord.test.js` (new)
**Reviewer:** Skip
**Key constraints:**

- `createApplicationRecord` sets all quality fields to `null`, `pillarsSelected` to `[]`, `notes` to `''`, `dateApplied` to `null`, `applicationMethod` to `null`, `status` to `'generated'`
- `generateRecordId` uses `sanitizeForFilename` internally — handles special characters
- `VALID_STATUSES` is `['generated', 'applied', 'interviewing', 'rejected', 'offer', 'withdrawn']`

**Done when:**

- `createApplicationRecord` produces record with `status: 'generated'` and all quality fields `null`
- `generateRecordId('2026-05-30', 'AT&T', 'Senior Engineer')` returns `'2026-05-30-ATT-Senior-Engineer'`
- `isValidStatus` returns `true` for all 6 valid statuses and `false` for `''`, `'pending'`, `'unknown'`
- `npm run lint` passes; `npm test` passes; `applicationRecord.js` coverage ≥ 90%

---

### Dependency graph

```
P1-T02
  └── P2-T01
        └── P2-T02
              ├── P2-T03
              └── P2-T04
```

---

# Phase 3 — Adapters

**Status:** ✅ Complete

All modules that perform side effects (filesystem, HTTP, external API) plus the three pure lib modules (deduplicator, ranker, promptBuilder). After this phase every building block is in place and independently tested. Orchestrators in Phase 4 will only call functions defined here.

---

## Phase 3 tasks

### P3-T01 · `fileStore.js` — filesystem adapter

**Status:** ✅ Complete
**Complexity:** high
**What:** Create `src/lib/fileStore.js` — the only module in the project that touches the
  filesystem. Exports ten functions: `readJobFiles`, `writeJobFile`, `writeStackRank`,
  `readStackRank`, `readConfig`, `writeApplicationDocs`, `writeSubmissionRecord`,
  `readApplications`, `writeApplications`, `archiveJobFiles`. Uses `fs.promises` throughout.
  Calls `sanitizeForFilename` internally in `writeApplicationDocs` before path construction.
**Prerequisite:** Phase 2 complete.
**Hard deps:** P2-T01, P2-T04
**Files:** `src/lib/fileStore.js` (new), `tests/integration/fileStore.test.js` (new)
**Reviewer:** Yes
**Key constraints:**

- `fs.promises` only — no `fs.readFileSync`, `fs.writeFileSync`, or callback-style `fs.readFile`
- `readApplications` returns `[]` when file does not exist — never throws on missing file
- `writeApplicationDocs` calls `sanitizeForFilename` on company and title before path construction
- `writeStackRank` and `readStackRank` take `dateStr` string, not `Date` objects
- Integration tests use `fs.promises.mkdtemp(path.join(os.tmpdir(), 'job-pipeline-test-'))` — no `tmp` package
- `afterEach` must `fs.rm(tmpDir, { recursive: true, force: true })` to clean up temp dirs

**Done when:**

- All 10 functions use `fs.promises` (code review — no sync variants)
- `readJobFiles` returns `[]` for empty directory and ignores non-`.md` files
- `writeJobFile` appends `-2` then `-3` on filename collision
- `writeStackRank` creates dated subdirectory if absent
- `readStackRank` throws descriptive error including the path when file not found
- `readConfig` throws `ConfigMissingError` with filename for missing file
- `writeApplicationDocs` returns `true` on first call and `false` without overwriting when dir exists
- `writeApplicationDocs` sanitizes `company='AT&T'` → folder named `ATT - ...`
- `readApplications` returns `[]` when `applications.json` does not exist
- `writeApplications` → `readApplications` round-trips correctly
- `archiveJobFiles` moves all `.md` files, returns correct count, leaves source dir empty
- Test setup uses `fs.mkdtemp` — no `tmp` package import (code review)
- `npm run lint` passes; `npm test` passes; `fileStore.js` coverage ≥ 85%

---

### P3-T02 · `deduplicator.js` — URL and fuzzy deduplication

**Status:** ✅ Complete
**Complexity:** medium
**What:** Create `src/lib/deduplicator.js` exporting `deduplicateJobs(jobs)`. Performs two-pass
  deduplication: Pass 1 removes exact URL duplicates keeping the most recently harvested; Pass 2
  flags jobs with matching sanitized company+title but different URLs as `fuzzyWarnings`. Returns
  `{ unique, duplicates, fuzzyWarnings }`. Does not mutate input.
**Prerequisite:** Phase 2 complete.
**Hard deps:** P2-T01
**Files:** `src/lib/deduplicator.js` (new), `tests/unit/deduplicator.test.js` (new)
**Reviewer:** Skip
**Key constraints:**

- Pass 1: keep most recently harvested on URL collision (compare `harvested` Date field)
- Pass 2: flag both jobs in `fuzzyWarnings` — do not remove them from `unique`
- Exact URL duplicates must NOT also appear in `fuzzyWarnings`
- Input array must not be mutated

**Done when:**

- Two jobs with identical URLs: `unique` has newer, `duplicates` has skipped
- Two jobs with matching company+title but different URLs: both in `unique`, one entry in `fuzzyWarnings`
- `fuzzyWarnings` is `[]` when no fuzzy matches
- Input array not mutated
- Handles empty and single-item arrays
- `npm run lint` passes; `npm test` passes; `deduplicator.js` coverage ≥ 95%

---

### P3-T03 · `ranker.js` — stack ranking

**Status:** ✅ Complete
**Complexity:** low
**What:** Create `src/lib/ranker.js` exporting `rankJobs(jobs)`. Sorts `ScoredJob` array
  descending by score, assigns dense rank 1..N, and sets `actionFlag` per rule: ranks 1–4 →
  `DEEP_TAILOR`; rank 5+ with score ≥ 6 → `AUTO_GENERATED`; rank 5+ with score < 6 → `NO_DOCS`.
  Fewer than 4 jobs → all `DEEP_TAILOR`. Ties straddling rank 4/5 → both get `DEEP_TAILOR`.
  Does not mutate input.
**Prerequisite:** Phase 2 complete.
**Hard deps:** P2-T02
**Files:** `src/lib/ranker.js` (new), `tests/unit/ranker.test.js` (new)
**Reviewer:** Skip
**Key constraints:**

- Does not mutate input array — returns a new array
- Tie straddling rank 4/5: all tied jobs get `DEEP_TAILOR`
- Fewer than 4 total jobs: all get `DEEP_TAILOR`

**Done when:**

- 10 jobs with distinct scores: ranks 1–4 = DEEP_TAILOR; rank 5+ per score threshold
- Rank 5, score 6 → AUTO_GENERATED; rank 5, score 5 → NO_DOCS
- 3 total jobs → all DEEP_TAILOR
- Tie at rank 4/5 → both get DEEP_TAILOR
- Input not mutated; empty → empty; single → DEEP_TAILOR rank 1
- `npm run lint` passes; `npm test` passes; `ranker.js` coverage ≥ 95%

---

### P3-T04 · `promptBuilder.js` — prompt assembly

**Status:** ✅ Complete
**Complexity:** low
**What:** Create `src/lib/promptBuilder.js` exporting four pure functions:
  `buildScoringPrompt(careerContents, jobFile)`, `buildResumePrompt(careerContents, pillarContents, scoredJob)`,
  `buildCoverLetterPrompt(careerContents, scoredJob, resumeContent)`, and
  `buildQualityPrompt(scoredJob, resumeContent, coverLetterContent)`. These assemble the user-side
  messages sent to DeepSeek. System prompts come from config files and are passed through unchanged.
**Prerequisite:** Phase 2 complete.
**Hard deps:** P2-T01, P2-T02
**Files:** `src/lib/promptBuilder.js` (new), `tests/unit/promptBuilder.test.js` (new)
**Reviewer:** Skip
**Key constraints:**

- `buildScoringPrompt` must include section labels `CANDIDATE PROFILE:` and `JOB DESCRIPTION:`
- No function truncates its inputs
- All functions return non-empty strings — never `undefined` or `null`

**Done when:**

- `buildScoringPrompt` output contains full career contents, full job description, both section labels
- `buildResumePrompt` contains career, pillars, job description, fitSignal, gap
- `buildCoverLetterPrompt` contains career, job description, resume content
- `buildQualityPrompt` contains job description, resume content, cover letter content
- All return non-empty strings for all fixture inputs
- `npm run lint` passes; `npm test` passes; `promptBuilder.js` coverage ≥ 90%

---

### P3-T05 · `deepseek.js` — DeepSeek API adapter

**Status:** ✅ Complete
**Complexity:** medium
**What:** Create `src/lib/deepseek.js` — the only module that calls the DeepSeek API. Exports
  `callDeepSeek(systemPrompt, userPrompt, options)` using Node.js v24 native `fetch`. Options
  accepts `maxTokens` and optional `timeoutMs` (default 30000). Throws `ConfigMissingError` when
  API key not set and `DeepSeekResponseError` on non-200, timeout, or network failure. Never
  includes the API key in error messages.
**Prerequisite:** Phase 2 complete.
**Hard deps:** P2-T02
**Files:** `src/lib/deepseek.js` (new), `tests/integration/deepseek.test.js` (new),
  `tests/helpers/msw-setup.js` (new)
**Reviewer:** Yes
**Key constraints:**

- Uses Node.js native `fetch` — no `axios` import anywhere
- `nock` must not be used — use `msw` v2 (`msw/node`) for all HTTP mocking
- Model is hardcoded as `'deepseek-chat'` — not configurable
- API key must never appear in thrown error messages
- Timeout via `AbortSignal.timeout(options.timeoutMs ?? 30000)`

**Done when:**

- Returns content string from mocked 200 response
- Throws `DeepSeekResponseError` on 401 (message includes "unauthorized")
- Throws `DeepSeekResponseError` on 429 (message includes "rate limit")
- Throws `DeepSeekResponseError` on 500
- Throws `DeepSeekResponseError` on timeout
- Throws `ConfigMissingError` when `DEEPSEEK_API_KEY` not set
- Error messages never include the API key value (verified with a known test key)
- No `axios` import (code review)
- `npm run lint` passes; `npm test` passes; `deepseek.js` coverage ≥ 85%

---

### Dependency graph

```
P2-T01
  ├── P3-T01 (also needs P2-T04)
  ├── P3-T02
  └── P3-T04 (also needs P2-T02)

P2-T02
  ├── P3-T03
  ├── P3-T04
  └── P3-T05
```

---

# Phase 4 — Orchestrators + Server

**Status:** ✅ Complete

Wires together all Phase 3 adapters into runnable scripts and a live server. Orchestrators contain no business logic — they call functions from `src/` in sequence. Two tasks (dashboard and bookmarklet) require manual testing against a running server and a live LinkedIn page respectively.

---

## Phase 4 tasks

### P4-T01 · `score.js` — scoring orchestrator

**Status:** ✅ Complete
**Complexity:** high
**What:** Create `score.js` — the CLI script that reads all job files, deduplicates, calls DeepSeek
  sequentially to score each job, ranks results, computes stats, formats and writes the stack rank
  file, and broadcasts SSE events throughout. Accepts `--date=YYYY-MM-DD` flag via `util.parseArgs`.
**Prerequisite:** Phase 3 complete.
**Hard deps:** P2-T03, P3-T01, P3-T02, P3-T03, P3-T04, P3-T05
**Files:** `score.js` (new), `tests/e2e/score.test.js` (new)
**Reviewer:** Yes
**Key constraints:**

- `require('dotenv').config()` must be the literal first line
- All DeepSeek calls are sequential — `Promise.all` is explicitly forbidden (grep before accepting)
- `--date` parsed via `util.parseArgs` — raw string used for path construction, never `new Date(values.date)`
- Default date via `formatDateString(new Date())` from `src/lib/dateUtils.js`
- Calls `formatStackRank(rankedJobs, date, fuzzyWarnings, stats)` — four arguments
- No logic in this file — all logic in `src/`
- No bare `console.log` — use `logger` only
- Event broadcasts via `broadcastEvent` are fire-and-forget — never block on them

**Done when:**

- `require('dotenv').config()` is first line (code review)
- Produces correct `stack_rank_[dateStr].md` from fixture jobs
- Stack rank header includes stats line
- Skips URL duplicate (older timestamp) with logged warning
- Fuzzy duplicate warning appears in stack rank output
- Skips malformed file with logged warning, continues with remaining jobs
- Exits 1 listing all missing config files when any are absent
- Exits 0 with message when `jobs/` is empty
- No `Promise.all` in file (grep: `grep -n "Promise.all" score.js`)
- `--date` flag overrides date for output file path
- Progress logged per job with ETA
- `npm run lint` passes; `npm test` passes

---

### P4-T02 · `generate.js` — generation orchestrator

**Status:** ✅ Complete
**Complexity:** high
**What:** Create `generate.js` — the CLI script that reads today's stack rank, generates resume,
  cover letter, and quality rating for each qualifying job via three sequential DeepSeek calls,
  writes all output files, appends to `applications.json`, and broadcasts SSE events. Accepts
  `--date` flag.
**Prerequisite:** P4-T01 accepted.
**Hard deps:** P2-T03, P2-T04, P3-T01, P3-T04, P3-T05
**Files:** `generate.js` (new), `tests/e2e/generate.test.js` (new)
**Reviewer:** Yes
**Key constraints:**

- `require('dotenv').config()` must be the literal first line
- `Promise.all` forbidden on DeepSeek calls (grep before accepting)
- `readApplications` called ONCE before the loop; `writeApplications` called ONCE after — never inside the loop
- `readJobFiles` called ONCE before the loop into a `Map<filename, content>` — never inside the loop
- Quality call failure sets quality fields to `null` — does not block resume/CL write
- `doc_generated` event must include `sourceFilename` field
- Output directory uses sanitized company+title (via `fileStore.writeApplicationDocs`)
- `generate.js` does NOT import from `score.js`
- No bare `console.log` — use `logger` only

**Done when:**

- `require('dotenv').config()` is first line (code review)
- Generates `resume.md`, `cover_letter.md`, `submission_record.md` for each 6+ job
- No output for `NO_DOCS` jobs
- Idempotent — re-run skips existing output directories
- Source file not found after cleanup → skip + log, continue
- Exits 1 with date hint when stack rank not found
- Exits 1 listing all missing configs
- Quality call failure does not block resume/CL write
- `applications.json` read once before loop, written once after (code review)
- `readJobFiles` not called inside loop (code review)
- `applications.json` contains one entry per generated package with correct fields
- `doc_generated` event includes `sourceFilename`
- No `Promise.all` in file (grep)
- `npm run lint` passes; `npm test` passes

---

### P4-T03 · `cleanup.js` — archive orchestrator

**Status:** ✅ Complete
**Complexity:** low
**What:** Create `cleanup.js` — the CLI script that archives all `.md` files from `jobs/` to
  `archive/YYYY-MM-DD/` using `formatDateString(new Date())` for the date. Exits 0 with a message
  if `jobs/` is already empty. Second run on the same day appends to the existing archive directory.
**Prerequisite:** P3-T01 complete.
**Hard deps:** P3-T01
**Files:** `cleanup.js` (new), `tests/e2e/cleanup.test.js` (new)
**Reviewer:** Skip
**Key constraints:**

- `require('dotenv').config()` must be the literal first line
- Uses `formatDateString` from `src/lib/dateUtils.js` — never `toISOString()`
- No bare `console.log` — use `logger` only

**Done when:**

- All `.md` files moved to `archive/[dateStr]/`
- `jobs/` directory exists but is empty after run
- Non-`.md` files not moved
- Exits 0 with message when `jobs/` already empty
- Second run appends to existing archive, does not fail
- `npm run lint` passes; `npm test` passes

---

### P4-T04 · `server.js` — server, SSE, and state

**Status:** ✅ Complete
**Complexity:** high
**What:** Create `server/server.js` — the Express server serving six endpoints: `POST /harvest`,
  `GET /health`, `GET /dashboard`, `GET /events` (SSE), `POST /event` (internal), `GET /state`.
  Maintains in-memory state rebuilt from `applications.json` on startup. Uses an in-memory URL
  Set for O(1) duplicate detection. Exports `createApp(jobsDir)` factory for testing.
**Prerequisite:** P3-T01 complete.
**Hard deps:** P3-T01
**Files:** `server/server.js` (new), `tests/integration/server.test.js` (new)
**Reviewer:** Yes
**Key constraints:**

- `require('dotenv').config()` must be the literal first line
- Must export `createApp(jobsDir)` factory — server only starts when `require.main === module`
- Port from `process.env.PIPELINE_PORT` (default `3000`) — same env var as `eventBroadcaster.js`
- CORS: `Access-Control-Allow-Origin: *` on all responses
- SSE clients: on `req.on('close')` remove client from array — no crash on disconnect
- In-memory URL Set populated from existing `jobs/` files on startup
- `GET /events` sends current state as first event immediately on connect
- No `supertest` in tests — use `createApp` factory + native `fetch` against random port
- No bare `console.log` — use `logger` only

**Done when:**

- `server.js` exports `createApp(jobsDir)`
- `POST /harvest` returns 200 and writes file for valid body
- Written file passes `parseJobFile` without error
- `POST /harvest` returns 409 for duplicate URL (checked against in-memory Set)
- `POST /harvest` returns 400 listing all missing required fields
- `GET /health` returns `200 { status: 'ok' }`
- `GET /dashboard` returns `200 text/html`
- `GET /events` returns `text/event-stream` and sends current state as first event
- `POST /event` with `scoring_started` updates `state.phase` to `'scoring'`
- `POST /event` with `job_scored` appends to `state.scored`
- `GET /state` returns current state as JSON
- SSE client disconnect handled without crash
- URL cache detects duplicates from existing `jobs/` files on startup
- `Access-Control-Allow-Origin: *` on all responses
- `npm run lint` passes; `npm test` passes; `server.js` coverage ≥ 85%

---

### P4-T05 · `dashboard.html` — real-time dashboard UI

**Status:** ✅ Complete
**Complexity:** high
**What:** Create `server/dashboard.html` — a single HTML file with inline CSS and JS, no external
  dependencies, no CDN resources, no build step. Connects to `GET /events` SSE stream and
  `GET /state` on load. Displays: header bar, score distribution chart (CSS-only bars), stack rank
  table (builds row by row), application history panel, and scrolling activity log.
**Prerequisite:** P4-T04 complete.
**Hard deps:** P4-T04
**Files:** `server/dashboard.html` (new), `tests/integration/dashboard.test.js` (new)
**Reviewer:** Yes
**Key constraints:**

- Single HTML file — inline CSS and JS only, no external dependencies, no CDN
- Stack rank rows matched to `doc_generated` events by `sourceFilename` — not by company+title strings
- Quality score < 6 rendered in amber with ⚠️
- Graceful degradation: if `/state` fetch fails on load, show "Server not running" banner
- Required element IDs: `#score-distribution`, `#stack-rank-table`, `#activity-log`, `#app-history`, `#header-phase`
- Must render correctly in Chrome and Edge on Windows

**Done when:**

- `GET /dashboard` serves the file with `200 text/html`
- HTML contains required element IDs: `score-distribution`, `stack-rank-table`, `activity-log`
- Manual test: run `score.js` with server running — table builds row by row in real time
- Manual test: run `generate.js` — R★/CL★ columns populate in correct rows
- Manual test: refresh page mid-run — state restored from `/state`
- Manual test: stop server — "Server not running" banner displayed
- Manual test result documented with date, browser, and outcome
- `npm run lint` passes; `npm test` passes (automated test only checks element IDs)

---

### P4-T06 · `bookmarklet.js` — browser bookmarklet

**Status:** ✅ Complete
**Complexity:** medium
**What:** Create `server/bookmarklet.js` (human-readable source) and `scripts/minify-bookmarklet.js`
  (build script). The bookmarklet extracts job data from LinkedIn's DOM and POSTs to
  `localhost:[PIPELINE_PORT]/harvest`. Exports `buildPostBody(document)` for unit testing.
  The minified `server/bookmarklet.min.js` is generated by `npm run build:bookmarklet`.
**Prerequisite:** P4-T04 complete.
**Hard deps:** P4-T04
**Files:** `server/bookmarklet.js` (new), `scripts/minify-bookmarklet.js` (new),
  `server/bookmarklet.min.js` (new), `tests/unit/bookmarklet.test.js` (new)
**Reviewer:** Yes
**Key constraints:**

- `buildPostBody(document)` exported for unit testing — jsdom used in tests
- `linkedInJobId` extracted from URL via `/jobs/view/([0-9]+)/` regex
- `linkedInJobId` set to `null` for non-LinkedIn URLs
- Salary field returns empty string when absent — never null in POST body
- URL query params stripped via `new URL(window.location.href).origin + pathname`
- `npm run build:bookmarklet` must produce `bookmarklet.min.js` starting with `javascript:`
- Toast on success (green), toast on duplicate 409 (yellow), `alert()` on failure

**Done when:**

- `buildPostBody` extracts title (primary + fallback selector), company, location, description
- `buildPostBody` returns empty string for salary when absent
- `buildPostBody` strips query params from URL
- `buildPostBody` includes `linkedInJobId` field (null for non-LinkedIn URLs)
- `npm run build:bookmarklet` produces `bookmarklet.min.js` starting with `javascript:`
- Manual test: click bookmarklet on live LinkedIn job page
- Manual test: green toast with correct company and title
- Manual test: `.md` file written to `jobs/` with all fields populated
- Manual test: dashboard updates in real time showing the harvested job
- Manual test result documented with LinkedIn job URL, date, and outcome
- `npm run lint` passes; `npm test` passes

---

### P4-T07 · `apply.js` — application status tracker

**Status:** ✅ Complete
**Complexity:** medium
**What:** Create `apply.js` — an interactive CLI using Node built-in `readline` that lists
  application records and allows status updates. Exports `processUpdate(records, updatePayload)`
  as a pure function for testing. The readline layer calls `processUpdate` — it is not tested
  directly. Accepts `--all` flag to show all entries regardless of status.
**Prerequisite:** P3-T01 complete, P2-T04 complete.
**Hard deps:** P2-T04, P3-T01
**Files:** `apply.js` (new), `tests/integration/apply.test.js` (new)
**Reviewer:** Skip
**Key constraints:**

- `require('dotenv').config()` must be the literal first line
- `--all` parsed via `util.parseArgs` — no manual `process.argv` slicing
- `processUpdate(records, payload)` is a pure function that returns a new array — does not mutate input
- Tests drive `processUpdate` directly — readline layer is not tested
- `readApplications` returns `[]` when file does not exist — `apply.js` creates file on first write
- No external prompt library — Node built-in `readline` only
- No bare `console.log` — use `logger` only

**Done when:**

- `processUpdate` returns new array without mutating input
- `processUpdate` updates correct record by index
- `processUpdate` sets `dateApplied` when status is `'applied'`
- `processUpdate` throws on out-of-range index
- `processUpdate` throws on invalid status string
- Default mode shows only `status === 'generated'` entries
- `--all` flag shows all entries
- `applications.json` written after each update
- `applications.json` created when not found
- `require('dotenv').config()` is first line
- `npm run lint` passes; `npm test` passes

---

### Dependency graph

```
P3-T01
  ├── P4-T01 (also needs P2-T03, P3-T02, P3-T03, P3-T04, P3-T05)
  ├── P4-T02 (also needs P2-T03, P2-T04, P3-T04, P3-T05; sequenced after P4-T01)
  ├── P4-T03
  ├── P4-T04
  │     ├── P4-T05
  │     └── P4-T06
  └── P4-T07 (also needs P2-T04)
```

---

# Phase 5 — Integration

**Status:** Pending

The full end-to-end pipeline test covering same-day and cross-day scenarios, SSE event verification, and the global 80% coverage gate. This phase can only begin once every task in Phase 4 is green.

---

## Phase 5 tasks

### P5-T01 · End-to-end pipeline test

**Status:** ✅ Complete
**Complexity:** high
**What:** Create `tests/e2e/pipeline.test.js` — full pipeline integration test using tmp directories
  and msw-mocked DeepSeek. Tests the complete same-day workflow (harvest → score → generate →
  cleanup) and a cross-day scenario using `--date` flags. Verifies SSE events, `applications.json`
  population, `submission_record.md` creation, and enforces the global 80% coverage threshold.
**Prerequisite:** All Phase 4 tasks complete.
**Hard deps:** P4-T01, P4-T02, P4-T03, P4-T04, P4-T05, P4-T06
**Files:** `tests/e2e/pipeline.test.js` (new)
**Reviewer:** Yes
**Key constraints:**

- Global Jest coverage threshold of 80% set here for the first time — add to `jest.config.js`
- Uses `tests/helpers/msw-setup.js` (created in P3-T05) for DeepSeek mocking in child processes
- Child processes receive env: `DEEPSEEK_API_KEY: 'test-key'`, `PIPELINE_PORT: '3001'`, `NODE_OPTIONS: '--require ./tests/helpers/msw-setup.js'`
- Tests must verify `doc_generated` events include `sourceFilename`
- Cross-day test must verify output goes to `resumes/[--date value]/` not today's folder

**Done when:**

- POST two jobs to server → two valid `.md` files written to `jobs/`
- `score.js` → `stack_rank_[today].md` with both jobs ranked and stats line present
- Fuzzy duplicate warning in stack rank when fixture includes matching company+title
- `generate.js` → `resume.md`, `cover_letter.md`, `submission_record.md` for qualifying jobs
- No output for `NO_DOCS` jobs
- `applications.json` contains one entry per generated package with correct fields
- `doc_generated` SSE events received by test client, each including `sourceFilename`
- `generate.js` is idempotent — second run skips existing output directories
- `cleanup.js` → `jobs/` empty, files moved to `archive/[today]/`
- All CLI scripts exit 0 under normal conditions
- Cross-day: `score.js --date=2026-05-28` writes to `resumes/2026-05-28/`
- Cross-day: `generate.js --date=2026-05-28` uses correct stack rank
- Cross-day: `generate.js` without `--date` on a different calendar day exits 1 with date hint
- `npm run lint` passes; `npm test` passes with all suites green
- Global coverage ≥ 80%

---

### Dependency graph

```
P4-T01
  └── P5-T01

P4-T02
  └── P5-T01

P4-T03
  └── P5-T01

P4-T04
  └── P5-T01

P4-T05
  └── P5-T01

P4-T06
  └── P5-T01
```

---
