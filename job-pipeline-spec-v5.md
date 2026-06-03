# Job Pipeline — Application Specification

**Version:** 5.0
**Date:** 2026-05-30
**Changes from v4.0:** formatDateString utility added to dateUtils.js; applications.json manual creation removed from setup (fileStore handles missing file); PowerShell echo encoding bug fixed; eventBroadcaster port configurable via PIPELINE_PORT env var; doc_generated event includes sourceFilename for reliable dashboard row matching; generate.js reads applications.json once before loop, writes once after; apply.js processUpdate() pure function pattern added for testability; T05 formatStackRank signature extended to accept fuzzyWarnings parameter; T06 dependency on T05b added.

---

## 1. Overview

A local Node.js pipeline that harvests job descriptions from LinkedIn, scores them against Adam's career profile using the DeepSeek API, stack ranks them daily, auto-generates lightly tailored resumes and cover letters for jobs scoring 6 or above, and serves a real-time dashboard showing pipeline progress and application history.

The pipeline has five phases:

1. **Harvest** — bookmarklet → local server → `jobs/` directory
2. **Score** — `score.js` → DeepSeek (sequential) → `stack_rank_YYYY-MM-DD.md`
3. **Generate** — `generate.js` → resume + cover letter + quality rating → `resumes/YYYY-MM-DD/`
4. **Track** — `apply.js` → update `applications.json`
5. **Cleanup** — `cleanup.js` → archive `jobs/`

The dashboard at `http://localhost:3000/dashboard` updates in real time as scoring and generation run.

---

## 2. Environment

| Property | Value |
|---|---|
| OS | Windows |
| Shell | PowerShell |
| Node.js | v24.11.1 (already installed) |
| Project root | `C:\Users\adam\OneDrive\Documents\projects\job-pipeline\` |
| API | DeepSeek (`deepseek-chat` model) |

> **OneDrive Warning:** Exclude `jobs/`, `resumes/`, and `archive/` from OneDrive sync before first use. Right-click each folder → OneDrive → "Don't sync this folder." Or move the project to `C:\projects\job-pipeline\` outside OneDrive entirely.

---

## 3. Directory Structure

```
job-pipeline/
├── config/
│   ├── adam_buteux_career.md
│   ├── pillar_library.md
│   ├── resume_format_spec.md        # Reference only — not used at runtime
│   ├── scoring_prompt.md
│   ├── resume_prompt.md
│   ├── cover_letter_prompt.md
│   └── quality_prompt.md
├── src/
│   ├── models/
│   │   ├── job.js                   # JobFile type, parser, sanitizeForFilename
│   │   ├── scoredJob.js             # ScoredJob type, DeepSeek response parser
│   │   ├── stackRank.js             # StackRank formatter and parser
│   │   └── applicationRecord.js    # ApplicationRecord type and helpers
│   └── lib/
│       ├── errors.js                # All custom error classes
│       ├── logger.js                # Centralized logger
│       ├── dateUtils.js             # formatDateString and date helpers
│       ├── eventBroadcaster.js      # Fire-and-forget POST to /event
│       ├── fileStore.js             # All filesystem I/O (fs.promises only)
│       ├── deepseek.js              # DeepSeek API adapter
│       ├── deduplicator.js          # URL dedup + fuzzy company+title warning
│       ├── ranker.js                # Stack ranking logic (pure)
│       └── promptBuilder.js        # Prompt assembly (pure)
├── server/
│   ├── server.js                    # Express server + SSE + dashboard
│   ├── dashboard.html               # Real-time dashboard UI
│   └── bookmarklet.js               # Bookmarklet source (human-readable)
├── scripts/
│   └── minify-bookmarklet.js
├── tests/
│   ├── fixtures/
│   ├── helpers/
│   │   └── msw-setup.js
│   ├── unit/
│   ├── integration/
│   └── e2e/
├── jobs/
├── archive/
│   └── YYYY-MM-DD/
├── resumes/
│   └── YYYY-MM-DD/
│       ├── stack_rank_YYYY-MM-DD.md
│       └── Company - Job Title/
│           ├── resume.md
│           ├── cover_letter.md
│           └── submission_record.md
├── applications.json                # Auto-created by generate.js on first run
├── score.js
├── generate.js
├── cleanup.js
├── apply.js
├── package.json
├── .env
└── .env.example
```

---

## 4. Setup Instructions

### 4.1 Create project directory

```powershell
cd "C:\Users\adam\OneDrive\Documents\projects"
mkdir job-pipeline
cd job-pipeline
```

After creation: right-click `jobs`, `resumes`, `archive` → OneDrive → "Don't sync this folder."

### 4.2 Initialize Node project

```powershell
npm init -y
npm install express dotenv
npm install --save-dev jest eslint @eslint/js msw jsdom terser
```

**Explicitly excluded:** `axios`, `nock`, `supertest`, `tmp`, `tmp-promise`, `minimist`, `yargs`. Any charting library (CSS-only in dashboard). Any readline wrapper (`readline` is Node built-in).

### 4.3 Create `.env`

```
DEEPSEEK_API_KEY=your_api_key_here
PIPELINE_PORT=3000
```

`PIPELINE_PORT` defaults to 3000 if not set. Used by server.js and eventBroadcaster.js.

### 4.4 Create subdirectories

```powershell
mkdir config, src, "src/models", "src/lib", server, scripts, tests, "tests/fixtures", "tests/helpers", "tests/unit", "tests/integration", "tests/e2e", jobs, archive, resumes
```

> **Note:** Do not manually create `applications.json`. `fileStore.readApplications` returns `[]` when the file does not exist, and `generate.js` creates it on first run.

### 4.5 Copy config files into `config/`

From your Claude project: `adam_buteux_career.md`, `pillar_library.md`, `resume_format_spec.md`

Create from Section 12 templates: `scoring_prompt.md`, `resume_prompt.md`, `cover_letter_prompt.md`, `quality_prompt.md`

### 4.6 Install bookmarklet

1. `node server/server.js`
2. `npm run build:bookmarklet`
3. Copy `server/bookmarklet.min.js` contents into a browser bookmark URL field, name "Harvest Job"

### 4.7 Verify

Open `http://localhost:3000/dashboard`. Click `Harvest Job` on a LinkedIn job page. Dashboard should update in real time.

