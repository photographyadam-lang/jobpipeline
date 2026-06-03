'use strict';

// ---------------------------------------------------------------------------
// IMPORTANT: jest.mock is hoisted above all imports. This replaces 'fs' for
// ALL modules that require it, including fileStore.js's internal require.
// We use jest.requireActual to delegate to the real fs by default, wrapping
// specific methods with jest.fn() so we can inject one-time errors.
// ---------------------------------------------------------------------------
jest.mock('fs', () => {
  const actual = jest.requireActual('fs');
  return {
    ...actual,
    promises: {
      access: jest.fn((...args) => actual.promises.access(...args)),
      readFile: jest.fn((...args) => actual.promises.readFile(...args)),
      readdir: jest.fn((...args) => actual.promises.readdir(...args)),
      writeFile: jest.fn((...args) => actual.promises.writeFile(...args)),
      mkdir: jest.fn((...args) => actual.promises.mkdir(...args)),
      mkdtemp: jest.fn((...args) => actual.promises.mkdtemp(...args)),
      rename: jest.fn((...args) => actual.promises.rename(...args)),
      rm: jest.fn((...args) => actual.promises.rm(...args)),
      stat: jest.fn((...args) => actual.promises.stat(...args)),
    },
  };
});

const path = require('path');
const os = require('os');
const { promises: fs } = require('fs');

const fileStore = require('../../src/lib/fileStore');
const { ConfigMissingError } = require('../../src/lib/errors');

// ---------------------------------------------------------------------------
// Coverage helpers
// ---------------------------------------------------------------------------

/**
 * Create an error object that mimics a non-ENOENT filesystem error.
 * @param {string} syscall - The syscall name (e.g. 'access', 'readFile').
 * @returns {Error} An error with err.code set to 'EACCES'.
 */
function makeFsError(syscall) {
  const err = new Error(`EACCES: permission denied, ${syscall}`);
  err.code = 'EACCES';
  err.errno = -13;
  err.syscall = syscall;
  return err;
}

// ---------------------------------------------------------------------------
// writeJobFile — non-ENOENT error from fs.access (covers src/lib/fileStore.js:66)
// ---------------------------------------------------------------------------
describe('writeJobFile — non-ENOENT error path', () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'job-pipeline-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('throws when fs.access rejects with non-ENOENT error', async () => {
    const jobsDir = path.join(tmpDir, 'jobs');
    await fs.mkdir(jobsDir, { recursive: true });

    // Intercept the next fs.access call to fail with EACCES
    fs.access.mockRejectedValueOnce(makeFsError('access'));

    await expect(
      fileStore.writeJobFile(jobsDir, 'job.md', '# Test')
    ).rejects.toThrow(/EACCES/);
  });
});

// ---------------------------------------------------------------------------
// readStackRank — non-ENOENT error from fs.readFile (covers src/lib/fileStore.js:105)
// ---------------------------------------------------------------------------
describe('readStackRank — non-ENOENT error path', () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'job-pipeline-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('throws when fs.readFile rejects with non-ENOENT error', async () => {
    const resumesDir = path.join(tmpDir, 'resumes');
    const dateStr = '2026-06-02';
    await fs.mkdir(path.join(resumesDir, dateStr), { recursive: true });
    // Create the stack rank file so readFile would normally succeed
    await fs.writeFile(
      path.join(resumesDir, dateStr, `stack_rank_${dateStr}.md`),
      '# Stack Rank',
      'utf-8'
    );

    // Intercept the next fs.readFile call to fail with EACCES
    fs.readFile.mockRejectedValueOnce(makeFsError('readFile'));

    await expect(
      fileStore.readStackRank(resumesDir, dateStr)
    ).rejects.toThrow(/EACCES/);
  });
});

// ---------------------------------------------------------------------------
// readConfig — non-ENOENT error from fs.readFile (covers src/lib/fileStore.js:125)
// ---------------------------------------------------------------------------
describe('readConfig — non-ENOENT error path', () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'job-pipeline-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('throws when fs.readFile rejects with non-ENOENT error', async () => {
    const configDir = path.join(tmpDir, 'config');
    await fs.mkdir(configDir, { recursive: true });
    // Create the config file so readFile would normally succeed
    await fs.writeFile(path.join(configDir, 'prompt.md'), 'prompt content', 'utf-8');

    // Intercept the next fs.readFile call to fail with EACCES
    fs.readFile.mockRejectedValueOnce(makeFsError('readFile'));

    await expect(
      fileStore.readConfig(configDir, 'prompt.md')
    ).rejects.toThrow(/EACCES/);
  });
});

// ---------------------------------------------------------------------------
// writeApplicationDocs — non-ENOENT error from fs.access
// (covers src/lib/fileStore.js:157)
// ---------------------------------------------------------------------------
describe('writeApplicationDocs — non-ENOENT error path', () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'job-pipeline-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('throws when fs.access rejects with non-ENOENT error', async () => {
    const resumesDir = path.join(tmpDir, 'resumes');
    const dateStr = '2026-06-02';
    const company = 'Acme';
    const title = 'Engineer';

    // Intercept the next fs.access call to fail with EACCES
    fs.access.mockRejectedValueOnce(makeFsError('access'));

    await expect(
      fileStore.writeApplicationDocs(resumesDir, dateStr, company, title, '# R', '# CL')
    ).rejects.toThrow(/EACCES/);
  });
});
