'use strict';

const {
  formatStackRank,
  parseStackRank,
  formatSubmissionRecord,
} = require('../../src/models/stackRank');

const { formatDateString, formatDateTimeString } = require('../../src/lib/dateUtils');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal ScoredJob-like object for testing.
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
    harvested: new Date('2026-05-30 09:14'),
    description: 'Meridian Health Systems is seeking a Senior Privacy Manager.',
    filename: 'sample_job_1.md',
    score: 8,
    fitSignal: 'Strong alignment on governance program leadership and enterprise compliance scope.',
    gap: 'No direct healthcare domain experience.',
    rank: 1,
    actionFlag: 'DEEP_TAILOR',
    ...overrides,
  };
}

/**
 * Build a minimal ApplicationRecord-like object for testing.
 */
function makeApplicationRecord(overrides = {}) {
  return {
    id: '2026-05-30-Meridian-Health-Systems-Senior-Privacy-Manager',
    company: 'Meridian Health Systems',
    title: 'Senior Privacy Manager',
    url: 'https://www.linkedin.com/jobs/view/3987654321',
    linkedInJobId: '3987654321',
    score: 8,
    actionFlag: 'DEEP_TAILOR',
    resumeQuality: 7,
    coverLetterQuality: 6,
    qualityNote: 'Strong pillar selection. Cover letter P2 cut.',
    pillarsSelected: ['Program Leadership', 'Risk Governance'],
    coverLetterParas: 2,
    outputPath: 'resumes/2026-05-30/Meridian-Health-Systems - Senior-Privacy-Manager/',
    dateGenerated: '2026-05-30',
    dateApplied: null,
    applicationMethod: null,
    status: 'generated',
    notes: '',
    ...overrides,
  };
}

/**
 * Build a stats object for formatStackRank.
 */
