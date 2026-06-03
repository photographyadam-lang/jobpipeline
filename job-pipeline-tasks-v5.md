# Job Pipeline — Atomic Build Tasks

**Version:** 5.0
**Date:** 2026-05-30

**Key changes from v4.0:**
- All tasks are now fully self-contained — no "identical to v3.1" or "additions to vX" patterns. Every task has complete deliverables, acceptance criteria, and test requirements.
- `dateUtils.js` added to T01.
- T05 `formatStackRank` signature corrected to accept `fuzzyWarnings` parameter.
- T06 dependency on T05b added (for `ApplicationRecord` type in `readApplications`).
- T11 dependency on T05 added (calls `formatStackRank`).
- T12 dependency on T11 clarified as sequencing-only (not a code import).
- `generate.js` reads/writes `applications.json` outside the loop.
- `eventBroadcaster.js` uses `PIPELINE_PORT` env var.
- `apply.js` exports `processUpdate()` pure function for testability.
- `doc_generated` event includes `sourceFilename` for reliable dashboard row matching.
- PowerShell `echo "[]"` encoding bug removed — `readApplications` handles missing file.

---

## Architecture Principles

### Pure Function / Model Architecture

Every meaningful transformation is a **pure function**: explicit input, explicit output, no side effects. Side effects (file I/O, API calls, HTTP, event broadcasting) are isolated in single-responsibility adapter modules.

The filesystem is touched only in `fileStore.js`.
The DeepSeek API is called only in `deepseek.js`.
Events are broadcast only in `eventBroadcaster.js`.
Everything else is a function.

### Module Map

```
src/
├── models/
│   ├── job.js                # JobFile + sanitizeForFilename + extractLinkedInJobId
│   ├── scoredJob.js          # ScoredJob type + DeepSeek score response parser
│   ├── stackRank.js          # StackRank formatter(rankedJobs, date, fuzzyWarnings) + parser
│   └── applicationRecord.js  # ApplicationRecord type + createApplicationRecord + helpers
└── lib/
    ├── errors.js             # JobParseError, DeepSeekResponseError, ConfigMissingError
    ├── logger.js             # info/error/warn with timestamp prefix
    ├── dateUtils.js          # formatDateString, formatDateTimeString
    ├── eventBroadcaster.js   # broadcastEvent (fire-and-forget, reads PIPELINE_PORT)
    ├── fileStore.js          # All fs.promises I/O
    ├── deepseek.js           # callDeepSeek (native fetch, sequential only)
    ├── deduplicator.js       # deduplicateJobs (URL + fuzzy, pure)
    ├── ranker.js             # rankJobs (pure)
    └── promptBuilder.js      # buildScoringPrompt, buildResumePrompt,
                              # buildCoverLetterPrompt, buildQualityPrompt (all pure)
```

### Testing Stack

| Layer | Tool | Purpose |
|---|---|---|
| Linting | ESLint (`eslint:recommended`) | Every task before acceptance |
| Unit | Jest | Pure functions tested with fixtures |
| Integration | Jest + msw | `fs.mkdtemp` for temp dirs; msw for HTTP mocking |
| E2E | Jest + msw | Full pipeline with child process env injection |

**Critical constraints:**
- `msw` not `nock` — nock does not intercept native `fetch`
- `fs.promises.mkdtemp` not `tmp` package — `tmp` has Windows cleanup issues
- `util.parseArgs` not minimist/yargs — built into Node v18+
- No `supertest` — use `createApp(jobsDir)` factory + native `fetch` against test port
- `PIPELINE_PORT` env var controls server port — set to `3001` in tests to avoid conflicts

### Coverage Strategy

`jest.config.js`:
```javascript
module.exports = {
  testEnvironment: 'node',
  testPathIgnorePatterns: ['/node_modules/', '/tests/fixtures/', '/tests/helpers/'],
  collectCoverageFrom: [
    'src/**/*.js',
    'score.js', 'generate.js', 'cleanup.js', 'apply.js', 'server/server.js'
  ],
  // Per-file thresholds added per task. Global 80% enforced at T16.
};
```

---

## Task Index

| # | Task | Depends on |
|---|---|---|
| T01 | Scaffold + errors.js + logger.js + dateUtils.js + eventBroadcaster.js | — |
| T02 | Test fixtures (10 files) | T01 |
| T03 | `job.js` — JobFile model | T02 |
| T04 | `scoredJob.js` — ScoredJob model | T03 |
| T05 | `stackRank.js` — formatter and parser | T04 |
| T05b | `applicationRecord.js` — ApplicationRecord model | T04 |
| T06 | `fileStore.js` — filesystem adapter | T03, T05b |
| T07 | `deduplicator.js` — URL + fuzzy deduplication | T03 |
| T08 | `ranker.js` — stack ranking | T04 |
| T09 | `promptBuilder.js` — prompt assembly | T03, T04 |
| T10 | `deepseek.js` — API adapter | T04 |
| T11 | `score.js` — scoring orchestrator | T05, T06, T07, T08, T09, T10 |
| T12 | `generate.js` — generation orchestrator | T05, T05b, T06, T09, T10 |
| T13 | `cleanup.js` — archive orchestrator | T06 |
| T14 | `server.js` — server + SSE + state | T06 |
| T14.5 | `dashboard.html` — real-time UI | T14 |
| T15 | `bookmarklet.js` — browser bookmarklet | T14 |
| T16 | End-to-end pipeline test | T11, T12, T13, T14, T14.5, T15 |
| T17 | `apply.js` — status tracker | T05b, T06 |

**Note on T12 dependency on T11:** T12 does not import from `score.js`. The dependency means T11 must be accepted before T12 begins, because `generate.js` reads the stack rank file that `score.js` produces. This is a sequencing dependency, not a code dependency.

---

## T01 — Scaffold + errors.js + logger.js + dateUtils.js + eventBroadcaster.js

**Dependencies:** None.

### Deliverables

**`package.json`** — scripts per Appendix A, dependencies per spec Section 17.

**`eslint.config.js`** — flat config, `eslint:recommended`, Node.js globals.

**`jest.config.js`** — per coverage strategy above.

**`.env.example`:**
```
DEEPSEEK_API_KEY=your_api_key_here
PIPELINE_PORT=3000
```

**`.gitignore`:**
```
.env
jobs/
archive/
resumes/
config/
node_modules/
server/bookmarklet.min.js
```

**`README.md`** — prerequisites, install steps, `.env` setup, daily workflow, cross-day `--date` usage, OneDrive sync warning.

**`src/lib/errors.js`:**
```javascript
'use strict';
class JobParseError extends Error {
  constructor(message, filename) {
    super(message);
    this.name = 'JobParseError';
    this.filename = filename;
  }
}
class DeepSeekResponseError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.name = 'DeepSeekResponseError';
    this.statusCode = statusCode;
  }
}
class ConfigMissingError extends Error {
  constructor(filename) {
    super(`Config file not found: ${filename}`);
    this.name = 'ConfigMissingError';
    this.filename = filename;
  }
}
module.exports = { JobParseError, DeepSeekResponseError, ConfigMissingError };
```

**`src/lib/logger.js`:**
```javascript
'use strict';
// timestamp(): "2026-05-30 14:32:01" — local time, seconds precision
const timestamp = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
const logger = {
  info:  (prefix, msg) => console.log(`${timestamp()} ${prefix} ${msg}`),
  error: (prefix, msg) => console.error(`${timestamp()} ${prefix} ERROR: ${msg}`),
  warn:  (prefix, msg) => console.warn(`${timestamp()} ${prefix} WARN: ${msg}`),
};
module.exports = logger;
```

No bare `console.log`, `console.error`, or `console.warn` anywhere else in the codebase.

**`src/lib/dateUtils.js`:**
```javascript
'use strict';
// Format Date as "YYYY-MM-DD" in LOCAL time.
// Use for all file path construction. Never use Date.toISOString() for paths
// — that gives UTC and will shift the date in negative-offset timezones.
function formatDateString(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
// Format Date as "YYYY-MM-DD HH:MM" in local time.
function formatDateTimeString(date) {
  const h = String(date.getHours()).padStart(2, '0');
  const mi = String(date.getMinutes()).padStart(2, '0');
  return `${formatDateString(date)} ${h}:${mi}`;
}
module.exports = { formatDateString, formatDateTimeString };
```

**`src/lib/eventBroadcaster.js`:**
```javascript
'use strict';
// Fire-and-forget POST to the pipeline event endpoint.
// NEVER throws — pipeline must not fail because dashboard is unavailable.
// Reads PIPELINE_PORT env var (default 3000) — must match server port.
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
module.exports = { broadcastEvent };
```

**`tests/unit/scaffold.test.js`** — tests for all four modules above.

### Acceptance Criteria

- [ ] `npm install` completes without errors
- [ ] `npm run lint` exits 0
- [ ] `npm test` exits 0, runs `scaffold.test.js`
- [ ] `jest.config.js` excludes `tests/fixtures/` and `tests/helpers/` from test discovery
- [ ] `.env` is not created — only `.env.example`
- [ ] `JobParseError` is instanceof Error, has `name === 'JobParseError'`, has `filename` property
- [ ] `DeepSeekResponseError` is instanceof Error, has `name`, `statusCode`
- [ ] `ConfigMissingError` message contains the filename passed to constructor
- [ ] `logger.info('[test]', 'msg')` output matches regex `^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} \[test\] msg$`
- [ ] `formatDateString(new Date(2026, 4, 30))` returns `'2026-05-30'` (month is 0-indexed)
- [ ] `formatDateString` does NOT use `toISOString()` internally (code review)
- [ ] `formatDateTimeString(new Date(2026, 4, 30, 14, 32))` returns `'2026-05-30 14:32'`
- [ ] `broadcastEvent('test', {})` resolves without throwing when no server is on port 3001
- [ ] `broadcastEvent` uses `process.env.PIPELINE_PORT` for the URL

### Test Requirements

