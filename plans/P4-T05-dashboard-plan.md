# P4-T05 — `dashboard.html` Real-Time Dashboard UI — Plan

## Overview

Implement a single-file, self-contained HTML dashboard (`server/dashboard.html`) and its
automated integration test (`tests/integration/dashboard.test.js`). The dashboard connects to
the existing Express server's SSE endpoint (`GET /events`) and state API (`GET /state`),
rendering live pipeline progress with zero external dependencies.

---

## Architecture

### Data Flow

```
┌─────────────────────────────────────────────────────────────┐
│  Browser (dashboard.html)                                    │
│                                                              │
│  DOMContentLoaded → fetch('/state') ──► populateFromState()  │
│                    → new EventSource('/events')               │
│                         │                                    │
│                         ▼                                    │
│                   handleEvent(parsed)                        │
│                         │                                    │
│           ┌─────────────┼─────────────┬──────────────┐       │
│           ▼             ▼             ▼              ▼       │
│     updateHeader  updateDist   updateTable   updateActivity  │
│     (phase/date/  (bar chart)  (stack rank)  (log entry)    │
│      counts)                                                 │
│                                                              │
│  On doc_generated: matchRowBySourceFilename() → update R★CL★│
│                                                              │
│  On fetch failure: showBanner('Server not running...')       │
│  On SSE error: showBanner('Connection lost...')              │
└─────────────────────────────────────────────────────────────┘
```

### State Shape (from server.js)

```javascript
{
  date: "2026-06-02" | null,
  phase: "idle" | "scoring" | "generating",
  harvested: [{ company, title, filename, url }],
  scored: [{ rank, score, company, title, actionFlag, fitSignal, gap,
             sourceFilename, salary, location, url, linkedInJobId }],
  generated: [{ company, title, sourceFilename, resumeQuality,
                coverLetterQuality, qualityNote, pillarsSelected,
                coverLetterParas }],
  stats: { total, scoreMean, scoreMin, scoreMax,
           distribution: { "1-3": N, "4-5": N, "6-7": N, "8-10": N } },
  applicationHistory: [last 10 ApplicationRecord entries]
}
```

### SSE Event Shapes (received via EventSource)

| Event type | Key fields handled |
|---|---|
| `state` | Full state snapshot (sent on connect) |
| `job_harvested` | `company, title, filename, url` |
| `scoring_started` | `total, date` |
| `job_scored` | `rank, score, company, title, actionFlag, fitSignal, gap, sourceFilename, salary, location, url, linkedInJobId` |
| `scoring_complete` | `scored, scoreMean, scoreMin, scoreMax, distribution` |
| `generation_started` | `total` |
| `doc_generated` | `company, title, sourceFilename, resumeQuality, coverLetterQuality, qualityNote, pillarsSelected, coverLetterParas` |
| `generation_complete` | `generated` |

---

## File: `server/dashboard.html`

### HTML Structure