---

## 5. Critical Requirements (All Scripts)

These apply to every CLI script (`score.js`, `generate.js`, `cleanup.js`, `apply.js`) and `server.js`:

**dotenv:** `require('dotenv').config()` must be the first line.

**Argument parsing:** Use `util.parseArgs` (Node v18+ built-in). Use the raw `values.date` string directly for file path construction — never `new Date(values.date)` as this shifts the date in negative-offset timezones.

**Logging:** Use `src/lib/logger.js` only — no bare `console.log`, `console.error`, or `console.warn`.

**Config validation:** Validate all required config files exist before making any API calls. Exit(1) and list all missing files.

**CommonJS:** This project uses `require`/`module.exports` throughout. If Jest reports ESM errors with msw, add `"type": "commonjs"` to `package.json`.

**NODE_OPTIONS injection for tests (Windows PowerShell):** Pass via `env` in `execSync` — do not set globally:
```javascript
execSync('node score.js', {
  env: { ...process.env,
    NODE_OPTIONS: '--require ./tests/helpers/msw-setup.js',
    DEEPSEEK_API_KEY: 'test-key',
    PIPELINE_PORT: '3001'   // use different port in tests
  }
});
```

---

## 6. Shared Utilities (`src/lib/dateUtils.js`)

```javascript
// Format a Date object as "YYYY-MM-DD" in local time.
// Use for all file path construction — never use Date.toISOString() which gives UTC.
formatDateString(date: Date): string   // e.g. "2026-05-30"

// Format a Date as "YYYY-MM-DD HH:MM" in local time.
formatDateTimeString(date: Date): string   // e.g. "2026-05-30 14:32"
```

**Every script and module that needs a date string for a file path calls `formatDateString`.** This is the single source of truth for date formatting. The raw `values.date` string passed via `--date` flag is used as-is (it is already `"YYYY-MM-DD"` format from the user) — it does not need to pass through `formatDateString`.

---

## 7. Server (`server/server.js`)

