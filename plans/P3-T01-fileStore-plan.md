# P3-T01: `fileStore.js` — Filesystem Adapter

## Objective

Create `src/lib/fileStore.js` — the **sole module** in the entire codebase permitted to touch the local disk — and its corresponding integration test suite `tests/integration/fileStore.test.js`. Exports exactly ten functions, all using `fs.promises` exclusively.

---

## Architecture & Constraints

### Non-negotiable rules

- **`fs.promises` only** — no `fs.readFileSync`, `fs.writeFileSync`, or callback-style `fs.readFile` anywhere
- **`require('dotenv').config()` NOT needed** — this is a lib module, not a CLI script
- **CommonJS** (`require`/`module.exports`) — no ESM
- **Windows paths** — use `path.join()` everywhere, never hardcode `/`
- **No bare `console`** — this module does not log; callers handle errors

### Dependencies

| Import | Source | Used by |
|--------|--------|---------|
| `{ ConfigMissingError }` | `src/lib/errors.js` | `readConfig` |
| `{ sanitizeForFilename }` | `src/models/job.js` | `writeApplicationDocs` |

### Function signatures & behaviour

```javascript
'use strict';
const path = require('path');
const { promises: fs } = require('fs');
const { ConfigMissingError } = require('./errors');
const { sanitizeForFilename } = require('../models/job');
```

#### 1. `readJobFiles(jobsDir)`

| Aspect | Detail |
|--------|--------|
| **Input** | `jobsDir` — path to `jobs/` directory |
| **Returns** | `Promise<{ filename: string, content: string }[]>` |
| **Behaviour** | Reads all `.md` files in `jobsDir`. Ignores non-`.md` files. Returns `[]` if path missing/empty. |
| **Edge cases** | Directory does not exist → catch `ENOENT` → return `[]`. Directory exists but no `.md` files → return `[]`. Mix of `.md` and `.txt`/`.json` → only `.md` returned. |
| **Implementation** | `fs.readdir(jobsDir)` → filter `.md` → `Promise.all` on `fs.readFile` with `utf-8` |

#### 2. `writeJobFile(jobsDir, filename, content)`

| Aspect | Detail |
|--------|--------|
| **Input** | `jobsDir`, `filename` (e.g. `"job.md"`), `content` (markdown string) |
| **Returns** | `Promise<string>` — the actual filename written |
| **Behaviour** | If `filename` exists, try `filename` → replace `.md` with `-2.md` → if that exists, `-3.md` etc. Writes first available name. |
| **Edge cases** | `-2` exists → try `-3`. `-3` exists → try `-4`. |
| **Implementation** | Build candidate paths in loop, `fs.access` to check existence, then `fs.writeFile` on first non-existent. Return the basename only. |

#### 3. `writeStackRank(resumesDir, dateStr, content)`

| Aspect | Detail |
|--------|--------|
| **Input** | `resumesDir` (e.g. `"./resumes"`), `dateStr` (`"YYYY-MM-DD"`), `content` (markdown string) |
| **Returns** | `Promise<string>` — the full path written |
| **Behaviour** | Creates `resumes/[dateStr]/` if absent. Writes `resumes/[dateStr]/stack_rank_[dateStr].md`. |
| **Implementation** | `fs.mkdir(targetDir, { recursive: true })` → `fs.writeFile(fullPath, content, 'utf-8')` → return `fullPath` |

#### 4. `readStackRank(resumesDir, dateStr)`

| Aspect | Detail |
|--------|--------|
| **Input** | `resumesDir`, `dateStr` |
| **Returns** | `Promise<string>` — file content |
| **Behaviour** | Reads `resumes/[dateStr]/stack_rank_[dateStr].md`. Throws descriptive `Error` including the full path if not found. |
| **Error message** | `"Stack rank file not found: [full path]"` |
| **Implementation** | `fs.readFile(fullPath, 'utf-8')` — catch `ENOENT` and throw new `Error` with path info |

#### 5. `readConfig(configDir, filename)`

| Aspect | Detail |
|--------|--------|
| **Input** | `configDir`, `filename` (e.g. `"scoring_prompt.md"`) |
| **Returns** | `Promise<string>` — file content |
| **Behaviour** | Reads `configDir/filename`. Throws `ConfigMissingError(filename)` if not found. |
| **Implementation** | `fs.readFile(path.join(configDir, filename), 'utf-8')` — catch `ENOENT` → throw `ConfigMissingError(filename)` |

#### 6. `writeApplicationDocs(resumesDir, dateStr, company, title, resume, coverLetter)`

| Aspect | Detail |
|--------|--------|
| **Input** | `resumesDir`, `dateStr`, `company` (raw string), `title` (raw string), `resume` (content), `coverLetter` (content) |
| **Returns** | `Promise<boolean>` — `true` if written, `false` if dir already existed |
| **Behaviour** | Calls `sanitizeForFilename(company, 60)` and `sanitizeForFilename(title, 60)` to build folder name. Constructs path: `resumes/[dateStr]/[sanitizedCompany] - [sanitizedTitle]/`. Writes `resume.md` and `cover_letter.md`. Returns `false` without writing if directory already exists. |
| **Edge cases** | `company='AT&T'` → sanitized to `ATT` → folder `ATT - Senior-Engineer/` |
| **Implementation** | Build path → `fs.mkdir(folderPath)` → catch `EEXIST` → return `false`. Write both files → return `true`. |

#### 7. `writeSubmissionRecord(outputDir, content)`

