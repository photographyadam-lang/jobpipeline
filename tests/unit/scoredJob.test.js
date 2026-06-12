'use strict';

const { parseScoreResponse, createScoredJob } = require('../../src/models/scoredJob');
const { DeepSeekResponseError } = require('../../src/lib/errors');
const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadFixture(name) {
  return fs.readFileSync(path.join(__dirname, '..', 'fixtures', name), 'utf8');
}

/**
 * Build a minimal valid JobFile object for testing createScoredJob.
 */
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
    description: 'Meridian Health Systems is seeking a Senior Privacy Manager.',
    filename: 'sample_job_1.md',
    ...overrides,
  };
}

/** Build a valid score result object. */
function makeScoreResult(overrides = {}) {
  return {
    score: 7,
    fitSignal: 'Strong alignment on governance program leadership.',
    gap: 'No direct healthcare domain experience.',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// parseScoreResponse
// ---------------------------------------------------------------------------

describe('parseScoreResponse', () => {
  it('parses valid fixture response correctly', () => {
    const fixtureContent = loadFixture('sample_deepseek_score_response.json');
    const result = parseScoreResponse(fixtureContent);

    expect(result).toEqual({
      score: 7,
      fitSignal: 'Strong alignment on governance program leadership and enterprise compliance scope. Meta experience maps directly to the regulatory delivery requirements.',
      gap: 'No direct healthcare domain experience.',
      mustHaves: 'Healthcare privacy domain expertise, program-building at scale, executive stakeholder management',
      targetArchetype: 'A hands-on governance program builder',
      matchedPillars: ['Pillar 1', 'Pillar 4', 'Pillar 8'],
      criticalKeywords: 'HIPAA, HITECH, CMS interoperability, healthcare data masking, EHR integration',
      overQualified: false,
    });
  });

  it('throws DeepSeekResponseError on non-JSON string', () => {
    expect(() => {
      parseScoreResponse('not valid json');
    }).toThrow(DeepSeekResponseError);
  });

  it('throws DeepSeekResponseError when score is missing', () => {
    const fixtureContent = loadFixture('sample_deepseek_score_invalid.json');
    expect(() => {
      parseScoreResponse(fixtureContent);
    }).toThrow(DeepSeekResponseError);
  });

  it('throws DeepSeekResponseError when score is 0 (out of range)', () => {
    const payload = JSON.stringify({
      score: 0,
      fit_signal: 'Some fit signal.',
      gap: 'Some gap.',
    });
    expect(() => {
      parseScoreResponse(payload);
    }).toThrow(DeepSeekResponseError);
  });

  it('throws DeepSeekResponseError when score is 11 (out of range)', () => {
    const payload = JSON.stringify({
      score: 11,
      fit_signal: 'Some fit signal.',
      gap: 'Some gap.',
    });
    expect(() => {
      parseScoreResponse(payload);
    }).toThrow(DeepSeekResponseError);
  });

  it('throws DeepSeekResponseError when score is a float (7.5)', () => {
    const payload = JSON.stringify({
      score: 7.5,
      fit_signal: 'Some fit signal.',
      gap: 'Some gap.',
    });
    expect(() => {
      parseScoreResponse(payload);
    }).toThrow(DeepSeekResponseError);
  });

  it('throws DeepSeekResponseError when fitSignal is missing', () => {
    const payload = JSON.stringify({
      score: 5,
      gap: 'Some gap.',
    });
    expect(() => {
      parseScoreResponse(payload);
    }).toThrow(DeepSeekResponseError);
  });

  it('throws DeepSeekResponseError when fitSignal is empty string', () => {
    const payload = JSON.stringify({
      score: 5,
      fit_signal: '',
      gap: 'Some gap.',
    });
    expect(() => {
      parseScoreResponse(payload);
    }).toThrow(DeepSeekResponseError);
  });

  it('throws DeepSeekResponseError when gap is missing', () => {
    const payload = JSON.stringify({
      score: 5,
      fit_signal: 'Some fit signal.',
    });
    expect(() => {
      parseScoreResponse(payload);
    }).toThrow(DeepSeekResponseError);
  });

  it('throws DeepSeekResponseError when gap is empty string', () => {
    const payload = JSON.stringify({
      score: 5,
      fit_signal: 'Some fit signal.',
      gap: '',
    });
    expect(() => {
      parseScoreResponse(payload);
    }).toThrow(DeepSeekResponseError);
  });

  // ── critical_keywords ──────────────────────────────────────────────

  it('parses critical_keywords from fixture response', () => {
    const payload = JSON.stringify({
      score: 5,
      fit_signal: 'Some fit signal.',
      gap: 'Some gap.',
      critical_keywords: 'HIPAA, HITECH, EHR integration',
      over_qualified: false,
    });
    const result = parseScoreResponse(payload);

    expect(result.criticalKeywords).toBe('HIPAA, HITECH, EHR integration');
  });

  it('defaults critical_keywords to empty string when missing', () => {
    const payload = JSON.stringify({
      score: 5,
      fit_signal: 'Some fit signal.',
      gap: 'Some gap.',
      over_qualified: false,
    });
    const result = parseScoreResponse(payload);

    expect(result.criticalKeywords).toBe('');
  });

  it('defaults critical_keywords to empty string when empty', () => {
    const payload = JSON.stringify({
      score: 5,
      fit_signal: 'Some fit signal.',
      gap: 'Some gap.',
      critical_keywords: '',
      over_qualified: false,
    });
    const result = parseScoreResponse(payload);

    expect(result.criticalKeywords).toBe('');
  });

  // ── over_qualified ────────────────────────────────────────────────

  it('parses over_qualified as true when true', () => {
    const payload = JSON.stringify({
      score: 5,
      fit_signal: 'Some fit signal.',
      gap: 'Some gap.',
      over_qualified: true,
    });
    const result = parseScoreResponse(payload);

    expect(result.overQualified).toBe(true);
  });

  it('defaults over_qualified to false when missing', () => {
    const payload = JSON.stringify({
      score: 5,
      fit_signal: 'Some fit signal.',
      gap: 'Some gap.',
    });
    const result = parseScoreResponse(payload);

    expect(result.overQualified).toBe(false);
  });

  it('defaults over_qualified to false when null', () => {
    const payload = JSON.stringify({
      score: 5,
      fit_signal: 'Some fit signal.',
      gap: 'Some gap.',
      over_qualified: null,
    });
    const result = parseScoreResponse(payload);

    expect(result.overQualified).toBe(false);
  });

  it('coerces over_qualified string "true" to boolean true', () => {
    const payload = JSON.stringify({
      score: 5,
      fit_signal: 'Some fit signal.',
      gap: 'Some gap.',
      over_qualified: 'true',
    });
    const result = parseScoreResponse(payload);

    expect(result.overQualified).toBe(true);
  });

  it('coerces over_qualified number 1 to boolean true', () => {
    const payload = JSON.stringify({
      score: 5,
      fit_signal: 'Some fit signal.',
      gap: 'Some gap.',
      over_qualified: 1,
    });
    const result = parseScoreResponse(payload);

    expect(result.overQualified).toBe(true);
  });

  it('coerces over_qualified number 0 to boolean false', () => {
    const payload = JSON.stringify({
      score: 5,
      fit_signal: 'Some fit signal.',
      gap: 'Some gap.',
      over_qualified: 0,
    });
    const result = parseScoreResponse(payload);

    expect(result.overQualified).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// createScoredJob
// ---------------------------------------------------------------------------

describe('createScoredJob', () => {
  it('includes all JobFile fields in the result', () => {
    const job = makeJobFile();
    const scoreResult = makeScoreResult();
    const scoredJob = createScoredJob(job, scoreResult);

    expect(scoredJob.title).toBe('Senior Privacy Manager');
    expect(scoredJob.company).toBe('Meridian Health Systems');
    expect(scoredJob.location).toBe('Remote');
    expect(scoredJob.employmentType).toBe('Full-time');
    expect(scoredJob.salary).toBe('$160,000–$185,000');
    expect(scoredJob.url).toBe('https://www.linkedin.com/jobs/view/3987654321');
    expect(scoredJob.linkedInJobId).toBe('3987654321');
    expect(scoredJob.harvested).toEqual(new Date('2026-05-30 09:14'));
    expect(scoredJob.description).toBe('Meridian Health Systems is seeking a Senior Privacy Manager.');
    expect(scoredJob.filename).toBe('sample_job_1.md');
  });

  it('sets rank to null', () => {
    const job = makeJobFile();
    const scoreResult = makeScoreResult();
    const scoredJob = createScoredJob(job, scoreResult);

    expect(scoredJob.rank).toBeNull();
  });

  it('sets actionFlag to null', () => {
    const job = makeJobFile();
    const scoreResult = makeScoreResult();
    const scoredJob = createScoredJob(job, scoreResult);

    expect(scoredJob.actionFlag).toBeNull();
  });

  it('sets score, fitSignal, gap from scoreResult', () => {
    const job = makeJobFile();
    const scoreResult = makeScoreResult({
      score: 8,
      fitSignal: 'Custom fit signal.',
      gap: 'Custom gap.',
    });
    const scoredJob = createScoredJob(job, scoreResult);

    expect(scoredJob.score).toBe(8);
    expect(scoredJob.fitSignal).toBe('Custom fit signal.');
    expect(scoredJob.gap).toBe('Custom gap.');
  });

  it('does not mutate the input JobFile object', () => {
    const job = makeJobFile();
    const original = { ...job };
    const scoreResult = makeScoreResult();

    createScoredJob(job, scoreResult);

    expect(job).toEqual(original);
  });

  it('binds criticalKeywords onto scored job', () => {
    const job = makeJobFile();
    const scoreResult = makeScoreResult({ criticalKeywords: 'HIPAA, HITECH' });
    const scoredJob = createScoredJob(job, scoreResult);

    expect(scoredJob.criticalKeywords).toBe('HIPAA, HITECH');
  });

  it('binds overQualified onto scored job', () => {
    const job = makeJobFile();
    const scoreResult = makeScoreResult({ overQualified: true });
    const scoredJob = createScoredJob(job, scoreResult);

    expect(scoredJob.overQualified).toBe(true);
  });
});
