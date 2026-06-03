'use strict';

const {
  VALID_STATUSES,
  createApplicationRecord,
  isValidStatus,
  generateRecordId,
} = require('../../src/models/applicationRecord');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal ScoredJob-like object for testing.
 * Contains all required JobFile fields plus score fields.
 */
function makeScoredJob(overrides = {}) {
  return {
    title: 'Senior Privacy Manager',
    company: 'Meridian Health Systems',
    location: 'Remote',
    employmentType: 'Full-time',
    salary: '$160,000–$185,000',
    url: 'https://www.linkedin.com/jobs/view/3987654321',
    linkedInJobId: '3987654321',
    harvested: new Date('2026-05-30T09:14:00'),
    description: 'Job description text...',
    filename: 'sample_job_1.md',
    score: 8,
    fitSignal: 'Strong alignment with governance and compliance requirements.',
    gap: 'No direct healthcare domain experience.',
    rank: 1,
    actionFlag: 'DEEP_TAILOR',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// VALID_STATUSES
// ---------------------------------------------------------------------------

describe('VALID_STATUSES', () => {
  it('is a frozen array with exactly 6 statuses', () => {
    expect(Array.isArray(VALID_STATUSES)).toBe(true);
    expect(VALID_STATUSES).toHaveLength(6);
  });

  it('contains all required status values in order', () => {
    expect(VALID_STATUSES).toEqual([
      'generated',
      'applied',
      'interviewing',
      'rejected',
      'offer',
      'withdrawn',
    ]);
  });
});

// ---------------------------------------------------------------------------
// createApplicationRecord
// ---------------------------------------------------------------------------

describe('createApplicationRecord', () => {
  it('sets status to "generated"', () => {
    const scoredJob = makeScoredJob();
    const record = createApplicationRecord(scoredJob, 'output/path', '2026-05-30');
    expect(record.status).toBe('generated');
  });

  it('sets all quality fields (resumeQuality, coverLetterQuality, qualityNote) to null', () => {
    const scoredJob = makeScoredJob();
    const record = createApplicationRecord(scoredJob, 'output/path', '2026-05-30');
    expect(record.resumeQuality).toBeNull();
    expect(record.coverLetterQuality).toBeNull();
    expect(record.qualityNote).toBeNull();
    expect(record.coverLetterParas).toBeNull();
  });

  it('sets pillarsSelected to empty array', () => {
    const scoredJob = makeScoredJob();
    const record = createApplicationRecord(scoredJob, 'output/path', '2026-05-30');
    expect(record.pillarsSelected).toEqual([]);
  });

  it('sets notes to empty string', () => {
    const scoredJob = makeScoredJob();
    const record = createApplicationRecord(scoredJob, 'output/path', '2026-05-30');
    expect(record.notes).toBe('');
  });

  it('sets dateApplied and applicationMethod to null', () => {
    const scoredJob = makeScoredJob();
    const record = createApplicationRecord(scoredJob, 'output/path', '2026-05-30');
    expect(record.dateApplied).toBeNull();
    expect(record.applicationMethod).toBeNull();
  });

  it('sets dateGenerated from dateStr', () => {
    const scoredJob = makeScoredJob();
    const record = createApplicationRecord(scoredJob, 'output/path', '2026-06-01');
    expect(record.dateGenerated).toBe('2026-06-01');
  });

  it('maps all ScoredJob identity fields correctly', () => {
    const scoredJob = makeScoredJob();
    const record = createApplicationRecord(scoredJob, 'output/path', '2026-05-30');
    expect(record.company).toBe(scoredJob.company);
    expect(record.title).toBe(scoredJob.title);
    expect(record.url).toBe(scoredJob.url);
    expect(record.linkedInJobId).toBe(scoredJob.linkedInJobId);
    expect(record.score).toBe(scoredJob.score);
    expect(record.actionFlag).toBe(scoredJob.actionFlag);
  });

  it('preserves the outputPath passed as argument', () => {
    const scoredJob = makeScoredJob();
    const outputPath = 'resumes/2026-05-30/Meridian-Health-Systems - Senior-Privacy-Manager';
    const record = createApplicationRecord(scoredJob, outputPath, '2026-05-30');
    expect(record.outputPath).toBe(outputPath);
  });

  it('generates a record id via generateRecordId', () => {
    const scoredJob = makeScoredJob();
    const record = createApplicationRecord(scoredJob, 'output/path', '2026-05-30');
    expect(record.id).toBe('2026-05-30-Meridian-Health-Systems-Senior-Privacy-Manager');
  });
});

// ---------------------------------------------------------------------------
// generateRecordId
// ---------------------------------------------------------------------------

describe('generateRecordId', () => {
  it('produces correct slug for clean input', () => {
    const id = generateRecordId('2026-05-30', 'Anthropic', 'AI Policy & Governance Lead');
    expect(id).toBe('2026-05-30-Anthropic-AI-Policy-Governance-Lead');
  });

  it('sanitizes special characters in company (AT&T → ATT)', () => {
    const id = generateRecordId('2026-05-30', 'AT&T', 'Senior Engineer');
    expect(id).toBe('2026-05-30-ATT-Senior-Engineer');
  });

  it('sanitizes special characters in title (removes ampersands, colons, etc.)', () => {
    const id = generateRecordId('2026-05-30', 'Company', 'Manager: Risk & Compliance');
    expect(id).toBe('2026-05-30-Company-Manager-Risk-Compliance');
  });

  it('handles multiple special characters gracefully', () => {
    const id = generateRecordId('2026-05-30', 'Johnson & Johnson (Pharma)', 'Director, Privacy (HIPAA)');
    expect(id).toBe('2026-05-30-Johnson-Johnson-Pharma-Director-Privacy-HIPAA');
  });
});

// ---------------------------------------------------------------------------
// isValidStatus
// ---------------------------------------------------------------------------

describe('isValidStatus', () => {
  it('returns true for all 6 valid statuses', () => {
    const valid = ['generated', 'applied', 'interviewing', 'rejected', 'offer', 'withdrawn'];
    valid.forEach(status => {
      expect(isValidStatus(status)).toBe(true);
    });
  });

  it('returns false for empty string', () => {
    expect(isValidStatus('')).toBe(false);
  });

  it('returns false for unknown status string', () => {
    expect(isValidStatus('pending')).toBe(false);
    expect(isValidStatus('unknown')).toBe(false);
  });

  it('returns false for null', () => {
    expect(isValidStatus(null)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isValidStatus(undefined)).toBe(false);
  });

  it('is case-sensitive — uppercase fails', () => {
    expect(isValidStatus('GENERATED')).toBe(false);
    expect(isValidStatus('Applied')).toBe(false);
  });
});