```javascript
// tests/unit/scaffold.test.js
describe('JobParseError', () => {
  it('is instanceof Error')
  it('has name "JobParseError"')
  it('has filename property matching constructor argument')
  it('message is set correctly')
})
describe('DeepSeekResponseError', () => {
  it('is instanceof Error')
  it('has name "DeepSeekResponseError"')
  it('has statusCode property')
})
describe('ConfigMissingError', () => {
  it('is instanceof Error')
  it('message contains the filename')
  it('filename property equals constructor argument')
})
describe('logger', () => {
  it('info output matches YYYY-MM-DD HH:MM:SS format')
  it('info includes prefix and message')
})
describe('dateUtils', () => {
  it('formatDateString returns YYYY-MM-DD in local time')
  it('formatDateString handles month padding (January = 01)')
  it('formatDateString handles day padding (1st = 01)')
  it('formatDateTimeString returns YYYY-MM-DD HH:MM')
})
describe('eventBroadcaster', () => {
  it('resolves without throwing when no server is running')
  it('resolves without throwing on timeout')
  it('uses PIPELINE_PORT env var in URL', async () => {
    // set process.env.PIPELINE_PORT = '9999', call broadcastEvent,
    // verify the fetch attempt targeted port 9999 (via msw or URL inspection)
  })
})
```

---

## T02 — Test Fixtures

**Dependencies:** T01.

Create all files in `tests/fixtures/`. These are static data — no code. They are the contract that all model tests assert against. Do not modify fixtures to make tests pass — fix the model.

### Deliverables

**`tests/fixtures/sample_job_1.md`** — complete, parseable job file:
```markdown
# Senior Privacy Manager

## Metadata
- **Company:** Meridian Health Systems
- **Location:** Remote
- **Employment Type:** Full-time
- **Salary:** $160,000–$185,000
- **URL:** https://www.linkedin.com/jobs/view/3987654321
- **LinkedIn Job ID:** 3987654321
- **Harvested:** 2026-05-30 09:14

## Job Description

Meridian Health Systems is seeking a Senior Privacy Manager to lead our enterprise privacy program across 12 hospital sites and 40,000 staff. You will own HIPAA and CCPA compliance, manage a team of 3 privacy analysts, drive our data governance roadmap, and serve as the primary liaison to Legal and Compliance leadership. The ideal candidate brings 8+ years of privacy program experience, a strong grasp of US healthcare privacy law, and a track record of cross-functional program delivery at scale. CIPP/US or CIPM certification preferred. Experience with OneTrust or similar privacy management platforms required.
```

**`tests/fixtures/sample_job_2.md`** — different company, URL, no salary (tests null salary path):
```markdown
# AI Governance Analyst

## Metadata
- **Company:** Vantara Financial
- **Location:** New York, NY (Hybrid)
- **Employment Type:** Full-time
- **Salary:** Not specified
- **URL:** https://www.linkedin.com/jobs/view/1122334455
- **LinkedIn Job ID:** 1122334455
- **Harvested:** 2026-05-30 10:30

## Job Description

Vantara Financial is hiring an AI Governance Analyst to support our model risk management function. Responsibilities include reviewing AI model documentation, supporting regulatory submissions, and assisting with internal AI policy development. 3-5 years of experience in risk, compliance, or technology governance required.
```

**`tests/fixtures/sample_job_duplicate.md`** — identical URL to `sample_job_1.md`, earlier timestamp (should be skipped by deduplicator):
```markdown
# Senior Privacy Manager

## Metadata
- **Company:** Meridian Health Systems
- **Location:** Remote
- **Employment Type:** Full-time
- **Salary:** $160,000–$185,000
- **URL:** https://www.linkedin.com/jobs/view/3987654321
- **LinkedIn Job ID:** 3987654321
- **Harvested:** 2026-05-30 07:02

## Job Description

[same or similar job description text]
```

**`tests/fixtures/sample_job_fuzzy_duplicate.md`** — same company AND title as `sample_job_1.md`, different URL and Job ID (should trigger fuzzyWarning):
```markdown
# Senior Privacy Manager

## Metadata
- **Company:** Meridian Health Systems
- **Location:** Remote
- **Employment Type:** Full-time
- **Salary:** Not specified
- **URL:** https://www.linkedin.com/jobs/view/9998887776
- **LinkedIn Job ID:** 9998887776
- **Harvested:** 2026-05-30 11:45

## Job Description

[reposted or slightly different job description]
```

**`tests/fixtures/sample_career.md`** — trimmed career file (~400 words): professional summary + one full Meta achievement + one Audible achievement + education + certifications.

**`tests/fixtures/sample_pillar_library.md`** — Pillars 1 and 2 only, all variants (~200 words).

**`tests/fixtures/sample_deepseek_score_response.json`:**
```json
{
  "score": 7,
  "fit_signal": "Strong alignment on governance program leadership and enterprise compliance scope. Meta experience maps directly to the regulatory delivery requirements.",
  "gap": "No direct healthcare domain experience."
}
```

**`tests/fixtures/sample_deepseek_score_invalid.json`:**
```json
{
  "fit_signal": "Present",
  "gap": "Present"
}
```
(Missing `score` — triggers DeepSeekResponseError)

**`tests/fixtures/sample_deepseek_quality_response.json`:**
```json
{
  "resume_quality": 7,
  "cover_letter_quality": 6,
  "pillars_selected": ["Program Leadership", "Risk Governance"],
  "cover_letter_paras": 2,
  "quality_note": "Strong pillar selection. Cover letter P2 cut — no specific angle available from JD."
}
```

**`tests/fixtures/sample_deepseek_quality_invalid.json`:**
```json
{
  "resume_quality": 7
}
```
(Missing `cover_letter_quality`, `pillars_selected`, `cover_letter_paras`, `quality_note`)

**`tests/fixtures/sample_deepseek_resume_response.txt`** — structured resume with these exact section headers (tests assert against them):
```
# Adam Buteux, MBA, CISSP, CIPM
Portland, Oregon (open to relocation) | adam@adambuteux.com | 929-218-3981 | linkedin.com/in/adambuteux

## Summary
Senior governance and privacy professional with 15+ years driving compliance programs at scale.

## Professional Experience

### Meta | Senior Manager, Privacy & Risk Review | June 2022–November 2025
*Led enterprise AI risk review across Facebook, Instagram, and Messenger.*
- **Reduced regulatory response time by 40%.** Redesigned the DMA compliance workflow across 10 product teams, cutting average cycle from 21 to 12 days.

### Audible (Amazon) | Director, Privacy Operations | January 2019–May 2022
*Oversaw global privacy program for 35M+ subscriber platform.*
- **Achieved GDPR certification ahead of deadline.** Delivered data mapping and consent infrastructure 3 months early across 6 workstreams.

### PwC Advisory | Director, Risk, Cybersecurity, and Privacy | March 2015–December 2018
*Privacy and GRC engagements for Fortune 500 clients.*
- **Built privacy program from scratch for a $4B healthcare client.** HIPAA-compliant governance framework adopted across 12 business units.

## Independent Projects

### RiskHelper.ai | Co-Founder & Head of Product | December 2025–Present
AI governance SaaS; product strategy, compliance framework, go-to-market.

## Education
**Executive MBA** — Bayes Business School, London
**BSc Computer Science with Management** — King's College London

## Certifications
CISSP | CIPM
```

**`tests/fixtures/sample_deepseek_cover_letter_response.txt`:**
```
# Cover Letter — Meridian Health Systems | Senior Privacy Manager

Privacy program leadership at scale is where my background is strongest, and the scope of this role — standing up a governance function across a multi-site health system — maps directly to what I built at Meta and Audible.

At Meta, the harder part wasn't the compliance work itself. It was building the internal infrastructure to make 10 product teams capable of self-assessing risk before shipping. That is the same muscle this role needs.

I'd like to talk.
```

### Acceptance Criteria

- [ ] All 10 fixture files exist and are valid UTF-8
- [ ] `sample_job_1.md` and `sample_job_duplicate.md`: identical URLs, duplicate has earlier `Harvested:` timestamp
- [ ] `sample_job_1.md` and `sample_job_fuzzy_duplicate.md`: different URLs, same company and title
- [ ] `sample_job_2.md`: `Salary: Not specified` (tests null salary path)
- [ ] `sample_deepseek_score_response.json`: valid JSON, all 3 required fields present
- [ ] `sample_deepseek_score_invalid.json`: valid JSON, missing `score`
- [ ] `sample_deepseek_quality_response.json`: valid JSON, all 5 required fields present
- [ ] `sample_deepseek_quality_invalid.json`: valid JSON, missing 4 of 5 required fields
- [ ] `sample_deepseek_resume_response.txt`: contains headers `## Summary`, `## Professional Experience`, `## Independent Projects`, `## Education`, `## Certifications`
- [ ] `sample_deepseek_cover_letter_response.txt`: starts with `# Cover Letter —`
- [ ] `npm run lint` passes; `npm test` passes (fixtures not scanned as test files)

---

## T03 — `job.js` — JobFile Model

**Dependencies:** T02.

### The `JobFile` Type

```javascript
{
  title: string,
  company: string,
  location: string,          // "Not specified" when field absent or "Not specified"
  employmentType: string,    // "Not specified" when field absent or "Not specified"
  salary: string | null,     // null when field is "Not specified"
  url: string,               // LinkedIn URL, query params stripped
  linkedInJobId: string | null,  // numeric string e.g. "3987654321", or null
  harvested: Date,           // parsed from "YYYY-MM-DD HH:MM" in metadata
  description: string,       // full text after "## Job Description"
  filename: string,          // passed as parameter, not parsed from content
}
```

### Deliverables

**`src/models/job.js`** exports:

```javascript
// Parse a .md file string into a JobFile.
// Throws JobParseError(message, filename) when required fields are missing.
// Required fields: title (h1), ## Metadata section, URL field, ## Job Description section.
parseJobFile(markdown: string, filename: string): JobFile

// Sanitize a string for safe filesystem use.
// Rules: spaces→hyphens, remove [& ( ) / , ' " @ # $ % ^ * ! ? < > | \ : ;],
//        collapse consecutive hyphens to one, trim leading/trailing hyphens,
//        truncate to maxLength.
sanitizeForFilename(str: string, maxLength: number): string

// Format a JobFile back to canonical .md string (for round-trip testing).
formatJobFile(job: JobFile): string

// Extract LinkedIn numeric job ID from a URL.
// Matches pattern /jobs/view/([0-9]+)/ — returns numeric string or null.
extractLinkedInJobId(url: string): string | null
```

**`tests/unit/job.test.js`**

### Acceptance Criteria

