'use strict';

const { execSync } = require('child_process');
const path = require('path');
const { promises: fs } = require('fs');
const os = require('os');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const FIXTURES_DIR = path.resolve(__dirname, '../fixtures');
const SCORE_SCRIPT = path.join(PROJECT_ROOT, 'score.js');
const GENERATE_SCRIPT = path.join(PROJECT_ROOT, 'generate.js');
const CLEANUP_SCRIPT = path.join(PROJECT_ROOT, 'cleanup.js');

// Increase timeout for full pipeline execution
jest.setTimeout(60000);

// ── Config file contents ────────────────────────────────────────────────────────

const SCORING_PROMPT_CONTENT = 'You are a job fit scoring assistant. Score how well a candidate profile matches a job description.';
const RESUME_PROMPT_CONTENT = 'You are an expert resume writer. Generate a tailored resume based on the candidate profile and job description.';
const CL_PROMPT_CONTENT = 'You are an expert cover letter writer. Generate a compelling cover letter based on the candidate profile and job description.';
const QUALITY_PROMPT_CONTENT = 'You are a neutral quality assessor. Score the quality of the generated resume and cover letter.';

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

const PILLAR_LIBRARY_CONTENT = `# Pillar Library

## Program Leadership
Track record of building privacy programs from scratch.

## Risk Governance
Experience with enterprise risk management frameworks.`;

// ── Job POST bodies ─────────────────────────────────────────────────────────────

const JOB_1_BODY = {
  title: 'Senior Privacy Manager',
  company: 'Meridian Health Systems',
  location: 'Portland, OR',
  employmentType: 'Full-time',
  salary: '$150k-$180k',
  url: 'https://www.linkedin.com/jobs/view/3987654321/',
  linkedInJobId: '3987654321',
  description: 'We are looking for a Senior Privacy Manager to lead our privacy program across a multi-site health system. The ideal candidate will have experience building governance frameworks and managing enterprise compliance programs.',
};

const JOB_2_BODY = {
  title: 'AI Governance Analyst',
  company: 'Vantara Financial',
  location: 'San Francisco, CA',
  employmentType: 'Full-time',
  salary: '$120k-$150k',
  url: 'https://www.linkedin.com/jobs/view/1122334455/',
  linkedInJobId: '1122334455',
  description: 'Vantara Financial is seeking an AI Governance Analyst to develop and maintain AI risk frameworks, ensuring compliance with emerging regulations.',
};

// ── Today's date string (local time) ────────────────────────────────────────────

function todayDateStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ── Sanitize helper (mirrors src/models/job.js) ─────────────────────────────────

function sanitize(str) {
  let result = str.replace(/\s+/g, '-');
  result = result.replace(/[&()/, '"@#$%^*!?<>|\\:;]/g, '');
  result = result.replace(/-+/g, '-');
  result = result.replace(/^-+/, '').replace(/-+$/, '');
  return result;
}

function outputFolderName(company, title) {
  return `${sanitize(company)} - ${sanitize(title)}`;
}

// ── Setup temp directory ────────────────────────────────────────────────────────

async function setupTempDir(prefix) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), prefix || 'pipeline-e2e-'));

  await fs.mkdir(path.join(tmpDir, 'config'), { recursive: true });
  await fs.mkdir(path.join(tmpDir, 'jobs'), { recursive: true });
  await fs.mkdir(path.join(tmpDir, 'resumes'), { recursive: true });
  await fs.mkdir(path.join(tmpDir, 'archive'), { recursive: true });

  // Write all 6 config files
  await fs.writeFile(path.join(tmpDir, 'config', 'scoring_prompt.md'), SCORING_PROMPT_CONTENT, 'utf-8');
  await fs.writeFile(path.join(tmpDir, 'config', 'resume_prompt.md'), RESUME_PROMPT_CONTENT, 'utf-8');
  await fs.writeFile(path.join(tmpDir, 'config', 'cover_letter_prompt.md'), CL_PROMPT_CONTENT, 'utf-8');
  await fs.writeFile(path.join(tmpDir, 'config', 'quality_prompt.md'), QUALITY_PROMPT_CONTENT, 'utf-8');
  await fs.writeFile(path.join(tmpDir, 'config', 'adam_buteux_career.md'), CAREER_CONTENT, 'utf-8');
  await fs.writeFile(path.join(tmpDir, 'config', 'pillar_library.md'), PILLAR_LIBRARY_CONTENT, 'utf-8');

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
 * Create a background SSE event collector that stays connected until close() is called.
 *
 * @param {string} baseUrl - Server base URL.
 * @returns {{ events: object[], close: Function }}
 */