### 7.1 Endpoints

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/harvest` | Receive job from bookmarklet, write file, broadcast event |
| `GET` | `/health` | Returns `{ status: "ok" }` |
| `GET` | `/dashboard` | Serves `server/dashboard.html` |
| `GET` | `/events` | SSE stream — browser connects here |
| `POST` | `/event` | Internal — score.js and generate.js push events here |
| `GET` | `/state` | Returns current in-memory state as JSON |

### 7.2 Port configuration

Port read from `process.env.PIPELINE_PORT` with default of `3000`. Used in `eventBroadcaster.js` identically — both read the same env var. This ensures tests can run on a different port without hardcode conflicts.

### 7.3 SSE architecture

The server maintains an in-memory `state` object and a `clients` array of active SSE response objects.

```javascript
// State shape — initialised on startup, rebuilt from applications.json
const state = {
  date: null,           // "YYYY-MM-DD" string or null
  phase: 'idle',        // 'idle' | 'harvesting' | 'scoring' | 'generating'
  harvested: [],        // { company, title, filename, url }[]
  scored: [],           // { rank, score, company, title, actionFlag, fitSignal, gap,
                        //   sourceFilename, salary, location, url, linkedInJobId }[]
  generated: [],        // { company, title, sourceFilename, resumeQuality,
                        //   coverLetterQuality, qualityNote, pillarsSelected,
                        //   coverLetterParas }[]
  stats: {
    total: 0,
    scoreMean: null,
    scoreMin: null,
    scoreMax: null,
    distribution: { '1-3': 0, '4-5': 0, '6-7': 0, '8-10': 0 }
  },
  applicationHistory: []  // last 10 entries from applications.json
};
```

**On `GET /events`:**
- Set headers: `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`
- Write current state immediately: `res.write('data: ' + JSON.stringify({ type: 'state', data: state }) + '\n\n')`
- Push `res` to `clients` array
- On `req.on('close')`: remove `res` from `clients` array

**On `POST /event`:**
- Parse body, update `state` per event type (see Section 7.4)
- Broadcast to all clients: `clients.forEach(c => c.write('data: ' + JSON.stringify(event) + '\n\n'))`
- Return `200 OK`

**On `GET /state`:** Return `JSON.stringify(state)`

### 7.4 State update logic per event type

| Event type | State mutation |
|---|---|
| `scoring_started` | `state.phase = 'scoring'`, `state.date = data.date`, `state.stats.total = data.total` |
| `job_scored` | `state.scored.push(data)`, recalculate `state.stats` from all scored entries |
| `job_skipped` | No state change — event broadcast only |
| `scoring_complete` | `state.phase = 'idle'`, `state.stats = data` (authoritative final stats) |
| `generation_started` | `state.phase = 'generating'` |
| `doc_generated` | `state.generated.push(data)` |
| `doc_skipped` | No state change — event broadcast only |
| `generation_complete` | `state.phase = 'idle'` |
| `job_harvested` | `state.harvested.push(data)` |

### 7.5 Event shapes

All events: `{ type: string, data: object, timestamp: string }`

```javascript
// server.js emits:
{ type: 'job_harvested', data: { company, title, filename, url } }

// score.js emits:
{ type: 'scoring_started',  data: { total: number, date: string } }
{ type: 'job_scored',       data: { rank, score, company, title, actionFlag,
                                    fitSignal, gap, sourceFilename, salary,
                                    location, url, linkedInJobId } }
{ type: 'job_skipped',      data: { filename, reason } }
{ type: 'scoring_complete', data: { scored: number, scoreMean: number,
                                    scoreMin: number, scoreMax: number,
                                    distribution: object } }

// generate.js emits:
{ type: 'generation_started', data: { total: number } }
{ type: 'doc_generated',      data: { company, title, sourceFilename,
                                      resumeQuality, coverLetterQuality,
                                      qualityNote, pillarsSelected,
                                      coverLetterParas } }
{ type: 'doc_skipped',        data: { company, title, reason } }
{ type: 'generation_complete',data: { generated: number } }
```

**Note:** `doc_generated` includes `sourceFilename` — the dashboard uses this as the stable key to match quality scores back to the correct stack rank row (company+title strings alone are not reliable enough for matching).

### 7.6 In-memory URL cache for `/harvest`

On startup: read all `.md` files in `jobs/`, parse URLs into a `Set<string>`. Check Set on each `POST /harvest`. Add to Set on successful write. O(1) per request regardless of jobs directory size.

### 7.7 `createApp(jobsDir)` factory

`server.js` exports `createApp(jobsDir)` for integration testing. When run directly, calls `createApp(defaultJobsDir).listen(port)`.

### 7.8 Response shapes for `/harvest`

```json
{ "success": true,  "filename": "2026-05-30-Google-Senior-Privacy-Manager.md" }
{ "success": false, "reason": "duplicate",      "existingFile": "..." }
{ "success": false, "reason": "missing_fields", "missing": ["title", "url"] }
{ "success": false, "reason": "write_error",    "message": "..." }
```

CORS: `Access-Control-Allow-Origin: *` on all responses.

---

## 8. Job File Format

```markdown
# [Job Title]

