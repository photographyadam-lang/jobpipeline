# Job Pipeline — Architecture Guide

> **Audience:** AI coding agents tasked with maintaining, extending, or debugging this project.
> **Last updated:** 2026-06-03

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Directory Structure](#2-directory-structure)
3. [Architecture Philosophy](#3-architecture-philosophy)
4. [Module Map](#4-module-map)
5. [Data Models](#5-data-models)
6. [Pipeline Orchestration](#6-pipeline-orchestration)
7. [Server Architecture](#7-server-architecture)
8. [SSE Event System](#8-sse-event-system)
9. [Deduplication Algorithm](#9-deduplication-algorithm)
10. [Ranking Algorithm](#10-ranking-algorithm)
11. [Prompt Assembly](#11-prompt-assembly)
12. [Testing Strategy](#12-testing-strategy)
13. [Coding Conventions & Constraints](#13-coding-conventions--constraints)
14. [Dependency Graph](#14-dependency-graph)

---

## 1. Project Overview

A local Node.js pipeline that:

1. **Harvests** LinkedIn job descriptions (via browser bookmarklet or manual AI ingestion)
2. **Scores** them against a candidate profile using the DeepSeek LLM API
3. **Ranks** them with a dense-ranking algorithm and assigns action flags
4. **Generates** tailored resumes and cover letters for top-ranked jobs
5. **Tracks** application status over time
6. **Serves** a real-time SSE dashboard showing pipeline progress

The pipeline is designed for a single user (adam_buteux) running locally on Windows. It is not deployed to any server — the Express server exists solely to provide a dashboard UI and SSE relay.

---

## 2. Directory Structure

```
jobs-pipeline/
├── config/                           # Human-authored config files (never modified by agent)
│   ├── adam_buteux_career.md         # Candidate career profile
│   ├── adam_buteux_pillar_library.md # Writing style pillars
│   ├── scoring_prompt.md             # Scoring system prompt
│   ├── resume_prompt.md              # Resume generation system prompt
│   ├── cover_letter_prompt.md        # Cover letter generation system prompt
│   └── quality_prompt.md             # Quality assessment system prompt
│
├── docs/
│   ├── RUNBOOK.md                    # Production runbook (setup, troubleshooting)
│   └── architecture.md               # THIS FILE
│
├── plans/                            # Implementation plans per task
│   └── *.md
│
├── scripts/
│   └── minify-bookmarklet.js         # Terser-based bookmarklet minifier
│
├── server/
│   ├── server.js                     # Express app factory + SSE + state management
│   ├── dashboard.html                # Single-file dashboard UI (1377 lines)
│   └── bookmarklet.js                # Browser bookmarklet for LinkedIn harvesting
│
├── src/
│   ├── lib/
│   │   ├── dateUtils.js              # Date formatting (local time)
│   │   ├── deduplicator.js           # Two-pass job deduplication
│   │   ├── deepseek.js               # DeepSeek API adapter (fetch-based)
│   │   ├── errors.js                 # Custom error classes
│   │   ├── eventBroadcaster.js       # SSE event broadcaster (fire-and-forget)
│   │   ├── fileStore.js              # All filesystem I/O (fs.promises only)
│   │   ├── logger.js                 # Centralized terminal logging
│   │   ├── promptBuilder.js          # Pure functions for prompt assembly
│   │   └── ranker.js                 # Dense ranking + action flag assignment
│   └── models/
│       ├── applicationRecord.js      # ApplicationRecord type + helpers
│       ├── job.js                    # JobFile type + parse/format/sanitize
│       ├── scoredJob.js              # Score response parsing + ScoredJob creation
│       └── stackRank.js              # StackRank markdown format/parse + submission records
│
├── tests/
│   ├── unit/                         # Pure unit tests (Jest, no msw)
│   ├── integration/                  # Integration tests (Jest + msw)
│   ├── e2e/                          # End-to-end tests (Jest + msw + child process)
│   ├── fixtures/                     # Test fixtures (never modified)
│   └── helpers/                      # Test setup helpers (msw handlers)
│
├── score.js                          # Scoring orchestrator (CLI entry point)
├── generate.js                       # Generation orchestrator (CLI entry point)
├── cleanup.js                        # Archive orchestrator (CLI entry point)
├── apply.js                          # Application status tracker (planned T17)
│
├── package.json                      # CommonJS, scripts for all operations
├── jest.config.js                    # Jest config with per-file coverage thresholds
├── eslint.config.js                  # ESLint flat config
├── .env                              # Secrets (DEEPSEEK_API_KEY, PIPELINE_PORT)
├── .env.example                      # Template for .env
├── AGENTS.md                         # Agent rules (coding constraints, conventions)
├── SESSIONSTATE.md                   # Current session state
├── job-pipeline-spec-v5.md           # Full application specification
├── job-pipeline-tasks-v5.md          # Atomic build tasks T01-T17
├── TASKS.md                          # Active task tracking
└── TASKS-COMPLETED.md                # Completed task log
```

### Dynamic directories (created at runtime)

| Directory | Created by | Contents |
|-----------|-----------|----------|
| `jobs/` | Harvesting | Raw job description markdown files |
| `jobs/archive/` | `cleanup.js` | Archived job files (dated subdirectories) |
| `resumes/` | `score.js` | Stack rank files per date |
| `resumes/YYYY-MM-DD/` | `generate.js` | Generated resumes, cover letters, submission records |

---

## 3. Architecture Philosophy

### 3.1 Pure Function / Model Architecture

The project follows a strict separation between **pure logic** and **side effects**:

```
┌─────────────────────────────────────────────────────┐
│                 Pure Functions                        │
│  (src/models/*.js, most of src/lib/*.js)              │
│                                                       │
│  • Parse, format, transform                           │
│  • Validate, calculate, rank                          │
│  • Assemble prompts, build markdown                   │
│  • No I/O, no network, no console                     │
│  • Deterministic given same inputs                    │
└──────────────────────┬──────────────────────────────┘
                       │called by
┌──────────────────────▼──────────────────────────────┐
│              Orchestrators (wiring only)              │
│  (score.js, generate.js, cleanup.js, apply.js)        │
│                                                       │
│  • Parse CLI flags (util.parseArgs)                   │
│  • Call pure functions from src/                      │
│  • Call side-effect modules in correct order          │
│  • No business logic — just coordination              │
└──────────────────────┬──────────────────────────────┘
                       │uses
┌──────────────────────▼──────────────────────────────┐
│           Side-Effect Modules (one concern each)      │
│                                                       │
│  • fileStore.js     — filesystem read/write           │
│  • deepseek.js      — DeepSeek API HTTP calls         │
│  • eventBroadcaster.js — SSE POST to dashboard        │
│  • logger.js        — terminal output                 │
│  • server.js        — HTTP server                     │
└─────────────────────────────────────────────────────┘
```

### 3.2 Side-Effect Isolation

Every side effect has exactly **one** module that owns it:

| Side effect | Owner module | Why |
|-------------|-------------|-----|
| Filesystem read/write | `src/lib/fileStore.js` | Single point for mocking in tests |
| DeepSeek API calls | `src/lib/deepseek.js` | Centralized error handling + timeout |
| SSE event broadcasting | `src/lib/eventBroadcaster.js` | Fire-and-forget, never throws |
| HTTP server | `server/server.js` | Express factory pattern |
| Terminal output | `src/lib/logger.js` | Structured prefix + timestamp format |

**Rule:** If you need to read a file, call `fileStore.readJobFiles()` — never use `fs` directly anywhere else. If you need to log something, call `logger.info()` — never use `console.log`.

### 3.3 Orchestrators Are Wiring Only

Orchestrators (`score.js`, `generate.js`, `cleanup.js`, `apply.js`) contain:
- `require('dotenv').config()` as the **literal first line**
- `const { parseArgs } = require('util');` for CLI flag parsing
- Sequential calls to pure functions + side-effect modules
- `for` loops (never `Promise.all` on DeepSeek calls)
- Broadcasts and logging

If you find yourself tempted to put business logic in an orchestrator, it belongs in `src/`.

---

## 4. Module Map

### 4.1 `src/lib/errors.js` — Custom Errors

| Class | Constructor args | Usage |
|-------|-----------------|-------|
| `JobParseError` | `(message, filename)` | Thrown when a job file cannot be parsed |
| `DeepSeekResponseError` | `(message, statusCode)` | Thrown on non-200 DeepSeek API responses |
| `ConfigMissingError` | `(filename)` | Auto-generates message: `"Missing config file: {filename}"` |

All extend `Error`. Used throughout `src/models/` and `src/lib/deepseek.js`.

### 4.2 `src/lib/logger.js` — Terminal Logger

```javascript
logger.info(prefix, msg)   // [YYYY-MM-DD HH:MM:SS] [prefix] msg
logger.error(prefix, msg)  // Same format, but writes to stderr
logger.warn(prefix, msg)   // Same format
```

Timestamps are in UTC (uses `.toISOString()` → strip `T`/`Z` → replace with spaces). Prefix is conventionally the module name, e.g. `[score]`, `[generate]`, `[server]`.

### 4.3 `src/lib/dateUtils.js` — Date Formatting

| Function | Returns | Important |
|----------|---------|-----------|
| `formatDateString(date)` | `"YYYY-MM-DD"` | Uses **local** time — never `toISOString()`. This is used for all directory paths. |
| `formatDateTimeString(date)` | `"YYYY-MM-DD HH:MM"` | Same local-time approach |

**Critical:** File paths use `formatDateString(new Date())`. The raw `--date` flag string is used as-is for paths — never pass through `new Date(values.date)`.

### 4.4 `src/lib/eventBroadcaster.js` — SSE Relay

```javascript
async function broadcastEvent(type, data)
```

- Fire-and-forget POST to `http://localhost:{PIPELINE_PORT}/event`
- Timeout: 2 seconds (AbortSignal.timeout)
- **Never throws** — entire body wrapped in `try/catch`
- If the dashboard is not running, the pipeline continues silently
- The dashboard matches quality scores to stack rank rows by `sourceFilename`

### 4.5 `src/lib/fileStore.js` — Filesystem Adapter

All functions use `fs.promises` exclusively. No sync calls.

| Function | Purpose |
|----------|---------|
| `readJobFiles(jobsDir)` | Reads all `.md` files in a directory, returns `[{ filename, content }]` |
| `writeJobFile(jobsDir, filename, content)` | Writes a job file; appends `-2`, `-3` etc. on filename collision |
| `writeStackRank(resumesDir, dateStr, content)` | Writes `resumes/YYYY-MM-DD/stack-rank.md` |
| `readStackRank(resumesDir, dateStr)` | Reads a stack rank file; throws descriptive error if missing |
| `readConfig(configDir, filename)` | Reads a config file; throws `ConfigMissingError` if missing |
| `writeApplicationDocs(resumesDir, dateStr, company, title, resume, coverLetter)` | Writes resume + cover letter; returns `false` if directory exists (idempotent) |
| `writeSubmissionRecord(outputDir, content)` | Writes a submission record file |
| `readApplications(rootDir)` | Reads `applications.json` (returns `[]` if missing) |
| `writeApplications(rootDir, records)` | Writes `applications.json` |
| `archiveJobFiles(jobsDir, archiveDir, dateStr)` | Moves job files to `jobs/archive/YYYY-MM-DD/` |

**I/O optimization (mandatory):**
- `applications.json` is read **once** before the generate loop, written **once** after
- Job files are read **once** before the generate loop into a `Map` — never inside the per-job loop

### 4.6 `src/lib/deepseek.js` — DeepSeek API Adapter

```javascript
async function callDeepSeek(systemPrompt, userPrompt, options)
```

- Calls `https://api.deepseek.com/v1/chat/completions` via native Node.js `fetch`
- Model: `deepseek-chat`
- API key from `process.env.DEEPSEEK_API_KEY` (throws `ConfigMissingError` if missing)
- Error handling:
  - Non-200 status → `DeepSeekResponseError(message, statusCode)`
  - Network error or timeout → `DeepSeekResponseError` with network message
- Never exposes the API key in error messages
- Returns the raw response text (callers parse JSON)

### 4.7 `src/lib/deduplicator.js` — Job Deduplication

```javascript
function deduplicateJobs(jobs)
```

See [Section 9 — Deduplication Algorithm](#9-deduplication-algorithm).

### 4.8 `src/lib/ranker.js` — Stack Ranking

```javascript
function rankJobs(jobs)
```

See [Section 10 — Ranking Algorithm](#10-ranking-algorithm).

### 4.9 `src/lib/promptBuilder.js` — Prompt Assembly

| Function | Returns | Labels in prompt |
|----------|---------|-----------------|
| `buildScoringPrompt(careerContents, jobFile)` | `[systemPrompt, userPrompt]` | `CANDIDATE PROFILE`, `JOB DESCRIPTION` |
| `buildResumePrompt(careerContents, pillarContents, scoredJob)` | `[systemPrompt, userPrompt]` | `CANDIDATE PROFILE`, `WRITING STYLE PILLARS`, `JOB TO TARGET` |
| `buildCoverLetterPrompt(careerContents, scoredJob, resumeContent)` | `[systemPrompt, userPrompt]` | `CANDIDATE PROFILE`, `JOB TO TARGET`, `GENERATED RESUME` |
| `buildQualityPrompt(scoredJob, resumeContent, coverLetterContent)` | `[systemPrompt, userPrompt]` | `JOB DESCRIPTION`, `GENERATED RESUME`, `GENERATED COVER LETTER` |

All functions validate inputs and throw descriptive errors if required fields are missing.

---

## 5. Data Models

### 5.1 `JobFile` — Raw Job Description

```javascript
{
  title:           string,         // Job title (required)
  company:         string,         // Company name (required)
  location:        string,         // Location string (required)
  employmentType:  string,         // e.g. "Full-time" (required)
  salary:          string | null,  // Salary range if available
  url:             string,         // Full URL with query params stripped
  linkedInJobId:   string | null,  // Numeric LinkedIn job ID from URL
  harvested:       Date,           // When the job was harvested
  description:     string,         // Full job description markdown
  filename:        string          // Sanitized filename (used as sourceFilename in SSE)
}
```

**Source:** [`src/models/job.js`](src/models/job.js:14) — `parseJobFile(markdown, filename)`

Key behaviors:
- `url` has query parameters stripped (via URI manipulation)
- `linkedInJobId` extracted via regex `/\/jobs/view\/(\d+)/` on the URL
- `sanitizeForFilename(str, maxLength=60)` — spaces→hyphens, removes special chars, collapses hyphens, trims, truncates
- `formatJobFile(job)` — canonicalizes back to markdown
- Throws `JobParseError` with filename on malformed input

### 5.2 `ScoredJob` — Job + Score

```javascript
{
  // All JobFile fields, plus:
  score:       number,         // 1-10 integer
  fitSignal:   string,         // "STRONG_FIT" | "MODERATE_FIT" | "WEAK_FIT" | "POOR_FIT"
  gap:         string,         // Description of skill/experience gaps
  rank:        number | null,  // Assigned by ranker.js (null until ranked)
  actionFlag:  string | null,  // Assigned by ranker.js (null until ranked)
}
```

**Source:** [`src/models/scoredJob.js`](src/models/scoredJob.js:12) — `parseScoreResponse(rawResponse)`

Validation on score response:
- Must be valid JSON
- Must have `score` (integer, 1-10)
- Must have `fitSignal` (non-empty string)
- Must have `gap` (non-empty string)
- Throws `DeepSeekResponseError` on any validation failure

### 5.3 `StackRankEntry` — Parsed Stack Rank Row

```javascript
{
  rank:            number,
  score:           number,
  actionFlag:      "DEEP_TAILOR" | "AUTO_GENERATED" | "NO_DOCS",
  company:         string,
  title:           string,
  url:             string,
  linkedInJobId:   string | null,
  sourceFilename:  string
}
```

**Source:** [`src/models/stackRank.js`](src/models/stackRank.js:110) — `parseStackRank(markdown)`

Only `DEEP_TAILOR` and `AUTO_GENERATED` entries are parsed (the generate orchestrator uses this to know which jobs need documents).

The `formatStackRank()` function produces a full stack rank markdown document with:
- Header (date, generated timestamp, job count, doc count, stats)
- Per-job entries with emoji flags (🔴 DEEP_TAILOR, 🟡 AUTO_GENERATED, ⚪ NO DOCS)
- Fit and gap descriptions
- Optional fuzzy warning blocks

### 5.4 `ApplicationRecord` — Application Tracking

```javascript
{
  id:                    string,   // Generated: {dateStr}-{company}-{title}
  company:               string,
  title:                 string,
  url:                   string,
  linkedInJobId:         string | null,
  score:                 number,
  actionFlag:            string,
  resumeQuality:         number | null,
  coverLetterQuality:    number | null,
  qualityNote:           string | null,
  pillarsSelected:       string[],
  coverLetterParas:      number | null,
  outputPath:            string,
  dateGenerated:         string,   // "YYYY-MM-DD"
  dateApplied:           null,     // Filled by apply.js
  applicationMethod:     null,     // Filled by apply.js
  status:                "generated" | "applied" | "interviewing" | "rejected" | "offer" | "withdrawn",
  notes:                 ""
}
```

**Source:** [`src/models/applicationRecord.js`](src/models/applicationRecord.js:25) — `createApplicationRecord(scoredJob, outputPath, dateStr)`

---

## 6. Pipeline Orchestration

### 6.1 Phase Overview

```
┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
│ HARVEST   │    │ SCORE    │    │ GENERATE  │    │ TRACK    │    │ CLEANUP  │
│           │    │          │    │           │    │          │    │          │
│ Bookmark- │───►│ score.js │───►│generate.js│───►│ apply.js │───►│cleanup.js│
│ let /     │    │          │    │           │    │ (T17)    │    │          │
│ Manual AI │    │ DeepSeek │    │ DeepSeek  │    │ Status   │    │ Archive  │
│ Ingestion │    │ Scoring  │    │ Resume +  │    │ Updates  │    │ Job Files│
│           │    │ + Rank   │    │ Cover Let │    │          │    │          │
└──────────┘    └──────────┘    └──────────┘    └──────────┘    └──────────┘
```

### 6.2 Harvest Phase

**Methods:**
1. **Browser bookmarklet** (`server/bookmarklet.js`) — Run on a LinkedIn job page; extracts DOM data, POSTs to `/harvest`
2. **Manual AI Ingestion** (`POST /harvest-raw`) — Dashboard form; uses DeepSeek to parse pasted content into structured JobFile format
3. **Direct file creation** — Manually place `.md` files in `jobs/` directory

The server maintains an **in-memory URL cache** to prevent duplicate harvests (returns `409 Conflict` for duplicates).

### 6.3 Score Phase (`score.js`)

```
1. dotenv.config()                          ← must be first line
2. parseArgs({ --date })                    ← util.parseArgs, not minimist/yargs
3. Validate configs exist                   ← scoring_prompt.md, adam_buteux_career.md
4. Read job files from jobs/ dir            ← fileStore.readJobFiles()
5. Parse each job file                      ← parseJobFile() — skip on JobParseError
6. Deduplicate                              ← deduplicateJobs()
7. Broadcast scoring_started                ← SSE event
8. FOR each unique job (sequential):        ← NO Promise.all
   a. Build scoring prompt                  ← buildScoringPrompt()
   b. callDeepSeek()                        ← DeepSeek API
   c. Parse response                        ← parseScoreResponse()
   d. Create ScoredJob                      ← createScoredJob()
   e. Broadcast job_scored                  ← SSE with rank: null
   f. Log progress with ETA
9. Rank jobs                                ← rankJobs()
10. Compute stats (mean, min, max, dist)    ← distribution: { '1-3','4-5','6','7-8','9-10' }
11. Format stack rank                       ← formatStackRank()
12. Write stack rank file                   ← fileStore.writeStackRank()
13. Broadcast scoring_complete              ← SSE
```

### 6.4 Generate Phase (`generate.js`)

```
1. dotenv.config()                          ← must be first line
2. parseArgs({ --date })
3. Validate 5 configs exist                 ← all system prompt configs + career
4. Read stack rank                          ← fileStore.readStackRank()
5. Parse stack rank (DEEP_TAILOR + AUTO_GENERATED only)
6. Read applications.json ONCE              ← before loop
7. Read job files ONCE into Map             ← before loop (keyed by filename)
8. FOR each qualifying job (sequential):    ← NO Promise.all
   a. Lookup source in jobFileMap
   b. Parse job file                        ← parseJobFile()
   c. Extract fit/gap from stack rank MD
   d. Check output dir exists (skip if yes) ← idempotency
   e. Build resume prompt → callDeepSeek
   f. Build cover letter prompt → callDeepSeek
   g. Build quality prompt → callDeepSeek
   h. Write resume + cover letter files
   i. Create ApplicationRecord
   j. Write submission record
   k. Broadcast doc_generated               ← SSE with sourceFilename
   l. Log progress with ETA
9. Write applications.json ONCE             ← after loop
10. Broadcast generation_complete
```

### 6.5 Cleanup Phase (`cleanup.js`)

1. Read job files — if empty, exit(0) — nothing to archive
2. `formatDateString(new Date())` for archive subdirectory
3. Move all job files to `jobs/archive/YYYY-MM-DD/`
4. Log count of archived files

### 6.6 Apply Phase (`apply.js`) — Planned T17

Will read `applications.json`, present UI for status updates, and write back.

---

## 7. Server Architecture

### 7.1 Factory Pattern

```javascript
function createApp(jobsDir) {
  const app = express();
  // ... middleware, routes, state ...
  return app;
}

// Only starts listening when executed directly:
if (require.main === module) {
  const app = createApp(process.cwd());
  const port = process.env.PIPELINE_PORT || '3000';
  app.listen(port, () => logger.info('server', `Dashboard on http://localhost:${port}/dashboard`));
}
```

**Why:** This pattern enables integration tests to create an app instance pointing at a temporary directory without starting a server. Tests call `createApp(tmpDir).listen(0)` and use the random port.

### 7.2 In-Memory State

```javascript
const state = {
  date: null,
  phase: 'idle',
  harvested: [],       // recent harvest entries
  scored: [],          // scored job entries (for dashboard table)
  generated: [],       // generated doc entries
  stats: null,         // { scored, scoreMean, scoreMin, scoreMax, distribution }
  appHistory: []       // last 10 application records
};
```

State is rebuilt on startup:
- URL cache populated by reading existing job files
- Application history from `applications.json` (last 10 entries)

### 7.3 Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/harvest` | Receive job from bookmarklet, write file, update state |
| `POST` | `/harvest-raw` | AI-powered ingestion via DeepSeek |
| `GET` | `/health` | Health check |
| `GET` | `/dashboard` | Serves `dashboard.html` |
| `GET` | `/events` | SSE endpoint — clients connect here |
| `POST` | `/event` | Internal endpoint for pipeline SSE broadcasts |
| `GET` | `/state` | Returns full current state as JSON |

### 7.4 SSE Client Management

- Clients connect to `GET /events` and receive an immediate state snapshot
- Subsequent events are pushed as they arrive from the pipeline
- Client cleanup: on `close` event, the client is removed from the clients array
- `broadcast(payload)` iterates clients in reverse, removes dead connections

### 7.5 URL Cache

- An in-memory `Set` of URLs
- Populated on startup by reading all existing job files and extracting URLs
- Checked on `/harvest` — returns `409 Conflict` if URL already exists
- Prevents duplicate harvests across server restarts

---

## 8. SSE Event System

### 8.1 Event Types

| Event | Triggered by | Key fields |
|-------|-------------|------------|
| `job_harvested` | Server (harvest endpoint) | `company, title, filename, url` |
| `scoring_started` | `score.js` | `total, date` |
| `job_scored` | `score.js` (per job) | `rank, score, company, title, actionFlag, fitSignal, gap, sourceFilename, salary, location, url, linkedInJobId` |
| `scoring_complete` | `score.js` | `scored, scoreMean, scoreMin, scoreMax, distribution` |
| `generation_started` | `generate.js` | `total` |
| `doc_generated` | `generate.js` (per job) | `company, title, sourceFilename, resumeQuality, coverLetterQuality, qualityNote, pillarsSelected, coverLetterParas` |
| `generation_complete` | `generate.js` | `generated` |

### 8.2 Event Flow

```
Pipeline (score.js/generate.js)          Server                   Dashboard
        │                                   │                        │
        │─── broadcastEvent(type, data) ───►│                        │
        │                                   │─── SSE push ─────────►│
        │                                   │                        │
        │                                   │◄── EventSource ───────│
```

The pipeline never talks to the dashboard directly. It POSTs to the server's `/event` endpoint, which then relays to all connected SSE clients.

### 8.3 State Mutations on `/event`

| Event type | State mutation |
|------------|---------------|
| `scoring_started` | Sets `state.date`, `state.phase = 'scoring'`, clears `scored`/`generated`, resets `stats` |
| `job_scored` | Pushes to `state.scored` |
| `scoring_complete` | Sets `state.stats`, `state.phase = 'scoring_complete'` |
| `generation_started` | Sets `state.phase = 'generation'`, clears `generated` |
| `doc_generated` | Pushes to `state.generated` |
| `generation_complete` | Sets `state.phase = 'generation_complete'` |

### 8.4 `sourceFilename` Constraint

The dashboard matches quality scores to stack rank rows by `sourceFilename` — not by company+title strings. This means:

- `job_scored` events must include `sourceFilename` (the job's filename)
- `doc_generated` events must include `sourceFilename` (matching the job's filename)
- The stack rank table in the dashboard uses `sourceFilename` as the key for updating quality columns (R★, CL★)

---

## 9. Deduplication Algorithm

**Source:** [`src/lib/deduplicator.js`](src/lib/deduplicator.js:22)

### Pass 1 — URL Exact Match

1. Group jobs by URL (string equality)
2. Within each group, keep the one with the newest `harvested` date
3. The removed jobs become `duplicates`

### Pass 2 — Fuzzy Company+Title Match

1. On the remaining unique jobs, group by lowercase company + lowercased words of title (split by non-alphanumeric)
2. Groups with >1 member are flagged as fuzzy matches
3. Fuzzy matches are **not removed** — only warnings are emitted
4. The final output retains all Pass-1 unique jobs

### Return value

```javascript
{
  unique:       [...],  // deduplicated jobs
  duplicates:   [...],  // jobs removed by Pass 1
  fuzzyWarnings: [...]  // { company, title, matches: [...] }
}
```

The function does **not mutate** the input array.

---

## 10. Ranking Algorithm

**Source:** [`src/lib/ranker.js`](src/lib/ranker.js:20)

### Dense Ranking

Jobs are sorted descending by `score`. Tied scores receive the same rank. Ranks are dense (no gaps):

```
Score:  [9, 9, 8, 7, 7, 7, 5]
Rank:   [1, 1, 2, 3, 3, 3, 4]
```

### Action Flag Logic

| Condition | Action Flag |
|-----------|-------------|
| Rank 1-4 | `DEEP_TAILOR` |
| Rank 5+ AND score >= 6 | `AUTO_GENERATED` |
| Rank 5+ AND score < 6 | `NO_DOCS` |
| Total jobs <= 4 | All `DEEP_TAILOR` |

**Straddle rule:** If a score tie occurs at the rank 4/5 boundary, all tied jobs get `DEEP_TAILOR`. For example, if rank 4 has score 7 and rank 5 also has score 7 (tied), both get `DEEP_TAILOR` and the next distinct score gets rank 5 with appropriate flag.

---

## 11. Prompt Assembly

### 11.1 Pattern

All prompt builders follow the same pattern:

1. Validate inputs (throw descriptive errors for missing fields)
2. Read system prompt from config file (the system prompt text)
3. Assemble user prompt with labeled sections (e.g. `## CANDIDATE PROFILE`, `## JOB DESCRIPTION`)
4. Return `[systemPromptString, userPromptString]`

### 11.2 Config File Roles

| Config file | Used by | Content |
|-------------|---------|---------|
| `scoring_prompt.md` | `buildScoringPrompt()` | Instructions for scoring a job against the candidate |
| `resume_prompt.md` | `buildResumePrompt()` | Instructions for tailoring a resume |
| `cover_letter_prompt.md` | `buildCoverLetterPrompt()` | Instructions for writing a cover letter |
| `quality_prompt.md` | `buildQualityPrompt()` | Instructions for quality assessment |
| `adam_buteux_career.md` | All | Candidate career profile (experience, education, certifications) |
| `adam_buteux_pillar_library.md` | `buildResumePrompt()` | Writing style pillars |

### 11.3 DeepSeek Response Formats

**Score response** (parsed by `parseScoreResponse`):
```json
{
  "score": 8,
  "fitSignal": "STRONG_FIT",
  "gap": "Limited experience with healthcare regulations"
}
```

**Quality response** (parsed inline in `generate.js`):
```json
{
  "resumeQuality": 8,
  "coverLetterQuality": 7,
  "qualityNote": "Resume is strong but could highlight privacy certifications more prominently",
  "pillarsSelected": ["Strategic Vision", "Subject Matter Expertise"],
  "coverLetterParas": 3
}
```

**Resume and cover letter responses** are plain text (raw markdown).

---

## 12. Testing Strategy

### 12.1 Test Layers

| Layer | Tool | What it tests | Location |
|-------|------|---------------|----------|
| **Unit** | Jest (no msw) | Pure functions in `src/models/` and `src/lib/` — no I/O, no HTTP | `tests/unit/` |
| **Integration** | Jest + msw | Adapters (`fileStore.js`, `deepseek.js`) with real I/O or mocked HTTP | `tests/integration/` |
| **End-to-End** | Jest + msw + child process | Full orchestrators spawned as child processes with env injection | `tests/e2e/` |

### 12.2 Key Testing Rules

- **`msw` not `nock`** — `nock` does not intercept Node.js native `fetch`
- **`fs.mkdtemp` not `tmp`** — `tmp` has cleanup failures on Windows
- **No `supertest`** — Use `createApp(jobsDir).listen(0)` + native `fetch`
- **No `axios`** — Native `fetch` only

### 12.3 msw Setup Pattern

```javascript
// tests/helpers/msw-setup.js
const { http, HttpResponse } = require('msw');
const { setupServer } = require('msw/node');

const server = setupServer(
  http.post('https://api.deepseek.com/v1/chat/completions', () => {
    return HttpResponse.json({
      choices: [{ message: { content: '{"score":8,"fitSignal":"STRONG_FIT","gap":"..."}' } }]
    });
  })
);

beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
```

### 12.4 Child Process Env Injection (E2E)

```javascript
execSync('node score.js --date 2026-05-30', {
  env: {
    ...process.env,
    DEEPSEEK_API_KEY: 'test-key',
    PIPELINE_PORT: '3001',
    PIPELINE_BASE_DIR: tmpDir,       // for E2E test override
    NODE_OPTIONS: '--require ./tests/helpers/msw-setup.js'
  }
});
```

### 12.5 Coverage Thresholds

Per-file thresholds in `jest.config.js`:

| File | Branches | Functions | Lines | Statements |
|------|----------|-----------|-------|------------|
| `src/models/job.js` | 90 | 90 | 90 | 90 |
| `src/models/scoredJob.js` | 90 | 90 | 90 | 90 |
| `src/models/stackRank.js` | 90 | 90 | 90 | 90 |
| `src/models/applicationRecord.js` | 90 | 90 | 90 | 90 |
| `src/lib/fileStore.js` | 85 | 85 | 85 | 85 |
| `src/lib/ranker.js` | 95 | 90 | 95 | 95 |
| `src/lib/promptBuilder.js` | 90 | 90 | 90 | 90 |
| `src/lib/deepseek.js` | 85 | 85 | 85 | 85 |

Global 80% threshold is added only at Phase 5.

### 12.6 Fixtures — Never Modified

Test fixtures in `tests/fixtures/` are the contract. If a model's output does not match a fixture, fix the model — never modify the fixture.

---

## 13. Coding Conventions & Constraints

### 13.1 Module System

- **CommonJS** throughout — `require()` / `module.exports`
- No ESM (`import`/`export`)
- Node.js v24.11.1

### 13.2 Package Dependencies

**Runtime (production):**
- `express` ^4.18.0
- `dotenv` ^16.0.0

**Dev only:**
- `jest`
- `eslint` + `@eslint/js`
- `msw`
- `jsdom` (for bookmarklet testing)
- `terser` (for bookmarklet minification)

**Forbidden:** `axios`, `nock`, `supertest`, `tmp`, `tmp-promise`, `minimist`, `yargs`

### 13.3 Mandatory Rules (Non-Negotiable)

1. **`require('dotenv').config()`** is the literal first line of every CLI script and `server/server.js`
2. **No bare `console` calls** — use `src/lib/logger.js` only
3. **`fs.promises` only in `fileStore.js`** — no sync file operations anywhere else
4. **No `Promise.all` on DeepSeek calls** — all API calls awaited individually in a `for` loop (rate limits)
5. **`util.parseArgs` for all CLI flags** — no `minimist`, `yargs`, or manual `process.argv` slicing
6. **Date strings for file paths** — never `toISOString()`. Always `formatDateString(new Date())`. The raw `--date` string is used as-is.
7. **`PIPELINE_PORT` env var controls server port** — default `'3000'`
8. **`eventBroadcaster` must never throw** — entire body wrapped in `try/catch`
9. **`config/` files are never created or modified** — agent checks existence, throws `ConfigMissingError` if absent
10. **`server.js` exports `createApp(jobsDir)` factory** — only starts server when `require.main === module`
11. **`applications.json` read once before the generate loop, written once after**
12. **Job files read once before the generate loop into a Map**

### 13.4 Error Handling Patterns

```javascript
// Custom errors (src/lib/errors.js)
throw new JobParseError('Missing required field: title', filename);
throw new DeepSeekResponseError('DeepSeek API returned 429', 429);
throw new ConfigMissingError('scoring_prompt.md');

// Config validation in orchestrators
function validateConfigs(configDir, filenames) {
  for (const f of filenames) {
    readConfig(configDir, f); // throws ConfigMissingError if missing
  }
}
```

### 13.5 Pipeline ID Patterns

Application record IDs are generated as:
```javascript
// generateRecordId(dateStr, company, title)
// Uses sanitizeForFilename on the company-title part
// Result: "2026-05-30-acme-corp-senior-privacy-manager"
```

---

## 14. Dependency Graph

```
                    ┌───────────────┐
                    │  package.json │
                    └───────┬───────┘
                            │
          ┌─────────────────┼──────────────────┐
          │                 │                   │
    ┌─────▼─────┐    ┌─────▼─────┐     ┌───────▼───────┐
    │  score.js  │    │generate.js│     │  cleanup.js   │
    └─────┬─────┘    └─────┬─────┘     └───────┬───────┘
          │                 │                   │
    ┌─────▼─────────┐ ┌────▼──────────┐  ┌─────▼────────┐
    │    src/lib/    │ │    src/lib/   │  │   src/lib/   │
    │  deepseek.js   │ │  deepseek.js  │  │  fileStore.js│
    │ eventBroadcast │ │ eventBroadcast│  └──────────────┘
    │  fileStore.js  │ │  fileStore.js │
    │   logger.js    │ │   logger.js   │
    └─────┬─────────┘ └────┬──────────┘
          │                 │
    ┌─────▼─────────────────▼──────────┐
    │         src/models/               │
    │   job.js   scoredJob.js          │
    │ stackRank.js applicationRecord.js│
    └──────────────────────────────────┘
          │                 │
    ┌─────▼─────────────────▼──────────┐
    │         src/lib/                  │
    │  promptBuilder.js  ranker.js     │
    │  deduplicator.js  dateUtils.js   │
    │  errors.js                       │
    └──────────────────────────────────┘
          │                 │
    ┌─────▼─────────────────▼──────────┐
    │         server/server.js          │
    │  (createApp factory + dashboard)  │
    └──────────────────────────────────┘
```

### Module dependency rules

- `src/models/*.js` depend on **nothing** except `src/lib/errors.js`
- `src/lib/*.js` depend on models and `src/lib/errors.js` but NOT on each other (except errors)
- Orchestrators depend on `src/lib/*.js` and `src/models/*.js`
- `server/server.js` depends on `src/lib/logger.js` and `src/lib/fileStore.js`

---

## Appendix: Quick Reference

### Key file locations

| What | Path |
|------|------|
| Agent rules | [`AGENTS.md`](AGENTS.md) |
| Full spec | [`job-pipeline-spec-v5.md`](job-pipeline-spec-v5.md) |
| Task definitions | [`job-pipeline-tasks-v5.md`](job-pipeline-tasks-v5.md) |
| Production runbook | [`docs/RUNBOOK.md`](docs/RUNBOOK.md) |
| This document | [`docs/architecture.md`](docs/architecture.md) |
| Current session state | [`SESSIONSTATE.md`](SESSIONSTATE.md) |

### Useful grep commands

```bash
# Check for console.log violations
grep -r "console\." src/ score.js generate.js cleanup.js apply.js server/server.js

# Check for Promise.all on DeepSeek
grep -n "Promise.all" score.js generate.js

# Check for sync file operations
grep -rn "readFileSync\|writeFileSync" src/

# Check for forbidden packages in imports
grep -rn "require.*\(axios\|nock\|supertest\|tmp\|minimist\|yargs\)" src/ score.js generate.js cleanup.js apply.js server/
```

### Quick test commands

```bash
npm run lint       # ESLint — must exit 0 before marking tasks complete
npm test           # All tests — must exit 0, all prior tests green
npm run test:unit  # Unit tests only
npm run test:int   # Integration tests only
npm run test:e2e   # End-to-end tests only
```
