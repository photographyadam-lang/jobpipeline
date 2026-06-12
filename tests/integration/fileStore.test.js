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

// ---------------------------------------------------------------------------
// readDocFile / writeDocFile
// ---------------------------------------------------------------------------
describe('readDocFile / writeDocFile', () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'job-pipeline-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('reads existing file content', async () => {
    const filePath = path.join(tmpDir, 'test.md');
    await fs.writeFile(filePath, '# Document content', 'utf-8');

    const content = await fileStore.readDocFile(filePath);
    expect(content).toBe('# Document content');
  });

  it('throws ENOENT when file does not exist', async () => {
    const filePath = path.join(tmpDir, 'nonexistent.md');

    await expect(fileStore.readDocFile(filePath)).rejects.toThrow(/ENOENT|no such file/i);
  });

  it('writes content to specified path', async () => {
    const filePath = path.join(tmpDir, 'output.md');
    const content = '# Sanitized document';

    await fileStore.writeDocFile(filePath, content);

    const written = await fs.readFile(filePath, 'utf-8');
    expect(written).toBe(content);
  });

  it('overwrites existing file content', async () => {
    const filePath = path.join(tmpDir, 'existing.md');
    await fs.writeFile(filePath, '# Original content', 'utf-8');

    await fileStore.writeDocFile(filePath, '# Updated content');

    const written = await fs.readFile(filePath, 'utf-8');
    expect(written).toBe('# Updated content');
  });
});

// ---------------------------------------------------------------------------
// readDateDir
// ---------------------------------------------------------------------------
describe('readDateDir', () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'job-pipeline-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('finds resume.md and cover_letter.md in company subdirectories', async () => {
    const resumesDir = path.join(tmpDir, 'resumes');
    const dateStr = '2026-06-02';

    // Create company subdirectories with documents
    const company1Dir = path.join(resumesDir, dateStr, 'Company-A - Job-Title');
    await fs.mkdir(company1Dir, { recursive: true });
    await fs.writeFile(path.join(company1Dir, 'resume.md'), '# Resume A', 'utf-8');
    await fs.writeFile(path.join(company1Dir, 'cover_letter.md'), '# CL A', 'utf-8');

    const company2Dir = path.join(resumesDir, dateStr, 'Company-B - Another-Role');
    await fs.mkdir(company2Dir, { recursive: true });
    await fs.writeFile(path.join(company2Dir, 'resume.md'), '# Resume B', 'utf-8');

    const results = await fileStore.readDateDir(resumesDir, dateStr);

    expect(results).toHaveLength(3);
    expect(results.filter(r => r.docType === 'resume')).toHaveLength(2);
    expect(results.filter(r => r.docType === 'cover_letter')).toHaveLength(1);

    // Check relative paths
    expect(results[0].relativePath).toContain(dateStr);
    expect(results[0].filePath).toBeDefined();
  });

  it('skips subdirectories without matching files', async () => {
    const resumesDir = path.join(tmpDir, 'resumes');
    const dateStr = '2026-06-02';

    const subDir = path.join(resumesDir, dateStr, 'Empty-Co - Role');
    await fs.mkdir(subDir, { recursive: true });
    // No files inside

    const results = await fileStore.readDateDir(resumesDir, dateStr);
    expect(results).toHaveLength(0);
  });

  it('returns empty array when no company subdirectories exist', async () => {
    const resumesDir = path.join(tmpDir, 'resumes');
    const dateStr = '2026-06-02';

    await fs.mkdir(path.join(resumesDir, dateStr), { recursive: true });
    // No subdirectories

    const results = await fileStore.readDateDir(resumesDir, dateStr);
    expect(results).toHaveLength(0);
  });

  it('propagates ENOENT when date directory does not exist', async () => {
    const resumesDir = path.join(tmpDir, 'nonexistent');
    const dateStr = '2026-06-02';

    await expect(fileStore.readDateDir(resumesDir, dateStr)).rejects.toThrow(/ENOENT|no such file|ENOTDIR/i);
  });
});

