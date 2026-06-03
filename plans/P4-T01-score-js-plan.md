# Plan: P4-T01 — `score.js` Scoring Orchestrator + E2E Tests

## Overview

Create [`score.js`](score.js) (root-level CLI orchestrator) and [`tests/e2e/score.test.js`](tests/e2e/score.test.js) (child-process E2E test suite). `score.js` is a pure wiring layer — zero business logic, zero data transformations. Every operation delegates to existing modules in `src/lib/` and `src/models/`.

---

## Part A: `score.js` — Implementation Plan

### File Location
[`score.js`](score.js) at project root.

### Execution Flow (13 steps)

```
require('dotenv').config()                        // STEP 0 — mandatory first line

const { parseArgs } = require('util');            // STEP 1 — CLI parsing
const path = require('path');

1.  dateStr = values.date ?? formatDateString(new Date())
    // Use raw values.date string directly — never new Date(values.date)

2.  CONFIG_DIR = path.join(__dirname, 'config')
    JOBS_DIR    = path.join(__dirname, 'jobs')
    RESUMES_DIR = path.join(__dirname, 'resumes')

3.  Validate config files exist:
    - readConfig(CONFIG_DIR, 'scoring_prompt.md')
    - readConfig(CONFIG_DIR, 'adam_buteux_career.md')
    → catch ConfigMissingError → accumulate missing filenames
    → if any missing: logger.error each, exit(1)

4.  Read career file content for later prompt building:
    careerContents = await readConfig(CONFIG_DIR, 'adam_buteux_career.md')

5.  allFiles = await readJobFiles(JOBS_DIR)
    → if empty: logger.info '[score] No job files found in jobs/ — nothing to score.' ; exit(0)

6.  Parse each file — try/catch JobParseError:
    for each { filename, content }:
      try:
        job = parseJobFile(content, filename)
        parsedJobs.push(job)
      catch (err):
        if err instanceof JobParseError → logger.warn '[score]', `Skipping ${filename}: ${err.message}`
        else → throw

7.  Deduplicate:
    { unique, duplicates, fuzzyWarnings } = deduplicateJobs(parsedJobs)
    for each duplicate: logger.warn '[score]', `Duplicate: ${skipped.company} — ${skipped.title} ...`
    for each fuzzyWarning: logger.warn '[score]', `Fuzzy: ${reason}`

8.  broadcastEvent('scoring_started', { total: unique.length, date: dateStr })

9.  SEQUENTIAL loop — NO Promise.all (ENFORCED):
    scoredJobs = []
    for (i = 0; i < unique.length; i++):
      a. job = unique[i]
      b. userPrompt = buildScoringPrompt(careerContents, job)
      c. try: rawResponse = await callDeepSeek(systemPrompt, userPrompt, { maxTokens: 300 })
         catch:
           logger.error '[score]', `DeepSeek error for ${job.filename}: ${err.message}`
           broadcastEvent('job_skipped', { filename: job.filename, reason: err.message })
           continue
      d. try: scoreResult = parseScoreResponse(rawResponse)
         catch:
           logger.error '[score]', `Parse error for ${job.filename}: ${err.message}`
           broadcastEvent('job_skipped', { filename: job.filename, reason: err.message })
           continue
      e. scoredJob = createScoredJob(job, scoreResult)
      f. scoredJobs.push(scoredJob)
      g. broadcastEvent('job_scored', {
           rank: null, score: scoredJob.score, company: scoredJob.company,
           title: scoredJob.title, actionFlag: null, fitSignal: scoredJob.fitSignal,
           gap: scoredJob.gap, sourceFilename: scoredJob.filename,
           salary: scoredJob.salary, location: scoredJob.location,
           url: scoredJob.url, linkedInJobId: scoredJob.linkedInJobId
         })
      h. remaining = unique.length - (i + 1)
         avgSecsPerJob = ... (running average)
         eta = Math.round(avgSecsPerJob * remaining)
         logger.info '[score]', `${i+1}/${unique.length}: ${job.company} — ${job.title} (est. ${eta}s remaining)`

10. rankedJobs = rankJobs(scoredJobs)

11. Compute stats:
    scores = rankedJobs.map(j => j.score)
    scoreMean = parseFloat((scores.reduce((a,b)=>a+b,0) / scores.length).toFixed(1))
    scoreMin = Math.min(...scores)
    scoreMax = Math.max(...scores)
    distribution = {
      '1-3':  scores.filter(s => s >= 1 && s <= 3).length,
      '4-5':  scores.filter(s => s >= 4 && s <= 5).length,
      '6-7':  scores.filter(s => s >= 6 && s <= 7).length,
      '8-10': scores.filter(s => s >= 8 && s <= 10).length,
    }

12. stackRankContent = formatStackRank(rankedJobs, new Date(), fuzzyWarnings, stats)

13. writtenPath = await writeStackRank(RESUMES_DIR, dateStr, stackRankContent)

14. broadcastEvent('scoring_complete', {
      scored: rankedJobs.length, scoreMean, scoreMin, scoreMax, distribution
    })

15. logger.info '[score]', `Done. ${rankedJobs.length} jobs scored → resumes/${dateStr}/stack_rank_${dateStr}.md`
```