## Metadata
- **Company:** [Company Name]
- **Location:** [Location or "Not specified"]
- **Employment Type:** [Full-time / Contract / Part-time / Not specified]
- **Salary:** [Salary range or "Not specified"]
- **URL:** [LinkedIn URL — query params stripped]
- **LinkedIn Job ID:** [numeric ID or "Not available"]
- **Harvested:** [YYYY-MM-DD HH:MM]

## Job Description

[Full job description text]
```

`sanitizeForFilename()` rules:
- Spaces → hyphens
- Remove: `& ( ) / , ' " @ # $ % ^ * ! ? < > | \ : ;`
- Collapse consecutive hyphens to one
- Trim leading/trailing hyphens
- Truncate combined company+title to 60 chars
- Collision: append `-2`, `-3`

---

## 9. Scoring Script (`score.js`)

```powershell
node score.js
node score.js --date=2026-05-29
```

Flow:
1. `require('dotenv').config()` — first line
2. Parse `--date` via `util.parseArgs`; use raw string for paths
3. Validate config files: `scoring_prompt.md`, `adam_buteux_career.md` — exit(1) if missing
4. Read job files — exit(0) with message if empty
5. Parse each file — skip + log on `JobParseError`
6. Deduplicate → `{ unique, duplicates, fuzzyWarnings }` — log each skip and fuzzy warning
7. Broadcast `scoring_started` event
8. **SEQUENTIAL loop — no `Promise.all`:**
   - Build scoring prompt → callDeepSeek (max_tokens: 300, timeout: 30s) → parseScoreResponse → createScoredJob
   - On error: log, broadcast `job_skipped`, continue
   - Broadcast `job_scored` after each success
   - Log: `[score] 3/12: Company — Title (est. 27s remaining)`
9. `rankJobs`
10. Compute stats: mean, min, max, distribution
11. `formatStackRank(rankedJobs, date, fuzzyWarnings)` — pass fuzzyWarnings explicitly
12. Write stack rank file
13. Broadcast `scoring_complete` with stats
14. Log done

**Stack rank header format:**
```markdown
# Stack Rank — 2026-05-30
*Generated: 2026-05-30 14:32 | Jobs scored: 12 | Documents to generate: 7*
*Score stats: mean 6.8 | range 4–9 | distribution: 1-3: 0 | 4-5: 2 | 6-7: 7 | 8-10: 3*

⚠️ **Possible duplicate:** "Meridian Health Systems — Senior Privacy Manager" appears at 2 different URLs. Verify before generating.
```

> **Known limitation:** No resume on interrupted runs.

---

## 10. Generation Script (`generate.js`)

```powershell
node generate.js
node generate.js --date=2026-05-29
```

Flow:
1. `require('dotenv').config()` — first line
2. Parse `--date` via `util.parseArgs`
3. Validate config: `resume_prompt.md`, `cover_letter_prompt.md`, `adam_buteux_career.md`, `pillar_library.md`, `quality_prompt.md` — exit(1) if any missing
4. Read stack rank — exit(1) with date hint if not found
5. Parse qualifying jobs (🔴 and 🟡) from stack rank
6. **Read `applications.json` once before loop** via `fileStore.readApplications`
7. Broadcast `generation_started`
8. **SEQUENTIAL loop:**
   - Read `jobs/[sourceFilename]` — skip + log if not found
   - Skip if output dir exists (idempotent)
   - DeepSeek call 1: resume (max_tokens: 2000, timeout: 60s)
   - DeepSeek call 2: cover letter (max_tokens: 800, timeout: 60s)
   - DeepSeek call 3: quality rating (max_tokens: 200, timeout: 30s) — on error: null quality fields, log, continue
   - Write `resume.md`, `cover_letter.md`, `submission_record.md`
   - Append new `ApplicationRecord` to in-memory array
   - Broadcast `doc_generated` event (includes `sourceFilename`)
   - Log: `[generate] 2/7: Company — Title (est. 45s remaining)`
9. **Write `applications.json` once after loop** via `fileStore.writeApplications`
10. Broadcast `generation_complete`
11. Log done

**Why read/write applications.json outside the loop:** Avoids N sequential file reads/writes for N jobs and eliminates any risk of corruption from overlapping writes.

