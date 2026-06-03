'use strict';

const { execSync } = require('child_process');
const path = require('path');
const { promises: fs } = require('fs');
const os = require('os');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const FIXTURES_DIR = path.resolve(__dirname, '../fixtures');
const CLEANUP_SCRIPT = path.join(PROJECT_ROOT, 'cleanup.js');

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Create a temporary directory with jobs/ and archive/ subdirectories.
 *
 * @returns {Promise<string>} The temp directory path.
 */
async function setupTempDir() {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cleanup-e2e-'));
  await fs.mkdir(path.join(tmpDir, 'jobs'), { recursive: true });
  await fs.mkdir(path.join(tmpDir, 'archive'), { recursive: true });
  return tmpDir;
}

/**
 * Copy a fixture file from tests/fixtures/ into the temp jobs/ directory.
 */
async function copyFixture(tmpDir, fixtureName) {
  const src = path.join(FIXTURES_DIR, fixtureName);
  const dst = path.join(tmpDir, 'jobs', fixtureName);
  await fs.copyFile(src, dst);
  return dst;
}

/**
 * Run cleanup.js as a child process with the given temp directory as base.
 * stderr is redirected to stdout via 2>&1 so warnings (console.warn) are captured.
 *
 * @param {string} tmpDir - The temp directory (PIPELINE_BASE_DIR).
 * @param {object} [extraEnv] - Additional environment variables.
 * @returns {{ stdout: string }} Combined stdout+stderr output.
 */
function runCleanup(tmpDir, extraEnv = {}) {
  const result = execSync(`node "${CLEANUP_SCRIPT}" 2>&1`, {
    cwd: tmpDir,
    env: {
      ...process.env,
      DEEPSEEK_API_KEY: 'test-key',
      PIPELINE_PORT: '3001',
      PIPELINE_BASE_DIR: tmpDir,
      ...extraEnv,
    },
    encoding: 'utf8',
  });
  return { stdout: result };
}

/**
 * Return today's date string in YYYY-MM-DD format (local time).
 * Mirrors formatDateString from src/lib/dateUtils.js.
 */
function todayDateStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('cleanup.js', () => {
  /** @type {string} */
  let tmpDir;
  const dateStr = todayDateStr();

  beforeEach(async () => {
    tmpDir = await setupTempDir();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  // ── Test 1: Moves all .md files to archive ────────────────────────────
  it('moves all .md files to archive', async () => {
    await copyFixture(tmpDir, 'sample_job_1.md');
    await copyFixture(tmpDir, 'sample_job_2.md');

    const { stdout } = runCleanup(tmpDir);

    // Verify completion message
    expect(stdout).toMatch(/Archived 2 files to archive/);

    // Verify jobs/ directory is empty
    const jobsFiles = await fs.readdir(path.join(tmpDir, 'jobs'));
    expect(jobsFiles).toHaveLength(0);

    // Verify files exist in archive/[dateStr]/
    const archiveDir = path.join(tmpDir, 'archive', dateStr);
    const archiveFiles = await fs.readdir(archiveDir);
    expect(archiveFiles).toContain('sample_job_1.md');
    expect(archiveFiles).toContain('sample_job_2.md');
    expect(archiveFiles).toHaveLength(2);
  });

  // ── Test 2: Leaves jobs/ empty but present ────────────────────────────
  it('leaves jobs/ empty but present', async () => {
    await copyFixture(tmpDir, 'sample_job_1.md');

    runCleanup(tmpDir);

    // jobs/ directory still exists
    const jobsDir = path.join(tmpDir, 'jobs');
    const jobsStat = await fs.stat(jobsDir);
    expect(jobsStat.isDirectory()).toBe(true);

    // jobs/ directory is empty
    const jobsFiles = await fs.readdir(jobsDir);
    expect(jobsFiles).toHaveLength(0);
  });

  // ── Test 3: Handles empty jobs/ gracefully with exit 0 ───────────────
  it('handles empty jobs/ gracefully with exit 0', async () => {
    const { stdout } = runCleanup(tmpDir);

    // Should log the "already empty" message
    expect(stdout).toMatch(/already empty/);

    // jobs/ directory still exists
    const jobsDir = path.join(tmpDir, 'jobs');
    const jobsStat = await fs.stat(jobsDir);
    expect(jobsStat.isDirectory()).toBe(true);
  });

  // ── Test 4: Appends to existing archive directory on second run ───────
  it('appends to existing archive directory on second run', async () => {
    // First run: move sample_job_1.md
    await copyFixture(tmpDir, 'sample_job_1.md');
    const { stdout: firstStdout } = runCleanup(tmpDir);
    expect(firstStdout).toMatch(/Archived 1 files to archive/);

    // Verify job_1 is in archive
    const archiveDir = path.join(tmpDir, 'archive', dateStr);
    let archiveFiles = await fs.readdir(archiveDir);
    expect(archiveFiles).toContain('sample_job_1.md');

    // Second run: add sample_job_2.md to jobs/ and run again
    await copyFixture(tmpDir, 'sample_job_2.md');
    const { stdout: secondStdout } = runCleanup(tmpDir);
    expect(secondStdout).toMatch(/Archived 1 files to archive/);

    // Verify both files now in archive
    archiveFiles = await fs.readdir(archiveDir);
    expect(archiveFiles).toContain('sample_job_1.md');
    expect(archiveFiles).toContain('sample_job_2.md');
    expect(archiveFiles).toHaveLength(2);

    // jobs/ is empty after second run
    const jobsFiles = await fs.readdir(path.join(tmpDir, 'jobs'));
    expect(jobsFiles).toHaveLength(0);
  });

  // ── Test 5: Does not move non-.md files ───────────────────────────────
  it('does not move non-.md files', async () => {
    await copyFixture(tmpDir, 'sample_job_1.md');

    // Create a non-.md file in jobs/
    const txtPath = path.join(tmpDir, 'jobs', 'notes.txt');
    await fs.writeFile(txtPath, 'Some random notes', 'utf-8');

    const { stdout } = runCleanup(tmpDir);

    // Only the .md file was archived
    expect(stdout).toMatch(/Archived 1 files to archive/);

    // .txt file remains in jobs/
    const jobsFiles = await fs.readdir(path.join(tmpDir, 'jobs'));
    expect(jobsFiles).toEqual(['notes.txt']);

    // Archive contains only the .md file
    const archiveDir = path.join(tmpDir, 'archive', dateStr);
    const archiveFiles = await fs.readdir(archiveDir);
    expect(archiveFiles).toEqual(['sample_job_1.md']);
  });
});
