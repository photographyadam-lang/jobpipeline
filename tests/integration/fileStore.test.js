'use strict';

const path = require('path');
const os = require('os');
const { promises: fs } = require('fs');

const fileStore = require('../../src/lib/fileStore');
const { ConfigMissingError } = require('../../src/lib/errors');

// ---------------------------------------------------------------------------
// readJobFiles
// ---------------------------------------------------------------------------
describe('readJobFiles', () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'job-pipeline-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('reads all .md files', async () => {
    const jobsDir = path.join(tmpDir, 'jobs');
    await fs.mkdir(jobsDir, { recursive: true });
    await fs.writeFile(path.join(jobsDir, 'job1.md'), '# Job One', 'utf-8');
    await fs.writeFile(path.join(jobsDir, 'job2.md'), '# Job Two', 'utf-8');

    const result = await fileStore.readJobFiles(jobsDir);
    expect(result).toHaveLength(2);
    expect(result).toEqual(
      expect.arrayContaining([
        { filename: 'job1.md', content: '# Job One' },
        { filename: 'job2.md', content: '# Job Two' },
      ])
    );
  });

  it('returns [] for empty directory', async () => {
    const jobsDir = path.join(tmpDir, 'jobs');
    await fs.mkdir(jobsDir, { recursive: true });

    const result = await fileStore.readJobFiles(jobsDir);
    expect(result).toEqual([]);
  });

  it('ignores non-.md files', async () => {
    const jobsDir = path.join(tmpDir, 'jobs');
    await fs.mkdir(jobsDir, { recursive: true });
    await fs.writeFile(path.join(jobsDir, 'readme.txt'), 'text', 'utf-8');
    await fs.writeFile(path.join(jobsDir, 'data.json'), '{}', 'utf-8');
    await fs.writeFile(path.join(jobsDir, 'job.md'), '# Real Job', 'utf-8');

    const result = await fileStore.readJobFiles(jobsDir);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ filename: 'job.md', content: '# Real Job' });
  });

  it('returns [] when directory does not exist', async () => {
    const jobsDir = path.join(tmpDir, 'nonexistent');
    const result = await fileStore.readJobFiles(jobsDir);
    expect(result).toEqual([]);
  });

  it('throws non-ENOENT errors from readdir', async () => {
    // Pass a file path, not a directory — fs.readdir will throw ENOTDIR
    const filePath = path.join(tmpDir, 'not-a-dir.md');
    await fs.writeFile(filePath, '', 'utf-8');

    await expect(fileStore.readJobFiles(filePath)).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// writeJobFile
// ---------------------------------------------------------------------------
describe('writeJobFile', () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'job-pipeline-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('writes new file', async () => {
    const jobsDir = path.join(tmpDir, 'jobs');
    await fs.mkdir(jobsDir, { recursive: true });

    const written = await fileStore.writeJobFile(jobsDir, 'job.md', '# Test Job');
    expect(written).toBe('job.md');

    const content = await fs.readFile(path.join(jobsDir, 'job.md'), 'utf-8');
    expect(content).toBe('# Test Job');
  });

  it('appends -2 on collision', async () => {
    const jobsDir = path.join(tmpDir, 'jobs');
    await fs.mkdir(jobsDir, { recursive: true });
    await fs.writeFile(path.join(jobsDir, 'job.md'), '# Original', 'utf-8');

    const written = await fileStore.writeJobFile(jobsDir, 'job.md', '# Second');
    expect(written).toBe('job-2.md');

    const content = await fs.readFile(path.join(jobsDir, 'job-2.md'), 'utf-8');
    expect(content).toBe('# Second');
  });

  it('appends -3 when -2 also exists', async () => {
    const jobsDir = path.join(tmpDir, 'jobs');
    await fs.mkdir(jobsDir, { recursive: true });
    await fs.writeFile(path.join(jobsDir, 'job.md'), '# Original', 'utf-8');
    await fs.writeFile(path.join(jobsDir, 'job-2.md'), '# Second', 'utf-8');

    const written = await fileStore.writeJobFile(jobsDir, 'job.md', '# Third');
    expect(written).toBe('job-3.md');

    const content = await fs.readFile(path.join(jobsDir, 'job-3.md'), 'utf-8');
    expect(content).toBe('# Third');
  });
});

