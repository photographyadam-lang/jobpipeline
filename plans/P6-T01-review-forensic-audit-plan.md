# P6-T01: Create Reviews for Resumes — Forensic Audit Pipeline

## Overview

Add a new `review.js` orchestration script that performs a recruiter-persona forensic audit on generated application documents (resume.md + cover_letter.md), extracting keyword density metrics and writing a structured `forensic_audit.md` per job package.

---

## Architecture

```
review.js (CLI orchestrator)
│
├─ reads stack_rank_YYYY-MM-DD.md
├─ filters DEEP_TAILOR / AUTO_GENERATED (skips NO_DOCS)
├─ reads job files into Map (once, before loop)
├─ sequential loop per qualifying job:
│   ├─ look up JD from jobFileMap
│   ├─ read resume.md + cover_letter.md from output dir
│   ├─ LLM Call 1: Forensic Audit Narrative (JD + metadata + docs → DeepSeek)
│   ├─ LLM Call 2: Keyword Extraction (JD → DeepSeek → 10 keywords array)
│   ├─ Programmatic: count keyword freq in resume.md
│   └─ write forensic_audit.md to job output dir
├─ broadcast review_started / job_reviewed / review_complete
└─ (no applications.json mutation — read-only audit)
```

---

## Files to Create

### 1. `review.js` — Root-level CLI script

**Structure:** Mirrors [`generate.js`](generate.js), obeys all framework constraints:

- **Line 1:** `require('dotenv').config()`
- **Imports:** `parseArgs`, `path`, `fs.promises`, `ConfigMissingError`, `logger`, `formatDateString`, `broadcastEvent`, `fileStore`, `callDeepSeek`, `parseJobFile`, `parseStackRank`, `sanitizeForFilename`
- **No bare `console` calls** — use `logger.info/warn/error`
- **No `Promise.all` on DeepSeek calls** — sequential `for` loop
- **`util.parseArgs`** for `--date` flag
- **No `toISOString`** — use `formatDateString(new Date())`
- **`eventBroadcaster` wrapped in try/catch** — never throws

**Constants:**
```javascript
const ROOT_DIR = process.env.PIPELINE_BASE_DIR || __dirname;
const RESUMES_DIR = path.join(ROOT_DIR, 'resumes');
const JOBS_DIR = path.join(ROOT_DIR, 'jobs');
```

**System prompts (inline — no new config files):**

> **Rationale:** The AGENTS.md rule says config files are never created or modified. So both LLM system prompts are embedded as string constants in review.js.

- `FORENSIC_AUDIT_SYSTEM_PROMPT` — instructs DeepSeek to act as a recruiter persona, analyze the 6-second identity projection, identify unlinked filler and over-qualification risks
- `KEYWORD_EXTRACTION_SYSTEM_PROMPT` — instructs DeepSeek to extract top 10 most critical operational/technical keywords from the JD as a clean JSON array string

**`getOutputDir()` helper:** Exactly mirrors the one in [`generate.js`](generate.js:139):

```javascript
function getOutputDir(resumesDir, dateStr, company, title) {
  const safeCompany = sanitizeForFilename(company, 60);
  const safeTitle = sanitizeForFilename(title, 60);
  const folderName = `${safeCompany} - ${safeTitle}`;
  return path.join(resumesDir, dateStr, folderName);
}
```

**`countKeywordFrequencies(keywordsArray, resumeContent)` pure helper:**

```javascript
function countKeywordFrequencies(keywords, resumeContent) {
  const lowerContent = resumeContent.toLowerCase();
  return keywords.map(kw => ({
    keyword: kw,
    count: (lowerContent.match(new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length,
  }));
}
```

**Main loop flow (per qualifying job):**

1. Look up JD content from `jobFileMap` (parsed via `parseJobFile`)
2. Compute output dir via `getOutputDir()`
3. Read `resume.md` and `cover_letter.md` from output dir (skip with warning if either missing)
4. Build scoredJob-like metadata object (rank, score, actionFlag, fitSignal, gap from stack rank + company, title, url, linkedInJobId, location, salary from parsed job)
5. **LLM Call 1** — Forensic Audit: `callDeepSeek(FORENSIC_AUDIT_SYSTEM_PROMPT, buildAuditUserPrompt(...), { maxTokens: 1500, timeoutMs: 60000 })`
6. **LLM Call 2** — Keywords: `callDeepSeek(KEYWORD_EXTRACTION_SYSTEM_PROMPT, buildKeywordUserPrompt(...), { maxTokens: 500, timeoutMs: 30000 })`
7. Parse LLM Call 2 response as JSON array of 10 strings
8. Run `countKeywordFrequencies(keywords, resumeContent)` for programmatic density
9. Format `forensic_audit.md` content (markdown template)
10. Write via `fileStore.writeForensicAudit(resumesDir, dateStr, company, title, content)`
11. Broadcast `job_reviewed` event
12. Log progress with ETA

**Output file format (`forensic_audit.md`):**

```markdown
# Forensic Audit — {company} | {title}

## Identity Projection (6-Second Scan)

{narrative from LLM Call 1}

## Filler & Over-Qualification Analysis

{narrative from LLM Call 1 continued}

## Keyword Frequency Table

| Keyword | Frequency |
|---------|-----------|
| compliance | 12 |
| privacy | 8 |
| ...
```