- [ ] `parseJobFile(sample_job_1_content, 'sample_job_1.md')` returns `JobFile` with all fields correct
- [ ] `salary` is `null` when field is `"Not specified"` (tested with sample_job_2.md)
- [ ] `salary` is populated string when field has value
- [ ] `url` has query parameters stripped (test with URL containing `?trk=...`)
- [ ] `linkedInJobId` is `'3987654321'` for sample_job_1.md
- [ ] `linkedInJobId` is `null` when URL is not a LinkedIn jobs URL
- [ ] Throws `JobParseError` (with filename in `.filename` property) when `## Metadata` section missing
- [ ] Throws `JobParseError` when URL field missing or empty
- [ ] Throws `JobParseError` when `## Job Description` section missing
- [ ] `sanitizeForFilename('AT&T', 60)` returns `'ATT'`
- [ ] `sanitizeForFilename('Johnson & Johnson', 60)` returns `'Johnson-Johnson'`
- [ ] `sanitizeForFilename('Company (Inc.) / Division', 60)` returns `'Company-Inc-Division'`
- [ ] `sanitizeForFilename('A--B', 60)` returns `'A-B'` (consecutive hyphens collapsed)
- [ ] `sanitizeForFilename('-Leading', 60)` returns `'Leading'` (leading hyphen trimmed)
- [ ] `sanitizeForFilename` truncates at `maxLength`
- [ ] `extractLinkedInJobId('https://www.linkedin.com/jobs/view/3987654321/')` returns `'3987654321'`
- [ ] `extractLinkedInJobId('https://www.linkedin.com/jobs/view/3987654321')` returns `'3987654321'` (no trailing slash)
- [ ] `extractLinkedInJobId('https://example.com/job/123')` returns `null`
- [ ] Round-trip: `parseJobFile(formatJobFile(job), filename)` returns equivalent object
- [ ] `npm run lint` passes; `npm test` passes, all prior tests green; `job.js` coverage ≥ 90%

### Test Requirements

```javascript
// tests/unit/job.test.js
describe('parseJobFile', () => {
  it('parses sample_job_1.md correctly')
  it('sets salary to null when "Not specified"')
  it('populates salary when value is present')
  it('strips query parameters from URL')
  it('extracts linkedInJobId from URL')
  it('sets linkedInJobId to null for non-LinkedIn URLs')
  it('throws JobParseError with filename when Metadata section missing')
  it('throws JobParseError when URL field empty')
  it('throws JobParseError when Job Description section missing')
})
describe('sanitizeForFilename', () => {
  it('replaces spaces with hyphens')
  it('removes ampersands')
  it('removes parentheses and slashes')
  it('collapses consecutive hyphens')
  it('trims leading and trailing hyphens')
  it('truncates at maxLength')
  it('handles already-clean strings without modification')
})
describe('formatJobFile', () => {
  it('round-trips: parse → format → parse returns equivalent object')
})
describe('extractLinkedInJobId', () => {
  it('extracts numeric ID from standard LinkedIn jobs URL')
  it('handles URL without trailing slash')
  it('returns null for non-LinkedIn URL')
  it('returns null for LinkedIn URL without job ID pattern')
})
```

---

## T04 — `scoredJob.js` — ScoredJob Model

**Dependencies:** T03.

### The `ScoredJob` Type

```javascript
{
  // All JobFile fields spread in:
  title: string,
  company: string,
  location: string,
  employmentType: string,
  salary: string | null,
  url: string,
  linkedInJobId: string | null,
  harvested: Date,
  description: string,
  filename: string,
  // Plus scoring fields:
  score: number,            // integer 1-10
  fitSignal: string,        // 2-sentence fit summary
  gap: string,              // 1-sentence gap note
  rank: number | null,      // null until rankJobs() assigns it
  actionFlag: string | null // null until rankJobs() assigns it
                            // Values: 'DEEP_TAILOR' | 'AUTO_GENERATED' | 'NO_DOCS'
}
```

### Deliverables

**`src/models/scoredJob.js`** exports:

```javascript
// Parse raw DeepSeek scoring response string (JSON).
// Throws DeepSeekResponseError when: not valid JSON, score missing, score not integer 1-10,
// fitSignal missing, gap missing.
parseScoreResponse(rawResponse: string): { score: number, fitSignal: string, gap: string }

// Combine a JobFile and parsed score fields into a ScoredJob.
// rank and actionFlag are always null at creation — set by rankJobs() later.
createScoredJob(job: JobFile, scoreResult: { score, fitSignal, gap }): ScoredJob
```

**`tests/unit/scoredJob.test.js`**

### Acceptance Criteria

- [ ] `parseScoreResponse(JSON.stringify(sample_score_fixture))` returns `{ score: 7, fitSignal: '...', gap: '...' }`
- [ ] Throws `DeepSeekResponseError` when input is not valid JSON
- [ ] Throws `DeepSeekResponseError` when `score` field missing
- [ ] Throws `DeepSeekResponseError` when `score` is `0` (out of range)
- [ ] Throws `DeepSeekResponseError` when `score` is `11` (out of range)
- [ ] Throws `DeepSeekResponseError` when `score` is `7.5` (not integer)
- [ ] Throws `DeepSeekResponseError` when `fitSignal` missing
- [ ] Throws `DeepSeekResponseError` when `gap` missing
- [ ] `createScoredJob` spreads all JobFile fields into result
- [ ] `createScoredJob` sets `rank` to `null`
- [ ] `createScoredJob` sets `actionFlag` to `null`
- [ ] `createScoredJob` sets `score`, `fitSignal`, `gap` from `scoreResult`
- [ ] `npm run lint` passes; `npm test` passes, all prior green; `scoredJob.js` ≥ 90%

### Test Requirements

```javascript
// tests/unit/scoredJob.test.js
describe('parseScoreResponse', () => {
  it('parses valid fixture response')
  it('throws on non-JSON string')
  it('throws when score missing')
  it('throws when score is 0')
  it('throws when score is 11')
  it('throws when score is float (7.5)')
  it('throws when fitSignal missing')
  it('throws when gap missing')
})
describe('createScoredJob', () => {
  it('includes all JobFile fields in result')
  it('sets rank to null')
  it('sets actionFlag to null')
  it('sets score, fitSignal, gap from scoreResult')
})
```

---

## T05 — `stackRank.js` — StackRank Formatter and Parser

**Dependencies:** T04.

### Deliverables

**`src/models/stackRank.js`** exports:

```javascript
// Format an array of ranked ScoredJobs into the stack rank markdown string.
// fuzzyWarnings: array from deduplicateJobs() — rendered as ⚠️ blocks between relevant entries.
// date: Date object for the header.
// stats: { scoreMean, scoreMin, scoreMax, distribution } from score.js computation.
formatStackRank(
  rankedJobs: ScoredJob[],
  date: Date,
  fuzzyWarnings: { job1: JobFile, job2: JobFile, reason: string }[],
  stats: { scoreMean: number|null, scoreMin: number|null, scoreMax: number|null, distribution: object }
): string

// Parse a stack rank markdown file into minimal entries for generate.js.
// Returns only entries with actionFlag DEEP_TAILOR or AUTO_GENERATED.
parseStackRank(markdown: string): StackRankEntry[]
// StackRankEntry: { rank, score, actionFlag, company, title, url, linkedInJobId, sourceFilename }

// Format an ApplicationRecord + ScoredJob into the submission_record.md string.
// Called by generate.js — keeps submission record markdown logic out of the orchestrator.
formatSubmissionRecord(record: ApplicationRecord, scoredJob: ScoredJob): string
```

**Output format per job entry:**
```markdown
## [rank]. [[score]/10] [🔴 DEEP TAILOR / 🟡 AUTO-GENERATED / ⚪ NO DOCS] — [Company] | [Title]
**Source file:** [sourceFilename]
**LinkedIn Job ID:** [id or "Not available"]
**URL:** [url]
**Location:** [location] | **Employment Type:** [type] | **Salary:** [salary — omit line if null]
**Harvested:** [YYYY-MM-DD HH:MM]

**Fit:** [fitSignal]
**Gap:** [gap]

---
```

**Fuzzy warning block** (inserted between entries for affected jobs):
```markdown
⚠️ **Possible duplicate:** "[Company] — [Title]" appears at 2 different URLs. Verify before generating.
```

**Header:**
```markdown
# Stack Rank — YYYY-MM-DD
*Generated: YYYY-MM-DD HH:MM | Jobs scored: N | Documents to generate: M*
*Score stats: mean X.X | range Y–Z | distribution: 1-3: A | 4-5: B | 6-7: C | 8-10: D*
```

**`tests/unit/stackRank.test.js`**

### Acceptance Criteria

- [ ] `formatStackRank` renders correct rank numbers in descending score order
- [ ] Renders `🔴 DEEP TAILOR`, `🟡 AUTO-GENERATED`, `⚪ NO DOCS` correctly
- [ ] Includes `**Source file:**` field for every job
- [ ] Includes `**LinkedIn Job ID:**` field for every job
- [ ] Omits `**Salary:**` line when `job.salary` is null
- [ ] Header includes correct stats line (mean, range, distribution)
- [ ] Header includes correct document count (jobs with actionFlag ≠ NO_DOCS)
- [ ] Fuzzy warning block rendered when `fuzzyWarnings` is non-empty
- [ ] No fuzzy warning block when `fuzzyWarnings` is empty
- [ ] `parseStackRank` returns only DEEP_TAILOR and AUTO_GENERATED entries
- [ ] `parseStackRank` extracts `sourceFilename` and `linkedInJobId` per entry
- [ ] `parseStackRank` returns empty array when no qualifying jobs
- [ ] Round-trip: `parseStackRank(formatStackRank(...))` returns correct entries
- [ ] `formatStackRank` with empty `rankedJobs` returns valid header with zero counts
- [ ] `formatSubmissionRecord` output contains `# Submission Record —`, `## Pillars Selected`, `## Cover Letter Structure`, `## Quality Assessment`, `## Application Status`
- [ ] `formatSubmissionRecord` with null quality fields renders "—" placeholders not errors
- [ ] `npm run lint` passes; `npm test` passes, all prior green; `stackRank.js` ≥ 90%

### Test Requirements