| Aspect | Detail |
|--------|--------|
| **Input** | `outputDir` (path to application folder), `content` (markdown string) |
| **Returns** | `Promise<void>` |
| **Behaviour** | Writes `submission_record.md` to `outputDir`. |
| **Implementation** | `fs.writeFile(path.join(outputDir, 'submission_record.md'), content, 'utf-8')` |

#### 8. `readApplications(rootDir)`

| Aspect | Detail |
|--------|--------|
| **Input** | `rootDir` (project root) |
| **Returns** | `Promise<ApplicationRecord[]>` |
| **Behaviour** | Reads `rootDir/applications.json`. Returns `[]` if file does not exist — never throws. |
| **Implementation** | `fs.readFile(path.join(rootDir, 'applications.json'), 'utf-8')` → `JSON.parse` → return array. Catch `ENOENT` → return `[]`. Catch `SyntaxError` → rethrow. |

#### 9. `writeApplications(rootDir, records)`

| Aspect | Detail |
|--------|--------|
| **Input** | `rootDir`, `records` (array of `ApplicationRecord` objects) |
| **Returns** | `Promise<void>` |
| **Behaviour** | Overwrites `applications.json` with `JSON.stringify(records, null, 2)`. |
| **Implementation** | `fs.writeFile(path.join(rootDir, 'applications.json'), JSON.stringify(records, null, 2), 'utf-8')` |

#### 10. `archiveJobFiles(jobsDir, archiveDir, dateStr)`

| Aspect | Detail |
|--------|--------|
| **Input** | `jobsDir`, `archiveDir`, `dateStr` |
| **Returns** | `Promise<number>` — count of files moved |
| **Behaviour** | Creates `archive/[dateStr]/` if needed. Moves all `.md` files from `jobsDir` to `archive/[dateStr]/`. Returns count. Leaves source dir empty but present. |
| **Implementation** | `fs.readdir(jobsDir)` → filter `.md` → `fs.mkdir(targetDir, { recursive: true })` → for each file, `fs.rename(src, dest)` → return count |

---

## Test Plan

### Setup pattern

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

### Test cases

#### `describe('readJobFiles')`
| Test | Setup | Assert |
|------|-------|--------|
| reads all .md files | Create `job1.md`, `job2.md` in `tmpDir/jobs/` | Returns array of 2, each with `filename` and `content` |
| returns [] for empty dir | Create empty `tmpDir/jobs/` | Returns `[]` |
| ignores non-.md files | Create `readme.txt`, `data.json`, `job.md` | Returns 1 entry for `job.md` only |

#### `describe('writeJobFile')`
| Test | Setup | Assert |
|------|-------|--------|
| writes new file | No existing file | File written, returns filename |
| appends -2 on collision | Create `job.md` first | Writes `job-2.md`, returns that |
| appends -3 when -2 also exists | Create `job.md`, `job-2.md` | Writes `job-3.md`, returns that |

#### `describe('writeStackRank / readStackRank')`
| Test | Setup | Assert |
|------|-------|--------|
| round-trips | Write via `writeStackRank`, read via `readStackRank` | Content matches |
| throws with path when not found | No file present | Error message includes full path string |

#### `describe('readConfig')`
| Test | Setup | Assert |
|------|-------|--------|
| reads existing config | Create `configDir/prompt.md` | Returns content |
| throws ConfigMissingError | File not present | Throws `ConfigMissingError` with filename |

#### `describe('writeApplicationDocs')`
| Test | Setup | Assert |
|------|-------|--------|
| creates dir and writes both files, returns true | Call with company, title, resume, coverLetter | Dir created, both files exist, returns `true` |
| returns false without overwriting when dir exists | Call twice with same args | Second call returns `false`, files unchanged |
| sanitizes company with special chars | `company='AT&T'`, `title='Senior Engineer'` | Folder is `ATT - Senior-Engineer/` |

#### `describe('writeSubmissionRecord')`
| Test | Setup | Assert |
|------|-------|--------|
| writes file to specified output dir | Create output dir, call function | `submission_record.md` exists with correct content |

#### `describe('readApplications / writeApplications')`
| Test | Setup | Assert |
|------|-------|--------|
| returns [] when file does not exist | No `applications.json` | Returns `[]` |
| round-trips correctly | Write array, read back | Arrays are deeply equal |

#### `describe('archiveJobFiles')`
| Test | Setup | Assert |
|------|-------|--------|
| moves all .md files | Create 3 `.md` files in `jobs/` | Files moved to `archive/[dateStr]/` |
| returns correct count | Same setup | Returns `3` |
| leaves source dir empty | Same setup | `jobs/` has no `.md` files |

---

## `jest.config.js` Update

Add the following block to `coverageThreshold`:

```javascript
[path.resolve(__dirname, 'src/lib/fileStore.js')]: {
  branches: 85,
  functions: 85,
  lines: 85,
  statements: 85,
},
```

---

## Verification Checklist

```powershell
# Lint
npm run lint

# Tests
npm test

# No console.log leaks
findstr /s "console\." src\lib\fileStore.js tests\integration\fileStore.test.js

# No sync fs calls in src/
findstr /s "readFileSync\|writeFileSync" src\
```

---

## Implementation Order

1. Write `src/lib/fileStore.js` — all 10 functions
2. Update `jest.config.js` — add fileStore coverage threshold
3. Write `tests/integration/fileStore.test.js` — all describe blocks
4. Run `npm run lint` — fix any issues
5. Run `npm test` — verify all tests pass (existing + new)
6. Run grep checks — confirm no sync fs or console.log leaks
7. Present summary