// ---------------------------------------------------------------------------
// writeStackRank / readStackRank
// ---------------------------------------------------------------------------
describe('writeStackRank / readStackRank', () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'job-pipeline-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('round-trips correctly', async () => {
    const resumesDir = path.join(tmpDir, 'resumes');
    const dateStr = '2026-06-02';
    const content = '# Stack Rank\n\n| Rank | Score |\n|------|-------|\n| 1 | 9 |';

    const fullPath = await fileStore.writeStackRank(resumesDir, dateStr, content);
    expect(fullPath).toContain(`stack_rank_${dateStr}.md`);

    const readBack = await fileStore.readStackRank(resumesDir, dateStr);
    expect(readBack).toBe(content);
  });

  it('creates dated subdirectory if absent', async () => {
    const resumesDir = path.join(tmpDir, 'resumes');
    const dateStr = '2026-06-02';
    const content = '# Stack Rank';

    await fileStore.writeStackRank(resumesDir, dateStr, content);

    const dirExists = await fs.stat(path.join(resumesDir, dateStr));
    expect(dirExists.isDirectory()).toBe(true);
  });

  it('throws descriptive error including path when not found', async () => {
    const resumesDir = path.join(tmpDir, 'resumes');
    const dateStr = '2026-06-02';

    await expect(fileStore.readStackRank(resumesDir, dateStr)).rejects.toThrow(
      /Stack rank file not found:/
    );

    await expect(fileStore.readStackRank(resumesDir, dateStr)).rejects.toThrow(
      /stack_rank_2026-06-02\.md/
    );
  });

});

// ---------------------------------------------------------------------------
// readConfig
// ---------------------------------------------------------------------------
describe('readConfig', () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'job-pipeline-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('reads existing config file', async () => {
    const configDir = path.join(tmpDir, 'config');
    await fs.mkdir(configDir, { recursive: true });
    await fs.writeFile(path.join(configDir, 'prompt.md'), 'System prompt content', 'utf-8');

    const content = await fileStore.readConfig(configDir, 'prompt.md');
    expect(content).toBe('System prompt content');
  });

  it('throws ConfigMissingError with filename', async () => {
    const configDir = path.join(tmpDir, 'config');

    await expect(fileStore.readConfig(configDir, 'missing.md')).rejects.toThrow(
      ConfigMissingError
    );

    await expect(fileStore.readConfig(configDir, 'missing.md')).rejects.toThrow(
      /Config file not found: missing\.md/
    );
  });

});