### Quality rating response

```json
{
  "resume_quality": 7,
  "cover_letter_quality": 6,
  "pillars_selected": ["Program Leadership", "Risk Governance"],
  "cover_letter_paras": 2,
  "quality_note": "Strong pillar selection. Cover letter P2 cut — no specific angle."
}
```

Packages where either quality score < 6: log ⚠️ warning.

### `submission_record.md` format

```markdown
# Submission Record — [Company] | [Job Title]

**Generated:** [YYYY-MM-DD HH:MM]
**Source JD:** archive/YYYY-MM-DD/[sourceFilename]
**LinkedIn Job ID:** [id or "Not available"]
**Score:** [N]/10 | [🔴/🟡] [flag label]
**Fit:** [fitSignal]
**Gap:** [gap]

## Pillars Selected
[Pillar 1] | [Pillar 2] | [Pillar 3]

## Cover Letter Structure
[N] paragraphs ([which paras included or omitted])

## Quality Assessment
**Resume:** [N]/10 | **Cover Letter:** [N]/10
**Note:** [qualityNote]

## Application Status
**Date applied:** —
**Method:** —
**Notes:** —
```

### `applications.json` entry

```json
{
  "id": "2026-05-30-Anthropic-AI-Policy-Governance-Lead",
  "company": "Anthropic",
  "title": "AI Policy & Governance Lead",
  "url": "https://linkedin.com/jobs/view/3987654321/",
  "linkedInJobId": "3987654321",
  "score": 8,
  "actionFlag": "DEEP_TAILOR",
  "resumeQuality": 7,
  "coverLetterQuality": 6,
  "qualityNote": "Strong pillar selection. CL P2 cut.",
  "pillarsSelected": ["Program Leadership", "Risk Governance"],
  "coverLetterParas": 2,
  "outputPath": "resumes/2026-05-30/Anthropic - AI Policy Governance Lead/",
  "dateGenerated": "2026-05-30",
  "dateApplied": null,
  "applicationMethod": null,
  "status": "generated",
  "notes": ""
}
```

**Statuses:** `generated` → `applied` → `interviewing` → `rejected` / `offer` / `withdrawn`

---

## 11. Application Status Tracking (`apply.js`)

```powershell
node apply.js
node apply.js --all
```

Interactive CLI using Node built-in `readline`. `apply.js` exports `processUpdate(records, updatePayload)` as a pure function for testing. The readline layer calls it.

```javascript
// Pure function — testable without readline
// records: ApplicationRecord[]
// updatePayload: { index: number, status: string, method?: string, notes?: string }
// Returns new records array with the specified record updated
processUpdate(records, updatePayload): ApplicationRecord[]
```

Flow:
1. `require('dotenv').config()`
2. Parse `--all` via `util.parseArgs`
3. Read `applications.json` — returns `[]` if not found
4. Filter: `--all` shows all, default shows only `status === 'generated'`
5. Display numbered list
6. Readline loop: prompt for number → validate → prompt for status → validate via `isValidStatus` → prompt for method if `applied` → prompt for notes → call `processUpdate` → write updated array
7. Exit on `q`

---

## 12. Dashboard (`server/dashboard.html`)

Single HTML file — inline CSS and JS, no external dependencies, no build step.

### Sections

**Header bar:** date, phase indicator, live counts (harvested / scored / generated)

**Score distribution panel:** CSS horizontal bar chart (no JS library). Five bands: 1-3, 4-5, 6, 7-8, 9-10. Updates per `job_scored` event. Shows mean and range after `scoring_complete`.

**Stack rank table:** Builds row by row on `job_scored` events. Columns: Rank | Score | Flag | Company | Title | Location | Salary | Fit | Gap | R★ | CL★ | Links. R★ and CL★ populate on `doc_generated` events — matched by `sourceFilename` (not company+title strings). Quality < 6 shown amber with ⚠️. Links: "JD" → `file://` source path, "Resume" / "CL" → output paths (shown only after generation).

**Application history panel:** Loaded from `GET /state` on page load. Counts by status. Last 10 entries.

**Activity log:** Scrolling fixed-height div. All SSE events appended with timestamp and colour coding. Auto-scrolls.

### Real-time connection

```javascript
const stateRes = await fetch('/state');
populateFromState(await stateRes.json());

const evtSource = new EventSource('/events');
evtSource.onmessage = e => handleEvent(JSON.parse(e.data));
evtSource.onerror  = () => showBanner('Connection lost — reload to reconnect.');
```