```javascript
// tests/unit/stackRank.test.js
describe('formatStackRank', () => {
  it('renders descending rank order')
  it('renders correct action flags')
  it('includes Source file field')
  it('includes LinkedIn Job ID field')
  it('omits Salary line when salary is null')
  it('includes stats line in header')
  it('includes correct document count')
  it('renders fuzzy warning when fuzzyWarnings non-empty')
  it('no fuzzy warning when fuzzyWarnings empty')
  it('handles empty rankedJobs array')
})
describe('parseStackRank', () => {
  it('returns only DEEP_TAILOR and AUTO_GENERATED entries')
  it('extracts sourceFilename correctly')
  it('extracts linkedInJobId correctly')
  it('returns empty array when no qualifying jobs')
  it('round-trips with formatStackRank')
})
describe('formatSubmissionRecord', () => {
  it('contains all required section headers')
  it('renders null quality fields as placeholders not errors')
  it('includes company, title, score, fitSignal, gap')
})
```

---

## T05b — `applicationRecord.js` — ApplicationRecord Model

**Dependencies:** T04.

### The `ApplicationRecord` Type

```javascript
{
  id: string,                     // slug: "2026-05-30-Company-Title"
  company: string,
  title: string,
  url: string,
  linkedInJobId: string | null,
  score: number,
  actionFlag: string,             // 'DEEP_TAILOR' | 'AUTO_GENERATED' | 'NO_DOCS'
  resumeQuality: number | null,   // null until quality call completes
  coverLetterQuality: number | null,
  qualityNote: string | null,
  pillarsSelected: string[],      // populated from quality call
  coverLetterParas: number | null,
  outputPath: string,             // "resumes/YYYY-MM-DD/Company - Title/"
  dateGenerated: string,          // "YYYY-MM-DD"
  dateApplied: string | null,
  applicationMethod: string | null,
  status: string,                 // see VALID_STATUSES
  notes: string,                  // empty string by default
}
```

### Deliverables

**`src/models/applicationRecord.js`** exports:

```javascript
// Valid status values — exported for use by apply.js and tests
const VALID_STATUSES = ['generated', 'applied', 'interviewing', 'rejected', 'offer', 'withdrawn'];

// Create a new ApplicationRecord from a ScoredJob at generation time.
// Quality fields start as null — generate.js populates them after the quality call.
// outputPath: the sanitized directory path string.
// dateStr: "YYYY-MM-DD" string from formatDateString.
createApplicationRecord(scoredJob: ScoredJob, outputPath: string, dateStr: string): ApplicationRecord

// Validate a status string. Returns true if it is in VALID_STATUSES.
isValidStatus(status: string): boolean

// Generate the record id slug from date, company, title.
// Uses sanitizeForFilename internally. Example: "2026-05-30-Anthropic-AI-Policy-Lead"
generateRecordId(dateStr: string, company: string, title: string): string
```

**`tests/unit/applicationRecord.test.js`**

### Acceptance Criteria

- [ ] `createApplicationRecord` produces `ApplicationRecord` with `status: 'generated'`
- [ ] `createApplicationRecord` sets all quality fields to `null`
- [ ] `createApplicationRecord` sets `pillarsSelected` to `[]`
- [ ] `createApplicationRecord` sets `notes` to `''`
- [ ] `createApplicationRecord` sets `dateApplied` to `null`, `applicationMethod` to `null`
- [ ] `generateRecordId` uses `sanitizeForFilename` — handles special characters
- [ ] `generateRecordId('2026-05-30', 'AT&T', 'Senior Engineer')` returns `'2026-05-30-ATT-Senior-Engineer'`
- [ ] `isValidStatus` returns `true` for all 6 valid statuses
- [ ] `isValidStatus` returns `false` for `''`, `'pending'`, `'unknown'`
- [ ] `npm run lint` passes; `npm test` passes, all prior green; `applicationRecord.js` ≥ 90%

### Test Requirements

```javascript
// tests/unit/applicationRecord.test.js
describe('createApplicationRecord', () => {
  it('sets status to generated')
  it('sets all quality fields to null')
  it('sets pillarsSelected to empty array')
  it('sets notes to empty string')
  it('sets dateApplied and applicationMethod to null')
  it('sets dateGenerated from dateStr')
})
describe('generateRecordId', () => {
  it('produces correct slug for clean input')
  it('sanitizes special characters in company')
  it('sanitizes special characters in title')
})
describe('isValidStatus', () => {
  it('returns true for all 6 valid statuses')
  it('returns false for empty string')
  it('returns false for unknown status string')
})
```

---

## T06 — `fileStore.js` — Filesystem Adapter

**Dependencies:** T03, T05b.

**Rule:** `fs.promises` only throughout. No `fs.readFileSync`, `fs.writeFileSync`, or callback-style `fs.readFile`. No `tmp` package — use `fs.promises.mkdtemp(path.join(os.tmpdir(), 'job-pipeline-test-'))` in tests.

### Deliverables

**`src/lib/fileStore.js`** exports all of the following:

```javascript
// Read all .md files from jobsDir.
// Returns [] for empty directory or missing directory.
// Ignores non-.md files.
readJobFiles(jobsDir: string): Promise<{ filename: string, content: string }[]>

// Write a job .md file to jobsDir.
// If filename already exists, appends -2, then -3, etc.
// Returns the actual filename written.
writeJobFile(jobsDir: string, filename: string, content: string): Promise<string>

// Write stack rank markdown to resumes/[dateStr]/stack_rank_[dateStr].md.
// Creates the dated subdirectory if it does not exist.
// Returns the full path written.
writeStackRank(resumesDir: string, dateStr: string, content: string): Promise<string>

// Read stack rank file for a given date string.
// Throws a descriptive Error if not found (message includes the path tried).
readStackRank(resumesDir: string, dateStr: string): Promise<string>

// Read a config file by filename from configDir.
// Throws ConfigMissingError(filename) if not found.
readConfig(configDir: string, filename: string): Promise<string>

// Write resume.md and cover_letter.md to resumes/[dateStr]/[sanitized company] - [sanitized title]/.
// Calls sanitizeForFilename internally on company and title before path construction.
// Returns false without writing if the output directory already exists.
// Returns true after writing both files.
writeApplicationDocs(
  resumesDir: string,
  dateStr: string,
  company: string,
  title: string,
  resume: string,
  coverLetter: string
): Promise<boolean>

// Write submission_record.md to an output directory.
writeSubmissionRecord(outputDir: string, content: string): Promise<void>

// Read applications.json from rootDir.
// Returns [] if file does not exist (do not throw — handle gracefully).
readApplications(rootDir: string): Promise<ApplicationRecord[]>

// Write full ApplicationRecord array to applications.json in rootDir.
// Overwrites the file — callers read first, modify, then write.
writeApplications(rootDir: string, records: ApplicationRecord[]): Promise<void>

// Move all .md files from jobsDir to archiveDir/[dateStr]/.
// Creates archive subdirectory if needed.
// Returns count of files moved.
archiveJobFiles(jobsDir: string, archiveDir: string, dateStr: string): Promise<number>
```

**Note:** `writeStackRank` and `readStackRank` use `dateStr` string (not `Date` objects) — consistent with the rest of the pipeline's approach to date handling.

**`tests/integration/fileStore.test.js`**

Test setup pattern:
```javascript
const os = require('os');
const path = require('path');
const { promises: fs } = require('fs');

let tmpDir;
beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'job-pipeline-test-'));
});
afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});
```

### Acceptance Criteria

- [ ] All functions use `fs.promises` — no sync variants (code review)
- [ ] `readJobFiles` returns correct content for each `.md` file
- [ ] `readJobFiles` returns `[]` for empty directory
- [ ] `readJobFiles` ignores `.txt` and other non-`.md` files
- [ ] `writeJobFile` writes file and returns filename
- [ ] `writeJobFile` appends `-2` when name collides
- [ ] `writeJobFile` appends `-3` when `-2` also exists
- [ ] `writeStackRank` creates dated subdirectory if absent
- [ ] `readStackRank` then `writeStackRank` round-trips
- [ ] `readStackRank` throws descriptive error including the path when file not found
- [ ] `readConfig` reads existing file correctly
- [ ] `readConfig` throws `ConfigMissingError` with filename in message
- [ ] `writeApplicationDocs` returns `true` and writes both files on first call
- [ ] `writeApplicationDocs` returns `false` without overwriting when dir exists
- [ ] `writeApplicationDocs` sanitizes `company='AT&T'` → folder named `ATT - ...`
- [ ] `writeSubmissionRecord` writes file to correct path
- [ ] `readApplications` returns `[]` when file does not exist
- [ ] `writeApplications` → `readApplications` round-trips correctly
- [ ] `archiveJobFiles` moves all `.md` files, returns correct count
- [ ] `archiveJobFiles` leaves source directory empty (but present)
- [ ] Test setup uses `fs.mkdtemp` — no `tmp` package import (code review)
- [ ] `npm run lint` passes; `npm test` passes, all prior green; `fileStore.js` ≥ 85%

### Test Requirements

```javascript
// tests/integration/fileStore.test.js
describe('readJobFiles', () => {
  it('reads all .md files')
  it('returns [] for empty directory')
  it('ignores non-.md files')
})
describe('writeJobFile', () => {
  it('writes new file')
  it('appends -2 on collision')
  it('appends -3 when -2 also exists')
})
describe('writeStackRank / readStackRank', () => {
  it('round-trips correctly')
  it('throws descriptive error including path when not found')
})
describe('readConfig', () => {
  it('reads existing config file')
  it('throws ConfigMissingError with filename')
})
describe('writeApplicationDocs', () => {
  it('creates directory and writes both files, returns true')
  it('returns false without overwriting when directory exists')
  it('sanitizes company with special characters in path')
})
describe('writeSubmissionRecord', () => {
  it('writes file to specified output directory')
})
describe('readApplications / writeApplications', () => {
  it('returns [] when file does not exist')
  it('round-trips correctly')
})
describe('archiveJobFiles', () => {
  it('moves all .md files to archive directory')
  it('returns correct count')
  it('leaves source directory empty but present')
})
```

---

## T07 — `deduplicator.js` — URL + Fuzzy Deduplication

**Dependencies:** T03.

### Deliverables

**`src/lib/deduplicator.js`** exports:

```javascript
// Two-pass deduplication of a JobFile array.
//
// Pass 1 (URL): exact URL match → keep most recently harvested (by harvested Date),
//   skip the older one. Skipped entries go to `duplicates`.
//
// Pass 2 (Fuzzy): scan `unique` array after Pass 1 for pairs where
//   sanitizeForFilename(job1.company) === sanitizeForFilename(job2.company)
//   AND sanitizeForFilename(job1.title) === sanitizeForFilename(job2.title)
//   AND job1.url !== job2.url.
//   These are warnings only — both remain in `unique`.
//
// Does not mutate the input array.
deduplicateJobs(jobs: JobFile[]): {
  unique: JobFile[],
  duplicates: { kept: JobFile, skipped: JobFile }[],
  fuzzyWarnings: { job1: JobFile, job2: JobFile, reason: string }[]
}
```

