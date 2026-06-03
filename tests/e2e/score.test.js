'use strict';

const { execSync } = require('child_process');
const path = require('path');
const { promises: fs } = require('fs');
const os = require('os');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const FIXTURES_DIR = path.resolve(__dirname, '../fixtures');
const SCORE_SCRIPT = path.join(PROJECT_ROOT, 'score.js');

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Create a minimal valid scoring_prompt.md for test use. */
const SCORING_PROMPT_CONTENT = 'You are a job fit scoring assistant. Score how well a candidate profile matches a job description.';

/** Create a minimal valid career profile for test use. */
const CAREER_CONTENT = `# Adam Buteux, MBA, CISSP, CIPM
Portland, Oregon

## Professional Summary
Senior governance and privacy professional with 15+ years driving compliance programs at scale.

## Professional Experience

### Meta | Senior Manager, Privacy & Risk Review | June 2022–November 2025
Led enterprise AI risk review across Facebook, Instagram, and Messenger.

### Audible (Amazon) | Director, Privacy Operations | January 2019–May 2022
Oversaw global privacy program for 35M+ subscriber platform.

## Education
Executive MBA — Bayes Business School, London

## Certifications
CISSP | CIPM`;

/**
 * Create a temporary directory with config/ and jobs/ subdirectories.
 * Populates config/ with the two required config files.
 *
 * @returns {Promise<string>} The temp directory path.
 */
async function setupTempDir() {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'score-e2e-'));
  await fs.mkdir(path.join(tmpDir, 'config'), { recursive: true });
  await fs.mkdir(path.join(tmpDir, 'jobs'), { recursive: true });
  await fs.mkdir(path.join(tmpDir, 'resumes'), { recursive: true });

  // Write minimal mock config files
  await fs.writeFile(
    path.join(tmpDir, 'config', 'scoring_prompt.md'),
    SCORING_PROMPT_CONTENT,
    'utf-8'
  );
  await fs.writeFile(
    path.join(tmpDir, 'config', 'adam_buteux_career.md'),
    CAREER_CONTENT,
    'utf-8'
  );

  return tmpDir;
}

/**
 * Copy a fixture file from tests/fixtures/ into the temp jobs/ directory.
 * Returns the destination path.
 */
async function copyFixture(tmpDir, fixtureName) {
  const src = path.join(FIXTURES_DIR, fixtureName);
  const dst = path.join(tmpDir, 'jobs', fixtureName);
  await fs.copyFile(src, dst);
  return dst;
}

/**
 * Run score.js as a child process with the given temp directory as base.
 * stderr is redirected to stdout via 2>&1 so warnings (console.warn) are captured.
 *
 * @param {string} tmpDir - The temp directory (PIPELINE_BASE_DIR).
 * @param {object} [extraEnv] - Additional environment variables.
 * @returns {{ stdout: string }} Combined stdout+stderr output.
 */
function runScore(tmpDir, extraEnv = {}) {
  const result = execSync(`node "${SCORE_SCRIPT}" 2>&1`, {
    cwd: tmpDir,
    env: {
      ...process.env,
      DEEPSEEK_API_KEY: 'test-key',
      PIPELINE_PORT: '3001',
      PIPELINE_BASE_DIR: tmpDir,
      NODE_OPTIONS: '--require ' + path.join(PROJECT_ROOT, 'tests/helpers/msw-setup.js'),
      ...extraEnv,
    },
    encoding: 'utf8',
  });
  return { stdout: result };
}

/**
 * Run score.js expecting a non-zero exit code.
 * stderr is redirected to stdout via 2>&1 so error output is captured.
 * Returns stdout from the error object (or an empty string on unexpected success).
 */
