# Job Pipeline

A local Node.js pipeline that harvests LinkedIn job descriptions, scores them with DeepSeek,
stack ranks them, generates resumes and cover letters, and serves a real-time SSE dashboard.

## Prerequisites

- Node.js v24.11.1 (or v18+)
- npm
- DeepSeek API key

## Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure environment:**
   ```bash
   cp .env.example .env
   ```
   Edit `.env` and set your `DEEPSEEK_API_KEY`.

3. **OneDrive sync warning:** Exclude `jobs/`, `resumes/`, and `archive/` from OneDrive sync.
   Right-click each folder → OneDrive → "Don't sync this folder."

## Daily Workflow

### Harvest
1. `node server/server.js`
2. Open `http://localhost:3000/dashboard`
3. Browse LinkedIn, click the "Harvest Job" bookmarklet

### Score and generate
4. `node score.js`
5. Review stack rank at `resumes/YYYY-MM-DD/stack_rank_YYYY-MM-DD.md`
6. `node generate.js`

### Track applications
7. `node apply.js`

### End of day
8. `node cleanup.js`
9. Ctrl+C the server

### Cross-day runs
```bash
node generate.js --date=2026-05-29
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run lint` | Lint all source files |
| `npm test` | Run all tests with coverage |
| `npm run start` | Start the dashboard server |
| `npm run score` | Run scoring pipeline |
| `npm run generate` | Run document generation |
| `npm run cleanup` | Archive job files |
| `npm run build:bookmarklet` | Minify bookmarklet |
| `node apply.js` | Track application status |

## Project Structure

```
├── config/           # Human-authored configuration files
├── src/
│   ├── lib/          # Shared utilities (errors, logger, dates, I/O, API, etc.)
│   └── models/       # Pure data models (Job, ScoredJob, StackRank, ApplicationRecord)
├── server/           # Express server, dashboard, bookmarklet
├── scripts/          # Build utilities
├── tests/
│   ├── fixtures/     # Static test data (contract — never modify)
│   ├── helpers/      # Test helpers (msw setup)
│   ├── unit/         # Unit tests
│   ├── integration/  # Integration tests
│   └── e2e/          # End-to-end pipeline tests
├── jobs/             # Harvested job files
├── archive/          # Archived job files by date
├── resumes/          # Generated resumes and cover letters by date
├── applications.json # Permanent application log (auto-created)
├── .env.example      # Environment template
└── .gitignore
```