**`tests/unit/deduplicator.test.js`**

### Acceptance Criteria

- [ ] No duplicates → all in `unique`, both arrays empty
- [ ] Two jobs with identical URLs → `unique` has newer, `duplicates` has both with correct labels
- [ ] `unique.length === input.length - duplicates.length`
- [ ] Three jobs: two share URL (keep newer), third unique → 2 in unique, 1 in duplicates
- [ ] Two jobs: same company+title, different URLs → both in `unique`, one entry in `fuzzyWarnings`
- [ ] Exact URL duplicates are NOT also in `fuzzyWarnings`
- [ ] `fuzzyWarnings` is `[]` when no fuzzy matches
- [ ] Four-job set: one URL pair + one fuzzy pair → correct handling of both
- [ ] Input array is not mutated
- [ ] Empty input → `{ unique: [], duplicates: [], fuzzyWarnings: [] }`
- [ ] Single-item input → `{ unique: [item], duplicates: [], fuzzyWarnings: [] }`
- [ ] `npm run lint` passes; `npm test` passes, all prior green; `deduplicator.js` ≥ 95%

### Test Requirements

```javascript
// tests/unit/deduplicator.test.js
describe('URL deduplication (Pass 1)', () => {
  it('returns all when no duplicates')
  it('keeps most recently harvested on URL collision')
  it('reports skipped duplicate in duplicates array')
  it('handles three jobs with two sharing a URL')
  it('does not mutate input array')
  it('handles empty array')
  it('handles single-item array')
})
describe('fuzzy duplicate detection (Pass 2)', () => {
  it('flags matching company+title different URLs as fuzzyWarning')
  it('does not flag URL duplicates as fuzzyWarnings')
  it('returns empty fuzzyWarnings when no matches')
  it('handles set with both URL and fuzzy duplicates')
})
```

---

## T08 — `ranker.js` — Stack Ranking

**Dependencies:** T04.

### Action Flag Logic

```
Sort all ScoredJobs descending by score.
Assign dense rank 1..N (tied scores get equal rank).

Rank 1-4               → actionFlag = 'DEEP_TAILOR'  (regardless of score)
Rank 5+, score >= 6    → actionFlag = 'AUTO_GENERATED'
Rank 5+, score < 6     → actionFlag = 'NO_DOCS'

Edge cases:
  Fewer than 4 jobs    → all get 'DEEP_TAILOR'
  Tie straddling 4/5   → all tied jobs get 'DEEP_TAILOR'
```

### Deliverables

**`src/lib/ranker.js`** exports:

```javascript
// Returns a new array with rank and actionFlag populated.
// Does not mutate the input array.
rankJobs(jobs: ScoredJob[]): ScoredJob[]
```

**`tests/unit/ranker.test.js`**

### Acceptance Criteria

- [ ] 10 jobs with distinct scores: ranks 1-4 = DEEP_TAILOR; rank 5+ per score threshold
- [ ] Rank 5, score 6 → AUTO_GENERATED
- [ ] Rank 5, score 5 → NO_DOCS
- [ ] 3 total jobs → all DEEP_TAILOR
- [ ] 4 total jobs → all DEEP_TAILOR
- [ ] Tie at score boundary for rank 4/5 → both tied jobs get DEEP_TAILOR
- [ ] Input array not mutated
- [ ] Output sorted descending by score
- [ ] Empty array → empty array
- [ ] Single job → DEEP_TAILOR with rank 1
- [ ] `npm run lint` passes; `npm test` passes, all prior green; `ranker.js` ≥ 95%

### Test Requirements

```javascript
// tests/unit/ranker.test.js
describe('rankJobs', () => {
  it('assigns ranks in descending score order')
  it('assigns DEEP_TAILOR to top 4')
  it('assigns AUTO_GENERATED to rank 5+ score >= 6')
  it('assigns NO_DOCS to rank 5+ score < 6')
  it('assigns DEEP_TAILOR to all when fewer than 4 jobs')
  it('assigns DEEP_TAILOR to all when exactly 4 jobs')
  it('tie at rank 4/5 boundary — both get DEEP_TAILOR')
  it('does not mutate input array')
  it('handles empty array')
  it('handles single-item array')
})
```

---

## T09 — `promptBuilder.js` — Prompt Assembly

**Dependencies:** T03, T04.

### Deliverables

**`src/lib/promptBuilder.js`** exports:

```javascript
// Build user-side message for DeepSeek scoring call.
// System prompt comes from config/scoring_prompt.md and is passed through unchanged.
buildScoringPrompt(careerContents: string, jobFile: JobFile): string

// Build user-side message for DeepSeek resume generation call.
buildResumePrompt(careerContents: string, pillarContents: string, scoredJob: ScoredJob): string

// Build user-side message for DeepSeek cover letter generation call.
// resumeContent is the already-generated resume markdown string.
buildCoverLetterPrompt(careerContents: string, scoredJob: ScoredJob, resumeContent: string): string

// Build user-side message for DeepSeek quality rating call.
// resumeContent and coverLetterContent are the generated documents.
buildQualityPrompt(scoredJob: ScoredJob, resumeContent: string, coverLetterContent: string): string
```

**Section label conventions (required for parser reliability):**

`buildScoringPrompt` must include labels `CANDIDATE PROFILE:` and `JOB DESCRIPTION:` as section headers in the user message.

**`tests/unit/promptBuilder.test.js`**

### Acceptance Criteria

- [ ] `buildScoringPrompt` output contains full career contents
- [ ] `buildScoringPrompt` output contains full job description
- [ ] `buildScoringPrompt` output contains `CANDIDATE PROFILE:` label
- [ ] `buildScoringPrompt` output contains `JOB DESCRIPTION:` label
- [ ] `buildResumePrompt` output contains career, pillar library, job description, fitSignal, gap
- [ ] `buildCoverLetterPrompt` output contains career, job description, resume content
- [ ] `buildQualityPrompt` output contains job description, resume content, cover letter content
- [ ] No function truncates its inputs
- [ ] All functions return non-empty strings (never `undefined` or `null`)
- [ ] `npm run lint` passes; `npm test` passes, all prior green; `promptBuilder.js` ≥ 90%

### Test Requirements

```javascript
// tests/unit/promptBuilder.test.js
describe('buildScoringPrompt', () => {
  it('includes full career contents without truncation')
  it('includes full job description without truncation')
  it('includes CANDIDATE PROFILE: label')
  it('includes JOB DESCRIPTION: label')
  it('returns non-empty string')
})
describe('buildResumePrompt', () => {
  it('includes career, pillar library, job description')
  it('includes fitSignal and gap from scoredJob')
  it('returns non-empty string')
})
describe('buildCoverLetterPrompt', () => {
  it('includes career, job description, resume content')
  it('returns non-empty string')
})
describe('buildQualityPrompt', () => {
  it('includes job description, resume, cover letter content')
  it('returns non-empty string')
})
```

---

## T10 — `deepseek.js` — DeepSeek API Adapter

**Dependencies:** T04.

Uses Node.js v24 native `fetch`. No `axios`. No `nock` in tests — use `msw`.

### Deliverables

**`src/lib/deepseek.js`** exports:

```javascript
// Call DeepSeek chat completions API.
// options: { maxTokens: number, timeoutMs?: number }  — timeoutMs defaults to 30000
// Returns raw response content string from choices[0].message.content.
// Throws ConfigMissingError when process.env.DEEPSEEK_API_KEY is not set.
// Throws DeepSeekResponseError on non-200 status, timeout, or network failure.
// NEVER includes the API key in thrown error messages.
callDeepSeek(systemPrompt: string, userPrompt: string, options: object): Promise<string>
```

Implementation details:
- URL: `https://api.deepseek.com/v1/chat/completions`
- Model: `'deepseek-chat'` (hardcoded — do not make configurable)
- Auth: `Authorization: Bearer ${process.env.DEEPSEEK_API_KEY}`
- Timeout: `AbortSignal.timeout(options.timeoutMs ?? 30000)`
- No retry logic — callers handle retries if needed

**msw setup for tests:**
```javascript
const { setupServer } = require('msw/node');
const { http, HttpResponse } = require('msw');

const server = setupServer(
  http.post('https://api.deepseek.com/v1/chat/completions', () => {
    return HttpResponse.json({
      choices: [{ message: { content: 'mocked response content' } }]
    });
  })
);
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
```

**`tests/integration/deepseek.test.js`**

### Acceptance Criteria

- [ ] Returns content string from mocked 200 response
- [ ] Throws `DeepSeekResponseError` on 401, message includes "unauthorized" (case-insensitive)
- [ ] Throws `DeepSeekResponseError` on 429, message includes "rate limit" (case-insensitive)
- [ ] Throws `DeepSeekResponseError` on 500
- [ ] Throws `DeepSeekResponseError` on request timeout
- [ ] Throws `ConfigMissingError` when `DEEPSEEK_API_KEY` env var is not set or empty
- [ ] Error messages never include the API key value (verify with a known test key value)
- [ ] Uses native `fetch` — no `axios` import (code review)
- [ ] `npm run lint` passes; `npm test` passes, all prior green; `deepseek.js` ≥ 85%

### Test Requirements

```javascript
// tests/integration/deepseek.test.js (msw)
describe('callDeepSeek', () => {
  it('returns content string on 200')
  it('throws DeepSeekResponseError on 401')
  it('throws DeepSeekResponseError on 429')
  it('throws DeepSeekResponseError on 500')
  it('throws DeepSeekResponseError on timeout')
  it('throws ConfigMissingError when API key not set')
  it('does not expose API key in error messages')
})
```

---

## T11 — `score.js` — Scoring Orchestrator

**Dependencies:** T05, T06, T07, T08, T09, T10.

**Note:** T05 is a dependency because `score.js` calls `formatStackRank(rankedJobs, date, fuzzyWarnings, stats)`.

### Deliverables

**`score.js`** — orchestration only. No business logic. Every transformation delegates to `src/`.