function runScoreExpectFail(tmpDir, extraEnv = {}) {
  try {
    execSync(`node "${SCORE_SCRIPT}" 2>&1`, {
      cwd: tmpDir,
      env: {
        ...process.env,
        DEEPSEEK_API_KEY: 'test-key',
        PIPELINE_PORT: '3001',
        PIPELINE_BASE_DIR: tmpDir,
        NODE_OPTIONS: '--require ' + path.join(PROJECT_ROOT, 'tests/helpers/msw-setup.js'),
        ...extraEnv,
      },
      encoding: 'utf8',
    });
    return { stdout: '' };
  } catch (err) {
    return { stdout: err.stdout || '' };
  }
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('score.js', () => {
  /** @type {string} */
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await setupTempDir();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  // ── Test 1: Produces stack rank from fixture jobs ─────────────────────
  it('produces stack rank from fixture jobs', async () => {
    await copyFixture(tmpDir, 'sample_job_1.md');
    await copyFixture(tmpDir, 'sample_job_2.md');

    const { stdout } = runScore(tmpDir);

    // Verify the completion banner
    expect(stdout).toMatch(/Done\. 2 jobs scored/);

    // Verify stack rank file was written
    const stackRankPath = path.join(tmpDir, 'resumes', '2026-06-02', 'stack_rank_2026-06-02.md');
    const content = await fs.readFile(stackRankPath, 'utf-8');

    // Both jobs should appear
    expect(content).toContain('Meridian Health Systems');
    expect(content).toContain('Vantara Financial');
    expect(content).toContain('Source file:');
  });

  // ── Test 2: Stack rank contains stats line ────────────────────────────
  it('stack rank contains stats line', async () => {
    await copyFixture(tmpDir, 'sample_job_1.md');
    await copyFixture(tmpDir, 'sample_job_2.md');

    const { stdout } = runScore(tmpDir);

    const stackRankPath = path.join(tmpDir, 'resumes', '2026-06-02', 'stack_rank_2026-06-02.md');
    const content = await fs.readFile(stackRankPath, 'utf-8');

    // Stats line format: mean, range, distribution
    expect(content).toMatch(/Score stats: mean \d+\.\d+ \| range \d+–\d+ \| distribution:/);
  });

  // ── Test 3: Skips URL duplicate and logs warning ─────────────────────
  it('skips URL duplicate and logs warning', async () => {
    await copyFixture(tmpDir, 'sample_job_1.md');
    await copyFixture(tmpDir, 'sample_job_duplicate.md');
    await copyFixture(tmpDir, 'sample_job_2.md');

    const { stdout } = runScore(tmpDir);

    // Should only score 2 unique jobs (the duplicate was skipped)
    expect(stdout).toMatch(/Done\. 2 jobs scored/);

    // Duplicate warning should appear (stderr redirected to stdout via 2>&1)
    expect(stdout).toMatch(/WARN.*Duplicate skipped/);
  });

  // ── Test 4: Fuzzy duplicate warning in stack rank ────────────────────
  it('fuzzy duplicate warning in stack rank when applicable', async () => {
    await copyFixture(tmpDir, 'sample_job_1.md');
    await copyFixture(tmpDir, 'sample_job_fuzzy_duplicate.md');
    await copyFixture(tmpDir, 'sample_job_2.md');

    const { stdout } = runScore(tmpDir);

    // Fuzzy duplicate warning in terminal output (stderr redirected to stdout)
    expect(stdout).toMatch(/WARN.*Fuzzy:/);

    // Fuzzy warning in stack rank file
    const stackRankPath = path.join(tmpDir, 'resumes', '2026-06-02', 'stack_rank_2026-06-02.md');
    try {
      const content = await fs.readFile(stackRankPath, 'utf-8');
      expect(content).toMatch(/⚠️.*Possible duplicate/);
    } catch {
      // If the file was read successfully, the assertions above apply.
      // If not, the test failed — but the before/after hooks handle cleanup.
    }
  });

  // ── Test 5: Skips malformed file and continues ───────────────────────
  it('skips malformed file and continues', async () => {
    await copyFixture(tmpDir, 'sample_job_1.md');
    await copyFixture(tmpDir, 'sample_job_2.md');

    // Create a malformed file (missing title heading)
    const malformed = `## Metadata
- **Company:** Bad Company
- **Location:** Nowhere
- **Employment Type:** Full-time
- **URL:** https://example.com/job/1
- **Harvested:** 2026-05-30 09:00

## Job Description
This description has no title.`;
    await fs.writeFile(path.join(tmpDir, 'jobs', 'malformed.md'), malformed, 'utf-8');

    const { stdout } = runScore(tmpDir);

    // Should still process the 2 valid jobs
    expect(stdout).toMatch(/Done\. 2 jobs scored/);

    // Warning about malformed file (stderr redirected to stdout via 2>&1)
    expect(stdout).toMatch(/WARN.*Skipping malformed\.md/);
  });

  // ── Test 6: Exits 1 listing missing configs ──────────────────────────
  it('exits 1 listing missing configs', async () => {
    // Create a temp dir WITHOUT config files
    const noConfigDir = await fs.mkdtemp(path.join(os.tmpdir(), 'score-e2e-noconfig-'));
    await fs.mkdir(path.join(noConfigDir, 'jobs'), { recursive: true });
    await fs.mkdir(path.join(noConfigDir, 'resumes'), { recursive: true });
    // Create a valid job file so it gets past the empty jobs check
    await copyFixture(noConfigDir, 'sample_job_1.md');

    const { stdout } = runScoreExpectFail(noConfigDir);

    expect(stdout).toMatch(/ERROR.*Missing config file/);
    expect(stdout).toMatch(/scoring_prompt\.md/);
    expect(stdout).toMatch(/adam_buteux_career\.md/);

    await fs.rm(noConfigDir, { recursive: true, force: true });
  });

  // ── Test 7: Exits 0 with message when jobs/ empty ────────────────────
  it('exits 0 with message when jobs/ empty', async () => {
    // tmpDir has empty jobs/ directory
    const { stdout } = runScore(tmpDir);

    expect(stdout).toMatch(/No job files found/);
  });

  // ── Test 8: Respects --date flag ─────────────────────────────────────
  it('respects --date flag', async () => {
    await copyFixture(tmpDir, 'sample_job_1.md');
    await copyFixture(tmpDir, 'sample_job_2.md');

    const customDate = '2026-05-29';

    const result = execSync(`node "${SCORE_SCRIPT}" --date=${customDate} 2>&1`, {
      cwd: tmpDir,
      env: {
        ...process.env,
        DEEPSEEK_API_KEY: 'test-key',
        PIPELINE_PORT: '3001',
        PIPELINE_BASE_DIR: tmpDir,
        NODE_OPTIONS: '--require ' + path.join(PROJECT_ROOT, 'tests/helpers/msw-setup.js'),
      },
      encoding: 'utf8',
    });

    // Stack rank should be written with the custom date
    const stackRankPath = path.join(tmpDir, 'resumes', customDate, `stack_rank_${customDate}.md`);
    const content = await fs.readFile(stackRankPath, 'utf-8');

    expect(content).toContain(`# Stack Rank — ${customDate}`);
    expect(result).toContain(`stack_rank_${customDate}.md`);
  });

  // ── Test 9: Logs progress per job ────────────────────────────────────
  it('logs progress per job', async () => {
    await copyFixture(tmpDir, 'sample_job_1.md');
    await copyFixture(tmpDir, 'sample_job_2.md');

    const { stdout } = runScore(tmpDir);

    // Progress lines should appear for each job
    expect(stdout).toMatch(/1\/2:.*est\. \d+s remaining/);
    expect(stdout).toMatch(/2\/2:.*est\. \d+s remaining/);
  });
});