// ---------------------------------------------------------------------------
// writeApplicationDocs
// ---------------------------------------------------------------------------
describe('writeApplicationDocs', () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'job-pipeline-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('creates directory and writes both files, returns true', async () => {
    const resumesDir = path.join(tmpDir, 'resumes');
    const dateStr = '2026-06-02';
    const company = 'Meridian Health Systems';
    const title = 'Senior Privacy Manager';
    const resume = '# Resume content';
    const coverLetter = '# Cover letter content';

    const result = await fileStore.writeApplicationDocs(
      resumesDir, dateStr, company, title, resume, coverLetter
    );
    expect(result).toBe(true);

    // Check files exist
    const folderName = 'Meridian-Health-Systems---Senior-Privacy-Manager';
    // sanitizeForFilename replaces spaces with hyphens, removes special chars, collapses hyphens
    // "Meridian Health Systems" -> "Meridian-Health-Systems"
    // "Senior Privacy Manager" -> "Senior-Privacy-Manager"
    // Folder: "Meridian-Health-Systems - Senior-Privacy-Manager"
    const safeCompany = 'Meridian-Health-Systems';
    const safeTitle = 'Senior-Privacy-Manager';
    const expectedDir = path.join(resumesDir, dateStr, `${safeCompany} - ${safeTitle}`);

    const resumeContent = await fs.readFile(path.join(expectedDir, 'resume.md'), 'utf-8');
    expect(resumeContent).toBe('# Resume content');

    const clContent = await fs.readFile(path.join(expectedDir, 'cover_letter.md'), 'utf-8');
    expect(clContent).toBe('# Cover letter content');
  });

  it('returns false without overwriting when directory exists', async () => {
    const resumesDir = path.join(tmpDir, 'resumes');
    const dateStr = '2026-06-02';
    const company = 'Acme';
    const title = 'Engineer';
    const resume = '# First resume';
    const coverLetter = '# First cover letter';

    // First call should return true
    const firstResult = await fileStore.writeApplicationDocs(
      resumesDir, dateStr, company, title, resume, coverLetter
    );
    expect(firstResult).toBe(true);

    // Second call with different content should return false and not overwrite
    const secondResult = await fileStore.writeApplicationDocs(
      resumesDir, dateStr, company, title, '# Second resume', '# Second cover letter'
    );
    expect(secondResult).toBe(false);

    // Verify original content is intact
    const safeCompany = 'Acme';
    const safeTitle = 'Engineer';
    const expectedDir = path.join(resumesDir, dateStr, `${safeCompany} - ${safeTitle}`);
    const resumeContent = await fs.readFile(path.join(expectedDir, 'resume.md'), 'utf-8');
    expect(resumeContent).toBe('# First resume');
  });

  it('sanitizes company with special characters in path', async () => {
    const resumesDir = path.join(tmpDir, 'resumes');
    const dateStr = '2026-06-02';
    const company = 'AT&T';
    const title = 'Senior Engineer';
    const resume = '# Resume';
    const coverLetter = '# Cover letter';

    const result = await fileStore.writeApplicationDocs(
      resumesDir, dateStr, company, title, resume, coverLetter
    );
    expect(result).toBe(true);

    // sanitizeForFilename('AT&T', 60) -> 'ATT'
    // sanitizeForFilename('Senior Engineer', 60) -> 'Senior-Engineer'
    const safeCompany = 'ATT';
    const safeTitle = 'Senior-Engineer';
    const expectedDir = path.join(resumesDir, dateStr, `${safeCompany} - ${safeTitle}`);

    const dirStat = await fs.stat(expectedDir);
    expect(dirStat.isDirectory()).toBe(true);

    const resumeContent = await fs.readFile(path.join(expectedDir, 'resume.md'), 'utf-8');
    expect(resumeContent).toBe('# Resume');
  });

});

// ---------------------------------------------------------------------------
// writeSubmissionRecord
// ---------------------------------------------------------------------------
describe('writeSubmissionRecord', () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'job-pipeline-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('writes file to specified output directory', async () => {
    const outputDir = path.join(tmpDir, 'output');
    await fs.mkdir(outputDir, { recursive: true });
    const content = '# Submission Record\n\nApplied on 2026-06-02.';

    await fileStore.writeSubmissionRecord(outputDir, content);

    const written = await fs.readFile(path.join(outputDir, 'submission_record.md'), 'utf-8');
    expect(written).toBe(content);
  });
});

// ---------------------------------------------------------------------------
// readApplications / writeApplications
// ---------------------------------------------------------------------------
describe('readApplications / writeApplications', () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'job-pipeline-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('returns [] when file does not exist', async () => {
    const rootDir = path.join(tmpDir, 'project');
    await fs.mkdir(rootDir, { recursive: true });

    const result = await fileStore.readApplications(rootDir);
    expect(result).toEqual([]);
  });

  it('throws on invalid JSON content', async () => {
    const rootDir = path.join(tmpDir, 'project');
    await fs.mkdir(rootDir, { recursive: true });
    // Write invalid JSON to trigger JSON.parse error
    await fs.writeFile(
      path.join(rootDir, 'applications.json'),
      'this is not json',
      'utf-8'
    );

    await expect(fileStore.readApplications(rootDir)).rejects.toThrow(SyntaxError);
  });

  it('round-trips correctly', async () => {
    const rootDir = path.join(tmpDir, 'project');
    await fs.mkdir(rootDir, { recursive: true });

    const records = [
      {
        id: '2026-06-02-TestCo-Engineer',
        company: 'TestCo',
        title: 'Engineer',
        url: 'https://example.com/job/1',
        linkedInJobId: null,
        score: 9,
        actionFlag: 'DEEP_TAILOR',
        resumeQuality: null,
        coverLetterQuality: null,
        qualityNote: null,
        pillarsSelected: [],
        coverLetterParas: null,
        outputPath: 'resumes/2026-06-02/TestCo - Engineer',
        dateGenerated: '2026-06-02',
        dateApplied: null,
        applicationMethod: null,
        status: 'generated',
        notes: '',
      },
    ];

    await fileStore.writeApplications(rootDir, records);
    const readBack = await fileStore.readApplications(rootDir);
    expect(readBack).toEqual(records);
  });
});