```
require('dotenv').config()                    // MUST be first line

1.  Parse --date via util.parseArgs
    dateStr = values.date ?? formatDateString(new Date())

2.  Validate config: ['scoring_prompt.md', 'adam_buteux_career.md']
    → exit(1), list ALL missing, if any

3.  readJobFiles(JOBS_DIR)
    → exit(0) '[score] No job files found in jobs/ — nothing to score.' if empty

4.  For each file: parseJobFile(content, filename)
    → on JobParseError: logger.warn, continue

5.  deduplicateJobs(parsedJobs) → { unique, duplicates, fuzzyWarnings }
    → for each duplicate: logger.warn
    → for each fuzzyWarning: logger.warn

6.  broadcastEvent('scoring_started', { total: unique.length, date: dateStr })

7.  SEQUENTIAL loop (no Promise.all — ENFORCED):
    For each job in unique:
      a. buildScoringPrompt(careerContents, job)
      b. callDeepSeek(systemPrompt, userPrompt, { maxTokens: 300 })
         → on error: logger.error, broadcastEvent('job_skipped', ...), continue
      c. parseScoreResponse(rawResponse)
         → on error: logger.error, broadcastEvent('job_skipped', ...), continue
      d. createScoredJob(job, scoreResult)
      e. broadcastEvent('job_scored', {
           rank: null,       // rank assigned after loop
           score, company, title, actionFlag: null,
           fitSignal, gap, sourceFilename: job.filename,
           salary: job.salary, location: job.location,
           url: job.url, linkedInJobId: job.linkedInJobId
         })
      f. logger.info('[score]', `${i}/${total}: ${company} — ${title} (est. ${eta}s remaining)`)

8.  rankJobs(scoredJobs) → rankedJobs

9.  Compute stats:
      scoreMean = average of all scores (1 decimal place)
      scoreMin, scoreMax
      distribution: count jobs in bands 1-3, 4-5, 6-7, 8-10

10. formatStackRank(rankedJobs, new Date(), fuzzyWarnings, stats)

11. writeStackRank(RESUMES_DIR, dateStr, stackRankContent)

12. broadcastEvent('scoring_complete', { scored: rankedJobs.length,
      scoreMean, scoreMin, scoreMax, distribution })

13. logger.info('[score]', `Done. ${n} jobs scored → resumes/${dateStr}/stack_rank_${dateStr}.md`)
```

**Child process env injection for e2e tests:**
```javascript
execSync('node score.js', {
  cwd: projectRoot,
  env: {
    ...process.env,
    DEEPSEEK_API_KEY: 'test-key',
    PIPELINE_PORT: '3001',
    NODE_OPTIONS: '--require ./tests/helpers/msw-setup.js'
  },
  encoding: 'utf8'
});
```

**`tests/e2e/score.test.js`**

### Acceptance Criteria

- [ ] `require('dotenv').config()` is first line (code review)
- [ ] `formatDateString(new Date())` used for default date — not `new Date().toISOString()`
- [ ] `--date=YYYY-MM-DD` flag overrides date for output file path
- [ ] Produces correct `stack_rank_[dateStr].md` from fixture jobs
- [ ] Stack rank header includes stats line
- [ ] Skips URL duplicate (older timestamp) with `logger.warn`
- [ ] Fuzzy duplicate warning appears in stack rank when applicable
- [ ] Skips malformed file with `logger.warn`, continues
- [ ] Exit 1 listing all missing configs when config files absent
- [ ] Exit 0 with message when `jobs/` empty
- [ ] No `Promise.all` on DeepSeek calls (code review — grep for `Promise.all`)
- [ ] Progress logged per job with ETA
- [ ] `npm run lint` passes; `npm test` passes, all prior green

### Test Requirements

```javascript
// tests/e2e/score.test.js
describe('score.js', () => {
  it('produces stack rank from fixture jobs')
  it('stack rank contains stats line')
  it('skips URL duplicate and logs warning')
  it('fuzzy duplicate warning in stack rank when applicable')
  it('skips malformed file and continues')
  it('exits 1 listing missing configs')
  it('exits 0 with message when jobs/ empty')
  it('respects --date flag')
  it('logs progress per job')
})
```

---

## T12 — `generate.js` — Generation Orchestrator

**Dependencies:** T05, T05b, T06, T09, T10.

**Sequencing note:** T11 must be accepted before T12 begins because `generate.js` reads the stack rank file that `score.js` produces. This is a workflow sequencing dependency — `generate.js` does NOT import from `score.js`.

### Deliverables

**`generate.js`** — orchestration only.

```
require('dotenv').config()                    // MUST be first line

1.  Parse --date via util.parseArgs
    dateStr = values.date ?? formatDateString(new Date())

2.  Validate config: ['resume_prompt.md', 'cover_letter_prompt.md',
                      'adam_buteux_career.md', 'pillar_library.md', 'quality_prompt.md']
    → exit(1) listing all missing

3.  readStackRank(RESUMES_DIR, dateStr)
    → exit(1) 'No stack rank for [dateStr]. Run: node score.js --date=[dateStr]' if not found

4.  parseStackRank(stackRankContent) → qualifying jobs (DEEP_TAILOR + AUTO_GENERATED)

5.  READ applications.json ONCE before loop:
    existingRecords = await fileStore.readApplications(ROOT_DIR)

6.  READ job files ONCE before loop — build lookup Map:
    allJobFiles = await fileStore.readJobFiles(JOBS_DIR)
    jobFileMap = new Map(allJobFiles.map(f => [f.filename, f.content]))

7.  newRecords = []   ← accumulate during loop

8.  broadcastEvent('generation_started', { total: qualifying.length })

9.  SEQUENTIAL loop (no Promise.all):
    For each qualifyingJob:
      a. content = jobFileMap.get(qualifyingJob.sourceFilename)
         → if not found: logger.warn '...cleanup may have run. Skipping.', broadcastEvent('doc_skipped', ...), continue
      b. outputDir = writeApplicationDocs would create — skip if already exists (idempotent)
         → logger.info 'Skipping [company] — output already exists'
      c. callDeepSeek(resumeSystemPrompt, buildResumePrompt(...), { maxTokens: 2000, timeoutMs: 60000 })
         → on error: logger.error, broadcastEvent('doc_skipped', ...), continue
      d. callDeepSeek(clSystemPrompt, buildCoverLetterPrompt(...), { maxTokens: 800, timeoutMs: 60000 })
         → on error: logger.error (resume written, CL failed), coverLetterContent = null, continue to quality
      e. callDeepSeek(qualitySystemPrompt, buildQualityPrompt(...), { maxTokens: 200, timeoutMs: 30000 })
         → on error: logger.warn, qualityResult = null
      f. writeApplicationDocs(RESUMES_DIR, dateStr, company, title, resumeContent, coverLetterContent ?? '')
      g. record = createApplicationRecord(scoredJob, outputPath, dateStr)
         Populate quality fields from qualityResult (or leave null if null)
      h. writeSubmissionRecord(outputDir, formatSubmissionRecord(record, scoredJob))
      i. newRecords.push(record)
      j. broadcastEvent('doc_generated', {
           company, title, sourceFilename: qualifyingJob.sourceFilename,
           resumeQuality: record.resumeQuality,
           coverLetterQuality: record.coverLetterQuality,
           qualityNote: record.qualityNote,
           pillarsSelected: record.pillarsSelected,
           coverLetterParas: record.coverLetterParas
         })
      k. If resumeQuality < 6 OR coverLetterQuality < 6:
           logger.warn '[generate]', '⚠️ Low quality: [company] — [title]'
      l. logger.info '[generate]', `${i}/${total}: ${company} — ${title} (est. ${eta}s remaining)`

10. WRITE applications.json ONCE after loop:
    await fileStore.writeApplications(ROOT_DIR, [...existingRecords, ...newRecords])

11. broadcastEvent('generation_complete', { generated: newRecords.length })

12. logger.info '[generate]', `Done. ${n} packages written to resumes/${dateStr}/`
```

**`tests/e2e/generate.test.js`**

### Acceptance Criteria

- [ ] `require('dotenv').config()` is first line (code review)
- [ ] `--date` flag used for all lookups
- [ ] Generates `resume.md` + `cover_letter.md` + `submission_record.md` for each 6+ job
- [ ] No output for `NO_DOCS` jobs
- [ ] Idempotent — re-run skips existing output directories
- [ ] Source file not found after cleanup → skip + log, continue
- [ ] Exit 1 with helpful message when stack rank not found
- [ ] Exit 1 listing all missing configs
- [ ] Quality call failure → null quality fields, does not block resume+CL write
- [ ] `applications.json` read once before loop, written once after (code review — no readApplications/writeApplications inside loop)
- [ ] Job files read once before loop into a Map — no readJobFiles inside loop (code review)
- [ ] `applications.json` contains one entry per generated package
- [ ] `doc_generated` event includes `sourceFilename`
- [ ] Output directory uses sanitized company+title
- [ ] Sequential only — no `Promise.all` (code review)
- [ ] `npm run lint` passes; `npm test` passes, all prior green

### Test Requirements

```javascript
// tests/e2e/generate.test.js
describe('generate.js', () => {
  it('generates resume.md, cover_letter.md, submission_record.md for qualifying jobs')
  it('produces no output for NO_DOCS jobs')
  it('is idempotent — skips existing output directories')
  it('handles missing source file gracefully')
  it('exits 1 with date hint when stack rank not found')
  it('exits 1 listing all missing configs')
  it('quality call failure does not block resume/CL write')
  it('applications.json written once after loop (not per job)')
  it('each entry in applications.json has correct fields')
  it('doc_generated event includes sourceFilename')
  it('respects --date flag')
})
```

---

## T13 — `cleanup.js` — Archive Orchestrator

**Dependencies:** T06.

### Deliverables

**`cleanup.js`:**
```
require('dotenv').config()

1. readJobFiles(JOBS_DIR) to check if any .md files exist
   → if empty: logger.info '[cleanup]', 'jobs/ is already empty — nothing to archive.'
               exit(0)

2. dateStr = formatDateString(new Date())

3. archiveJobFiles(JOBS_DIR, ARCHIVE_DIR, dateStr)
   → creates ARCHIVE_DIR/[dateStr]/ if needed (appends if exists — never fails on second run)

4. logger.info '[cleanup]', `Archived ${count} files to archive/${dateStr}/`
```

**`tests/e2e/cleanup.test.js`**

### Acceptance Criteria