```
<body>
  <!-- Disconnect banner (hidden by default) -->
  <div id="disconnect-banner"></div>

  <!-- Header bar -->
  <header id="header-bar">
    <span id="header-phase">Pipeline Dashboard</span>
    <span id="header-date"></span>
    <span class="counts">
      <span>Harvested: <span id="count-harvested">0</span></span>
      <span>Scored: <span id="count-scored">0</span></span>
      <span>Generated: <span id="count-generated">0</span></span>
    </span>
  </header>

  <!-- Score distribution panel -->
  <section id="score-distribution">
    <h3>Score Distribution</h3>
    <div class="bars-container">
      <div class="bar-row" data-band="1-3">  <span class="bar-label">1-3</span>  <div class="bar" style="width:0%"></div>  <span class="bar-count">0</span>  </div>
      <div class="bar-row" data-band="4-5">  <span class="bar-label">4-5</span>  <div class="bar" style="width:0%"></div>  <span class="bar-count">0</span>  </div>
      <div class="bar-row" data-band="6">    <span class="bar-label">6</span>    <div class="bar" style="width:0%"></div>  <span class="bar-count">0</span>  </div>
      <div class="bar-row" data-band="7-8">  <span class="bar-label">7-8</span>  <div class="bar" style="width:0%"></div>  <span class="bar-count">0</span>  </div>
      <div class="bar-row" data-band="9-10"> <span class="bar-label">9-10</span> <div class="bar" style="width:0%"></div>  <span class="bar-count">0</span>  </div>
    </div>
    <div id="score-stats" class="stats-line" style="display:none"></div>
  </section>

  <!-- Stack rank table -->
  <section id="stack-rank-table">
    <h3>Stack Rank</h3>
    <table>
      <thead>
        <tr>
          <th>Rank</th> <th>Score</th> <th>Flag</th> <th>Company</th>
          <th>Title</th> <th>Location</th> <th>Salary</th>
          <th>Fit</th> <th>Gap</th>
          <th>R★</th> <th>CL★</th> <th>Links</th>
        </tr>
      </thead>
      <tbody id="rank-tbody"></tbody>
    </table>
  </section>

  <!-- Application history -->
  <section id="app-history">
    <h3>Application History</h3>
    <div id="app-history-content"></div>
  </section>

  <!-- Activity log -->
  <section id="activity-log">
    <h3>Activity Log</h3>
    <div id="log-entries"></div>
  </section>
</body>
```

### CSS Design Tokens

| Token | Value | Usage |
|-------|-------|-------|
| `--bg-primary` | `#1a1a2e` | Page background |
| `--bg-secondary` | `#16213e` | Card/panel backgrounds |
| `--bg-tertiary` | `#0f3460` | Table header, bar backgrounds |
| `--text-primary` | `#e0e0e0` | Body text |
| `--text-muted` | `#8892b0` | Secondary text |
| `--accent-blue` | `#4fc3f7` | Harvested events, links |
| `--accent-green` | `#66bb6a` | Scored events, bars |
| `--accent-purple` | `#ab47bc` | Generated events |
| `--accent-amber` | `#ffa726` | Warnings, quality < 6 |
| `--accent-red` | `#ef5350` | Errors, NO_DOCS flag |
| `--flag-grey` | `#616161` | NO_DOCS flag background |
| `--flag-amber` | `#f57c00` | AUTO_GENERATED flag background |
| `--flag-red` | `#c62828` | DEEP_TAILOR flag background |

### JavaScript Functions

#### `init()`
- `fetch('/state')` → `populateFromState(json)`
- On catch → `showBanner('Server not running — start with: node server/server.js')` and return
- `new EventSource('/events')` → `onmessage = e => handleEvent(JSON.parse(e.data))`
- `onerror = () => showBanner('Connection lost — reload to reconnect.')`

#### `populateFromState(state)`
- `updateHeader(state.phase, state.date)`
- `updateCounts(state.harvested.length, state.scored.length, state.generated.length)`
- For each `s` in `state.scored`: `addTableRow(s)`
- For each `g` in `state.generated`: `updateQualityCell(g.sourceFilename, g)`
- `updateDistribution(state.stats.distribution)`
- If `state.stats.scoreMean !== null`: `showStats(state.stats)`
- `renderAppHistory(state.applicationHistory)`

#### `handleEvent(event)`
- Switch on `event.type`:
  - `state`: `populateFromState(event.data)`
  - `job_harvested`: `updateCounts(++h, s, g)` + `addLogEntry('harvested', event.data)`
  - `scoring_started`: `updateHeader('scoring', event.data.date)` + `updateCounts(0,0,0)` + `clearTable()` + `addLogEntry(event)`
  - `job_scored`: `addTableRow(event.data)` + `updateCounts(h, ++s, g)` + `updateDistributionFromAll()` + `addLogEntry(event)`
  - `scoring_complete`: `updateHeader('idle')` + `showStats(event.data)` + `addLogEntry(event)`
  - `generation_started`: `updateHeader('generating')` + `addLogEntry(event)`
  - `doc_generated`: `updateQualityCell(event.data)` + `updateCounts(h, s, ++g)` + `addLogEntry(event)`
  - `generation_complete`: `updateHeader('idle')` + `addLogEntry(event)`