---

## Files to Modify

### 2. `src/lib/fileStore.js` — Add `writeForensicAudit()`

New exported method:

```javascript
async function writeForensicAudit(resumesDir, dateStr, company, title, content) {
  const safeCompany = sanitizeForFilename(company, 60);
  const safeTitle = sanitizeForFilename(title, 60);
  const folderName = `${safeCompany} - ${safeTitle}`;
  const targetDir = path.join(resumesDir, dateStr, folderName);
  // Directory already exists (created by generate.js) — just write the file
  const fullPath = path.join(targetDir, 'forensic_audit.md');
  await fs.writeFile(fullPath, content, 'utf-8');
  return fullPath;
}
```

Add to `module.exports`.

### 3. `server/server.js` — Wire `'review'` task + new event types

**a.** Add `'review'` to `VALID_TASKS` array (line ~669):

```javascript
const VALID_TASKS = ['score', 'generate', 'qa', 'cleanup', 'review'];
```

**b.** Add event type handlers in the `/event` POST switch statement (~line 510):

```javascript
case 'review_started':
  state.phase = 'reviewing';
  break;

case 'job_reviewed':
  // No persistent state needed — broadcast only
  break;

case 'review_complete':
  state.phase = 'idle';
  break;
```

**c.** Add phase label in `updateHeader()` — not in server.js but in dashboard.html.

**d.** On successful review completion (child `close` handler), re-broadcast state so dashboard knows phase is idle (similar to cleanup handler, line ~721).

### 4. `server/dashboard.html` — Add "Create Reviews for Resumes" button

**a.** Add new button in the Pipeline Operations Center panel (~line 932), after the QA button:

```html
<button id="pipeline-btn-review" type="button" class="pipeline-btn run-review">
  <span class="spinner"></span>
  &#9654; Create Reviews for Resumes
</button>
```

**b.** Add CSS for `.run-review` button styling (after `.run-qa` style block ~line 641):

```css
.pipeline-btn.run-review {
  background: #7c4dff;
  color: #fff;
}
.pipeline-btn.run-review:hover:not(:disabled) {
  background: #b388ff;
}
```

**c.** Add `review` to `PIPELINE_TASKS` object (line ~2015):

```javascript
review: { btnId: 'pipeline-btn-review', label: 'Review Engine' },
```

**d.** Wire the button in `wirePipelineControls()` (~line 2243):

```javascript
// Review Engine button
var reviewBtn = document.getElementById('pipeline-btn-review');
if (reviewBtn) {
  reviewBtn.addEventListener('click', function() {
    startPipelineTask('review');
  });
}
```

**e.** Add `reviewing` phase label in `updateHeader()` (~line 1047):

```javascript
if (phase === 'reviewing') label = '\u{1F50D} Reviewing Documents...';
```

**f.** Add handling for new events in `handleEvent()` and `addLogEntry()`:
- `review_started` → add log entry + update header
- `job_reviewed` → add log entry
- `review_complete` → add log entry + return header to idle

**g.** Add entries in `logClassForType()` for new review event types.

### 5. `package.json` — Add npm script

```json
"review": "node review.js",
```

---

## Files NOT Modified

| Path | Reason |
|------|--------|
| `config/` | Never created or modified per AGENTS.md Rule 9 |
| `src/lib/errors.js` | No new error types needed |
| `src/lib/deepseek.js` | No changes needed — `callDeepSeek` works as-is |
| `src/lib/eventBroadcaster.js` | No changes needed |
| `src/lib/logger.js` | No changes needed |
| `src/models/*` | No model changes needed |
| `applications.json` | Review is read-only — no record mutations |
| `tests/fixtures/` | Never modified per AGENTS.md |

---

## SSE Event Reference (New Types)

| Event type | Key fields |
|------------|-----------|
| `review_started` | `total, date` |
| `job_reviewed` | `company, title, sourceFilename, keywordCount` |
| `review_complete` | `reviewed` |

---

## Verification Checklist

Before marking complete:

1. `npm run lint` — must exit 0
2. `npm test` — must exit 0, all prior tests green
3. `grep -r "console\." src/ review.js server/server.js server/dashboard.html` — no bare console calls
4. `grep -n "Promise.all" review.js` — must return no results
5. `grep -rn "readFileSync\|writeFileSync" src/` — must return no results (for Phase 3)
6. Manual test: Run `node review.js --date=YYYY-MM-DD` against a date with generated docs; verify `forensic_audit.md` appears in each output directory with audit narrative + keyword frequency table

---

## Implementation Order

| Step | File | Action |
|------|------|--------|
| 1 | `src/lib/fileStore.js` | Add `writeForensicAudit()` method + export |
| 2 | `review.js` | Create full CLI script (all logic) |
| 3 | `package.json` | Add `"review": "node review.js"` script |
| 4 | `server/server.js` | Add `'review'` to `VALID_TASKS`, handle new event types |
| 5 | `server/dashboard.html` | Add button + CSS + wiring + event handlers |
| 6 | — | Run `npm run lint` and `npm test` to verify |
| 7 | — | Manual test with existing generated docs |
