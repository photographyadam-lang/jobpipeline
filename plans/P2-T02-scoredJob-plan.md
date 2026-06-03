# P2-T02 Implementation Plan — `scoredJob.js` (ScoredJob Model)

## Overview

Create the pure-function `ScoredJob` model layer that parses DeepSeek scoring responses and combines them with `JobFile` objects into unified `ScoredJob` entities. No side effects.

---

## Files to Create

### 1. `src/models/scoredJob.js`

**Pattern**: Follows `src/models/job.js` — `'use strict'`, CommonJS, pure functions.

#### `parseScoreResponse(rawResponse)` — Detailed Spec

| Input | Expected behavior |
|-------|-------------------|
| Valid JSON `{ "score": 7, "fit_signal": "...", "gap": "..." }` | Returns `{ score: 7, fitSignal: "…", gap: "…" }` |
| Non-JSON string (`"not json"`) | Throws `DeepSeekResponseError` |
| Valid JSON missing `score` key | Throws `DeepSeekResponseError` |
| `score: 0` (below range) | Throws `DeepSeekResponseError` |
| `score: 11` (above range) | Throws `DeepSeekResponseError` |
| `score: 7.5` (float, not integer) | Throws `DeepSeekResponseError` |
| `fit_signal` missing or empty string | Throws `DeepSeekResponseError` |
| `gap` missing or empty string | Throws `DeepSeekResponseError` |

**Implementation notes**:
- `JSON.parse(rawResponse)` wrapped in try/catch — catch throws `DeepSeekResponseError`
- DeepSeek returns `fit_signal` (snake_case) → map to `fitSignal` (camelCase) in return
- Validate: `!Number.isInteger(parsed.score)`, `parsed.score < 1`, `parsed.score > 10`
- Check `fit_signal` key (the JSON key), not `fitSignal` (the return key)
- Use `'use strict';` and import `DeepSeekResponseError` from `../lib/errors`

#### `createScoredJob(job, scoreResult)` — Detailed Spec

| Input | Expected behavior |
|-------|-------------------|
| `job` (valid JobFile) + `scoreResult` | Returns ScoredJob with all JobFile fields + score fields |
| JobFile fields | All primitives spread: title, company, location, employmentType, salary, url, linkedInJobId, harvested, description, filename |
| Score fields | `score`, `fitSignal`, `gap` taken from `scoreResult` |
| Rank field | Always `null` |
| ActionFlag field | Always `null` |

**Implementation notes**:
- Use spread operator: `{ ...job, score, fitSignal, gap, rank: null, actionFlag: null }`
- `scoreResult` provides `{ score, fitSignal, gap }`
- No validation needed — both inputs assumed pre-validated by `parseScoreResponse`

**Exports**:
```javascript
module.exports = { parseScoreResponse, createScoredJob };
```

---

### 2. `tests/unit/scoredJob.test.js`

**Pattern**: Follow `tests/unit/job.test.js` — `'use strict'`, `loadFixture` helper, `describe`/`it` blocks.

#### Describe block: `parseScoreResponse`

| Test case | Input | Expected |
|-----------|-------|----------|
| Parses valid fixture response | `JSON.stringify(sample_deepseek_score_response)` | `{ score: 7, fitSignal: "…", gap: "…" }` |
| Throws on non-JSON string | `"not valid json"` | `DeepSeekResponseError` |
| Throws when score missing | `sample_deepseek_score_invalid.json` content | `DeepSeekResponseError` |
| Throws when score is 0 | `{ "score": 0, "fit_signal": "x", "gap": "y" }` | `DeepSeekResponseError` |
| Throws when score is 11 | `{ "score": 11, "fit_signal": "x", "gap": "y" }` | `DeepSeekResponseError` |
| Throws when score is float 7.5 | `{ "score": 7.5, "fit_signal": "x", "gap": "y" }` | `DeepSeekResponseError` |
| Throws when fitSignal missing | `{ "score": 5, "gap": "y" }` | `DeepSeekResponseError` |
| Throws when fitSignal empty | `{ "score": 5, "fit_signal": "", "gap": "y" }` | `DeepSeekResponseError` |
| Throws when gap missing | `{ "score": 5, "fit_signal": "x" }` | `DeepSeekResponseError` |
| Throws when gap empty | `{ "score": 5, "fit_signal": "x", "gap": "" }` | `DeepSeekResponseError` |

#### Describe block: `createScoredJob`

| Test case | Input | Expected |
|-----------|-------|----------|
| Includes all JobFile fields | mock JobFile + scoreResult | Result has title, company, location, employmentType, salary, url, linkedInJobId, harvested, description, filename |
| Sets rank to null | mock JobFile + scoreResult | `result.rank === null` |
| Sets actionFlag to null | mock JobFile + scoreResult | `result.actionFlag === null` |
| Sets score, fitSignal, gap | mock JobFile + scoreResult | `result.score === 7`, `result.fitSignal === "…"`, `result.gap === "…"` |
| Does not mutate input JobFile | mock JobFile + scoreResult | Original job object unchanged |

**Test helper**: Create a minimal valid `JobFile` object inline (no filesystem dependency needed since `createScoredJob` is the unit under test, not `parseJobFile`).

---

### 3. `jest.config.js` — Update Coverage Threshold

Add per-file threshold entry for `src/models/scoredJob.js`:

```javascript
'src/models/scoredJob.js': {
  branches: 90,
  functions: 90,
  lines: 90,
  statements: 90,
},
```

Existing `job.js` threshold must remain untouched.

---

## Key Architectural Decisions

1. **`fit_signal` → `fitSignal` mapping**: DeepSeek returns snake_case keys. `parseScoreResponse` validates against `fit_signal` (the JSON key) but returns `fitSignal` (the ScoredJob camelCase field). This is consistent with the spec's `ScoredJob` type: `fitSignal`.

2. **Empty string validation**: The spec says `fitSignal`/`gap` "missing or empty" — both cases throw `DeepSeekResponseError`. This means `""` (empty string) is also invalid.

3. **Integer check**: Use `Number.isInteger(parsed.score)` — this correctly rejects floats like `7.5` while accepting `7`.

---

## Verification Steps

After implementation, run in order:

1. `npm run lint` — must exit 0
2. `npm test` — must exit 0 with all tests green (existing + new)
3. Grep bare `console.` in `src/`: `grep -r "console\." src/` — must only match `logger.js`