#### `addTableRow(data)` — Stack Rank Row Builder
Builds `<tr>` with `data-source-filename="${data.sourceFilename}"`:
1. **Rank** (`<td>`): `data.rank`
2. **Score** (`<td>`): `data.score`/10
3. **Flag** (`<td>`): Action flag text with colored background
   - `DEEP_TAILOR` → `🔴 DEEP TAILOR` on `--flag-red` bg
   - `AUTO_GENERATED` → `🟡 AUTO-GENERATED` on `--flag-amber` bg
   - `NO_DOCS` → `⚪ NO DOCS` on `--flag-grey` bg
4. **Company** (`<td>`): `data.company`
5. **Title** (`<td>`): `data.title`
6. **Location** (`<td>`): `data.location`
7. **Salary** (`<td>`): `data.salary ?? '—'`
8. **Fit** (`<td>`): `data.fitSignal`
9. **Gap** (`<td>`): `data.gap`
10. **R★** (`<td class="quality-cell r-star">`): `—` initially
11. **CL★** (`<td class="quality-cell cl-star">`): `—` initially
12. **Links** (`<td class="links-cell">`): `JD` link initially (Resume/CL appear after generation)

#### `updateQualityCell(data)` — Match by `sourceFilename`
```javascript
const row = document.querySelector(`tr[data-source-filename="${data.sourceFilename}"]`);
if (!row) return;
const rCell = row.querySelector('.r-star');
const clCell = row.querySelector('.cl-star');
rCell.textContent = formatQuality(data.resumeQuality);
clCell.textContent = formatQuality(data.coverLetterQuality);
// Add links
const linksCell = row.querySelector('.links-cell');
linksCell.innerHTML = buildLinks(data);
```

#### `formatQuality(score)`
- If `score === null` or `undefined`: return `'—'`
- If `score < 6`: return `'⚠️ ' + score + '/10'` with amber color class
- Else: return `score + '/10'`

#### `updateDistribution(distribution)`
For each band in `['1-3', '4-5', '6', '7-8', '9-10']`:
- Find max count across all bands
- Calculate percentage width: `(bandCount / maxCount) * 100`
- Set `.bar` width and `.bar-count` text

#### `addLogEntry(event)`
- Create `<div class="log-entry log-{color}">`
- Format: `[HH:MM:SS] EVENT_TYPE: summary text`
- Color coding: harvested=blue, scored=green, generated=purple, skipped/error=red, complete=white
- Append to `#log-entries`, scroll to bottom

#### `showBanner(message)`
- Set `#disconnect-banner` text and display

### Edge Cases Handled

| Scenario | Behavior |
|----------|----------|
| Server not running on load | Banner "Server not running — start with: node server/server.js" |
| SSE connection lost mid-session | Banner "Connection lost — reload to reconnect." |
| No jobs scored yet | Distribution shows all-zero bars, no stats line |
| `doc_generated` arrives for unknown `sourceFilename` | Silently ignored (row may not exist in table yet) |
| Quality score is null | R★/CL★ show `—` placeholder |
| Quality score < 6 | Amber background + ⚠️ prefix |
| Multiple events rapid-fire | Each handled synchronously; no batching issues |
| Phase transitions | Header phase text updates immediately |
| Page refresh mid-pipeline | `/state` hydrates all accumulated data |
| Empty application history | "No applications yet" message |

---

## File: `tests/integration/dashboard.test.js`

### Test Structure