function createSSECollector(baseUrl) {
  const collector = {
    events: [],
    _reader: null,
    _closed: false,
    close() {
      collector._closed = true;
      if (collector._reader) {
        try { collector._reader.cancel(); } catch { /* ignore */ }
      }
    },
  };

  // Start background collection (do not await — runs until close())
  (async () => {
    try {
      const response = await fetch(`${baseUrl}/events`);
      const reader = response.body.getReader();
      collector._reader = reader;
      const decoder = new TextDecoder();
      let buffer = '';

      while (!collector._closed) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              collector.events.push(JSON.parse(line.slice(6)));
            } catch {
              // Skip malformed JSON
            }
          }
        }
      }
    } catch {
      // Connection closed or error
    }
  })();

  return collector;
}

// ── Child process runners ───────────────────────────────────────────────────────

function runScore(tmpDir, port, extraEnv = {}, dateFlag = '') {
  const result = execSync(`node "${SCORE_SCRIPT}" ${dateFlag} 2>&1`, {
    cwd: tmpDir,
    env: {
      ...process.env,
      DEEPSEEK_API_KEY: 'test-key',
      PIPELINE_PORT: String(port),
      PIPELINE_BASE_DIR: tmpDir,
      NODE_OPTIONS: '--require ' + path.join(PROJECT_ROOT, 'tests/helpers/msw-setup.js'),
      ...extraEnv,
    },
    encoding: 'utf8',
  });
  return { stdout: result };
}

function runGenerate(tmpDir, port, extraEnv = {}, dateFlag = '') {
  const result = execSync(`node "${GENERATE_SCRIPT}" ${dateFlag} 2>&1`, {
    cwd: tmpDir,
    env: {
      ...process.env,
      DEEPSEEK_API_KEY: 'test-key',
      PIPELINE_PORT: String(port),
      PIPELINE_BASE_DIR: tmpDir,
      NODE_OPTIONS: '--require ' + path.join(PROJECT_ROOT, 'tests/helpers/msw-generate-setup.js'),
      ...extraEnv,
    },
    encoding: 'utf8',
  });
  return { stdout: result };
}

