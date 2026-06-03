# P2-T01 — `job.js` JobFile Model — Implementation Plan

## Overview

Create [`src/models/job.js`](src/models/job.js) — a pure function module exporting 4 functions for parsing, formatting, and sanitizing LinkedIn job descriptions. Create [`tests/unit/job.test.js`](tests/unit/job.test.js) with comprehensive coverage targeting ≥ 90%.

---

## 1. `src/models/job.js` — Implementation Spec

### 1.1 `parseJobFile(markdown, filename)`

**Signature:** `parseJobFile(markdown: string, filename: string): JobFile`

**Parsing steps:**

1. **Extract title** from `# (.*)\n` (first h1 heading after trimming leading newlines).
   - If no title found → throw [`JobParseError`](src/lib/errors.js:3) with `filename`.

2. **Locate `## Metadata`** via regex `/^## Metadata\s*$/m`.
   - If missing → throw `JobParseError` with `filename`.

3. **Extract metadata fields** using regex: `/-\s+\*\*(\w+(?:\s\w+)*):\*\*\s*(.*)/g` within the metadata block (from `## Metadata` to next `## ` heading).
   - Build a map of field names → values.
   - **Required:** `URL` — if missing or empty → throw `JobParseError`.
   - `Company` — if missing, default to empty string.
   - `Location` — if missing, set to `"Not specified"`.
   - `Employment Type` — if missing, set to `"Not specified"`.
   - `Salary`:
     - If absent → `null`
     - If value is `"Not specified"` → `null`
     - Otherwise → the raw string value
   - `LinkedIn Job ID` — if absent or `"Not available"` → `null`, else the string value.
   - `Harvested` — parse as `new Date(value)` (string format `"YYYY-MM-DD HH:MM"`). If absent → `new Date()` fallback.

4. **Strip query parameters from URL:**
   ```javascript
   function stripQueryParams(url) {
     try {
       const parsed = new URL(url);
       return parsed.origin + parsed.pathname;
     } catch { return url; }
   }
   ```

5. **Extract `linkedInJobId`** from cleaned URL via `extractLinkedInJobId(url)`.

6. **Locate `## Job Description`** via regex `/^## Job Description\s*$/m`.
   - If missing → throw `JobParseError` with `filename`.
   - Extract all text after this heading until end of string. Trim leading/trailing whitespace.

7. **Return `JobFile` object:**
   ```javascript
   {
     title,
     company,
     location,
     employmentType,
     salary,         // string | null
     url,            // query params stripped
     linkedInJobId,  // string | null
     harvested,      // Date
     description,
     filename        // passed as parameter
   }
   ```

### 1.2 `sanitizeForFilename(str, maxLength)`

**Signature:** `sanitizeForFilename(str: string, maxLength: number): string`

**Steps:**
1. Replace spaces with hyphens: `.replace(/\s+/g, '-')`
2. Remove forbidden chars: `& ( ) / , ' " @ # $ % ^ * ! ? < > | \ : ;`
   - `.replace(/[&()\/,'"@#\$%\^\*!?<>\|\\:;]/g, '')`
3. Collapse consecutive hyphens: `.replace(/-+/g, '-')`
4. Trim leading/trailing hyphens: `.replace(/^-+/, '').replace(/-+$/, '')`
5. Truncate to `maxLength`: `.slice(0, maxLength)`

**Edge case examples from acceptance criteria:**
| Input | maxLength | Expected output |
|---|---|---|
| `'AT&T'` | 60 | `'ATT'` |
| `'Johnson & Johnson'` | 60 | `'Johnson-Johnson'` |
| `'Company (Inc.) / Division'` | 60 | `'Company-Inc-Division'` |
| `'A--B'` | 60 | `'A-B'` |
| `'-Leading'` | 60 | `'Leading'` |
| `'abcdefghijklmnopqrstuvwxyz'` | 10 | `'abcdefghij'` |

### 1.3 `formatJobFile(job)`

**Signature:** `formatJobFile(job: JobFile): string`

**Output template:**
```markdown
# ${job.title}

## Metadata
- **Company:** ${job.company}
- **Location:** ${job.location}
- **Employment Type:** ${job.employmentType}
- **Salary:** ${job.salary ?? 'Not specified'}
- **URL:** ${job.url}
- **LinkedIn Job ID:** ${job.linkedInJobId ?? 'Not available'}
- **Harvested:** ${formatDateTimeString(job.harvested)}

## Job Description

${job.description}
```