Graceful degradation: if server not reachable on load, show banner "Server not running — start with: node server/server.js"

### Design constraints

- Dark background (`#1a1a2e` or similar), light text
- Monospace font for activity log
- No external fonts, no CDN resources — fully self-contained
- Renders correctly in Chrome and Edge on Windows

---

## 13. Cleanup Script (`cleanup.js`)

```powershell
node cleanup.js
```

1. Check `jobs/` — exit(0) if empty
2. Create `archive/YYYY-MM-DD/` using `formatDateString(new Date())` — append if exists
3. Move all `.md` files
4. Log: `[cleanup] Archived 12 files to archive/2026-05-30/`

---

## 14. Config File Templates

### 14.1 `config/scoring_prompt.md`

```
You are a job fit scoring assistant. Score how well a candidate profile matches a job description.

Score 1-10:
- 9-10: Exceptional — candidate exceeds core requirements
- 7-8: Strong — candidate meets all core requirements
- 6: Adequate — meets most requirements, minor gaps
- 4-5: Partial — meaningful gaps in 1-2 core requirements
- 1-3: Poor — significant gaps across multiple requirements

Score on:
1. Seniority and scope match
2. Domain expertise (privacy, GRC, AI governance, compliance)
3. Technical background relevance
4. Industry/company type fit
5. Location/remote compatibility

Respond ONLY with a valid JSON object — no preamble, no markdown fences:

{
  "score": [integer 1-10],
  "fit_signal": "[2 sentences on strongest match signals]",
  "gap": "[1 sentence on most significant mismatch, or 'No stated gap' if strong]"
}
```

### 14.2 `config/resume_prompt.md`

```
You are a resume assembly assistant for Adam Buteux, a senior governance, privacy, and AI compliance professional.

Assemble a tailored resume in Markdown format using the pillar library provided.

PILLAR SELECTION:
1. Identify 4-5 central hiring needs from the job description
2. Map each to the most relevant pillar in the library
3. Select the best bullet variant using the "Use when:" notes
4. One bullet per pillar per employer (Meta, Audible, PwC)
5. Sequence pillars in role-weight order
6. Never select two bullets from the same pillar for the same employer
7. Never invent bullets — use pillar library text verbatim
8. RiskHelper.ai: include only if role signals product thinking or AI governance as primary need. Always under INDEPENDENT PROJECTS.

OUTPUT — use these exact section headers:
# Adam Buteux, MBA, CISSP, CIPM
[contact line]
## Summary
## Professional Experience
### [Employer] | [Role Title] | [Dates]
## Independent Projects
## Education
## Certifications

WRITING RULES:
- Bold leads: outcome only, max 15 words
- No em dashes (max 3 if unavoidable)
- No three-part parallel lists
- Banned: leverage, synergy, spearhead, facilitate, enable, thought leadership, best-in-class, utilized, ensured, fostered, championed
- Every bullet must have a metric or scale indicator
- Do not fabricate metrics not in the career file
```

### 14.3 `config/cover_letter_prompt.md`

```
You are a cover letter writing assistant for Adam Buteux.

Goal: do not lose the application. Every sentence must clear this bar before asking whether it adds value.

OUTPUT — use this exact header:
# Cover Letter — [Company] | [Job Title]

STRUCTURE:
Paragraph 1 (2-3 sentences): What Adam does and why this role fits. Mirror role title. No superlatives.
Paragraph 2 (3-4 sentences): One achievement — the decision or constraint behind it. OMIT ENTIRELY if no specific angle exists.
Paragraph 3 (1-2 sentences): One concrete company-specific detail. OMIT ENTIRELY if nothing credible available.
Closing (1 sentence): Direct intent. Not "I'd welcome the opportunity."

CONSTRAINTS:
- Under 300 words. No em dashes. No three-part parallel lists.
- No paragraph restating a resume bullet. No "it wasn't X, it was Y" constructions.

SELF-CHECK: Doubt check | Swap test | Overlap check
```

### 14.4 `config/quality_prompt.md`