function makeStats(overrides = {}) {
  return {
    scoreMean: 7.0,
    scoreMin: 6,
    scoreMax: 8,
    distribution: { '1-3': 0, '4-5': 0, '6-7': 1, '8-10': 1 },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// formatStackRank
// ---------------------------------------------------------------------------

describe('formatStackRank', () => {
  const testDate = new Date(2026, 4, 30); // 2026-05-30

  it('renders descending rank order', () => {
    const jobs = [
      makeScoredJob({ rank: 1, score: 8, company: 'Alpha', title: 'Role A' }),
      makeScoredJob({ rank: 2, score: 6, company: 'Beta', title: 'Role B' }),
    ];
    const result = formatStackRank(jobs, testDate, [], makeStats());

    const rank1Index = result.indexOf('## 1.');
    const rank2Index = result.indexOf('## 2.');
    expect(rank1Index).toBeGreaterThan(0);
    expect(rank2Index).toBeGreaterThan(rank1Index);
  });

  it('renders correct action flags', () => {
    const jobs = [
      makeScoredJob({ rank: 1, score: 9, actionFlag: 'DEEP_TAILOR', company: 'A', title: 'Job A' }),
      makeScoredJob({ rank: 2, score: 6, actionFlag: 'AUTO_GENERATED', company: 'B', title: 'Job B' }),
      makeScoredJob({ rank: 3, score: 4, actionFlag: 'NO_DOCS', company: 'C', title: 'Job C' }),
    ];
    const result = formatStackRank(jobs, testDate, [], makeStats());

    expect(result).toContain('🔴 DEEP TAILOR');
    expect(result).toContain('🟡 AUTO-GENERATED');
    expect(result).toContain('⚪ NO DOCS');
  });

  it('includes Source file field', () => {
    const jobs = [makeScoredJob({ filename: 'custom_file.md' })];
    const result = formatStackRank(jobs, testDate, [], makeStats());

    expect(result).toContain('**Source file:** custom_file.md');
  });

  it('includes LinkedIn Job ID field', () => {
    const jobs = [makeScoredJob({ linkedInJobId: '1234567890' })];
    const result = formatStackRank(jobs, testDate, [], makeStats());

    expect(result).toContain('**LinkedIn Job ID:** 1234567890');
  });

  it('renders "Not available" when linkedInJobId is null', () => {
    const jobs = [makeScoredJob({ linkedInJobId: null })];
    const result = formatStackRank(jobs, testDate, [], makeStats());

    expect(result).toContain('**LinkedIn Job ID:** Not available');
  });

  it('omits Salary line when salary is null', () => {
    const jobs = [makeScoredJob({ salary: null })];
    const result = formatStackRank(jobs, testDate, [], makeStats());

    // Should contain location and employment type
    expect(result).toContain('**Location:** Remote');
    expect(result).toContain('**Employment Type:** Full-time');
    // Should NOT contain Salary
    expect(result).not.toContain('**Salary:**');
  });

  it('includes Salary line when salary is present', () => {
    const jobs = [makeScoredJob({ salary: '$200,000' })];
    const result = formatStackRank(jobs, testDate, [], makeStats());

    expect(result).toContain('**Salary:** $200,000');
  });

  it('includes stats line in header', () => {
    const jobs = [makeScoredJob({ score: 8, rank: 1 })];
    const stats = makeStats({ scoreMean: 8.0, scoreMin: 8, scoreMax: 8, distribution: { '1-3': 0, '4-5': 0, '6-7': 0, '8-10': 1 } });
    const result = formatStackRank(jobs, testDate, [], stats);

    expect(result).toContain('*Score stats: mean 8.0 | range 8–8 | distribution: 1-3: 0 | 4-5: 0 | 6-7: 0 | 8-10: 1*');
  });

  it('includes correct document count (excluding NO_DOCS)', () => {
    const jobs = [
      makeScoredJob({ rank: 1, score: 9, actionFlag: 'DEEP_TAILOR', company: 'A', title: 'X' }),
      makeScoredJob({ rank: 2, score: 6, actionFlag: 'AUTO_GENERATED', company: 'B', title: 'Y' }),
      makeScoredJob({ rank: 3, score: 4, actionFlag: 'NO_DOCS', company: 'C', title: 'Z' }),
    ];
    const result = formatStackRank(jobs, testDate, [], makeStats());

    expect(result).toContain('Documents to generate: 2');
  });

  it('renders fuzzy warning when fuzzyWarnings non-empty', () => {
    const jobs = [makeScoredJob()];
    const fuzzyWarnings = [
      {
        job1: { company: 'Test Corp', title: 'Test Role' },
        job2: { company: 'Test Corp', title: 'Test Role' },
        reason: 'same company+title, different URLs',
      },
    ];
    const result = formatStackRank(jobs, testDate, fuzzyWarnings, makeStats());

    expect(result).toContain('⚠️ **Possible duplicate:**');
    expect(result).toContain('Test Corp');
    expect(result).toContain('Test Role');
  });

  it('no fuzzy warning when fuzzyWarnings empty', () => {
    const jobs = [makeScoredJob()];
    const result = formatStackRank(jobs, testDate, [], makeStats());

    expect(result).not.toContain('⚠️');
  });

  it('handles empty rankedJobs array', () => {
    const result = formatStackRank([], testDate, [], makeStats());

    expect(result).toContain('# Stack Rank — 2026-05-30');
    expect(result).toContain('Jobs scored: 0');
    expect(result).toContain('Documents to generate: 0');
    // No job entry markers
    expect(result).not.toContain('## 1.');
  });

  it('uses header date from passed date parameter', () => {
    const pastDate = new Date(2026, 3, 15); // 2026-04-15
    const jobs = [makeScoredJob()];
    const result = formatStackRank(jobs, pastDate, [], makeStats());

    expect(result).toContain('# Stack Rank — 2026-04-15');
  });

  it('renders stats with null mean/min/max as em-dash', () => {
    const jobs = [makeScoredJob()];
    const nullStats = {
      scoreMean: null,
      scoreMin: null,
      scoreMax: null,
      distribution: { '1-3': 0, '4-5': 0, '6-7': 1, '8-10': 0 },
    };
    const result = formatStackRank(jobs, testDate, [], nullStats);

    expect(result).toContain('mean —');
    expect(result).toContain('range —–');
  });
  it('renders unknown actionFlag as-is via formatActionFlag default', () => {
    const jobs = [makeScoredJob({ actionFlag: 'CUSTOM_FLAG' })];
    const result = formatStackRank(jobs, testDate, [], makeStats());

    expect(result).toContain('[CUSTOM_FLAG]');
  });

  it('renders null actionFlag as empty string via formatActionFlag default', () => {
    const jobs = [makeScoredJob({ actionFlag: null })];
    const result = formatStackRank(jobs, testDate, [], makeStats());

    // formatActionFlag(null) returns null || '' = ''
    expect(result).toContain('[] —');
  });

  it('renders empty string actionFlag as empty via formatActionFlag default', () => {
    const jobs = [makeScoredJob({ actionFlag: '' })];
    const result = formatStackRank(jobs, testDate, [], makeStats());

    // formatActionFlag('') returns '' || '' = ''
    expect(result).toContain('[] —');
  });
  it('handles null stats.distribution with default empty object', () => {
    const jobs = [makeScoredJob()];
    const nullDistStats = {
      scoreMean: null,
      scoreMin: null,
      scoreMax: null,
      distribution: null,
    };
    const result = formatStackRank(jobs, testDate, [], nullDistStats);

    // Should not throw; distribution defaults to {}
    expect(result).toContain('distribution: 1-3: 0 | 4-5: 0 | 6-7: 0 | 8-10: 0');
  });

  it('handles incomplete distribution with missing buckets', () => {
    const jobs = [makeScoredJob()];
    const partialDistStats = makeStats({
      distribution: { '1-3': 0, '4-5': 0 },
    });
    const result = formatStackRank(jobs, testDate, [], partialDistStats);

    // Missing buckets default to 0 via ??
    expect(result).toContain('6-7: 0');
    expect(result).toContain('8-10: 0');
  });

  it('handles fuzzy warning with null job1 safely', () => {
    const jobs = [makeScoredJob()];
    const fuzzyWarnings = [
      {
        job1: null,
        job2: { company: 'Test Corp', title: 'Test Role' },
        reason: 'same company+title, different URLs',
      },
    ];
    const result = formatStackRank(jobs, testDate, fuzzyWarnings, makeStats());

    // Should not throw; company and title fall back to ''
    expect(result).toContain('⚠️ **Possible duplicate:**');
  });

  it('handles harvested date as string', () => {
    const jobs = [makeScoredJob({ harvested: '2026-05-30 09:14' })];
    const result = formatStackRank(jobs, testDate, [], makeStats());

    // harvested instanceof Date is false; uses String()
    expect(result).toContain('**Harvested:** 2026-05-30 09:14');
  });
});

// ---------------------------------------------------------------------------
// parseStackRank
// ---------------------------------------------------------------------------

describe('parseStackRank', () => {
  const testDate = new Date(2026, 4, 30);

  it('returns only DEEP_TAILOR and AUTO_GENERATED entries', () => {
    const jobs = [
      makeScoredJob({ rank: 1, score: 9, actionFlag: 'DEEP_TAILOR', company: 'A', title: 'Deep Role' }),
      makeScoredJob({ rank: 2, score: 6, actionFlag: 'AUTO_GENERATED', company: 'B', title: 'Auto Role' }),
      makeScoredJob({ rank: 3, score: 4, actionFlag: 'NO_DOCS', company: 'C', title: 'No Docs Role' }),
    ];
    const markdown = formatStackRank(jobs, testDate, [], makeStats());
    const parsed = parseStackRank(markdown);

    expect(parsed).toHaveLength(2);
    expect(parsed[0].actionFlag).toBe('DEEP_TAILOR');
    expect(parsed[1].actionFlag).toBe('AUTO_GENERATED');
  });

  it('extracts sourceFilename correctly', () => {
    const jobs = [
      makeScoredJob({ filename: 'my_custom_file.md' }),
    ];
    const markdown = formatStackRank(jobs, testDate, [], makeStats());
    const parsed = parseStackRank(markdown);

    expect(parsed[0].sourceFilename).toBe('my_custom_file.md');
  });

  it('extracts linkedInJobId correctly (null for "Not available")', () => {
    const jobs = [
      makeScoredJob({ linkedInJobId: '555555' }),
      makeScoredJob({ rank: 2, score: 6, actionFlag: 'AUTO_GENERATED', company: 'B', title: 'Role B', linkedInJobId: null }),
    ];
    const markdown = formatStackRank(jobs, testDate, [], makeStats());
    const parsed = parseStackRank(markdown);

    expect(parsed[0].linkedInJobId).toBe('555555');
    expect(parsed[1].linkedInJobId).toBeNull();
  });

  it('returns empty array when no qualifying jobs', () => {
    const jobs = [
      makeScoredJob({ rank: 1, score: 4, actionFlag: 'NO_DOCS', company: 'A', title: 'No Docs' }),
    ];
    const markdown = formatStackRank(jobs, testDate, [], makeStats());
    const parsed = parseStackRank(markdown);

    expect(parsed).toHaveLength(0);
  });

  it('round-trips with formatStackRank', () => {
    const jobs = [
      makeScoredJob({ rank: 1, score: 8, actionFlag: 'DEEP_TAILOR', company: 'Meridian Health Systems', title: 'Senior Privacy Manager' }),
      makeScoredJob({ rank: 2, score: 6, actionFlag: 'AUTO_GENERATED', company: 'Vantara Financial', title: 'AI Governance Analyst', filename: 'sample_job_2.md', linkedInJobId: '1122334455', salary: null }),
    ];
    const markdown = formatStackRank(jobs, testDate, [], makeStats());
    const parsed = parseStackRank(markdown);

    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toMatchObject({
      rank: 1,
      score: 8,
      actionFlag: 'DEEP_TAILOR',
      company: 'Meridian Health Systems',
      title: 'Senior Privacy Manager',
      sourceFilename: 'sample_job_1.md',
      linkedInJobId: '3987654321',
    });
    expect(parsed[1]).toMatchObject({
      rank: 2,
      score: 6,
      actionFlag: 'AUTO_GENERATED',
      company: 'Vantara Financial',
      title: 'AI Governance Analyst',
      sourceFilename: 'sample_job_2.md',
      linkedInJobId: '1122334455',
    });
  });

  it('returns empty array for empty markdown', () => {
    const result = parseStackRank('');
    expect(result).toEqual([]);
  });

  it('returns empty array for header-only markdown with no entries', () => {
    const markdown = '# Stack Rank — 2026-05-30\n*Generated: 2026-05-30 14:32 | Jobs scored: 0 | Documents to generate: 0*\n*Score stats: mean — | range —– | distribution: 1-3: 0 | 4-5: 0 | 6-7: 0 | 8-10: 0*';
    const result = parseStackRank(markdown);
    expect(result).toEqual([]);
  });

  it('returns empty sourceFilename when Source file line is missing', () => {
    const md = '# Stack Rank — 2026-05-30\n\n## 1. [8/10] [🔴 DEEP TAILOR] — Test Corp | Test Role\n**LinkedIn Job ID:** 123\n**URL:** https://example.com\n**Location:** Remote | **Employment Type:** Full-time\n**Harvested:** 2026-05-30 09:00\n\n**Fit:** Strong fit\n**Gap:** Some gap\n\n---';
    const result = parseStackRank(md);
    expect(result).toHaveLength(1);
    expect(result[0].sourceFilename).toBe('');
  });

  it('returns empty url when URL line is missing', () => {
    const md = '# Stack Rank — 2026-05-30\n\n## 1. [8/10] [🔴 DEEP TAILOR] — Test Corp | Test Role\n**Source file:** test.md\n**LinkedIn Job ID:** 123\n**Location:** Remote | **Employment Type:** Full-time\n**Harvested:** 2026-05-30 09:00\n\n**Fit:** Strong fit\n**Gap:** Some gap\n\n---';
    const result = parseStackRank(md);
    expect(result).toHaveLength(1);
    expect(result[0].url).toBe('');
  });

  it('returns null for linkedInJobId when value is "Not available"', () => {
    const md = '# Stack Rank — 2026-05-30\n\n## 1. [8/10] [🔴 DEEP TAILOR] — Test Corp | Test Role\n**Source file:** test.md\n**LinkedIn Job ID:** Not available\n**URL:** https://example.com\n\n---';
    const result = parseStackRank(md);
    expect(result).toHaveLength(1);
    expect(result[0].linkedInJobId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// formatSubmissionRecord
// ---------------------------------------------------------------------------

describe('formatSubmissionRecord', () => {
  it('contains all required section headers', () => {
    const record = makeApplicationRecord();
    const scoredJob = makeScoredJob();
    const result = formatSubmissionRecord(record, scoredJob);

    expect(result).toContain('# Submission Record —');
    expect(result).toContain('## Pillars Selected');
    expect(result).toContain('## Cover Letter Structure');
    expect(result).toContain('## Quality Assessment');
    expect(result).toContain('## Application Status');
  });

  it('renders null quality fields as placeholders not errors', () => {
    const record = makeApplicationRecord({
      resumeQuality: null,
      coverLetterQuality: null,
      qualityNote: null,
      pillarsSelected: null,
      coverLetterParas: null,
      dateApplied: null,
      applicationMethod: null,
      notes: null,
    });
    const scoredJob = makeScoredJob();
    const result = formatSubmissionRecord(record, scoredJob);

    // Should not throw, and should render — for null fields
    expect(result).toContain('**Resume:** —');
    expect(result).toContain('**Cover Letter:** —');
    expect(result).toContain('**Note:** —');
    expect(result).toContain('**Date applied:** —');
    expect(result).toContain('**Method:** —');
    expect(result).toContain('**Notes:** —');
  });

  it('includes company, title, score, fitSignal, gap', () => {
    const record = makeApplicationRecord({
      company: 'TestCorp',
      title: 'Test Role',
      score: 7,
    });
    const scoredJob = makeScoredJob({
      fitSignal: 'Custom fit signal.',
      gap: 'Custom gap.',
    });
    const result = formatSubmissionRecord(record, scoredJob);

    expect(result).toContain('TestCorp');
    expect(result).toContain('Test Role');
    expect(result).toContain('**Score:** 7/10');
    expect(result).toContain('Custom fit signal.');
    expect(result).toContain('Custom gap.');
  });

  it('renders pillars when present', () => {
    const record = makeApplicationRecord({
      pillarsSelected: ['Leadership', 'Governance'],
    });
    const scoredJob = makeScoredJob();
    const result = formatSubmissionRecord(record, scoredJob);

    expect(result).toContain('Leadership | Governance');
  });

  it('renders cover letter paras when present', () => {
    const record = makeApplicationRecord({ coverLetterParas: 3 });
    const scoredJob = makeScoredJob();
    const result = formatSubmissionRecord(record, scoredJob);

    expect(result).toContain('3 paragraphs');
  });

  it('renders unknown actionFlag via formatActionFlag and flagEmoji defaults', () => {
    const record = makeApplicationRecord({ actionFlag: 'UNKNOWN' });
    const scoredJob = makeScoredJob();
    const result = formatSubmissionRecord(record, scoredJob);

    // flagEmoji('UNKNOWN') returns '' (default)
    // formatActionFlag('UNKNOWN') returns 'UNKNOWN' (default)
    // Combined: ' UNKNOWN' (space + text)
    expect(result).toContain('UNKNOWN');
  });

  it('renders AUTO_GENERATED actionFlag with yellow circle', () => {
    const record = makeApplicationRecord({ actionFlag: 'AUTO_GENERATED' });
    const scoredJob = makeScoredJob();
    const result = formatSubmissionRecord(record, scoredJob);

    // Exercises flagEmoji('AUTO_GENERATED') → '🟡' branch
    expect(result).toContain('🟡 AUTO-GENERATED');
  });

  it('renders NO_DOCS actionFlag with white circle', () => {
    const record = makeApplicationRecord({ actionFlag: 'NO_DOCS' });
    const scoredJob = makeScoredJob();
    const result = formatSubmissionRecord(record, scoredJob);

    // Exercises flagEmoji('NO_DOCS') → '⚪' branch
    expect(result).toContain('⚪ NO DOCS');
  });
});