```javascript
'use strict';

const path = require('path');
const os = require('os');
const fs = require('fs').promises;
const { createApp } = require('../../server/server');

jest.setTimeout(30000);

describe('GET /dashboard', () => {
  let tmpJobsDir;
  let httpServer;
  let base;

  beforeAll(async () => {
    tmpJobsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'job-pipeline-dash-test-'));
    const app = createApp(tmpJobsDir);
    httpServer = app.listen(0);
    await new Promise(r => httpServer.once('listening', r));
    base = `http://localhost:${httpServer.address().port}`;
  });

  afterAll(async () => {
    if (httpServer) await new Promise(r => httpServer.close(r));
    await fs.rm(tmpJobsDir, { recursive: true, force: true });
  });

  it('returns 200 with text/html content type', async () => {
    const res = await fetch(`${base}/dashboard`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/html/);
  });

  it('HTML contains required element IDs', async () => {
    const res = await fetch(`${base}/dashboard`);
    const html = await res.text();
    expect(html).toContain('id="header-phase"');
    expect(html).toContain('id="header-date"');
    expect(html).toContain('id="count-harvested"');
    expect(html).toContain('id="count-scored"');
    expect(html).toContain('id="count-generated"');
    expect(html).toContain('id="score-distribution"');
    expect(html).toContain('id="stack-rank-table"');
    expect(html).toContain('id="app-history"');
    expect(html).toContain('id="activity-log"');
  });
});
```

---

## Manual Test Protocol (Required for Acceptance)

### Test 1: Live Scoring
1. Start server: `node server/server.js`
2. Open `http://localhost:3000/dashboard` in Chrome
3. Open `http://localhost:3000/dashboard` in a second tab in Edge
4. Run `node score.js` with fixture jobs in `jobs/`
5. **Verify:** Table rows appear one-by-one as each job scores
6. **Verify:** Score distribution bars update dynamically
7. **Verify:** Activity log shows colored entries per event
8. **Verify:** Phase indicator shows "scoring" during process, returns to "idle" on completion
9. **Verify:** Stats line appears after scoring_complete

### Test 2: Document Generation
1. After scoring completes, run `node generate.js`
2. **Verify:** R★ and CL★ columns populate in correct rows (matched by sourceFilename)
3. **Verify:** Cells with quality < 6 show amber ⚠️ styling
4. **Verify:** Links column shows Resume and CL links for generated docs

### Test 3: Page Refresh Hydration
1. Mid-pipeline (or after completion), refresh the browser
2. **Verify:** All accumulated data renders immediately from `/state`
3. **Verify:** Counts, table rows, distribution all match pre-refresh state

### Test 4: Disconnect Banner
1. Stop the server (Ctrl+C)
2. **Verify:** "Server not running — start with: node server/server.js" banner appears
3. Restart server
4. **Verify:** Dashboard reconnects on page reload

### Documentation Template
```
Manual Test Result — P4-T05 dashboard.html
Date: YYYY-MM-DD
Browser: Chrome [version] / Edge [version]
Test 1 (live scoring): ✅ Pass — [notes]
Test 2 (generation):   ✅ Pass — [notes]
Test 3 (hydration):    ✅ Pass — [notes]
Test 4 (disconnect):   ✅ Pass — [notes]
```

---

## Implementation Order

1. **`server/dashboard.html`** — Full implementation:
   a. HTML skeleton with all required element IDs
   b. CSS dark theme with design tokens
   c. JavaScript: `init()`, `populateFromState()`, `handleEvent()`
   d. JavaScript: `addTableRow()`, `updateQualityCell()`
   e. JavaScript: `updateDistribution()`, `showStats()`
   f. JavaScript: `addLogEntry()`, `showBanner()`
   g. JavaScript: helper functions (`formatQuality()`, `buildLinks()`)

2. **`tests/integration/dashboard.test.js`** — Automated tests

3. **Verification:**
   - `npm run lint` exits 0
   - `npm test` exits 0 (all prior tests green + new dashboard test)