- [ ] `require('dotenv').config()` is first line
- [ ] `formatDateString` used for date — not `toISOString()`
- [ ] All `.md` files moved to `archive/[dateStr]/`
- [ ] `jobs/` directory exists but is empty after run
- [ ] Non-`.md` files not moved
- [ ] Exit 0 with message when `jobs/` already empty
- [ ] Second run same day appends to existing archive, does not fail
- [ ] `npm run lint` passes; `npm test` passes

### Test Requirements

```javascript
// tests/e2e/cleanup.test.js
describe('cleanup.js', () => {
  it('moves all .md files to archive')
  it('leaves jobs/ empty but present')
  it('handles empty jobs/ gracefully with exit 0')
  it('appends to existing archive directory on second run')
  it('does not move non-.md files')
})
```

---

## T14 — `server/server.js` — Server + SSE + State

**Dependencies:** T06.

### Deliverables

**`server/server.js`** exports `createApp(jobsDir)` factory and starts server when run directly.

**All endpoints:**

`POST /harvest` — validates body (required: `title`, `company`, `description`, `url`; optional: `location`, `employmentType`, `salary`, `linkedInJobId`), checks URL against in-memory Set, writes file, adds URL to Set, broadcasts `job_harvested` event. Response per spec Section 7.8.

`GET /health` — returns `{ status: 'ok' }` with 200.

`GET /dashboard` — serves `server/dashboard.html` with `Content-Type: text/html`.

`GET /events` — SSE stream. Set headers, write current state as first event, add to clients array, remove on close.

`POST /event` — parse body, update state per event type (spec Section 7.4), broadcast to all clients.

`GET /state` — return `JSON.stringify(state)` with `Content-Type: application/json`.

**In-memory state** (shape per spec Section 7.3).

**On startup:**
1. Read `applications.json` via `fileStore.readApplications` (returns `[]` if not found)
2. Populate `state.applicationHistory` with last 10 entries
3. Read all `.md` files in `jobs/`, parse URLs into `harvestedUrls = new Set<string>()`

**Port:** `parseInt(process.env.PIPELINE_PORT || '3000', 10)`

**CORS:** `Access-Control-Allow-Origin: *` on all responses.

**Integration testing pattern:**
```javascript
const { createApp } = require('../../server/server');
const app = createApp(tmpJobsDir);
const httpServer = app.listen(0);
await new Promise(r => httpServer.once('listening', r));
const port = httpServer.address().port;
const base = `http://localhost:${port}`;
afterAll(() => httpServer.close());
```

**`tests/integration/server.test.js`**

### Acceptance Criteria

- [ ] `server.js` exports `createApp(jobsDir)`
- [ ] `POST /harvest` returns 200 and writes file for valid body
- [ ] Written file passes `parseJobFile` without error
- [ ] `POST /harvest` returns 409 for duplicate URL (checked against in-memory Set)
- [ ] `POST /harvest` returns 400 listing all missing required fields
- [ ] `GET /health` returns 200 `{ status: 'ok' }`
- [ ] `GET /dashboard` returns 200 with `text/html` content type
- [ ] `GET /events` returns `text/event-stream` content type
- [ ] `GET /events` sends current state as first event
- [ ] `POST /event` with `scoring_started` updates `state.phase` to `'scoring'`
- [ ] `POST /event` with `job_scored` appends to `state.scored`
- [ ] `GET /state` returns current state as JSON
- [ ] SSE client disconnect handled cleanly — no crash
- [ ] In-memory URL cache populated from existing `jobs/` files on startup
- [ ] `Access-Control-Allow-Origin: *` on all responses
- [ ] Filename collision appends `-2` suffix
- [ ] `npm run lint` passes; `npm test` passes, all prior green; `server.js` ≥ 85%

### Test Requirements

```javascript
// tests/integration/server.test.js
describe('POST /harvest', () => {
  it('returns 200 and writes valid file')
  it('written file passes parseJobFile')
  it('returns 409 for duplicate URL')
  it('returns 400 listing all missing required fields')
  it('appends -2 on same-day name collision')
  it('includes CORS header')
})
describe('GET /health', () => {
  it('returns 200 with status ok')
})
describe('GET /dashboard', () => {
  it('returns 200 with text/html')
})
describe('GET /events', () => {
  it('returns text/event-stream')
  it('sends current state as first event')
})
describe('POST /event', () => {
  it('updates state.phase on scoring_started')
  it('appends to state.scored on job_scored')
})
describe('GET /state', () => {
  it('returns state as JSON')
  it('reflects events since startup')
})
describe('startup', () => {
  it('URL cache detects duplicates from existing jobs/ files')
})
```

---

## T14.5 — `server/dashboard.html` — Real-Time Dashboard UI

**Dependencies:** T14.

**What to build:** Single HTML file. Inline CSS and JS. No external dependencies. No CDN resources. No build step. Served by `GET /dashboard`.

### Required HTML element IDs (for automated testing)

- `#header-phase` — current phase text
- `#header-date` — current date
- `#count-harvested`, `#count-scored`, `#count-generated` — live counters
- `#score-distribution` — distribution chart container
- `#stack-rank-table` — table element or container
- `#app-history` — application history panel
- `#activity-log` — scrolling event log

### Sections

**Header bar:** phase indicator, date, harvested/scored/generated counts. Updates on every relevant event.

**Score distribution:** CSS horizontal bars (no JS library). Bands: 1-3, 4-5, 6, 7-8, 9-10. Updates per `job_scored`. Mean and range shown after `scoring_complete`.

**Stack rank table:** Columns: Rank | Score | Flag | Company | Title | Location | Salary | Fit | Gap | R★ | CL★ | Links. Rows added per `job_scored`. R★/CL★ populated per `doc_generated` — matched by `sourceFilename` field (not company+title). Quality < 6 → amber cell with ⚠️. Flag column: red/amber/grey background per flag value. Links (JD, Resume, CL) shown only after generation.

**Application history:** Loaded from `GET /state` on page load. Counts by status. Last 10 entries with company, title, status, date.

**Activity log:** Fixed-height scrolling div. All SSE events appended as timestamped lines. Color coded: harvested=blue, scored=green, generated=purple, skipped/warned=amber, error=red. Auto-scrolls to bottom.

### Real-time connection

```javascript
async function init() {
  try {
    const res = await fetch('/state');
    populateFromState(await res.json());
  } catch {
    showBanner('Server not running — start with: node server/server.js');
    return;
  }
  const evtSource = new EventSource('/events');
  evtSource.onmessage = e => handleEvent(JSON.parse(e.data));
  evtSource.onerror  = () => showBanner('Connection lost — reload to reconnect.');
}
document.addEventListener('DOMContentLoaded', init);
```

### Design constraints

- Dark background (`#1a1a2e`), light text
- Monospace font for activity log
- No external fonts, CDN, or resources
- Chrome/Edge on Windows

### Manual acceptance test (required before T14.5 accepted)

- [ ] Run `score.js` with server running — confirm table builds row by row
- [ ] Run `generate.js` — confirm R★/CL★ columns populate in correct rows
- [ ] Refresh page mid-run — confirm state restored from `/state`
- [ ] Stop server — confirm banner displayed
- [ ] Document test result: date, browser, outcome

### Automated test

```javascript
// tests/integration/dashboard.test.js
describe('GET /dashboard', () => {
  it('returns 200 with text/html content type')
  it('HTML contains required element IDs: score-distribution, stack-rank-table, activity-log')
})
```

---

## T15 — `server/bookmarklet.js` — Browser Bookmarklet

**Dependencies:** T14.

### Deliverables

**`server/bookmarklet.js`** — human-readable source. Exports `buildPostBody(document)` for unit testing.

**`server/bookmarklet.min.js`** — generated by `npm run build:bookmarklet`.

**`scripts/minify-bookmarklet.js`** — wraps source in IIFE, minifies with `terser`, prepends `javascript:`.

### DOM selectors (try in order, use first with non-empty result)

| Field | Selectors |
|---|---|
| Title | `h1.job-details-jobs-unified-top-card__job-title`, `h1.topcard__title` |
| Company | `a.job-details-jobs-unified-top-card__company-name`, `a.topcard__org-name-link` |
| Location | `div.job-details-jobs-unified-top-card__tertiary-description`, `span.topcard__flavor--bullet` |
| Employment type | Text scan of `li.description__job-criteria-item` for "Employment type" label |
| Salary | `div.salary`, `span.compensation__salary` (empty string if absent) |
| Description | `div.jobs-description__content`, `div.description__text` |
| URL | `new URL(window.location.href).origin + pathname` |
| LinkedIn Job ID | Extract from URL via `/jobs/view/([0-9]+)/` regex |

### POST body shape

```javascript
{
  title: string,
  company: string,
  location: string,        // or empty string
  employmentType: string,  // or empty string
  salary: string,          // or empty string
  url: string,
  linkedInJobId: string | null,
  description: string
}
```

### Feedback

- 200 success: green toast 3s `"Saved: [Company] — [Job Title]"`
- 409 duplicate: yellow toast 3s `"Already saved: [Company] — [Job Title]"`
- Failure: `alert("Harvest failed — is the server running? Start with: node server/server.js")`

### Known limitation

jsdom tests use a static HTML fixture — they do not test against LinkedIn's live React-rendered DOM. Selectors may break when LinkedIn updates class names.

### Manual acceptance test (required before T15 accepted)

- [ ] Click bookmarklet on a live LinkedIn job page
- [ ] Green toast with correct company and title
- [ ] `.md` file written to `jobs/` with all fields populated
- [ ] `parseJobFile` succeeds on the written file
- [ ] Dashboard updates in real time showing the harvested job
- [ ] Document: LinkedIn job URL tested, date, outcome

### Acceptance Criteria

- [ ] `buildPostBody` extracts title from primary selector, falls back to secondary
- [ ] Extracts company, location, description
- [ ] Returns empty string for salary when absent
- [ ] Strips query params from URL
- [ ] Includes `linkedInJobId` field (null for non-LinkedIn URLs)
- [ ] Returns correctly shaped POST body
- [ ] `npm run build:bookmarklet` produces `bookmarklet.min.js` starting with `javascript:`
- [ ] `npm run lint` passes; `npm test` passes

### Test Requirements

```javascript
// tests/unit/bookmarklet.test.js (jsdom)
describe('buildPostBody', () => {
  it('extracts title from primary selector')
  it('falls back to secondary title selector')
  it('extracts company name')
  it('extracts location')
  it('extracts employment type from criteria list')
  it('extracts salary when present')
  it('returns empty string for salary when absent')
  it('strips query parameters from URL')
  it('extracts linkedInJobId from LinkedIn URL')
  it('sets linkedInJobId to null for non-LinkedIn URL')
  it('returns correct POST body shape')
})
```