// ---------------------------------------------------------------------------
// writeQaReport
// ---------------------------------------------------------------------------
describe('writeQaReport', () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'job-pipeline-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('writes qa_report.md to dated directory', async () => {
    const resumesDir = path.join(tmpDir, 'resumes');
    const dateStr = '2026-06-02';
    const content = '# QA Report\n\n## Executive Summary\n\nAll files passed.';

    const fullPath = await fileStore.writeQaReport(resumesDir, dateStr, content);

    expect(fullPath).toContain('qa_report.md');
    expect(fullPath).toContain(dateStr);

    const written = await fs.readFile(fullPath, 'utf-8');
    expect(written).toBe(content);
  });

  it('creates dated subdirectory when absent', async () => {
    const resumesDir = path.join(tmpDir, 'resumes');
    const dateStr = '2026-06-02';
    const content = '# QA Report';

    await fileStore.writeQaReport(resumesDir, dateStr, content);

    const dirStat = await fs.stat(path.join(resumesDir, dateStr));
    expect(dirStat.isDirectory()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// readForensicAudit
// ---------------------------------------------------------------------------
describe('readForensicAudit', () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'job-pipeline-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('reads forensic_audit.md from a job output directory', async () => {
    const resumesDir = path.join(tmpDir, 'resumes');
    const dateStr = '2026-06-02';
    const company = 'TestCorp';
    const title = 'Senior Engineer';
    const auditContent = '# Forensic Audit — TestCorp | Senior Engineer\n\n## Identity Projection\n\nStrong match.\n';

    // Write the forensic_audit.md to the expected path using direct fs
    const safeCompany = 'TestCorp';
    const safeTitle = 'Senior-Engineer';
    const targetDir = path.join(resumesDir, dateStr, `${safeCompany} - ${safeTitle}`);
    await fs.mkdir(targetDir, { recursive: true });
    await fs.writeFile(path.join(targetDir, 'forensic_audit.md'), auditContent, 'utf-8');

    const result = await fileStore.readForensicAudit(resumesDir, dateStr, company, title);
    expect(result).toBe(auditContent);
  });

  it('throws ENOENT when forensic_audit.md does not exist', async () => {
    const resumesDir = path.join(tmpDir, 'resumes');
    const dateStr = '2026-06-02';
    const company = 'NoAuditCo';
    const title = 'Ghost Role';

    await expect(
      fileStore.readForensicAudit(resumesDir, dateStr, company, title)
    ).rejects.toThrow(/ENOENT|no such file/i);
  });

  it('sanitizes company name in path resolution', async () => {
    const resumesDir = path.join(tmpDir, 'resumes');
    const dateStr = '2026-06-02';
    const company = 'AT&T Corp';
    const title = 'Privacy Manager';
    const auditContent = '# Forensic Audit';

    // Write using sanitized path matching readForensicAudit internals
    const safeCompany = 'ATT-Corp';
    const safeTitle = 'Privacy-Manager';
    const targetDir = path.join(resumesDir, dateStr, `${safeCompany} - ${safeTitle}`);
    await fs.mkdir(targetDir, { recursive: true });
    await fs.writeFile(path.join(targetDir, 'forensic_audit.md'), auditContent, 'utf-8');

    const result = await fileStore.readForensicAudit(resumesDir, dateStr, company, title);
    expect(result).toBe(auditContent);
  });
});

// ---------------------------------------------------------------------------
// readQaReport
// ---------------------------------------------------------------------------
describe('readQaReport', () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'job-pipeline-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('reads qa_report.md from dated directory', async () => {
    const resumesDir = path.join(tmpDir, 'resumes');
    const dateStr = '2026-06-02';
    const content = '# QA Report\n\n## Summary\n\nAll checks passed.';

    await fs.mkdir(path.join(resumesDir, dateStr), { recursive: true });
    await fs.writeFile(path.join(resumesDir, dateStr, 'qa_report.md'), content, 'utf-8');

    const result = await fileStore.readQaReport(resumesDir, dateStr);
    expect(result).toBe(content);
  });

  it('throws ENOENT when qa_report.md does not exist', async () => {
    const resumesDir = path.join(tmpDir, 'resumes');
    const dateStr = '2026-06-02';

    await expect(fileStore.readQaReport(resumesDir, dateStr)).rejects.toThrow(/ENOENT|no such file/i);
  });
});

// ---------------------------------------------------------------------------
// writePromptDiagnostics
// ---------------------------------------------------------------------------
describe('writePromptDiagnostics', () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'job-pipeline-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('writes prompt_diagnostics_YYYY-MM-DD.md to dated directory', async () => {
    const resumesDir = path.join(tmpDir, 'resumes');
    const dateStr = '2026-06-02';
    const content = '# Prompt Diagnostics — 2026-06-02\n\n## Recommendations\n\n...';

    const fullPath = await fileStore.writePromptDiagnostics(resumesDir, dateStr, content);

    expect(fullPath).toContain(`prompt_diagnostics_${dateStr}.md`);
    expect(fullPath).toContain(dateStr);

    const written = await fs.readFile(fullPath, 'utf-8');
    expect(written).toBe(content);
  });

  it('creates dated subdirectory when absent', async () => {
    const resumesDir = path.join(tmpDir, 'resumes');
    const dateStr = '2026-06-02';
    const content = '# Prompt Diagnostics';

    await fileStore.writePromptDiagnostics(resumesDir, dateStr, content);

    const dirStat = await fs.stat(path.join(resumesDir, dateStr));
    expect(dirStat.isDirectory()).toBe(true);
  });
});
