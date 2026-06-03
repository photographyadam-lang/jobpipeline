'use strict';

require('dotenv').config();

const path = require('path');

const logger = require('./src/lib/logger');
const { formatDateString } = require('./src/lib/dateUtils');
const fileStore = require('./src/lib/fileStore');

// ── Constants ──────────────────────────────────────────────────────────────────
// PIPELINE_BASE_DIR env var allows E2E tests to override the base directory.
// Defaults to __dirname (project root) for normal usage.
const ROOT_DIR = process.env.PIPELINE_BASE_DIR || __dirname;
const JOBS_DIR = path.join(ROOT_DIR, 'jobs');
const ARCHIVE_DIR = path.join(ROOT_DIR, 'archive');

// ── Main ───────────────────────────────────────────────────────────────────────
(async function main() {
  // 1. Read job files to check if any .md files exist
  const allJobFiles = await fileStore.readJobFiles(JOBS_DIR);
  if (allJobFiles.length === 0) {
    logger.info('[cleanup]', 'jobs/ is already empty — nothing to archive.');
    process.exit(0);
  }

  // 2. Generate date string — NEVER use toISOString() for paths
  const dateStr = formatDateString(new Date());

  // 3. Archive all .md files — creates archive/[dateStr]/ if needed
  //    Appends if directory already exists — idempotent by design
  const count = await fileStore.archiveJobFiles(JOBS_DIR, ARCHIVE_DIR, dateStr);

  // 4. Log completion with count
  logger.info('[cleanup]', `Archived ${count} files to archive/${dateStr}/`);
})();
