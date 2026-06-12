'use strict';

const path = require('path');
const fs = require('fs');

const {
  buildScoringPrompt,
  buildResumePrompt,
  buildCoverLetterPrompt,
  buildQualityPrompt,
} = require('../../src/lib/promptBuilder');

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

/** Read a fixture file as a trimmed string. */
function fixture(name) {
  return fs.readFileSync(
    path.resolve(__dirname, '../fixtures', name),
    'utf8'
  ).trim();
}

/** Build a minimal JobFile from fixture data. */
function makeJobFile(overrides = {}) {
  return {
    title: 'Senior Privacy Manager',
    company: 'Meridian Health Systems',
    location: 'Remote',
    employmentType: 'Full-time',
    salary: '$160,000–$185,000',
    url: 'https://www.linkedin.com/jobs/view/3987654321',
    linkedInJobId: '3987654321',
    harvested: new Date('2026-05-30 09:14'),
    description: fixture('sample_job_1.md').split('## Job Description\n\n')[1] || fixture('sample_job_1.md'),
    filename: 'sample_job_1.md',
    ...overrides,
  };
}

/** Build a minimal ScoredJob from fixture data. */
function makeScoredJob(overrides = {}) {
  const base = makeJobFile();
  return {
    ...base,
    score: 7,
    fitSignal: 'Strong alignment on governance program leadership and enterprise compliance scope.',
    gap: 'No direct healthcare domain experience.',
    rank: null,
    actionFlag: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Pre-loaded fixture content
// ---------------------------------------------------------------------------

const careerContents = fixture('sample_career.md');
const pillarContents = fixture('sample_pillar_library.md');
const resumeContent = fixture('sample_deepseek_resume_response.txt');
const coverLetterContent = fixture('sample_deepseek_cover_letter_response.txt');

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildScoringPrompt', () => {
  it('includes full career contents without truncation', () => {
    const jobFile = makeJobFile();
    const result = buildScoringPrompt(careerContents, jobFile);

    expect(result).toContain(careerContents);
    // Verify every word of the career profile appears
    const careerWords = careerContents.split(/\s+/);
    for (const word of careerWords) {
      if (word.length > 3) {
        expect(result).toContain(word);
      }
    }
  });

  it('includes full job description without truncation', () => {
    const jobFile = makeJobFile();
    const result = buildScoringPrompt(careerContents, jobFile);

    expect(result).toContain(jobFile.description);
    // Verify description length matches (no truncation)
    const descWords = jobFile.description.split(/\s+/);
    for (const word of descWords) {
      if (word.length > 3) {
        expect(result).toContain(word);
      }
    }
  });

  it('includes CANDIDATE PROFILE: label', () => {
    const result = buildScoringPrompt(careerContents, makeJobFile());
    expect(result).toContain('CANDIDATE PROFILE:');
  });

  it('includes JOB DESCRIPTION: label', () => {
    const result = buildScoringPrompt(careerContents, makeJobFile());
    expect(result).toContain('JOB DESCRIPTION:');
  });

  it('returns non-empty string', () => {
    const result = buildScoringPrompt(careerContents, makeJobFile());
    expect(result).toBeTruthy();
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('throws when careerContents is missing', () => {
    expect(() => buildScoringPrompt(null, makeJobFile())).toThrow();
    expect(() => buildScoringPrompt('', makeJobFile())).toThrow();
  });

  it('throws when jobFile is missing', () => {
    expect(() => buildScoringPrompt(careerContents, null)).toThrow();
  });

  it('throws when jobFile.description is missing', () => {
    expect(() => buildScoringPrompt(careerContents, makeJobFile({ description: '' }))).toThrow();
  });
});

describe('buildResumePrompt', () => {
  it('includes career, pillar library, job description', () => {
    const scoredJob = makeScoredJob();
    const result = buildResumePrompt(careerContents, pillarContents, scoredJob);

    expect(result).toContain(careerContents);
    expect(result).toContain(pillarContents);
    expect(result).toContain(scoredJob.description);
  });

  it('includes fitSignal and gap from scoredJob', () => {
    const scoredJob = makeScoredJob({
      fitSignal: 'Custom fit signal for testing.',
      gap: 'Custom gap for testing.',
    });
    const result = buildResumePrompt(careerContents, pillarContents, scoredJob);

    expect(result).toContain('Custom fit signal for testing.');
    expect(result).toContain('Custom gap for testing.');
  });

  it('returns non-empty string', () => {
    const result = buildResumePrompt(careerContents, pillarContents, makeScoredJob());
    expect(result).toBeTruthy();
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('throws when careerContents is missing', () => {
    expect(() => buildResumePrompt(null, pillarContents, makeScoredJob())).toThrow();
    expect(() => buildResumePrompt('', pillarContents, makeScoredJob())).toThrow();
  });

  it('throws when pillarContents is missing', () => {
    expect(() => buildResumePrompt(careerContents, null, makeScoredJob())).toThrow();
    expect(() => buildResumePrompt(careerContents, '', makeScoredJob())).toThrow();
  });

  it('throws when scoredJob is missing', () => {
    expect(() => buildResumePrompt(careerContents, pillarContents, null)).toThrow();
  });

  it('throws when fitSignal is missing', () => {
    expect(() => buildResumePrompt(careerContents, pillarContents, makeScoredJob({ fitSignal: undefined }))).toThrow();
  });

  it('throws when gap is missing', () => {
    expect(() => buildResumePrompt(careerContents, pillarContents, makeScoredJob({ gap: undefined }))).toThrow();
  });

  it('includes CRITICAL KEYWORDS section when criticalKeywords is present', () => {
    const scoredJob = makeScoredJob({ criticalKeywords: 'HIPAA, HITECH, EHR integration' });
    const result = buildResumePrompt(careerContents, pillarContents, scoredJob);

    expect(result).toContain('CRITICAL KEYWORDS TO WEAVE:');
    expect(result).toContain('HIPAA, HITECH, EHR integration');
  });

  it('omits CRITICAL KEYWORDS section when criticalKeywords is empty', () => {
    const scoredJob = makeScoredJob({ criticalKeywords: '' });
    const result = buildResumePrompt(careerContents, pillarContents, scoredJob);

    expect(result).not.toContain('CRITICAL KEYWORDS TO WEAVE:');
  });

  it('omits CRITICAL KEYWORDS section when criticalKeywords is undefined', () => {
    const scoredJob = makeScoredJob();
    const result = buildResumePrompt(careerContents, pillarContents, scoredJob);

    expect(result).not.toContain('CRITICAL KEYWORDS TO WEAVE:');
  });
});

describe('buildCoverLetterPrompt', () => {
  it('includes career, job description, resume content', () => {
    const scoredJob = makeScoredJob();
    const result = buildCoverLetterPrompt(careerContents, scoredJob, resumeContent);

    expect(result).toContain(careerContents);
    expect(result).toContain(scoredJob.description);
    expect(result).toContain(resumeContent);
  });

  it('returns non-empty string', () => {
    const result = buildCoverLetterPrompt(careerContents, makeScoredJob(), resumeContent);
    expect(result).toBeTruthy();
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('throws when careerContents is missing', () => {
    expect(() => buildCoverLetterPrompt(null, makeScoredJob(), resumeContent)).toThrow();
    expect(() => buildCoverLetterPrompt('', makeScoredJob(), resumeContent)).toThrow();
  });

  it('throws when scoredJob is missing', () => {
    expect(() => buildCoverLetterPrompt(careerContents, null, resumeContent)).toThrow();
  });

  it('throws when resumeContent is missing', () => {
    expect(() => buildCoverLetterPrompt(careerContents, makeScoredJob(), null)).toThrow();
    expect(() => buildCoverLetterPrompt(careerContents, makeScoredJob(), '')).toThrow();
  });

  it('includes CRITICAL KEYWORDS section when criticalKeywords is present', () => {
    const scoredJob = makeScoredJob({ criticalKeywords: 'HIPAA, HITECH, EHR integration' });
    const result = buildCoverLetterPrompt(careerContents, scoredJob, resumeContent);

    expect(result).toContain('CRITICAL KEYWORDS TO WEAVE:');
    expect(result).toContain('HIPAA, HITECH, EHR integration');
  });

  it('omits CRITICAL KEYWORDS section when criticalKeywords is empty', () => {
    const scoredJob = makeScoredJob({ criticalKeywords: '' });
    const result = buildCoverLetterPrompt(careerContents, scoredJob, resumeContent);

    expect(result).not.toContain('CRITICAL KEYWORDS TO WEAVE:');
  });

  it('omits CRITICAL KEYWORDS section when criticalKeywords is undefined', () => {
    const scoredJob = makeScoredJob();
    const result = buildCoverLetterPrompt(careerContents, scoredJob, resumeContent);

    expect(result).not.toContain('CRITICAL KEYWORDS TO WEAVE:');
  });
});

describe('buildQualityPrompt', () => {
  it('includes job description, resume, cover letter content', () => {
    const scoredJob = makeScoredJob();
    const result = buildQualityPrompt(scoredJob, resumeContent, coverLetterContent);

    expect(result).toContain(scoredJob.description);
    expect(result).toContain(resumeContent);
    expect(result).toContain(coverLetterContent);
  });

  it('returns non-empty string', () => {
    const result = buildQualityPrompt(makeScoredJob(), resumeContent, coverLetterContent);
    expect(result).toBeTruthy();
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('throws when scoredJob is missing', () => {
    expect(() => buildQualityPrompt(null, resumeContent, coverLetterContent)).toThrow();
  });

  it('throws when resumeContent is missing', () => {
    expect(() => buildQualityPrompt(makeScoredJob(), null, coverLetterContent)).toThrow();
    expect(() => buildQualityPrompt(makeScoredJob(), '', coverLetterContent)).toThrow();
  });

  it('throws when coverLetterContent is missing', () => {
    expect(() => buildQualityPrompt(makeScoredJob(), resumeContent, null)).toThrow();
    expect(() => buildQualityPrompt(makeScoredJob(), resumeContent, '')).toThrow();
  });

  it('includes CRITICAL KEYWORDS section when criticalKeywords is present', () => {
    const scoredJob = makeScoredJob({ criticalKeywords: 'HIPAA, HITECH, EHR integration' });
    const result = buildQualityPrompt(scoredJob, resumeContent, coverLetterContent);

    expect(result).toContain('CRITICAL KEYWORDS TO WEAVE:');
    expect(result).toContain('HIPAA, HITECH, EHR integration');
  });

  it('omits CRITICAL KEYWORDS section when criticalKeywords is empty', () => {
    const scoredJob = makeScoredJob({ criticalKeywords: '' });
    const result = buildQualityPrompt(scoredJob, resumeContent, coverLetterContent);

    expect(result).not.toContain('CRITICAL KEYWORDS TO WEAVE:');
  });

  it('omits CRITICAL KEYWORDS section when criticalKeywords is undefined', () => {
    const scoredJob = makeScoredJob();
    const result = buildQualityPrompt(scoredJob, resumeContent, coverLetterContent);

    expect(result).not.toContain('CRITICAL KEYWORDS TO WEAVE:');
  });
});

// ---------------------------------------------------------------------------
// Cross-cutting tests
// ---------------------------------------------------------------------------

describe('content preservation (no truncation)', () => {
  it('buildScoringPrompt preserves full content length', () => {
    const jobFile = makeJobFile();
    const result = buildScoringPrompt(careerContents, jobFile);

    // Career contents appear in full
    expect(result.includes(careerContents)).toBe(true);
    // Job description appears in full
    expect(result.includes(jobFile.description)).toBe(true);
    // Combined length should be career + desc + boilerplate
    expect(result.length).toBeGreaterThan(careerContents.length + jobFile.description.length);
  });

  it('buildResumePrompt preserves all input content length', () => {
    const scoredJob = makeScoredJob();
    const result = buildResumePrompt(careerContents, pillarContents, scoredJob);

    expect(result.includes(careerContents)).toBe(true);
    expect(result.includes(pillarContents)).toBe(true);
    expect(result.includes(scoredJob.description)).toBe(true);
    expect(result.includes(scoredJob.fitSignal)).toBe(true);
    expect(result.includes(scoredJob.gap)).toBe(true);
  });

  it('buildCoverLetterPrompt preserves all input content length', () => {
    const scoredJob = makeScoredJob();
    const result = buildCoverLetterPrompt(careerContents, scoredJob, resumeContent);

    expect(result.includes(careerContents)).toBe(true);
    expect(result.includes(scoredJob.description)).toBe(true);
    expect(result.includes(resumeContent)).toBe(true);
  });

  it('buildQualityPrompt preserves all input content length', () => {
    const scoredJob = makeScoredJob();
    const result = buildQualityPrompt(scoredJob, resumeContent, coverLetterContent);

    expect(result.includes(scoredJob.description)).toBe(true);
    expect(result.includes(resumeContent)).toBe(true);
    expect(result.includes(coverLetterContent)).toBe(true);
  });
});
