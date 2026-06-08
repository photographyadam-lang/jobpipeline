# Job Pipeline — Production Runbook

> **Version:** 1.4
> **Last updated:** 2026-06-08
> **Maintainer:** Pipeline operator

---

## Table of Contents

1. [Overview](#1-overview)
2. [Prerequisites](#2-prerequisites)
3. [Stage 1: Ingestion (Harvesting)](#3-stage-1-ingestion-harvesting)
4. [Stage 2: Prioritization (Scoring)](#4-stage-2-prioritization-scoring)
5. [Stage 3: Customization (Generation)](#5-stage-3-customization-generation)
6. [Stage 4: Archiving (Cleanup)](#6-stage-4-archiving-cleanup)
7. [Forensic Audit Review (review.js)](#7-forensic-audit-review-reviewjs)
8. [Dashboard Pipeline Controls](#8-dashboard-pipeline-controls)
9. [Application Tracking](#9-application-tracking)
10. [Cross-Day Workflow](#10-cross-day-workflow)
11. [Quality Assurance](#11-quality-assurance)
12. [Troubleshooting Protocols](#12-troubleshooting-protocols)
13. [File Reference](#13-file-reference)

---

## 1. Overview

The pipeline processes LinkedIn job descriptions through five main stages:

| Stage | Script | Purpose |
|-------|--------|---------|
| Ingestion | `node server/server.js` + bookmarklet **or** dashboard form | Harvest job descriptions from LinkedIn |
| Prioritization | `node score.js` | Score jobs against your profile, build stack rank |
| Customization | `node generate.js` | Generate resumes, cover letters, quality ratings |
| Review | `node review.js` | Forensic audit of generated application packages |
| Archiving | `node cleanup.js` | Archive completed job files for the day |

Additional utilities:
| Purpose | Script |
|---------|--------|
| Quality Assurance | `npm run qa` |
| Application Tracking | Dashboard UI (not a CLI script) |

### Quick start

```powershell
cd C:\Users\adam\OneDrive\Documents\projects\jobs-pipeline

# Terminal 1 — Start the server
node server/server.js

# Open http://localhost:3000/dashboard in browser
# Click bookmarklet on LinkedIn jobs to harvest,
# OR use the "Manual AI Ingestion Platform" form on the dashboard

# Terminal 2 — After harvesting
node score.js
node generate.js
node review.js      # optional — forensic audit of packages
node cleanup.js
```

---

## 2. Prerequisites

### 2.1 Environment configuration

Ensure a `.env` file exists in the project root with the following values:

```
DEEPSEEK_API_KEY=sk-your-actual-key-here
PIPELINE_PORT=3000
```

**Never commit `.env` to version control.** It is listed in `.gitignore`. Use `.env.example` as a reference template — copy it to `.env` and fill in your real values.

The `PIPELINE_PORT` env var controls which port the server listens on. Default is `3000`. If you change it, update your bookmarklet URL and dashboard links accordingly.

### 2.2 Config files

The following files must exist in `config/`. They are human-authored and are never created or modified by the pipeline agent.

| File | Purpose | Required by |
|------|---------|-------------|
| `config/scoring_prompt.md` | System prompt for DeepSeek scoring | `score.js` |
| `config/resume_prompt.md` | System prompt for resume generation | `generate.js` |
| `config/cover_letter_prompt.md` | System prompt for cover letter generation | `generate.js` |
| `config/quality_prompt.md` | System prompt for quality rating | `generate.js` |
| `config/adam_buteux_career.md` | Career profile used by all prompts | Both |
| `config/pillar_library.md` | Bullet-point pillar library | `generate.js` |
| `config/qa_prompt.md` | System prompt for QA evaluation | `src/qa.js` |

Additional reference files (not required by any script):
| File | Purpose |
|------|---------|
| `config/adam_buteux_pillar_library.md` | Alternate pillar library format |
| `config/Writing_Style_Guide.md` | Writing style reference |
| `config/authenticity-SKILL.md` | Authenticity skill definition |

If any required config file is missing, the CLI script exits with code 1 and lists all missing files.

### 2.3 Directory structure

The pipeline expects (and creates) these directories:

```
jobs/                  # Incoming harvested job files
archive/YYYY-MM-DD/    # Archived job files after cleanup
resumes/YYYY-MM-DD/    # Stack rank + generated documents
resumes/YYYY-MM-DD/
  └── Company - Title/ # Per-job output directory
       ├── resume.md
       ├── cover_letter.md
       ├── submission_record.md
       └── forensic_audit.md  # (created by review.js)
applications.json      # Persistent application log (auto-created)
```

**OneDrive warning:** Exclude `jobs/`, `resumes/`, and `archive/` from OneDrive sync. Right-click each folder → OneDrive → "Don't sync this folder." Better yet, move the project outside OneDrive entirely.

### 2.4 Verify the server is running

```powershell
curl http://localhost:3000/health
# Expected: {"status":"ok"}
```

If the server is not running, start it with:

```powershell
npm run server
# or
node server/server.js
```

---

## 3. Stage 1: Ingestion (Harvesting)

There are two ways to harvest job descriptions:

1. **Bookmarklet (automatic):** Click a bookmarklet on a LinkedIn job page to extract and save structured data.
2. **Manual AI Ingestion (alternative):** Paste a URL and raw job text into the dashboard form. DeepSeek parses the text into structured fields. The description text is stitched locally (not from AI output) to avoid truncation on long job descriptions.

Both methods write job files to `jobs/` in the same format and broadcast `job_harvested` events to the dashboard.

### 3.1 Start the server

```powershell
npm run server
```

Expected output:
```
[TIMESTAMP] [server] Pipeline server listening on port 3000
```

(If `PIPELINE_PORT` is set to a different value, the port number will reflect that.)

Open [http://localhost:3000/dashboard](http://localhost:3000/dashboard) in your browser. You should see the dashboard with a "Server running" banner showing `idle` phase.

### 3.2 Install the bookmarklet

**One-time setup:**

```powershell
npm run build:bookmarklet
```

This generates `server/bookmarklet.min.js` starting with `javascript:`.

1. Open your browser's bookmark manager
2. Create a new bookmark named `Harvest Job`
3. Set the URL to the **entire contents** of `server/bookmarklet.min.js`
4. Save

### 3.3 Harvest job descriptions (bookmarklet)

1. Navigate to a LinkedIn job listing (e.g., `https://www.linkedin.com/jobs/view/1234567890/`)
2. Click the `Harvest Job` bookmarklet
3. A green toast appears: `"Saved: Company — Job Title"`
4. The dashboard updates with the new entry in the harvested list

**What the bookmarklet extracts:**

| Field | Source |
|-------|--------|
| Title | LinkedIn job title heading |
| Company | LinkedIn company name link |
| Location | Location text |
| Employment Type | Criteria list item |
| Salary | Salary element (or empty string) |
| Description | Job description section |
| URL | Current page URL (query params stripped) |
| LinkedIn Job ID | Extracted from URL pattern `/jobs/view/([0-9]+)/` |

**Duplicate detection:** If you harvest the same URL twice, the server returns `409 Conflict` and the bookmarklet shows a yellow toast: `"Already saved: Company — Title"`.

**Repeat across sessions.** Harvest all jobs you want to evaluate for the day. You can accumulate jobs over multiple browsing sessions — the server persists them to `jobs/`.

### 3.4 Manual AI Ingestion (alternative)

When the bookmarklet is unavailable (LinkedIn DOM changes, mobile, or blocked), use the **Manual AI Ingestion Platform** built into the dashboard.

1. On the dashboard, locate the **Manual AI Ingestion Platform** panel
2. Paste the LinkedIn job URL into the URL field
3. Copy-paste the **entire raw job description text** into the textarea (select all text on the LinkedIn page, copy, paste)
4. Click **"Harvest via AI Engine"**

**What happens server-side:**

| Step | Description |
|------|-------------|
| 1 | Server receives `POST /harvest-raw` with `{ url, rawText }` |
| 2 | URL is checked against the in-memory duplicate cache (returns `409` if already harvested) |
| 3 | LinkedIn Job ID is extracted from the URL via regex |
| 4 | DeepSeek is called with a data-extraction system prompt to parse the raw text into `{ title, company, location, employmentType, salary }` — **description is NOT extracted from AI**; the raw text is stitched locally to avoid truncation |
| 5 | A job file is written to `jobs/` in the same format as the bookmarklet |
| 6 | A `job_harvested` event is broadcast to the dashboard |

**Feedback:**

| HTTP Status | Toast | Meaning |
|-------------|-------|---------|
| 200 | Green: `"AI Saved: Company — Title"` | Job successfully harvested |
| 409 | Yellow: `"Duplicate URL — already saved"` | URL already in cache |
| 500 | Red: Error message | AI extraction failed or response unparseable |

**Limitations:**

- The AI extraction may occasionally produce incorrect fields (e.g., wrong company name, missing title). Review the saved `.md` file before scoring.
- If extraction fails to return `title`, `company`, or `description`, the server responds with `extraction_incomplete`.
- The raw text should be as complete as possible — truncated text reduces extraction quality.

### 3.5 Verify files were written

```powershell
dir jobs\
# Should show .md files like:
# 2026-06-03-Meridian-Health-Systems-Senior-Privacy-Manager.md
```

Each `.md` file follows the job file format with a `# Title` heading, `## Metadata` section, and `## Job Description` section.

---

## 4. Stage 2: Prioritization (Scoring)

### 4.1 Run the scoring engine

```powershell
npm run score
```

This command:
1. Reads all `.md` files from `jobs/`
2. Parses each job file — skips malformed files with a warning
3. Deduplicates by URL (keeps most recently harvested)
4. Detects fuzzy duplicates (same company + title, different URLs) — warns only, both remain
5. Loads config files: `scoring_prompt.md` (system prompt) and `adam_buteux_career.md` (career profile)
6. Scores each unique job via **sequential** DeepSeek API calls (no `Promise.all` — rate limits are real)
7. Ranks jobs by score (descending) with dense ranking and action flag assignment
8. Computes statistical distribution (buckets: `1-3`, `4-5`, `6-7`, `8-10`)
9. Broadcasts real-time SSE events (`scoring_started`, `job_scored`, `scoring_complete`)
10. Writes `stack_rank_YYYY-MM-DD.md` to `resumes/YYYY-MM-DD/`

**Errors during scoring:** If a DeepSeek call fails for an individual job (timeout, API error, parse error), that job is skipped and a `job_skipped` event is broadcast. The pipeline continues with the remaining jobs.

### 4.2 Understand the output

The stack rank file header shows summary statistics:

```markdown
# Stack Rank — 2026-06-03
*Generated: 2026-06-03 14:32 | Jobs scored: 12 | Documents to generate: 7*
*Score stats: mean 6.8 | range 4–9 | distribution: 1-3: 0 | 4-5: 2 | 6-7: 7 | 8-10: 3*
```

Each job entry includes:

| Field | Meaning |
|-------|---------|
| Rank | 1-based position in stack (dense ranking — ties share rank) |
| Score | 1–10 from DeepSeek |
| Action Flag | 🔴 `DEEP TAILOR` (top 4), 🟡 `AUTO-GENERATED` (5+, score ≥ 6), ⚪ `NO DOCS` (5+, score < 6) |
| Fit | 2-sentence match signal from DeepSeek |
| Gap | 1-sentence identified gap |

**Action flag logic:**

| Condition | Flag | Docs generated? |
|-----------|------|-----------------|
| Rank 1–4 | `DEEP_TAILOR` | Yes |
| Rank 5+, score ≥ 6 | `AUTO_GENERATED` | Yes |
| Rank 5+, score < 6 | `NO_DOCS` | No |
| Fewer than 4 total jobs | All `DEEP_TAILOR` | Yes |
| Tie at rank 4/5 boundary | All tied get `DEEP_TAILOR` | Yes |

### 4.3 Review the dashboard

While scoring runs, the dashboard updates in real time:
- Phase indicator shows `scoring`
- Score distribution bars update per job
- Stack rank table builds row by row
- Activity log shows each event (`scoring_started`, `job_scored`, `job_skipped`, `scoring_complete`)

After `scoring_complete`:
- Review the distribution — if most jobs cluster in the 1–3 range, your career profile may need updating
- Check fuzzy duplicate warnings — they appear as ⚠️ blocks in the stack rank

### 4.4 Using a specific date

```powershell
npm run score -- --date=2026-05-28
```

This writes output to `resumes/2026-05-28/stack_rank_2026-05-28.md` instead of today's folder.

### 4.5 Empty jobs/ directory

If no job files exist, the script exits with code 0:

```
[TIMESTAMP] [score] No job files found in jobs/ — nothing to score.
```

If all files were malformed, it also exits with code 0:

```
[TIMESTAMP] [score] All job files were malformed — nothing to score.
```

### 4.6 No jobs successfully scored

If all jobs encountered errors during scoring, the script exits with code 0:

```
[TIMESTAMP] [score] No jobs were successfully scored.
```

---

## 5. Stage 3: Customization (Generation)

### 5.1 Run the document generator

```powershell
npm run generate
```

This command:

1. **Loads config files:** `resume_prompt.md`, `cover_letter_prompt.md`, `quality_prompt.md`, `adam_buteux_career.md`, `pillar_library.md`
2. **Strips static sections from career profile** — removes contact header and all content from `## Education` onward before sending to the LLM (saves tokens, prevents LLM from rewriting static credentials)
3. **Reads the stack rank file** for today's date via `fileStore.readStackRank()`
4. **Parses qualifying jobs** from the stack rank (`DEEP_TAILOR` and `AUTO_GENERATED` only)
5. **I/O optimization — reads `applications.json` ONCE** before the main loop (never inside the loop)
6. **I/O optimization — reads all job files ONCE** into an in-memory `Map` keyed by filename (never inside the loop)
7. For each qualifying job in a **sequential** loop:
   - Looks up the source job content from the in-memory `Map` by `sourceFilename`
   - Parses the job file to get the full `JobFile` object
   - Extracts `fitSignal` and `gap` from the raw stack rank markdown using regex on `**Fit:**` / `**Gap:**` patterns
   - Builds a ScoredJob-like object combining stack rank data + job file data
   - Checks if output directory already exists (idempotent skip)
   - **Call 1 — Resume (Hybrid Assembly Pattern):** LLM generates only the tailored core (Professional Experience + Independent Projects). Static header and footer (contact info, Education, Certifications, Publications) are hardcoded invariants — never passed to the LLM.
   - **Call 2:** Generates a tailored cover letter via DeepSeek (maxTokens: 800, timeout: 60s) — on failure, sets `coverLetterContent` to `null` and continues
   - **Call 3:** Rates quality of both documents via DeepSeek (maxTokens: 200, timeout: 30s) — on failure, sets quality fields to `null` and continues
   - Stitches final resume: static header + LLM tailored core + static footer
   - Writes `resume.md` and `cover_letter.md` to the output directory
   - Writes `submission_record.md` with metadata
   - Accumulates an `ApplicationRecord` into an in-memory array
   - Broadcasts `doc_generated` event with quality scores and `sourceFilename`
   - Logs a warning if resume or cover letter quality is below 6
8. **I/O optimization — writes `applications.json` ONCE** after the loop with all new records appended

### 5.2 Understand the output

Each job produces a directory with three files (plus a forensic audit file if `review.js` was run):

```
resumes/2026-06-03/Meridian-Health-Systems-Senior-Privacy-Manager/
├── resume.md              # Tailored resume (Hybrid Assembly — static header/footer + LLM core)
├── cover_letter.md        # Tailored cover letter
├── submission_record.md   # Metadata record
└── forensic_audit.md      # Forensic audit report (created by review.js)
```

**`resume.md`** — Built using the **Hybrid Assembly Pattern**: a hardcoded static header (contact info + professional summary) and footer (Education, Certifications, Publications) sandwich an LLM-tailored core (Professional Experience + Independent Projects). The LLM only generates the middle section — static boilerplate never enters the prompt context window.

**`cover_letter.md`** — Concise (< 300 words). Paragraphs selected based on available angles.

**`submission_record.md`** — Contains:
- Generated date, source path, LinkedIn Job ID
- Score, action flag, fit signal, gap
- Pillars selected for the resume
- Cover letter structure (paragraphs used)
- Quality assessments (R★/CL★ scores)
- Application status (initially `generated`)

### 5.3 Quality scores

Quality scores (R★ and CL★) are displayed in the dashboard's stack rank table. The `doc_generated` event carries `resumeQuality`, `coverLetterQuality`, `qualityNote`, `pillarsSelected`, and `coverLetterParas`. The dashboard matches these to the correct stack rank row by **`sourceFilename`** (not by company+title strings).

| Score | Meaning |
|-------|---------|
| 9–10 | Highly tailored, strong keyword alignment |
| 7–8 | Well matched, minor gaps |
| 6 | Adequate for numbers-game application |
| 4–5 | **⚠️ Weak** — consider re-generating |
| 1–3 | **⚠️ Poor** — do not submit without rework |

If a quality score is below 6, the dashboard shows it in amber with ⚠️. A warning is also logged to the terminal.

**Quality call failure:** If the DeepSeek quality call fails (timeout, API error, or JSON parse error), the quality fields (`resumeQuality`, `coverLetterQuality`, `qualityNote`, `pillarsSelected`, `coverLetterParas`) are all set to `null`. Resume and cover letter are still written — generation is not blocked by a failed quality assessment.

**Cover letter call failure:** If the cover letter DeepSeek call fails (timeout, API error), `coverLetterContent` is set to `null` (empty string is written to disk). The job continues to the quality assessment step — generation is not blocked by a failed cover letter.

### 5.4 Idempotent behavior

If you run `generate.js` a second time, it skips jobs that already have output directories:

```
[TIMESTAMP] [generate] Skipping Company — Title — output already exists
```

This is safe to run multiple times.

### 5.5 Source file lookup via Map

Before the main loop, **all job files in `jobs/`** are read into a `Map`:

```javascript
const jobFileMap = new Map(allJobFiles.map(f => [f.filename, f.content]));
```

Inside the loop, each qualifying job's `sourceFilename` is used to look up the source content. If the source file is not found (e.g., cleanup already ran), the job is skipped with a warning.

### 5.6 Applications.json

After generation completes, `applications.json` contains one entry per generated job. This file is the permanent record of all generated applications. It is read once before the loop and written once after the loop — never accessed inside the per-job loop.

```json
{
  "id": "2026-06-03-Meridian-Health-Systems-Senior-Privacy-Manager",
  "company": "Meridian Health Systems",
  "title": "Senior Privacy Manager",
  "url": "https://www.linkedin.com/jobs/view/3987654321",
  "score": 8,
  "actionFlag": "DEEP_TAILOR",
  "status": "generated",
  ...
}
```

### 5.7 Cross-day generation

If you scored jobs on a previous day but didn't generate:

```powershell
npm run generate -- --date=2026-05-28
```

This reads `resumes/2026-05-28/stack_rank_2026-05-28.md` and writes output to `resumes/2026-05-28/`.

**Without `--date` on a different day:** If stack rank doesn't exist for today, the script exits with code 1 and a helpful message:

```
No stack rank for YYYY-MM-DD. Run: node score.js --date=YYYY-MM-DD
```

---

## 6. Stage 4: Archiving (Cleanup)

### 6.1 Run the cleanup script

```powershell
npm run cleanup
```

This command:
1. Checks if `jobs/` has any `.md` files — if empty, exits with code 0
2. Creates `archive/YYYY-MM-DD/` (appends to existing directory if today is a second run)
3. Moves all `.md` files from `jobs/` to `archive/YYYY-MM-DD/`
4. Logs the count of files archived

Expected output:
```
[TIMESTAMP] [cleanup] Archived 12 files to archive/2026-06-03/
```

**Note:** Archive goes to `archive/` at the project root level, **not** `jobs/archive/`.

### 6.2 Verify

After cleanup:
- `jobs/` still exists but is empty
- `archive/YYYY-MM-DD/` contains all the harvested `.md` files
- Non-`.md` files in `jobs/` are not moved

### 6.3 Cleanup on an empty directory

If `jobs/` is already empty (e.g., running cleanup twice):

```
[TIMESTAMP] [cleanup] jobs/ is already empty — nothing to archive.
```

Exits with code 0.

### 6.4 End-of-day sequence

Recommended order:

```powershell
node score.js       # Stage 2 — prioritize all harvested jobs
node generate.js    # Stage 3 — generate documents for qualifying jobs
node review.js      # Stage 3b — (optional) forensic audit of generated packages
node cleanup.js     # Stage 4 — archive job files
# Ctrl+C the server in Terminal 1
```

**Important:** Run `generate.js` **before** `cleanup.js`. The generate script needs the original job files in `jobs/` to look up job descriptions. If you archive first, generate will skip jobs with "source file not found" warnings. Similarly, run `review.js` before `cleanup.js` — it also needs the original job files.

---

## 7. Forensic Audit Review (review.js)

The pipeline includes an optional **Forensic Audit Review** stage that evaluates generated application packages before submission. This is not a mandatory stage — it provides an additional quality gate for candidates who want a recruiter-perspective critique.

### 7.1 Run the review

```powershell
npm run review
```

Or with a specific date:

```powershell
npm run review -- --date=2026-06-03
```

This command:

1. **Reads the stack rank file** for today's date
2. **Parses qualifying jobs** (`DEEP_TAILOR` and `AUTO_GENERATED` only)
3. **I/O optimization — reads job files ONCE** into an in-memory `Map` keyed by filename (before the loop)
4. For each qualifying job in a **sequential** loop:
   - Looks up the source job content from the in-memory `Map`
   - Reads the generated `resume.md` and `cover_letter.md` from the job's output directory
   - **Call 1 — Forensic Audit Narrative:** Calls DeepSeek with an elite-recruiter persona system prompt to generate a 2-section critique:
     - **Identity Projection (6-Second Scan):** What professional identity does the application project?
     - **Filler & Over-Qualification Analysis:** Identifies unlinked filler sections and over-qualification risks
     - **Call 2 — Keyword Extraction:** Calls DeepSeek to extract the top 10 critical keywords from the job description
     - **Programmatic keyword frequency count:** Uses `countKeywordFrequencies()` from [`src/lib/reviewUtils.js`](src/lib/reviewUtils.js) to count keyword occurrences in the resume. Each keyword is normalized via `normalizeKeyword()` — a multi-step pipeline that lowercases, strips punctuation, strips possessives, and normalizes pluralization markers. An **over-stripping guardrail** protects domain-critical terms ending naturally in `s` (e.g., `business`, `process`, `access`, `analysis`) from being clipped. Word-boundary-aware regex ensures exact substring matching with no false partial matches.
   - Writes `forensic_audit.md` to the job's output directory containing both the narrative analysis and keyword frequency table
   - Broadcasts `job_reviewed` SSE event
   - On failure: broadcasts `job_skipped` and continues to next job
5. Broadcasts `review_complete`

### 7.2 Understand the output

Each reviewed job gets a `forensic_audit.md` file in its output directory:

```
resumes/2026-06-03/Meridian-Health-Systems-Senior-Privacy-Manager/
├── resume.md
├── cover_letter.md
├── submission_record.md
└── forensic_audit.md      # ← created by review.js
```

**`forensic_audit.md`** contains:
- **## Identity Projection** — LLM assessment of the professional identity the application conveys
- **## Filler & Over-Qualification Analysis** — LLM flagging of weak sections and mismatches
- **## Keyword Frequency Table** — Programmatic frequency count of the top 10 job keywords in the resume

### 7.3 When to run review

| Scenario | Recommendation |
|----------|---------------|
| Before submitting an application | Run review to catch filler sections or identity mismatches |
| After generating multiple packages | Batch review all packages in one pass |
| Skipping review entirely | Optional — generation produces complete packages without it |

### 7.4 Review and cleanup

Like `generate.js`, the review script needs the original job files in `jobs/` to run. Run `review.js` **before** `cleanup.js`.

---

## 8. Dashboard Pipeline Controls

The dashboard includes built-in buttons to run pipeline stages directly from the UI.

### 7.1 Available controls

| Button | Action | Equivalent CLI |
|--------|--------|---------------|
| **Run Score** | Spawns `npm run score` as a child process | `node score.js` |
| **Run Generate** | Spawns `npm run generate` as a child process | `node generate.js` |
| **Run Review** | Spawns `npm run review` as a child process | `node review.js` |
| **Run QA** | Spawns `npm run qa` as a child process | `node src/qa.js` |
| **Run Cleanup** | Spawns `npm run cleanup` as a child process | `node cleanup.js` |

### 7.2 How it works

1. Click the button in the dashboard's "Pipeline Controls" section
2. The server spawns the script as a child process via `child_process.spawn`
3. Live stdout/stderr output appears in a terminal-like log panel on the dashboard
4. Only one pipeline process may run at a time — clicking a second button while one is running returns a `409 Conflict` error
5. On process exit, the exit code is displayed

### 7.3 When to use dashboard controls vs. CLI

| Scenario | Recommendation |
|----------|---------------|
| First run of the day | CLI (you're already in the terminal) |
| Quick re-score after fixing a job file | Dashboard button |
| Running generate after scoring from CLI | Either works |
| QA evaluation | Dashboard button or `npm run qa` |
| Running review after generation | Dashboard button or CLI |
| Reviewing packages before submission | CLI — review.js output is markdown files |
| Debugging (need to see full output) | CLI (terminal output is persistent) |

---

## 9. Application Tracking

Application status tracking is handled through the dashboard UI, not a CLI script.

### 9.1 View application history

After generation, the dashboard shows your application history in a table at the bottom of the page. Each row includes:
- Company and title
- Score and action flag
- Quality scores (R★/CL★)
- Current status
- Date generated
- Date applied (if applicable)

### 9.2 Mark an application as applied

1. From the dashboard, find the application in the "Application History" section
2. Click the **"Mark Applied"** button next to the entry
3. This sends `POST /api/applications/apply` with the application `id`
4. The server updates `applications.json`:
   - Sets `status` to `"applied"`
   - Sets `dateApplied` to today's date
5. The dashboard refreshes to show the updated status

### 9.3 Open output folder

Click the **"Open Folder"** button next to any application entry in the dashboard. This:
1. Sends `POST /api/applications/open-folder` with the application `id`
2. The server looks up the `outputPath` from `applications.json`
3. Opens the folder in Windows Explorer

### 9.4 Valid statuses

| Status | Meaning |
|--------|---------|
| `generated` | Documents created, not yet submitted |
| `applied` | Application submitted |
| `interviewing` | In interview process |
| `rejected` | Application rejected |
| `offer` | Offer received |
| `withdrawn` | Application withdrawn |

---

## 10. Cross-Day Workflow

### Scenario: You scored yesterday but didn't generate

```powershell
node generate.js --date=2026-05-28
```

This reads the stack rank from `resumes/2026-05-28/` and generates documents there.

### Scenario: You want to score old jobs on a new day

```powershell
node score.js --date=2026-05-28
```

This writes the stack rank to `resumes/2026-05-28/stack_rank_2026-05-28.md`.

### Scenario: Running generate on a different calendar day

If you have jobs harvested and scored but it's now a different day:

```powershell
node generate.js            # Fails — no stack rank for today
node generate.js --date=2026-05-28  # Works — reads yesterday's stack rank
```

### Scenario: You need job files after cleanup

If `cleanup.js` has already run but you need to re-generate:

1. Restore files: Copy from `archive/YYYY-MM-DD/` back to `jobs/`
2. Then run `node generate.js --date=YYYY-MM-DD`

---

## 11. Quality Assurance

### 11.1 Run QA evaluation

```powershell
npm run qa
```

This command:
1. Reads the most recent stack rank and generated documents from `resumes/`
2. Uses `config/qa_prompt.md` as the DeepSeek system prompt
3. Evaluates each generated document for quality, accuracy, and completeness
4. Produces a QA assessment report
5. Broadcasts a `qa_complete` SSE event if the server is running

### 11.2 When to run QA

- After generation is complete, before submitting applications
- To check if resume/cover letter quality needs improvement
- As a pre-flight check before marking applications as applied

---

## 12. Troubleshooting Protocols

### 12.1 Missing API key

**Symptom:** Script exits immediately with `ConfigMissingError`.

```
[TIMESTAMP] [score] ERROR: Config file not found: DEEPSEEK_API_KEY
```

**Fix:**
1. Verify `.env` exists in the project root
2. Verify it contains `DEEPSEEK_API_KEY=sk-...`
3. Verify there's no trailing space or quote in the value
4. Run `node -e "require('dotenv').config(); console.log(process.env.DEEPSEEK_API_KEY)"` to check the key loads
5. If still failing, copy `.env.example` to `.env` and re-enter the key

### 12.2 Missing config file

**Symptom:** Script exits with code 1 listing missing config files.

```
Missing config file(s):
  - config/scoring_prompt.md
```

**Fix:** Ensure all required config files exist in `config/`. See [Section 2.2](#22-config-files) for the full list. These files are human-authored — the pipeline creates none of them.

### 12.3 DeepSeek API errors

**Symptom:** Individual jobs are skipped with `DeepSeekResponseError`.

| Error | Likely cause | Fix |
|-------|-------------|-----|
| 401 Unauthorized | Invalid API key | Regenerate key at platform.deepseek.com, update `.env` |
| 429 Rate limit | Too many requests | Wait 60 seconds, retry. Sequential loop is by design. |
| 500 Server error | DeepSeek outage | Wait and retry. Check status.deepseek.com |
| Timeout | Network or overload | Retry the job. Default timeout is 30s for scoring, 60s for generation. |

**Note:** Errors on individual jobs only skip that job — the rest of the pipeline continues unaffected.

For a complete reference on how LLM calls are assembled, dispatched, parsed, and error-handled, see [Section 11 — LLM Integration](docs/architecture.md#11-llm-integration) in the architecture guide.

### 12.4 Server won't start

**Symptom:** `node server/server.js` fails.

**Common causes and fixes:**

| Symptom | Cause | Fix |
|---------|-------|-----|
| `EADDRINUSE :::3000` | Port already in use | Kill the existing process or set `PIPELINE_PORT=3001` in `.env` |
| `EADDRINUSE :::3001` | Custom port in use | Use a different port in `PIPELINE_PORT` |
| `MODULE_NOT_FOUND` express | Dependencies not installed | Run `npm install` |
| `ConfigMissingError` | `.env` missing or incomplete | Create `.env` from `.env.example` |

**Finding what's on a port:**
```powershell
netstat -ano | findstr :3000
# Get the PID, then:
taskkill /PID [number] /F
```

### 12.5 Stack rank file not found by generate.js

**Symptom:**
```
No stack rank for YYYY-MM-DD. Run: node score.js --date=YYYY-MM-DD
```

**Fix:** Either:
- Run `node score.js` first to generate the stack rank for today
- Or use `--date` to point to an existing stack rank: `node generate.js --date=2026-05-28`

### 12.6 Source file not found by generate.js

**Symptom:**
```
Source file 2026-05-28-Company-Title.md not found for Company — Title — cleanup may have run. Skipping.
```

**Fix:** This occurs when `cleanup.js` has already archived the job files but the stack rank still references them. Either:
- Restore files from `archive/YYYY-MM-DD/` back to `jobs/` before running `generate.js`
- Or run `generate.js` before `cleanup.js` in your workflow

### 12.7 Dashboard not showing updates

**Symptom:** Dashboard loads but no real-time updates appear.

**Checks:**
1. Verify the server is running on the same port as `PIPELINE_PORT` in `.env`
2. Open browser DevTools → Network tab → filter by "events"
3. Check for SSE connection errors to `http://localhost:{PORT}/events`
4. Try refreshing the page

**Fallback:** If the dashboard is unavailable, the pipeline still runs correctly — events simply aren't displayed. The `eventBroadcaster` module never throws, so a missing dashboard won't crash the pipeline.

### 12.8 Bookmarklet not working

**Symptom:** Clicking the bookmarklet does nothing or shows an alert.

**Checks:**
1. Is the server running? (`curl http://localhost:3000/health`)
2. Are you on a LinkedIn job page? (URL should match `https://www.linkedin.com/jobs/view/*`)
3. Did you update the bookmarklet URL after `npm run build:bookmarklet`?
4. Check browser DevTools Console for JavaScript errors

**Known limitation:** LinkedIn periodically changes its DOM class names. The bookmarklet uses multiple fallback selectors, but may need updating if LinkedIn makes significant changes to its job page layout.

**Alternative:** Use the **Manual AI Ingestion Platform** on the dashboard instead — it does not depend on LinkedIn DOM structure.

### 12.9 Poor quality scores

**Symptom:** Quality scores consistently below 6.

**Possible causes:**
1. **Career profile too generic** — Update `config/adam_buteux_career.md` with more specific, measurable achievements
2. **Pillar library needs expansion** — Add more bullet variants to `config/pillar_library.md` covering different role types
3. **Job descriptions too sparse** — Some LinkedIn listings have minimal text; the AI has less to work with
4. **Cover letter paragraph 2 omitted** — If no specific angle exists, the AI correctly skips it, lowering the word count and potentially the score

### 12.10 Manual AI Ingestion failures

**Symptom:** The "Harvest via AI Engine" button returns an error.

| Error | Likely cause | Fix |
|-------|-------------|-----|
| `missing_fields` | URL or text field empty | Fill in both fields before submitting |
| `duplicate` | URL already harvested | The job is already saved — check `jobs/` |
| `parse_error` | DeepSeek returned unparseable JSON | Retry with more complete raw text |
| `extraction_incomplete` | Missing title, company, or description | Paste more of the job page text for better AI extraction |
| `server_error` | General failure | Check server logs for details |

**Best practices for paste text:**
- Copy the **entire page content** from the LinkedIn job listing (Ctrl+A, Ctrl+C)
- Include the job title, company name, and all description sections
- More text = better AI extraction. If text is truncated, the extraction quality drops.

### 12.11 Applications.json corruption

**Symptom:** `generate.js` errors related to `applications.json`.

**Recovery:**
1. The file is standard JSON — manually inspect with a JSON validator
2. If corrupted, the last backup is the previous version (the file is overwritten, not appended)
3. As a last resort, set `applications.json` to `[]` — the pipeline creates a fresh file on the next write

### 12.12 Network/connectivity issues

**Symptom:** All DeepSeek calls fail with timeout or network errors.

**Checks:**
1. Verify internet connectivity
2. Verify `api.deepseek.com` is reachable: `curl https://api.deepseek.com/v1/chat/completions` (expects POST with auth — a connection-refused or timeout tells you about network)
3. Check firewall/proxy settings
4. Check DeepSeek service status

### 12.13 Pipeline button in dashboard shows error

**Symptom:** Clicking "Run Score" or "Run Generate" in the dashboard shows an error toast.

| Error | Cause | Fix |
|-------|-------|-----|
| `Pipeline process already running` | A previous run hasn't finished | Wait for it to complete, or restart the server |
| `Invalid task` | Unknown task name | Only `score`, `generate`, `qa`, `cleanup`, and `review` are valid |
| Process exits with code 1 | Script error | Check the live log panel for error details |

---

## 13. File Reference

### 13.1 Source modules

| File | Purpose |
|------|---------|
| `src/models/job.js` | JobFile parser, sanitizeForFilename, extractLinkedInJobId |
| `src/models/scoredJob.js` | ScoredJob type, DeepSeek response parser |
| `src/models/stackRank.js` | StackRank formatter and parser (parseStackRank, formatStackRank, formatSubmissionRecord) |
| `src/models/applicationRecord.js` | ApplicationRecord type and helpers (createApplicationRecord) |
| `src/lib/errors.js` | Custom error classes (JobParseError, DeepSeekResponseError, ConfigMissingError) |
| `src/lib/logger.js` | Centralized logger with timestamps |
| `src/lib/dateUtils.js` | formatDateString, formatDateTimeString (local time) |
| `src/lib/eventBroadcaster.js` | Fire-and-forget SSE event POST (never throws) |
| `src/lib/fileStore.js` | All filesystem I/O (fs.promises only) |
| `src/lib/deepseek.js` | DeepSeek API adapter (native fetch, configurable timeout) |
| `src/lib/deduplicator.js` | Two-pass deduplication (URL exact + fuzzy company/title) |
| `src/lib/ranker.js` | Stack ranking logic (dense ranking, action flag assignment, straddle rule) |
| `src/lib/promptBuilder.js` | Prompt assembly for all DeepSeek calls (scoring, resume, cover letter, quality) |
| `src/lib/reviewUtils.js` | Keyword normalization (`normalizeKeyword`) and frequency counting (`countKeywordFrequencies`) with over-stripping guardrail and word-boundary-aware matching |

### 13.2 Orchestrators

| File | Purpose |
|------|---------|
| `score.js` | Scoring orchestrator — reads jobs, validates configs, scores via DeepSeek, ranks, writes stack rank, broadcasts events |
| `generate.js` | Generation orchestrator — reads stack rank, parses qualifying jobs, generates docs (Hybrid Assembly Pattern), writes applications.json, broadcasts events |
| `review.js` | Forensic audit review — reads stack rank and generated docs, performs forensic audit narrative + keyword extraction, writes forensic_audit.md, broadcasts events |
| `cleanup.js` | Archive orchestrator — moves job files from `jobs/` to `archive/YYYY-MM-DD/` |
| `src/qa.js` | QA evaluation — reads generated docs and evaluates quality via DeepSeek |

### 13.3 Server

| File | Purpose |
|------|---------|
| `server/server.js` | Express server factory (`createApp(jobsDir)`), SSE, state management, POST /harvest, POST /harvest-raw, dashboard pipeline controls, application tracking API |
| `server/dashboard.html` | Real-time dashboard (inline CSS/JS, no external deps) with Manual AI Ingestion Platform, pipeline controls, and application history |
| `server/bookmarklet.js` | Bookmarklet source (human-readable, exported for unit testing with jsdom) |
| `server/bookmarklet.min.js` | Minified bookmarklet (generated by `npm run build:bookmarklet`) |
| `scripts/minify-bookmarklet.js` | Terser-based bookmarklet minifier |

### 13.4 Configuration (human-authored)

| File | Purpose |
|------|---------|
| `config/scoring_prompt.md` | DeepSeek system prompt for job scoring |
| `config/resume_prompt.md` | DeepSeek system prompt for resume generation |
| `config/cover_letter_prompt.md` | DeepSeek system prompt for cover letter generation |
| `config/quality_prompt.md` | DeepSeek system prompt for quality rating |
| `config/qa_prompt.md` | DeepSeek system prompt for QA evaluation |
| `config/adam_buteux_career.md` | Career profile (professional summary, achievements, education, certifications) |
| `config/pillar_library.md` | Bullet-point library organized by skill pillar |
| `config/Writing_Style_Guide.md` | Writing style reference (informational) |
| `config/authenticity-SKILL.md` | Authenticity skill definition (informational) |

### 13.5 Data files

| File | Purpose | Created by |
|------|---------|------------|
| `jobs/*.md` | Harvested job descriptions | Bookmarklet → `POST /harvest` **or** dashboard → `POST /harvest-raw` |
| `resumes/YYYY-MM-DD/stack_rank_YYYY-MM-DD.md` | Scored job rankings | `score.js` |
| `resumes/YYYY-MM-DD/Company - Title/resume.md` | Tailored resume | `generate.js` |
| `resumes/YYYY-MM-DD/Company - Title/cover_letter.md` | Tailored cover letter | `generate.js` |
| `resumes/YYYY-MM-DD/Company - Title/submission_record.md` | Application metadata | `generate.js` |
| `resumes/YYYY-MM-DD/Company - Title/forensic_audit.md` | Forensic audit report | `review.js` |
| `archive/YYYY-MM-DD/*.md` | Archived job files | `cleanup.js` |
| `applications.json` | Application history (permanent) | `generate.js` |