function runGenerateExpectFail(tmpDir, port, extraEnv = {}, dateFlag = '') {
  try {
    execSync(`node "${GENERATE_SCRIPT}" ${dateFlag} 2>&1`, {
      cwd: tmpDir,
      env: {
        ...process.env,
        DEEPSEEK_API_KEY: 'test-key',
        PIPELINE_PORT: String(port),
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

// ═════════════════════════════════════════════════════════════════════════════════
// Same-day pipeline — full end-to-end test
// ═════════════════════════════════════════════════════════════════════════════════

describe('Same-day pipeline', () => {
  /** @type {string} */
  let tmpDir;
  /** @type {import('http').Server} */
  let httpServer;
  /** @type {string} */
  let baseUrl;
  /** @type {number} */
  let serverPort;
  /** @type {ReturnType<createSSECollector>} */
  let sseCollector;
  /** @type {string} */
  const dateStr = todayDateStr();

  beforeAll(async () => {
    tmpDir = await setupTempDir('pipeline-e2e-');

    // Start server
    const jobsDir = path.join(tmpDir, 'jobs');
    const { createApp } = require('../../server/server');
    const app = createApp(jobsDir);
    httpServer = app.listen(0);
    await new Promise(r => httpServer.once('listening', r));
    serverPort = httpServer.address().port;
    baseUrl = `http://localhost:${serverPort}`;

    // Start background SSE collection (runs until close() in afterAll)
    sseCollector = createSSECollector(baseUrl);

    // Give SSE client time to connect
    await new Promise(r => setTimeout(r, 200));
  });

  afterAll(async () => {
    if (sseCollector) sseCollector.close();
    if (httpServer) {
      await new Promise(r => httpServer.close(r));
    }
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  // ── Stage 1: Ingestion ───────────────────────────────────────────────────

  it('server writes valid job files from POST requests', async () => {
    const res1 = await fetch(`${baseUrl}/harvest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(JOB_1_BODY),
    });
    expect(res1.status).toBe(200);
    const body1 = await res1.json();
    expect(body1.success).toBe(true);
    expect(body1.filename).toMatch(/\.md$/);

    const res2 = await fetch(`${baseUrl}/harvest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(JOB_2_BODY),
    });
    expect(res2.status).toBe(200);
    const body2 = await res2.json();
    expect(body2.success).toBe(true);
    expect(body2.filename).toMatch(/\.md$/);

    // Verify 2 .md files exist in jobs/
    const files = await fs.readdir(path.join(tmpDir, 'jobs'));
    const mdFiles = files.filter(f => f.endsWith('.md'));
    expect(mdFiles).toHaveLength(2);

    // Verify server state reflects harvest
    const stateRes = await fetch(`${baseUrl}/state`);
    const state = await stateRes.json();
    expect(state.harvested).toHaveLength(2);
    expect(state.harvested[0].company).toBe('Meridian Health Systems');
    expect(state.harvested[1].company).toBe('Vantara Financial');
  });

  // ── Stage 2: Scoring ─────────────────────────────────────────────────────

  it('score.js produces stack rank with stats', async () => {
    const { stdout } = runScore(tmpDir, serverPort);

    // Exit 0
    expect(stdout).toMatch(/Done\. 2 jobs scored/);

    // Stack rank file exists
    const stackRankPath = path.join(tmpDir, 'resumes', dateStr, `stack_rank_${dateStr}.md`);
    const content = await fs.readFile(stackRankPath, 'utf-8');

    // Both jobs appear
    expect(content).toContain('Meridian Health Systems');
    expect(content).toContain('Vantara Financial');
    expect(content).toContain('Source file:');

    // Stats line present
    expect(content).toMatch(/Score stats: mean \d+\.\d+ \| range \d+–\d+ \| distribution:/);
  });

  // ── Stage 3: Generation ──────────────────────────────────────────────────

  it('generate.js produces docs for qualifying jobs', async () => {
    const { stdout } = runGenerate(tmpDir, serverPort);

    // Exit 0, 2 packages
    expect(stdout).toMatch(/Done\. 2 packages written/);

    // docs exist for job 1
    const folder1 = outputFolderName('Meridian Health Systems', 'Senior Privacy Manager');
    const outputDir1 = path.join(tmpDir, 'resumes', dateStr, folder1);
    const resume1 = await fs.readFile(path.join(outputDir1, 'resume.md'), 'utf-8');
    const coverLetter1 = await fs.readFile(path.join(outputDir1, 'cover_letter.md'), 'utf-8');
    const submissionRecord1 = await fs.readFile(path.join(outputDir1, 'submission_record.md'), 'utf-8');

    expect(resume1).toContain('Adam Buteux');
    expect(coverLetter1).toContain('Cover Letter');
    expect(submissionRecord1).toContain('Submission Record');
    expect(submissionRecord1).toContain('Meridian Health Systems');

    // docs exist for job 2
    const folder2 = outputFolderName('Vantara Financial', 'AI Governance Analyst');
    const outputDir2 = path.join(tmpDir, 'resumes', dateStr, folder2);
    const resume2 = await fs.readFile(path.join(outputDir2, 'resume.md'), 'utf-8');
    const coverLetter2 = await fs.readFile(path.join(outputDir2, 'cover_letter.md'), 'utf-8');
    const submissionRecord2 = await fs.readFile(path.join(outputDir2, 'submission_record.md'), 'utf-8');

    expect(resume2).toContain('Adam Buteux');
    expect(coverLetter2).toContain('Cover Letter');
    expect(submissionRecord2).toContain('Submission Record');
    expect(submissionRecord2).toContain('Vantara Financial');
  });

  // ── Stage 4: applications.json ───────────────────────────────────────────

  it('applications.json populated correctly', async () => {
    const appRecords = JSON.parse(
      await fs.readFile(path.join(tmpDir, 'applications.json'), 'utf-8')
    );
    expect(appRecords).toHaveLength(2);

    const record1 = appRecords.find(r => r.company === 'Meridian Health Systems');
    const record2 = appRecords.find(r => r.company === 'Vantara Financial');

    expect(record1).toBeDefined();
    expect(record1).toHaveProperty('id');
    expect(record1).toHaveProperty('title', 'Senior Privacy Manager');
    expect(record1).toHaveProperty('url', 'https://www.linkedin.com/jobs/view/3987654321/');
    expect(record1).toHaveProperty('linkedInJobId', '3987654321');
    expect(record1).toHaveProperty('score');
    expect(record1).toHaveProperty('actionFlag', 'DEEP_TAILOR');
    expect(record1).toHaveProperty('resumeQuality');
    expect(record1).toHaveProperty('coverLetterQuality');
    expect(record1).toHaveProperty('pillarsSelected');
    expect(Array.isArray(record1.pillarsSelected)).toBe(true);
    expect(record1).toHaveProperty('status', 'generated');
    expect(record1).toHaveProperty('dateGenerated');
    expect(record1).toHaveProperty('outputPath');

    expect(record2).toBeDefined();
    expect(record2).toHaveProperty('title', 'AI Governance Analyst');
    // With only 2 total jobs, the ranker assigns DEEP_TAILOR to all
    expect(record2).toHaveProperty('actionFlag', 'DEEP_TAILOR');
    expect(record2).toHaveProperty('status', 'generated');
  });

  // ── Stage 5: SSE events ──────────────────────────────────────────────────

  it('doc_generated SSE events include sourceFilename', async () => {
    // Wait briefly for any in-flight SSE events to arrive
    await new Promise(r => setTimeout(r, 500));

    const docGeneratedEvents = sseCollector.events.filter(
      e => e.type === 'doc_generated'
    );
    expect(docGeneratedEvents.length).toBeGreaterThanOrEqual(1);

    for (const event of docGeneratedEvents) {
      expect(event.data).toBeDefined();
      expect(event.data.sourceFilename).toBeDefined();
      expect(typeof event.data.sourceFilename).toBe('string');
      expect(event.data.sourceFilename.length).toBeGreaterThan(0);
    }
  });

  // ── Stage 6: Server state verification ───────────────────────────────────

  it('server state reflects full pipeline execution', async () => {
    const stateRes = await fetch(`${baseUrl}/state`);
    const state = await stateRes.json();

    // Phase should be idle after completion
    expect(state.phase).toBe('idle');

    // Harvested should have 2 entries
    expect(state.harvested).toHaveLength(2);

    // Scored should have 2 entries
    expect(state.scored).toHaveLength(2);

    // Stats should be populated
    expect(state.stats.scoreMean).toBeGreaterThan(0);
    expect(state.stats.scoreMin).toBeGreaterThan(0);
    expect(state.stats.scoreMax).toBeGreaterThan(0);

    // Generated should have 2 entries
    expect(state.generated).toHaveLength(2);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════
// Idempotency test
// ═════════════════════════════════════════════════════════════════════════════════

describe('Idempotency', () => {
  /** @type {string} */
  let tmpDir;
  /** @type {import('http').Server} */
  let httpServer;
  /** @type {number} */
  let serverPort;
  /** @type {string} */
  const dateStr = todayDateStr();

  beforeAll(async () => {
    tmpDir = await setupTempDir('pipeline-idempotency-');

    // Start server
    const jobsDir = path.join(tmpDir, 'jobs');
    const { createApp } = require('../../server/server');
    const app = createApp(jobsDir);
    httpServer = app.listen(0);
    await new Promise(r => httpServer.once('listening', r));
    serverPort = httpServer.address().port;
  });

  afterAll(async () => {
    if (httpServer) {
      await new Promise(r => httpServer.close(r));
    }
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('generate.js is idempotent — second run skips existing output directories', async () => {
    const baseUrl = `http://localhost:${serverPort}`;

    // POST job
    await fetch(`${baseUrl}/harvest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(JOB_1_BODY),
    });

    // Score
    runScore(tmpDir, serverPort);

    // First generate
    const { stdout: run1 } = runGenerate(tmpDir, serverPort);
    expect(run1).toMatch(/Done\. 1 packages written/);

    // Second generate — should skip
    const { stdout: run2 } = runGenerate(tmpDir, serverPort);
    expect(run2).toMatch(/output already exists/);
    expect(run2).toMatch(/Done\. 0 packages written/);

    // Output files still intact
    const folder = outputFolderName('Meridian Health Systems', 'Senior Privacy Manager');
    const outputDir = path.join(tmpDir, 'resumes', dateStr, folder);
    await expect(fs.access(path.join(outputDir, 'resume.md'))).resolves.toBeUndefined();
    await expect(fs.access(path.join(outputDir, 'cover_letter.md'))).resolves.toBeUndefined();
    await expect(fs.access(path.join(outputDir, 'submission_record.md'))).resolves.toBeUndefined();

    // applications.json still has 1 entry (no duplicate)
    const appRecords = JSON.parse(
      await fs.readFile(path.join(tmpDir, 'applications.json'), 'utf-8')
    );
    expect(appRecords).toHaveLength(1);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════
// Cleanup test
// ═════════════════════════════════════════════════════════════════════════════════

describe('Cleanup', () => {
  /** @type {string} */
  let tmpDir;
  /** @type {string} */
  const dateStr = todayDateStr();

  beforeAll(async () => {
    tmpDir = await setupTempDir('pipeline-cleanup-');
  });

  afterAll(async () => {
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('cleanup.js archives all job files and leaves jobs/ empty', async () => {
    // Copy fixture files into jobs/
    await copyFixture(tmpDir, 'sample_job_1.md');
    await copyFixture(tmpDir, 'sample_job_2.md');

    // Verify jobs/ has files
    let jobsFiles = await fs.readdir(path.join(tmpDir, 'jobs'));
    expect(jobsFiles.filter(f => f.endsWith('.md'))).toHaveLength(2);

    // Run cleanup
    const { stdout } = runCleanup(tmpDir);
    expect(stdout).toMatch(/Archived 2 files to archive/);

    // jobs/ empty
    jobsFiles = await fs.readdir(path.join(tmpDir, 'jobs'));
    expect(jobsFiles.filter(f => f.endsWith('.md'))).toHaveLength(0);

    // Files in archive
    const archiveDir = path.join(tmpDir, 'archive', dateStr);
    const archiveFiles = await fs.readdir(archiveDir);
    expect(archiveFiles).toContain('sample_job_1.md');
    expect(archiveFiles).toContain('sample_job_2.md');
  });
});

// ═════════════════════════════════════════════════════════════════════════════════
// Cross-day scenario
// ═════════════════════════════════════════════════════════════════════════════════

describe('Cross-day scenario', () => {
  /** @type {string} */
  let tmpDir;

  const crossDate = '2026-05-28';

  beforeEach(async () => {
    tmpDir = await setupTempDir('pipeline-crossday-');
  });

  afterEach(async () => {
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('score.js --date writes to correct folder', async () => {
    // Copy fixture jobs into temp dir
    await copyFixture(tmpDir, 'sample_job_1.md');
    await copyFixture(tmpDir, 'sample_job_2.md');

    // Run score with --date flag (no server needed — broadcasts fail silently)
    const { stdout } = runScore(tmpDir, '3001', {}, `--date=${crossDate}`);
    expect(stdout).toMatch(/Done\. 2 jobs scored/);

    // Stack rank should be in the cross-date folder, not today's folder
    const crossStackRankPath = path.join(tmpDir, 'resumes', crossDate, `stack_rank_${crossDate}.md`);
    const content = await fs.readFile(crossStackRankPath, 'utf-8');
    expect(content).toContain(`# Stack Rank — ${crossDate}`);
    expect(content).toContain('Meridian Health Systems');
    expect(content).toContain('Vantara Financial');

    // Today's folder should not exist (no stack rank written there)
    const todayStr = todayDateStr();
    if (todayStr !== crossDate) {
      const todayStackRankPath = path.join(tmpDir, 'resumes', todayStr, `stack_rank_${todayStr}.md`);
      await expect(fs.access(todayStackRankPath)).rejects.toThrow();
    }
  });

  it('generate.js --date uses correct stack rank and writes to --date folder', async () => {
    // Copy fixture job file into jobs/ so the source exists
    await copyFixture(tmpDir, 'sample_job_1.md');

    // Write a stack rank manually for the cross-date using the correct format
    const stackRankContent = `# Stack Rank — ${crossDate}

## 1. [7/10] [🔴 DEEP_TAILOR] — Meridian Health Systems | Senior Privacy Manager
**Source file:** sample_job_1.md
**LinkedIn Job ID:** 3987654321
**URL:** https://www.linkedin.com/jobs/view/3987654321
**Fit:** Strong alignment on governance program leadership and enterprise compliance scope.
**Gap:** No direct healthcare domain experience.

---

Score stats: mean 7.0 | range 7–7 | distribution: 4:0,5:0,6:0,7:1,8:0,9:0,10:0`;

    const stackRankDir = path.join(tmpDir, 'resumes', crossDate);
    await fs.mkdir(stackRankDir, { recursive: true });
    await fs.writeFile(path.join(stackRankDir, `stack_rank_${crossDate}.md`), stackRankContent, 'utf-8');

    // Run generate with --date flag (no server needed)
    const { stdout } = runGenerate(tmpDir, '3001', {}, `--date=${crossDate}`);
    expect(stdout).toMatch(/Done\. 1 packages written/);

    // Output files in the cross-date folder
    const folder = outputFolderName('Meridian Health Systems', 'Senior Privacy Manager');
    const outputDir = path.join(tmpDir, 'resumes', crossDate, folder);
    await expect(fs.access(path.join(outputDir, 'resume.md'))).resolves.toBeUndefined();
    await expect(fs.access(path.join(outputDir, 'cover_letter.md'))).resolves.toBeUndefined();
    await expect(fs.access(path.join(outputDir, 'submission_record.md'))).resolves.toBeUndefined();

    // applications.json in root
    const appRecords = JSON.parse(
      await fs.readFile(path.join(tmpDir, 'applications.json'), 'utf-8')
    );
    expect(appRecords).toHaveLength(1);
    expect(appRecords[0].dateGenerated).toBe(crossDate);
  });

  it('generate.js without --date exits 1 with date hint when stack rank not found', async () => {
    // No stack rank file exists for today's date
    const { stdout } = runGenerateExpectFail(tmpDir, '3001');
    expect(stdout).toMatch(/No stack rank/);
    expect(stdout).toMatch(/node score\.js --date=/);
  });
});