```
You are a quality assessor for auto-generated job application documents.

Review the resume and cover letter provided against the job description.

Respond ONLY with a valid JSON object — no preamble, no markdown fences:

{
  "resume_quality": [integer 1-10],
  "cover_letter_quality": [integer 1-10],
  "pillars_selected": ["pillar name 1", "pillar name 2"],
  "cover_letter_paras": [integer: body paragraphs, not counting closing line],
  "quality_note": "[1-2 sentences: what is strong, what is weak]"
}

Quality scoring:
- 9-10: Highly tailored, strong keyword alignment
- 7-8: Well matched, minor gaps in specificity
- 6: Adequate for a numbers-game application
- 4-5: Weak tailoring, consider re-generating
- 1-3: Poor fit signal, do not submit without rework
```

---

## 15. Daily Workflow

### Harvest
1. `node server/server.js`
2. Open `http://localhost:3000/dashboard`
3. Browse LinkedIn, click `Harvest Job` — dashboard updates live
4. Repeat across sessions

### Score and generate
5. `node score.js` — watch dashboard populate row by row
6. Review stack rank table — 🔴 flag is informational only, you decide how to use it
7. `node generate.js` — quality columns populate as each package completes
8. ⚠️ packages (quality < 6) flagged for further work

### Track applications
9. `node apply.js` — update status after submitting

### End of day
10. `node cleanup.js`
11. Ctrl+C the server

### Cross-day runs
```powershell
node generate.js --date=2026-05-29
```

---

## 16. Error Handling

### All scripts
- `require('dotenv').config()` as first line
- Use `src/lib/logger.js` — no bare `console.log`
- `util.parseArgs` for CLI flags
- Validate config files before API calls

### `server.js`
- Port in use → clear message, exit(1)
- Missing POST fields → 400 with `missing` array
- Write failure → 500
- SSE disconnect → remove client silently, no crash

### `score.js` / `generate.js`
- Event broadcast failures → silent, never block pipeline
- DeepSeek errors on individual job → log, skip, continue

### `generate.js` specifically
- Quality call failure → null quality fields, continue with resume+CL write
- `applications.json` write failure → log error prominently (data loss risk)

### `apply.js`
- `applications.json` not found → returns `[]`, creates on first write
- Invalid status → re-prompt

---

## 17. Package Dependencies

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

## 18. `.gitignore`

```
.env
jobs/
archive/
resumes/
config/
node_modules/
server/bookmarklet.min.js
```

`applications.json` is **not** gitignored.

---

## 19. File Reference Summary

| File | Authored by | Task | Purpose |
|---|---|---|---|
| `src/lib/errors.js` | Agent | T01 | Custom error classes |
| `src/lib/logger.js` | Agent | T01 | Centralized logger |
| `src/lib/dateUtils.js` | Agent | T01 | formatDateString, formatDateTimeString |
| `src/lib/eventBroadcaster.js` | Agent | T01 | Fire-and-forget event POST |
| `src/models/job.js` | Agent | T03 | JobFile parser + sanitizeForFilename |
| `src/models/scoredJob.js` | Agent | T04 | ScoredJob parser |
| `src/models/stackRank.js` | Agent | T05 | StackRank formatter/parser |
| `src/models/applicationRecord.js` | Agent | T05b | ApplicationRecord type |
| `src/lib/fileStore.js` | Agent | T06 | All filesystem I/O |
| `src/lib/deduplicator.js` | Agent | T07 | URL + fuzzy deduplication |
| `src/lib/ranker.js` | Agent | T08 | Stack ranking |
| `src/lib/promptBuilder.js` | Agent | T09 | Prompt assembly |
| `src/lib/deepseek.js` | Agent | T10 | DeepSeek API calls |
| `score.js` | Agent | T11 | Scoring orchestrator |
| `generate.js` | Agent | T12 | Generation orchestrator |
| `cleanup.js` | Agent | T13 | Archive orchestrator |
| `server/server.js` | Agent | T14 | Server + SSE + state |
| `server/dashboard.html` | Agent | T14.5 | Real-time dashboard UI |
| `server/bookmarklet.js` | Agent | T15 | Bookmarklet source |
| `apply.js` | Agent | T17 | Application status tracker |
| `config/scoring_prompt.md` | Adam | Before first run | Scoring instructions |
| `config/resume_prompt.md` | Adam | Before first run | Resume instructions |
| `config/cover_letter_prompt.md` | Adam | Before first run | Cover letter instructions |
| `config/quality_prompt.md` | Adam | Before first run | Quality rating instructions |
| `applications.json` | Pipeline | Auto-created | Permanent application log |
| `.env` | Adam | Setup | API key + port |