// ---------------------------------------------------------------------------
// archiveJobFiles
// ---------------------------------------------------------------------------
describe('archiveJobFiles', () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'job-pipeline-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('moves all .md files to archive directory', async () => {
    const jobsDir = path.join(tmpDir, 'jobs');
    const archiveDir = path.join(tmpDir, 'archive');
    const dateStr = '2026-06-02';

    await fs.mkdir(jobsDir, { recursive: true });
    await fs.writeFile(path.join(jobsDir, 'job1.md'), '# Job 1', 'utf-8');
    await fs.writeFile(path.join(jobsDir, 'job2.md'), '# Job 2', 'utf-8');
    await fs.writeFile(path.join(jobsDir, 'readme.txt'), 'not a job', 'utf-8');

    const count = await fileStore.archiveJobFiles(jobsDir, archiveDir, dateStr);
    expect(count).toBe(2);

    const archiveContent1 = await fs.readFile(
      path.join(archiveDir, dateStr, 'job1.md'), 'utf-8'
    );
    expect(archiveContent1).toBe('# Job 1');

    const archiveContent2 = await fs.readFile(
      path.join(archiveDir, dateStr, 'job2.md'), 'utf-8'
    );
    expect(archiveContent2).toBe('# Job 2');

    // Non-.md file should still be in jobs
    const remaining = await fs.readdir(jobsDir);
    expect(remaining).toEqual(['readme.txt']);
  });

  it('returns correct count', async () => {
    const jobsDir = path.join(tmpDir, 'jobs');
    const archiveDir = path.join(tmpDir, 'archive');
    const dateStr = '2026-06-02';

    await fs.mkdir(jobsDir, { recursive: true });
    await fs.writeFile(path.join(jobsDir, 'a.md'), '# A', 'utf-8');
    await fs.writeFile(path.join(jobsDir, 'b.md'), '# B', 'utf-8');
    await fs.writeFile(path.join(jobsDir, 'c.md'), '# C', 'utf-8');

    const count = await fileStore.archiveJobFiles(jobsDir, archiveDir, dateStr);
    expect(count).toBe(3);
  });

  it('leaves source directory empty but present', async () => {
    const jobsDir = path.join(tmpDir, 'jobs');
    const archiveDir = path.join(tmpDir, 'archive');
    const dateStr = '2026-06-02';

    await fs.mkdir(jobsDir, { recursive: true });
    await fs.writeFile(path.join(jobsDir, 'job.md'), '# Job', 'utf-8');

    await fileStore.archiveJobFiles(jobsDir, archiveDir, dateStr);

    const remaining = await fs.readdir(jobsDir);
    expect(remaining).toEqual([]);

    // Directory still exists
    const dirStat = await fs.stat(jobsDir);
    expect(dirStat.isDirectory()).toBe(true);
  });

  it('returns 0 when no .md files exist', async () => {
    const jobsDir = path.join(tmpDir, 'jobs');
    const archiveDir = path.join(tmpDir, 'archive');
    const dateStr = '2026-06-02';

    await fs.mkdir(jobsDir, { recursive: true });
    await fs.writeFile(path.join(jobsDir, 'readme.txt'), 'not a job', 'utf-8');

    const count = await fileStore.archiveJobFiles(jobsDir, archiveDir, dateStr);
    expect(count).toBe(0);
  });
});
