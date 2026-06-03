'use strict';

const { execSync } = require('child_process');
const path = require('path');
const { promises: fs } = require('fs');
const os = require('os');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const FIXTURES_DIR = path.resolve(__dirname, '../fixtures');
const GENERATE_SCRIPT = path.join(PROJECT_ROOT, 'generate.js');

// ── Stack rank builders ────────────────────────────────────────────────────────

/**
 * Build a single stack rank entry in the format expected by parseStackRank.
 *
 * @param {number} rank - Numeric rank (1-based).
 * @param {number} score - Score 1-10.
 * @param {string} actionFlag - 'DEEP_TAILOR', 'AUTO_GENERATED', or 'NO_DOCS'.
 * @param {string} company - Company name.
 * @param {string} title - Job title.
 * @param {string} sourceFilename - Source job file name.
 * @param {string} linkedInJobId - LinkedIn job ID.
 * @param {string} url - Job URL.
 * @param {string} fitSignal - Fit signal text.
 * @param {string} gap - Gap text.
 * @returns {string} Markdown entry block.
 */
function stackRankEntry(rank, score, actionFlag, company, title, sourceFilename, linkedInJobId, url, fitSignal, gap) {
  const emoji = actionFlag === 'DEEP_TAILOR' ? '🔴' : actionFlag === 'AUTO_GENERATED' ? '🟡' : '⚪';
  return `## ${rank}. [${score}/10] [${emoji} ${actionFlag}] — ${company} | ${title}
**Source file:** ${sourceFilename}
**LinkedIn Job ID:** ${linkedInJobId}
**URL:** ${url}
**Fit:** ${fitSignal}
**Gap:** ${gap}

---`;
}

/**
 * Build a complete stack rank markdown file.
 *
 * @param {string} dateStr - Date string in "YYYY-MM-DD" format.
 * @param {string[]} entries - Array of entry blocks from stackRankEntry().
 * @returns {string} Full stack rank markdown.
 */
function buildStackRank(dateStr, entries) {
  return `# Stack Rank — ${dateStr}

${entries.join('\n\n')}

Score stats: mean 7.0 | range 4–8 | distribution: 4:0,5:0,6:0,7:2,8:0,9:0,10:0`;
}

/**
 * Simulate sanitizeForFilename to compute expected output directory names.
 * Mirrors sanitizeForFilename in src/models/job.js.
 *
 * @param {string} str - Input string.
 * @returns {string} Sanitized string.
 */