---

## T16 — End-to-End Pipeline Test

**Dependencies:** T11, T12, T13, T14, T14.5, T15.

### Deliverables

**`tests/e2e/pipeline.test.js`** — full pipeline with tmp dirs, msw-mocked DeepSeek, and SSE event verification.

**`tests/helpers/msw-setup.js`** — shared msw Node.js server setup used by T10, T11, T12, T16.

### Same-day pipeline acceptance criteria

- [ ] POST two jobs to server → two valid `.md` files in `jobs/`
- [ ] `score.js` → `stack_rank_[today].md` with both jobs ranked and stats line
- [ ] Fuzzy duplicate warning in stack rank when fixture includes matching company+title
- [ ] `generate.js` → `resume.md`, `cover_letter.md`, `submission_record.md` for qualifying jobs
- [ ] No output for `NO_DOCS` jobs
- [ ] `applications.json` contains one entry per generated package with correct fields
- [ ] `doc_generated` SSE events received by test SSE client, each including `sourceFilename`
- [ ] `generate.js` is idempotent — second run skips existing dirs
- [ ] `cleanup.js` → `jobs/` empty, files in `archive/[today]/`
- [ ] All scripts exit 0 under normal conditions

### Cross-day scenario acceptance criteria

- [ ] `score.js --date=2026-05-28` writes to `resumes/2026-05-28/`
- [ ] `generate.js --date=2026-05-28` reads and uses `resumes/2026-05-28/stack_rank_2026-05-28.md`
- [ ] Output written to `resumes/2026-05-28/` not today's folder
- [ ] `generate.js` without `--date` (different calendar day) exits 1 with helpful date hint

### Quality gates

- [ ] `npm run lint` passes
- [ ] `npm test` passes — all task test suites green
- [ ] Global coverage ≥ 80% (first time global threshold is enforced)

### Test Requirements

```javascript
// tests/e2e/pipeline.test.js
describe('Same-day pipeline', () => {
  it('server writes valid job files from POST requests')
  it('score.js produces stack rank with stats')
  it('fuzzy duplicate warning in stack rank when applicable')
  it('generate.js produces docs for qualifying jobs')
  it('submission_record.md exists in each output folder')
  it('applications.json populated correctly')
  it('doc_generated events include sourceFilename')
  it('generate.js is idempotent')
  it('cleanup.js archives all job files')
  it('all scripts exit 0')
})
describe('Cross-day scenario', () => {
  it('score.js --date writes to correct folder')
  it('generate.js --date uses correct stack rank')
  it('output goes to --date folder')
  it('generate.js without --date exits 1 with date hint')
})
```

---

## T17 — `apply.js` — Application Status Tracker

**Dependencies:** T05b, T06.

### Deliverables

**`apply.js`** — exports `processUpdate` pure function for testing. Readline layer calls it.

```javascript
// Pure function — testable without readline.
// records: ApplicationRecord[] — the full current array
// updatePayload: {
//   index: number,           // 0-based index in the filtered display list
//   status: string,
//   method?: string,         // required when status === 'applied'
//   notes?: string
// }
// Returns new records array (does not mutate input).
// Throws Error if index out of range or status invalid.
processUpdate(records: ApplicationRecord[], updatePayload: object): ApplicationRecord[]
```

**Flow:**
```
require('dotenv').config()

1.  Parse --all via util.parseArgs
2.  existingRecords = await fileStore.readApplications(ROOT_DIR)
3.  displayList = --all ? existingRecords : existingRecords.filter(r => r.status === 'generated')
4.  if displayList empty: logger.info '[apply]', 'No entries to display.' + exit(0)
5.  Display: '[N] Company — Title | Score: X/10 | Generated: YYYY-MM-DD | Status: current'
6.  readline loop:
    prompt 'Enter number (1-N) to update, or q to quit: '
    → 'q': exit(0)
    → invalid number: re-prompt
    → valid: prompt 'New status (applied/interviewing/rejected/offer/withdrawn): '
      → invalid: re-prompt
      → 'applied': prompt 'Method (LinkedIn Easy Apply / company portal / email / referral): '
      → prompt 'Notes (Enter to skip): '
      → processUpdate(existingRecords, { index, status, method, notes })
      → fileStore.writeApplications(ROOT_DIR, updatedRecords)
      → existingRecords = updatedRecords  (update for next iteration)
      → logger.info '[apply]', `Updated: ${company} — ${title} → ${status}`
      → re-display updated list, loop
```

**`tests/integration/apply.test.js`**

### Acceptance Criteria

- [ ] `processUpdate` returns new array without mutating input
- [ ] `processUpdate` updates the correct record by index
- [ ] `processUpdate` sets `dateApplied` when status is `'applied'`
- [ ] `processUpdate` throws when index out of range
- [ ] `processUpdate` throws when status invalid
- [ ] `--all` flag shows all entries; default shows only `status === 'generated'`
- [ ] Empty display list exits 0 with message
- [ ] `applications.json` written after each update
- [ ] `applications.json` not found → `[]`, creates file on first write
- [ ] `require('dotenv').config()` is first line
- [ ] `npm run lint` passes; `npm test` passes

### Test Requirements

```javascript
// tests/integration/apply.test.js
// Uses tmp dir with pre-populated applications.json fixture
describe('processUpdate', () => {
  it('returns new array without mutating input')
  it('updates correct record by index')
  it('sets dateApplied when status is applied')
  it('throws on out-of-range index')
  it('throws on invalid status')
})
describe('apply.js integration', () => {
  it('reads applications.json and filters to generated entries by default')
  it('shows all entries with --all flag')
  it('writes updated applications.json after processUpdate')
  it('creates applications.json when not found')
  it('exits 0 when display list is empty')
})
```

---

## Appendix A — `package.json` Scripts

```json
{
  "scripts": {
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
}
```

---

## Appendix B — Dependency Graph

```
T01 (errors + logger + dateUtils + eventBroadcaster)
 └── T02 (10 fixtures — fully specified, static data)
      └── T03 (job.js — JobFile + sanitize + extractLinkedInJobId)
           ├── T06 (fileStore — fs.promises, sanitizes paths, depends on T05b for type)
           │    ├── T11 (score.js — depends on T05 for formatStackRank)
           │    ├── T12 (generate.js — sequencing after T11, not code import)
           │    ├── T13 (cleanup.js)
           │    ├── T14 (server.js — createApp factory, SSE, state)
           │    │    └── T14.5 (dashboard.html — manual test required)
           │    │         └── T15 (bookmarklet — manual test required)
           │    └── T17 (apply.js — exports processUpdate pure fn)
           ├── T07 (deduplicator — URL + fuzzy, returns fuzzyWarnings)
           │    └── T11
           └── T04 (scoredJob.js)
                ├── T05 (stackRank.js — formatStackRank takes fuzzyWarnings param)
                │    └── T11
                ├── T05b (applicationRecord.js)
                │    ├── T06 (for ApplicationRecord type in readApplications)
                │    ├── T12
                │    └── T17
                ├── T08 (ranker.js)
                │    └── T11
                ├── T09 (promptBuilder.js — 4 functions incl. buildQualityPrompt)
                │    ├── T11
                │    └── T12
                └── T10 (deepseek.js — msw in tests, never nock)
                     ├── T11
                     └── T12
                                   ↓
                         T16 (full pipeline e2e + cross-day + global 80%)
```

---

## Appendix C — Handoff Note for Claude Code

Read all of these before writing a single line of code. They are not suggestions.

1. **Build in task order.** T03 green before T04. T05b before T06. T05 before T11. No exceptions.
2. **`npm test` after every task.** All prior tests must remain green before starting the next task.
3. **Never silently patch a completed module** to make a later task's tests pass. Raise the conflict explicitly.
4. **Fixtures are the contract.** If a model's output doesn't match a fixture, fix the model — not the fixture.
5. **`config/` files are never created by the agent.** Check for their existence and error clearly if missing.
6. **No logic in orchestrators.** `score.js`, `generate.js`, `cleanup.js`, `apply.js` are wiring. All logic lives in `src/`.
7. **No `Promise.all` on DeepSeek calls.** Sequential always. Rate limits are real. Grep for `Promise.all` before accepting any orchestrator task.
8. **`fs.promises` only in `fileStore.js`.** No sync variants, no callbacks anywhere.
9. **No `console.log` outside `logger.js`.** Grep for bare `console.` before accepting.
10. **`require('dotenv').config()` is the first line** of every CLI script and `server.js`. Check before accepting.
11. **`util.parseArgs` for all CLI flags.** No `minimist`, no `yargs`, no manual `process.argv` slicing.
12. **`msw` not `nock`.** nock does not intercept native `fetch`. Using nock will produce tests that appear to pass while making real API calls.
13. **No `tmp` package.** Use `fs.promises.mkdtemp(path.join(os.tmpdir(), 'job-pipeline-test-'))`.
14. **`server.js` must export `createApp(jobsDir)`.** Required for integration testing. Without it, the server cannot be tested without binding a real port.
15. **`eventBroadcaster` must never throw.** Pipeline cannot fail because the dashboard is unavailable.
16. **`values.date` string used as-is for file paths.** Never pass through `new Date()` — timezone shift risk in negative-offset timezones.
17. **`formatDateString(new Date())` for default date construction.** From `src/lib/dateUtils.js`. Never `new Date().toISOString().slice(0, 10)` — that gives UTC.
18. **`applications.json` read once before generate loop, written once after.** Not inside the loop.
19. **`doc_generated` event includes `sourceFilename`.** Dashboard matches quality scores to rows by `sourceFilename`, not by company+title strings.
20. **`apply.js` exports `processUpdate(records, payload)`.** This pure function is what the tests drive. The readline layer is untested — only `processUpdate` needs test coverage.
21. **T14.5 and T15 both require manual tests.** Document the result in the acceptance checklist before marking complete.
22. **PIPELINE_PORT env var controls server port.** Tests use port 3001 to avoid conflicts with any running server instance.
23. **In `generate.js`, read job files once before the loop into a `Map`.** `readJobFiles` inside the loop means N filesystem scans for N jobs. Build the Map before the loop, look up by `sourceFilename` inside it.