Uses `formatDateTimeString` from [`src/lib/dateUtils.js`](src/lib/dateUtils.js:201).

### 1.4 `extractLinkedInJobId(url)`

**Signature:** `extractLinkedInJobId(url: string): string | null`

**Regex:** `/\/jobs\/view\/([0-9]+)\/?/`

- If match found → return capture group 1 (the numeric string)
- If no match → return `null`

**Note:** Trailing slash is optional in the regex because fixtures have URLs without trailing slashes (e.g., `sample_job_1.md` URL is `https://www.linkedin.com/jobs/view/3987654321`).

---

## 2. `tests/unit/job.test.js` — Test Spec

### 2.1 Test Structure

```javascript
const { parseJobFile, sanitizeForFilename, formatJobFile, extractLinkedInJobId } = require('../../src/models/job');
const { JobParseError } = require('../../src/lib/errors');
const fs = require('fs');
const path = require('path');

// Helper to load fixture content
function loadFixture(name) {
  return fs.readFileSync(path.join(__dirname, '../fixtures', name), 'utf8');
}
```

### 2.2 Test Cases

#### `describe('parseJobFile')`

| # | Test name | Input | Expected |
|---|---|---|---|
| 1 | parses sample_job_1.md correctly | `loadFixture('sample_job_1.md')`, `'sample_job_1.md'` | `title: 'Senior Privacy Manager'`, `company: 'Meridian Health Systems'`, `location: 'Remote'`, `employmentType: 'Full-time'`, `salary: '$160,000–$185,000'`, `url: 'https://www.linkedin.com/jobs/view/3987654321'`, `linkedInJobId: '3987654321'` |
| 2 | sets salary to null when Not specified | `loadFixture('sample_job_2.md')`, `'sample_job_2.md'` | `salary: null` |
| 3 | populates salary when value is present | `loadFixture('sample_job_1.md')`, `'sample_job_1.md'` | `salary: '$160,000–$185,000'` |
| 4 | strips query parameters from URL | markdown with URL `https://www.linkedin.com/jobs/view/3987654321?trk=someParam` | `url: 'https://www.linkedin.com/jobs/view/3987654321'` |
| 5 | extracts linkedInJobId from URL | `loadFixture('sample_job_1.md')` | `linkedInJobId: '3987654321'` |
| 6 | sets linkedInJobId to null for non-LinkedIn URLs | markdown with URL `https://example.com/job/123` | `linkedInJobId: null` |
| 7 | throws JobParseError when Metadata section missing | markdown without `## Metadata` | throws `JobParseError` with `filename` |
| 8 | throws JobParseError when URL field empty | markdown with `## Metadata` but `URL:` empty | throws `JobParseError` with `filename` |
| 9 | throws JobParseError when Job Description section missing | markdown with `## Metadata` but no `## Job Description` | throws `JobParseError` with `filename` |

#### `describe('sanitizeForFilename')`

| # | Test name | Input args | Expected |
|---|---|---|---|
| 1 | replaces spaces with hyphens | `'Hello World', 60` | `'Hello-World'` |
| 2 | removes ampersands | `'AT&T', 60` | `'ATT'` |
| 3 | removes ampersands and joins | `'Johnson & Johnson', 60` | `'Johnson-Johnson'` |
| 4 | removes parentheses and slashes | `'Company (Inc.) / Division', 60` | `'Company-Inc-Division'` |
| 5 | collapses consecutive hyphens | `'A--B', 60` | `'A-B'` |
| 6 | trims leading hyphens | `'-Leading', 60` | `'Leading'` |
| 7 | trims trailing hyphens | `'Trailing-', 60` | `'Trailing'` |
| 8 | truncates at maxLength | `'abcdefghijklmnopqrstuvwxyz', 10` | `'abcdefghij'` |
| 9 | handles already-clean strings | `'Clean-String', 60` | `'Clean-String'` |
| 10 | removes all forbidden special chars | `'Hello! @World# $Test% ^&*()', 60` | `'Hello-World-Test'` |

#### `describe('formatJobFile')`