function sanitize(str) {
  let result = str.replace(/\s+/g, '-');
  result = result.replace(/[&()/, '"@#$%^*!?<>|\\:;]/g, '');
  result = result.replace(/-+/g, '-');
  result = result.replace(/^-+/, '').replace(/-+$/, '');
  return result;
}

/**
 * Compute the expected output directory name for a given company and title.
 *
 * @param {string} company - Company name.
 * @param {string} title - Job title.
 * @returns {string} The folder name used on disk.
 */
function outputFolderName(company, title) {
  return `${sanitize(company)} - ${sanitize(title)}`;
}

// ── Config file contents ───────────────────────────────────────────────────────

const RESUME_PROMPT_CONTENT = 'You are an expert resume writer. Generate a tailored resume based on the candidate profile and job description.';
const CL_PROMPT_CONTENT = 'You are an expert cover letter writer. Generate a compelling cover letter based on the candidate profile and job description.';
const CAREER_CONTENT = `# Adam Buteux, MBA, CISSP, CIPM
Portland, Oregon

## Professional Summary
Senior governance and privacy professional with 15+ years driving compliance programs at scale.

## Professional Experience
### Meta | Senior Manager, Privacy & Risk Review | June 2022–November 2025
Led enterprise AI risk review across Facebook, Instagram, and Messenger.

## Education
Executive MBA — Bayes Business School, London

## Certifications
CISSP | CIPM`;

const PILLAR_LIBRARY_CONTENT = `# Pillar Library

## Program Leadership
Track record of building privacy programs from scratch.

## Risk Governance
Experience with enterprise risk management frameworks.`;

const QUALITY_PROMPT_CONTENT = 'You are a neutral quality assessor. Score the quality of the generated resume and cover letter.';

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Create a temporary directory with config/, jobs/, and resumes/ subdirectories.
 * Populates config/ with all 5 required config files.
 *
 * @returns {Promise<string>} The temp directory path.
 */
async function setupTempDir() {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'generate-e2e-'));
  await fs.mkdir(path.join(tmpDir, 'config'), { recursive: true });
  await fs.mkdir(path.join(tmpDir, 'jobs'), { recursive: true });
  await fs.mkdir(path.join(tmpDir, 'resumes'), { recursive: true });

  // Write all 5 required mock config files
  await fs.writeFile(path.join(tmpDir, 'config', 'resume_prompt.md'), RESUME_PROMPT_CONTENT, 'utf-8');
  await fs.writeFile(path.join(tmpDir, 'config', 'cover_letter_prompt.md'), CL_PROMPT_CONTENT, 'utf-8');
  await fs.writeFile(path.join(tmpDir, 'config', 'adam_buteux_career.md'), CAREER_CONTENT, 'utf-8');
  await fs.writeFile(path.join(tmpDir, 'config', 'pillar_library.md'), PILLAR_LIBRARY_CONTENT, 'utf-8');
  await fs.writeFile(path.join(tmpDir, 'config', 'quality_prompt.md'), QUALITY_PROMPT_CONTENT, 'utf-8');

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
 * Write a stack rank file into resumes/<dateStr>/.
 */
async function writeStackRank(tmpDir, dateStr, content) {
  const stackRankDir = path.join(tmpDir, 'resumes', dateStr);
  await fs.mkdir(stackRankDir, { recursive: true });
  await fs.writeFile(path.join(stackRankDir, `stack_rank_${dateStr}.md`), content, 'utf-8');
}

/**
 * Run generate.js as a child process with the given temp directory as base.
 * stderr is redirected to stdout via 2>&1 so warnings are captured.
 *
 * @param {string} tmpDir - The temp directory (PIPELINE_BASE_DIR).
 * @param {object} [extraEnv] - Additional environment variables.
 * @param {string} [dateFlag] - Optional --date flag string (e.g. '--date=2026-05-29').
 * @returns {{ stdout: string }} Combined stdout+stderr output.
 */
function runGenerate(tmpDir, extraEnv = {}, dateFlag = '') {
  const result = execSync(`node "${GENERATE_SCRIPT}" ${dateFlag} 2>&1`, {
    cwd: tmpDir,
    env: {
      ...process.env,
      DEEPSEEK_API_KEY: 'test-key',
      PIPELINE_PORT: '3001',
      PIPELINE_BASE_DIR: tmpDir,
      NODE_OPTIONS: '--require ' + path.join(PROJECT_ROOT, 'tests/helpers/msw-generate-setup.js'),
      ...extraEnv,
    },
    encoding: 'utf8',
  });
  return { stdout: result };
}

/**
 * Run generate.js expecting a non-zero exit code.
 * Returns stdout from the error object (or empty string on unexpected success).
 */
function runGenerateExpectFail(tmpDir, extraEnv = {}, dateFlag = '') {
  try {
    execSync(`node "${GENERATE_SCRIPT}" ${dateFlag} 2>&1`, {
      cwd: tmpDir,
      env: {
        ...process.env,
        DEEPSEEK_API_KEY: 'test-key',
        PIPELINE_PORT: '3001',
        PIPELINE_BASE_DIR: tmpDir,
        NODE_OPTIONS: '--require ' + path.join(PROJECT_ROOT, 'tests/helpers/msw-generate-setup.js'),
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

describe('generate.js', () => {
  /** @type {string} */
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await setupTempDir();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  // The default date used by generate.js when --date is not provided
  const defaultDate = '2026-06-02';

  // ── Test 1: Generates resume.md, cover_letter.md, submission_record.md ──
  it('generates resume.md, cover_letter.md, submission_record.md for qualifying jobs', async () => {
    await copyFixture(tmpDir, 'sample_job_1.md');
    await copyFixture(tmpDir, 'sample_job_2.md');

    const stackRank = buildStackRank(defaultDate, [
      stackRankEntry(1, 7, 'DEEP_TAILOR', 'Meridian Health Systems', 'Senior Privacy Manager',
        'sample_job_1.md', '3987654321', 'https://www.linkedin.com/jobs/view/3987654321',
        'Strong alignment on governance program leadership and enterprise compliance scope.',
        'No direct healthcare domain experience.'),
      stackRankEntry(2, 6, 'AUTO_GENERATED', 'Vantara Financial', 'AI Governance Analyst',
        'sample_job_2.md', '1122334455', 'https://www.linkedin.com/jobs/view/1122334455',
        'Risk governance experience applicable.',
        'No financial services background.'),
    ]);
    await writeStackRank(tmpDir, defaultDate, stackRank);

    const { stdout } = runGenerate(tmpDir);

    // Completion banner
    expect(stdout).toMatch(/Done\. 2 packages written/);

    // ── Job 1: Meridian Health Systems ──
    const folder1 = outputFolderName('Meridian Health Systems', 'Senior Privacy Manager');
    const outputDir1 = path.join(tmpDir, 'resumes', defaultDate, folder1);
    const resume1 = await fs.readFile(path.join(outputDir1, 'resume.md'), 'utf-8');
    const coverLetter1 = await fs.readFile(path.join(outputDir1, 'cover_letter.md'), 'utf-8');
    const submissionRecord1 = await fs.readFile(path.join(outputDir1, 'submission_record.md'), 'utf-8');

    expect(resume1).toContain('Adam Buteux');
    expect(coverLetter1).toContain('Cover Letter');
    expect(submissionRecord1).toContain('Submission Record');
    expect(submissionRecord1).toContain('Meridian Health Systems');

    // ── Job 2: Vantara Financial ──
    const folder2 = outputFolderName('Vantara Financial', 'AI Governance Analyst');
    const outputDir2 = path.join(tmpDir, 'resumes', defaultDate, folder2);
    const resume2 = await fs.readFile(path.join(outputDir2, 'resume.md'), 'utf-8');
    const coverLetter2 = await fs.readFile(path.join(outputDir2, 'cover_letter.md'), 'utf-8');
    const submissionRecord2 = await fs.readFile(path.join(outputDir2, 'submission_record.md'), 'utf-8');

    expect(resume2).toContain('Adam Buteux');
    expect(coverLetter2).toContain('Cover Letter');
    expect(submissionRecord2).toContain('Submission Record');
    expect(submissionRecord2).toContain('Vantara Financial');

    // applications.json has 2 entries
    const appRecords = JSON.parse(await fs.readFile(path.join(tmpDir, 'applications.json'), 'utf-8'));
    expect(appRecords).toHaveLength(2);
    expect(appRecords[0].company).toBe('Meridian Health Systems');
    expect(appRecords[0].title).toBe('Senior Privacy Manager');
    expect(appRecords[0].actionFlag).toBe('DEEP_TAILOR');
    expect(appRecords[1].company).toBe('Vantara Financial');
    expect(appRecords[1].title).toBe('AI Governance Analyst');
    expect(appRecords[1].actionFlag).toBe('AUTO_GENERATED');
  });

  // ── Test 2: No output for NO_DOCS jobs ─────────────────────────────────
  it('produces no output for NO_DOCS jobs', async () => {
    await copyFixture(tmpDir, 'sample_job_1.md');

    // Mix of DEEP_TAILOR and NO_DOCS
    const stackRank = buildStackRank(defaultDate, [
      stackRankEntry(1, 7, 'DEEP_TAILOR', 'Meridian Health Systems', 'Senior Privacy Manager',
        'sample_job_1.md', '3987654321', 'https://www.linkedin.com/jobs/view/3987654321',
        'Strong alignment on governance program leadership.',
        'No direct healthcare domain experience.'),
      stackRankEntry(2, 4, 'NO_DOCS', 'Low Fit Company', 'Unrelated Role',
        'sample_job_1.md', '5555555555', 'https://www.linkedin.com/jobs/view/5555555555',
        'Weak alignment.',
        'Major gaps in experience.'),
    ]);
    await writeStackRank(tmpDir, defaultDate, stackRank);

    const { stdout } = runGenerate(tmpDir);

    // Only 1 package generated (NO_DOCS filtered out)
    expect(stdout).toMatch(/Done\. 1 packages written/);

    // Output for qualifying job exists
    const folder1 = outputFolderName('Meridian Health Systems', 'Senior Privacy Manager');
    const outputDir1 = path.join(tmpDir, 'resumes', defaultDate, folder1);
    await expect(fs.access(path.join(outputDir1, 'resume.md'))).resolves.toBeUndefined();

    // No output for NO_DOCS job — no output dir created
    const folder2 = outputFolderName('Low Fit Company', 'Unrelated Role');
    const outputDir2 = path.join(tmpDir, 'resumes', defaultDate, folder2);
    await expect(fs.access(outputDir2)).rejects.toThrow(/ENOENT/);

    // Only 1 entry in applications.json
    const appRecords = JSON.parse(await fs.readFile(path.join(tmpDir, 'applications.json'), 'utf-8'));
    expect(appRecords).toHaveLength(1);
  });

  // ── Test 3: Idempotent — skips existing output directories ──────────────
  it('is idempotent — skips existing output directories', async () => {
    await copyFixture(tmpDir, 'sample_job_1.md');

    const stackRank = buildStackRank(defaultDate, [
      stackRankEntry(1, 7, 'DEEP_TAILOR', 'Meridian Health Systems', 'Senior Privacy Manager',
        'sample_job_1.md', '3987654321', 'https://www.linkedin.com/jobs/view/3987654321',
        'Strong alignment on governance program leadership.',
        'No direct healthcare domain experience.'),
    ]);
    await writeStackRank(tmpDir, defaultDate, stackRank);

    // First run
    const { stdout: run1 } = runGenerate(tmpDir);
    expect(run1).toMatch(/Done\. 1 packages written/);

    // Second run — should skip existing
    const { stdout: run2 } = runGenerate(tmpDir);
    expect(run2).toMatch(/output already exists/);
    expect(run2).toMatch(/Done\. 0 packages written/);

    // Verify output files are still intact
    const folder = outputFolderName('Meridian Health Systems', 'Senior Privacy Manager');
    const outputDir = path.join(tmpDir, 'resumes', defaultDate, folder);
    await expect(fs.access(path.join(outputDir, 'resume.md'))).resolves.toBeUndefined();
    await expect(fs.access(path.join(outputDir, 'cover_letter.md'))).resolves.toBeUndefined();
    await expect(fs.access(path.join(outputDir, 'submission_record.md'))).resolves.toBeUndefined();

    // applications.json still has 1 entry (no duplicate)
    const appRecords = JSON.parse(await fs.readFile(path.join(tmpDir, 'applications.json'), 'utf-8'));
    expect(appRecords).toHaveLength(1);
  });

  // ── Test 4: Handles missing source file gracefully ─────────────────────
  it('handles missing source file gracefully', async () => {
    // Stack rank references a job file that does NOT exist in jobs/
    const stackRank = buildStackRank(defaultDate, [
      stackRankEntry(1, 7, 'DEEP_TAILOR', 'Meridian Health Systems', 'Senior Privacy Manager',
        'sample_job_1.md', '3987654321', 'https://www.linkedin.com/jobs/view/3987654321',
        'Strong alignment on governance program leadership.',
        'No direct healthcare domain experience.'),
    ]);
    await writeStackRank(tmpDir, defaultDate, stackRank);

    const { stdout } = runGenerate(tmpDir);

    // Should log warning about cleanup having run
    expect(stdout).toMatch(/cleanup may have run/);
    expect(stdout).toMatch(/Skipping/);

    // No packages written
    expect(stdout).toMatch(/Done\. 0 packages written/);
  });

  // ── Test 5: Exit 1 with date hint when stack rank not found ────────────
  it('exits 1 with date hint when stack rank not found', async () => {
    const { stdout } = runGenerateExpectFail(tmpDir);

    expect(stdout).toMatch(/No stack rank/);
    expect(stdout).toMatch(/node score\.js --date=/);
  });

  // ── Test 6: Exit 1 listing all missing configs ─────────────────────────
  it('exits 1 listing all missing configs', async () => {
    const noConfigDir = await fs.mkdtemp(path.join(os.tmpdir(), 'generate-e2e-noconfig-'));
    await fs.mkdir(path.join(noConfigDir, 'jobs'), { recursive: true });
    await fs.mkdir(path.join(noConfigDir, 'resumes'), { recursive: true });

    const { stdout } = runGenerateExpectFail(noConfigDir);

    expect(stdout).toMatch(/ERROR.*Missing config file/);
    expect(stdout).toMatch(/resume_prompt\.md/);
    expect(stdout).toMatch(/cover_letter_prompt\.md/);
    expect(stdout).toMatch(/adam_buteux_career\.md/);
    expect(stdout).toMatch(/pillar_library\.md/);
    expect(stdout).toMatch(/quality_prompt\.md/);

    await fs.rm(noConfigDir, { recursive: true, force: true });
  });

  // ── Test 7: Quality call failure does not block resume/CL write ────────
  it('quality call failure does not block resume/CL write', async () => {
    await copyFixture(tmpDir, 'sample_job_1.md');

    const stackRank = buildStackRank(defaultDate, [
      stackRankEntry(1, 7, 'DEEP_TAILOR', 'Meridian Health Systems', 'Senior Privacy Manager',
        'sample_job_1.md', '3987654321', 'https://www.linkedin.com/jobs/view/3987654321',
        'Strong alignment on governance program leadership.',
        'No direct healthcare domain experience.'),
    ]);
    await writeStackRank(tmpDir, defaultDate, stackRank);

    // Use quality-fail msw handler by overriding NODE_OPTIONS
    const { stdout } = runGenerate(tmpDir, {
      NODE_OPTIONS: '--require ' + path.join(PROJECT_ROOT, 'tests/helpers/msw-generate-quality-fail.js'),
    });

    // Should log quality assessment failure warning
    expect(stdout).toMatch(/Quality assessment failed/);

    // Resume and cover letter should still be written
    const folder = outputFolderName('Meridian Health Systems', 'Senior Privacy Manager');
    const outputDir = path.join(tmpDir, 'resumes', defaultDate, folder);
    await expect(fs.access(path.join(outputDir, 'resume.md'))).resolves.toBeUndefined();
    await expect(fs.access(path.join(outputDir, 'cover_letter.md'))).resolves.toBeUndefined();
    await expect(fs.access(path.join(outputDir, 'submission_record.md'))).resolves.toBeUndefined();

    // Quality fields should be null in applications.json
    const appRecords = JSON.parse(await fs.readFile(path.join(tmpDir, 'applications.json'), 'utf-8'));
    expect(appRecords).toHaveLength(1);
    expect(appRecords[0].resumeQuality).toBeNull();
    expect(appRecords[0].coverLetterQuality).toBeNull();
    expect(appRecords[0].qualityNote).toBeNull();
    expect(appRecords[0].pillarsSelected).toStrictEqual([]);
    expect(appRecords[0].coverLetterParas).toBeNull();
  });

  // ── Test 8: applications.json preserves existing records ───────────────
  it('preserves existing records in applications.json', async () => {
    await copyFixture(tmpDir, 'sample_job_1.md');

    // Create an existing applications.json with one record
    const existingRecord = {
      id: '2026-06-02_meridian-health-systems_senior-privacy-manager',
      company: 'Meridian Health Systems',
      title: 'Senior Privacy Manager',
      url: 'https://www.linkedin.com/jobs/view/3987654321',
      linkedInJobId: '3987654321',
      score: 7,
      actionFlag: 'DEEP_TAILOR',
      resumeQuality: null,
      coverLetterQuality: null,
      qualityNote: null,
      pillarsSelected: [],
      coverLetterParas: null,
      outputPath: '/some/old/path',
      dateGenerated: '2026-06-01',
      dateApplied: null,
      applicationMethod: null,
      status: 'generated',
      notes: '',
    };
    await fs.writeFile(
      path.join(tmpDir, 'applications.json'),
      JSON.stringify([existingRecord], null, 2),
      'utf-8'
    );

    const stackRank = buildStackRank(defaultDate, [
      stackRankEntry(1, 7, 'DEEP_TAILOR', 'Meridian Health Systems', 'Senior Privacy Manager',
        'sample_job_1.md', '3987654321', 'https://www.linkedin.com/jobs/view/3987654321',
        'Strong alignment on governance program leadership.',
        'No direct healthcare domain experience.'),
    ]);
    await writeStackRank(tmpDir, defaultDate, stackRank);

    const { stdout } = runGenerate(tmpDir);
    expect(stdout).toMatch(/Done\. 1 packages written/);

    // Verify existing record is preserved alongside new record
    const appRecords = JSON.parse(await fs.readFile(path.join(tmpDir, 'applications.json'), 'utf-8'));
    expect(appRecords).toHaveLength(2);
    expect(appRecords[0].id).toBe(existingRecord.id);
    expect(appRecords[0].company).toBe('Meridian Health Systems');
    expect(appRecords[0].dateGenerated).toBe('2026-06-01');
    expect(appRecords[1].company).toBe('Meridian Health Systems');
    expect(appRecords[1].dateGenerated).toBe('2026-06-02');
  });

  // ── Test 9: Each entry in applications.json has correct fields ─────────
  it('each entry in applications.json has correct fields', async () => {
    await copyFixture(tmpDir, 'sample_job_1.md');

    const stackRank = buildStackRank(defaultDate, [
      stackRankEntry(1, 7, 'DEEP_TAILOR', 'Meridian Health Systems', 'Senior Privacy Manager',
        'sample_job_1.md', '3987654321', 'https://www.linkedin.com/jobs/view/3987654321',
        'Strong alignment on governance program leadership and enterprise compliance scope.',
        'No direct healthcare domain experience.'),
    ]);
    await writeStackRank(tmpDir, defaultDate, stackRank);

    const { stdout } = runGenerate(tmpDir);
    expect(stdout).toMatch(/Done\. 1 packages written/);

    const appRecords = JSON.parse(await fs.readFile(path.join(tmpDir, 'applications.json'), 'utf-8'));
    const record = appRecords[0];

    // All ApplicationRecord fields present
    expect(record).toHaveProperty('id');
    expect(record).toHaveProperty('company', 'Meridian Health Systems');
    expect(record).toHaveProperty('title', 'Senior Privacy Manager');
    expect(record).toHaveProperty('url', 'https://www.linkedin.com/jobs/view/3987654321');
    expect(record).toHaveProperty('linkedInJobId', '3987654321');
    expect(record).toHaveProperty('score', 7);
    expect(record).toHaveProperty('actionFlag', 'DEEP_TAILOR');
    expect(record).toHaveProperty('resumeQuality', 7);
    expect(record).toHaveProperty('coverLetterQuality', 6);
    expect(record).toHaveProperty('qualityNote');
    expect(record).toHaveProperty('pillarsSelected');
    expect(Array.isArray(record.pillarsSelected)).toBe(true);
    expect(record).toHaveProperty('coverLetterParas', 2);
    expect(record).toHaveProperty('outputPath');
    expect(record).toHaveProperty('dateGenerated', defaultDate);
    expect(record).toHaveProperty('dateApplied', null);
    expect(record).toHaveProperty('applicationMethod', null);
    expect(record).toHaveProperty('status', 'generated');
    expect(record).toHaveProperty('notes', '');
  });

  // ── Test 10: doc_generated event includes sourceFilename ───────────────
  it('doc_generated event includes sourceFilename', async () => {
    await copyFixture(tmpDir, 'sample_job_1.md');

    const stackRank = buildStackRank(defaultDate, [
      stackRankEntry(1, 7, 'DEEP_TAILOR', 'Meridian Health Systems', 'Senior Privacy Manager',
        'sample_job_1.md', '3987654321', 'https://www.linkedin.com/jobs/view/3987654321',
        'Strong alignment on governance program leadership.',
        'No direct healthcare domain experience.'),
    ]);
    await writeStackRank(tmpDir, defaultDate, stackRank);

    const { stdout } = runGenerate(tmpDir);

    // stdout should contain the company name from the stack rank entry
    expect(stdout).toContain('Meridian Health Systems');
    expect(stdout).toContain('Done. 1 packages written');
  });

  // ── Test 11: Respects --date flag ──────────────────────────────────────
  it('respects --date flag', async () => {
    await copyFixture(tmpDir, 'sample_job_1.md');

    const customDate = '2026-05-29';
    const stackRank = buildStackRank(customDate, [
      stackRankEntry(1, 7, 'DEEP_TAILOR', 'Meridian Health Systems', 'Senior Privacy Manager',
        'sample_job_1.md', '3987654321', 'https://www.linkedin.com/jobs/view/3987654321',
        'Strong alignment on governance program leadership.',
        'No direct healthcare domain experience.'),
    ]);
    await writeStackRank(tmpDir, customDate, stackRank);

    const result = execSync(`node "${GENERATE_SCRIPT}" --date=${customDate} 2>&1`, {
      cwd: tmpDir,
      env: {
        ...process.env,
        DEEPSEEK_API_KEY: 'test-key',
        PIPELINE_PORT: '3001',
        PIPELINE_BASE_DIR: tmpDir,
        NODE_OPTIONS: '--require ' + path.join(PROJECT_ROOT, 'tests/helpers/msw-generate-setup.js'),
      },
      encoding: 'utf8',
    });

    // Banner should reference the custom date directory
    expect(result).toContain(customDate);
    expect(result).toMatch(/Done\. 1 packages written/);

    // Output files in the custom date directory
    const folder = outputFolderName('Meridian Health Systems', 'Senior Privacy Manager');
    const outputDir = path.join(tmpDir, 'resumes', customDate, folder);
    await expect(fs.access(path.join(outputDir, 'resume.md'))).resolves.toBeUndefined();
    await expect(fs.access(path.join(outputDir, 'cover_letter.md'))).resolves.toBeUndefined();
    await expect(fs.access(path.join(outputDir, 'submission_record.md'))).resolves.toBeUndefined();
  });

  // ── Test 12: Logs progress per job ─────────────────────────────────────
  it('logs progress per job', async () => {
    await copyFixture(tmpDir, 'sample_job_1.md');
    await copyFixture(tmpDir, 'sample_job_2.md');

    const stackRank = buildStackRank(defaultDate, [
      stackRankEntry(1, 7, 'DEEP_TAILOR', 'Meridian Health Systems', 'Senior Privacy Manager',
        'sample_job_1.md', '3987654321', 'https://www.linkedin.com/jobs/view/3987654321',
        'Strong alignment on governance program leadership.',
        'No direct healthcare domain experience.'),
      stackRankEntry(2, 6, 'AUTO_GENERATED', 'Vantara Financial', 'AI Governance Analyst',
        'sample_job_2.md', '1122334455', 'https://www.linkedin.com/jobs/view/1122334455',
        'Risk governance experience applicable.',
        'No financial services background.'),
    ]);
    await writeStackRank(tmpDir, defaultDate, stackRank);

    const { stdout } = runGenerate(tmpDir);

    // Progress lines with job number and ETA
    expect(stdout).toMatch(/1\/2:.*est\. \d+s remaining/);
    expect(stdout).toMatch(/2\/2:.*est\. \d+s remaining/);
  });
});