### Key Constraints
- `require('dotenv').config()` is the literal first line — verified via code review
- All DeepSeek calls are awaited sequentially in a `for` loop — NO `Promise.all` (grep: `grep -n "Promise.all" score.js`)
- Event broadcasts via `broadcastEvent` are fire-and-forget — never `await` them
- System prompt for scoring comes from `config/scoring_prompt.md` — read via `readConfig`
- Career content comes from `config/adam_buteux_career.md`
- The raw `values.date` string from `--date` is used as-is for file paths — never `new Date(values.date)`
- Default date via `formatDateString(new Date())` — never `toISOString()`
- No bare `console.*` calls — use `logger` only
- Config files are never created by this script — only verified for existence

---

## Part B: E2E Test Suite — `tests/e2e/score.test.js`

### File Location
[`tests/e2e/score.test.js`](tests/e2e/score.test.js) at project root tests directory.

### Architecture
- Uses `execSync` from `child_process` to spawn `score.js` as a child process
- Injects environment via `env` parameter (NOT `NODE_OPTIONS` globally)
- Uses `fs.promises.mkdtemp` for temp directories (NOT `tmp` package)
- Copies fixture files into temp `jobs/` directory
- Creates temp `config/` with required config files
- Asserts stdout/stderr output and written stack rank file

### Test Cases

| # | Test | Description |
|---|------|-------------|
| 1 | **produces stack rank from fixture jobs** | Copy sample_job_1.md and sample_job_2.md into temp jobs/. Run score.js. Assert stack_rank file is created with both entries. |
| 2 | **stack rank contains stats line** | Same setup. Assert header includes `*Score stats: mean ... \| range ... \| distribution: ...*` |
| 3 | **skips URL duplicate and logs warning** | Add sample_job_duplicate.md (same URL as sample_job_1.md, earlier timestamp). Assert only 1 entry for that URL. Assert stderr contains WARN with duplicate message. |
| 4 | **fuzzy duplicate warning in stack rank** | Add sample_job_fuzzy_duplicate.md (same company+title, different URL). Assert stack rank contains `⚠️ Possible duplicate:` block. |
| 5 | **skips malformed file and continues** | Create a malformed .md file (missing title). Assert WARN log. Assert remaining valid jobs still scored. |
| 6 | **exits 1 listing missing configs** | Remove config files. Assert exit code 1. Assert stderr includes missing filenames. |
| 7 | **exits 0 with message when jobs/ empty** | Empty jobs/ directory. Assert exit code 0. Assert stdout includes "No job files found" message. |
| 8 | **respects --date flag** | Run with `--date=2026-05-29`. Assert stack_rank_2026-05-29.md is created. |
| 9 | **logs progress per job** | Assert stdout contains progress lines like "1/2: ... (est. ...s remaining)" |

### Test Setup Pattern
```javascript
'use strict';
const { execSync } = require('child_process');
const path = require('path');
const { promises: fs } = require('fs');
const os = require('os');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const FIXTURES_DIR = path.resolve(__dirname, '../fixtures');

let tmpDir;
beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'score-e2e-'));
});
afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

function runScore(extraEnv = {}) {
  return execSync('node score.js', {
    cwd: tmpDir,
    env: {
      ...process.env,
      DEEPSEEK_API_KEY: 'test-key',
      PIPELINE_PORT: '3001',
      NODE_OPTIONS: '--require ' + path.join(PROJECT_ROOT, 'tests/helpers/msw-setup.js'),
      ...extraEnv,
    },
    encoding: 'utf8',
  });
}
```

### Config Fixtures
Tests need minimal valid config files in temp `config/`:
- `config/scoring_prompt.md` — minimal scoring prompt text
- `config/adam_buteux_career.md` — minimal career profile text

These are created inline in the test (short strings) — not copied from the real config/ to avoid touching human-authored files.

---

## Dependency Graph

```
score.js imports:
  - src/lib/errors.js         → JobParseError, DeepSeekResponseError, ConfigMissingError
  - src/lib/logger.js         → logger.info, .error, .warn
  - src/lib/dateUtils.js      → formatDateString
  - src/lib/eventBroadcaster.js → broadcastEvent
  - src/lib/fileStore.js      → readJobFiles, readConfig, writeStackRank
  - src/lib/deepseek.js       → callDeepSeek
  - src/lib/deduplicator.js   → deduplicateJobs
  - src/lib/ranker.js         → rankJobs
  - src/lib/promptBuilder.js  → buildScoringPrompt
  - src/models/job.js         → parseJobFile
  - src/models/scoredJob.js   → parseScoreResponse, createScoredJob
  - src/models/stackRank.js   → formatStackRank
```

All these modules already exist and are passing tests.