| # | Test name | Input | Expected |
|---|---|---|---|
| 1 | round-trips parse -> format -> parse | `loadFixture('sample_job_1.md')` | After `parseJobFile` → `formatJobFile` → `parseJobFile`, all fields match original parse (except description may normalize whitespace) |
| 2 | round-trips with null salary | `loadFixture('sample_job_2.md')` | Salary preserved as `null` through round-trip |

#### `describe('extractLinkedInJobId')`

| # | Test name | Input | Expected |
|---|---|---|---|
| 1 | extracts numeric ID from standard LinkedIn jobs URL | `'https://www.linkedin.com/jobs/view/3987654321/'` | `'3987654321'` |
| 2 | handles URL without trailing slash | `'https://www.linkedin.com/jobs/view/3987654321'` | `'3987654321'` |
| 3 | returns null for non-LinkedIn URL | `'https://example.com/job/123'` | `null` |
| 4 | returns null for URL without job ID pattern | `'https://www.linkedin.com/feed/'` | `null` |

---

## 3. Per-file Coverage Threshold

Add per-file threshold to [`jest.config.js`](jest.config.js:1):

```javascript
module.exports = {
  // ... existing config ...
  coverageThreshold: {
    'src/models/job.js': {
      branches: 90,
      functions: 90,
      lines: 90,
      statements: 90,
    },
  },
};
```

---

## 4. Verification Checklist

1. `npm run lint` — must exit 0
2. `npm test` — must exit 0, all suites (existing `scaffold.test.js` + new `job.test.js`) green
3. `grep -r "console\." src/models/job.js` — must find nothing (use `logger` if needed, but this is pure function so likely no logging needed)
4. Coverage report — `src/models/job.js` must show ≥ 90% for branches, functions, lines, statements

---

## 5. Files to Create/Modify

| File | Action | Description |
|---|---|---|
| `src/models/job.js` | **Create** | Pure function module with 4 exports |
| `tests/unit/job.test.js` | **Create** | Unit tests with ≥ 90% coverage |
| `jest.config.js` | **Modify** | Add per-file coverage threshold for `src/models/job.js` |

---

## 6. Key Architectural Decisions

1. **No side effects**: `parseJobFile`, `sanitizeForFilename`, `formatJobFile`, `extractLinkedInJobId` are all pure — no filesystem, no `console`, no network.
2. **Error type**: Use `JobParseError` from [`src/lib/errors.js`](src/lib/errors.js:3) — pass `filename` as second argument so error messages identify the source file.
3. **URL strip logic**: Use [`new URL()`](https://developer.mozilla.org/en-US/docs/Web/API/URL) constructor and take `origin + pathname`. This removes all query parameters, hash fragments, etc. If URL parsing fails, return the raw URL as-is.
4. **Regex for extractLinkedInJobId**: `/\/jobs\/view\/([0-9]+)\/?/` — the `/?` makes trailing slash optional, matching both the fixture URLs (no trailing slash) and test inputs (with trailing slash).
5. **Salary null handling**: The field `salary` is `string | null`. When metadata has `Salary: Not specified` or the field is absent, value is `null`. When `formatJobFile` encounters `null`, it serializes as `Not specified` for round-trip consistency.

---

## 7. Round-trip Behavior

The round-trip `parseJobFile(formatJobFile(job), filename)` must return an equivalent object. Key considerations:

- **`formatDateTimeString`** produces `"YYYY-MM-DD HH:MM"` (seconds truncated). The fixture has `"2026-05-30 09:14"`. When `parseJobFile` reads this via `new Date()`, the Date object captures it. When `formatJobFile` writes it back via `formatDateTimeString`, it produces the same string. **However**, `new Date()` parsing may create seconds — `formatDateTimeString` truncates them. The round-trip parse will re-read the truncated string producing a `harvested` Date with 0 seconds. This is acceptable because the spec only requires equivalence on the significant fields.
- **Description whitespace**: The description text after `## Job Description` may have leading/trailing newlines. Both `parseJobFile` and `formatJobFile` should trim consistently.

A pragmatic round-trip test verifies field-by-field equality of title, company, location, employmentType, salary, url, linkedInJobId, filename, and description — comparing `harvested` as date strings, not Date object identity.
