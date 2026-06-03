'use strict';

const {
  parseJobFile,
  sanitizeForFilename,
  formatJobFile,
  extractLinkedInJobId,
} = require('../../src/models/job');
const { JobParseError } = require('../../src/lib/errors');
const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadFixture(name) {
  return fs.readFileSync(path.join(__dirname, '..', 'fixtures', name), 'utf8');
}

/**
 * Build a minimal valid markdown string for testing, with overridable fields.
 */
function buildJobMarkdown(overrides = {}) {
  const defaults = {
    title: 'Test Job Title',
    company: 'Test Company',
    location: 'Remote',
    employmentType: 'Full-time',
    salary: '$100,000–$120,000',
    url: 'https://www.linkedin.com/jobs/view/1234567890',
    linkedInJobId: '1234567890',
    harvested: '2026-05-30 09:00',
    description: 'This is a test job description.',
  };
  const opts = { ...defaults, ...overrides };

  return [
    `# ${opts.title}`,
    '',
    '## Metadata',
    `- **Company:** ${opts.company}`,
    `- **Location:** ${opts.location}`,
    `- **Employment Type:** ${opts.employmentType}`,
    `- **Salary:** ${opts.salary}`,
    `- **URL:** ${opts.url}`,
    `- **LinkedIn Job ID:** ${opts.linkedInJobId}`,
    `- **Harvested:** ${opts.harvested}`,
    '',
    '## Job Description',
    '',
    opts.description,
    '',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// parseJobFile
// ---------------------------------------------------------------------------

describe('parseJobFile', () => {
  it('parses sample_job_1.md correctly', () => {
    const content = loadFixture('sample_job_1.md');
    const job = parseJobFile(content, 'sample_job_1.md');

    expect(job.title).toBe('Senior Privacy Manager');
    expect(job.company).toBe('Meridian Health Systems');
    expect(job.location).toBe('Remote');
    expect(job.employmentType).toBe('Full-time');
    expect(job.salary).toBe('$160,000–$185,000');
    expect(job.url).toBe('https://www.linkedin.com/jobs/view/3987654321');
    expect(job.linkedInJobId).toBe('3987654321');
    expect(job.filename).toBe('sample_job_1.md');
    expect(job.description).toContain('Meridian Health Systems is seeking');
    expect(job.harvested instanceof Date).toBe(true);
  });

  it('sets salary to null when "Not specified"', () => {
    const content = loadFixture('sample_job_2.md');
    const job = parseJobFile(content, 'sample_job_2.md');

    expect(job.salary).toBeNull();
    expect(job.company).toBe('Vantara Financial');
  });

  it('populates salary when value is present', () => {
    const content = loadFixture('sample_job_1.md');
    const job = parseJobFile(content, 'sample_job_1.md');

    expect(job.salary).toBe('$160,000–$185,000');
  });

  it('sets salary to null when Salary field is absent', () => {
    const content = buildJobMarkdown({ salary: 'Not specified' });
    const job = parseJobFile(content, 'test.md');
    expect(job.salary).toBeNull();
  });

  it('strips query parameters from URL', () => {
    const urlWithParams = 'https://www.linkedin.com/jobs/view/3987654321?trk=someTracking&ref=123';
    const content = buildJobMarkdown({ url: urlWithParams });
    const job = parseJobFile(content, 'test.md');

    expect(job.url).toBe('https://www.linkedin.com/jobs/view/3987654321');
    expect(job.url).not.toContain('trk=');
  });

  it('strips hash fragments from URL', () => {
    const urlWithHash = 'https://www.linkedin.com/jobs/view/3987654321#section';
    const content = buildJobMarkdown({ url: urlWithHash });
    const job = parseJobFile(content, 'test.md');

    expect(job.url).toBe('https://www.linkedin.com/jobs/view/3987654321');
  });

  it('extracts linkedInJobId from URL', () => {
    const content = loadFixture('sample_job_1.md');
    const job = parseJobFile(content, 'sample_job_1.md');

    expect(job.linkedInJobId).toBe('3987654321');
  });

  it('sets linkedInJobId to null for non-LinkedIn URL', () => {
    const content = buildJobMarkdown({
      url: 'https://example.com/job/123',
      linkedInJobId: 'Not available',
    });
    const job = parseJobFile(content, 'test.md');

    expect(job.linkedInJobId).toBeNull();
  });

  it('sets linkedInJobId to null for non-LinkedIn URL', () => {
    const content = buildJobMarkdown({
      url: 'https://example.com/job/12345',
      linkedInJobId: 'Not available',
    });
    const job = parseJobFile(content, 'test.md');

    expect(job.linkedInJobId).toBeNull();
  });

  it('sets location to "Not specified" when Location field is absent', () => {
    // Build markdown without Location line
    const content = [
      '# Test Job',
      '',
      '## Metadata',
      '- **Company:** Test Co',
      '- **Employment Type:** Full-time',
      '- **Salary:** $100k',
      '- **URL:** https://www.linkedin.com/jobs/view/1',
      '- **LinkedIn Job ID:** 1',
      '- **Harvested:** 2026-05-30 09:00',
      '',
      '## Job Description',
      '',
      'Description text.',
      '',
    ].join('\n');
    const job = parseJobFile(content, 'test.md');

    expect(job.location).toBe('Not specified');
  });

  it('sets employmentType to "Not specified" when field is absent', () => {
    const content = buildJobMarkdown({ employmentType: 'Not specified' });
    const job = parseJobFile(content, 'test.md');
    expect(job.employmentType).toBe('Not specified');
  });

  it('throws JobParseError with filename when ## Metadata section missing', () => {
    const content = [
      '# Test Job',
      '',
      '## Job Description',
      '',
      'Some description.',
    ].join('\n');

    expect(() => {
      parseJobFile(content, 'missing_metadata.md');
    }).toThrow(JobParseError);

    try {
      parseJobFile(content, 'missing_metadata.md');
    } catch (err) {
      expect(err.filename).toBe('missing_metadata.md');
    }
  });

  it('throws JobParseError when URL field is empty', () => {
    const content = buildJobMarkdown({ url: '' });

    expect(() => {
      parseJobFile(content, 'empty_url.md');
    }).toThrow(JobParseError);

    try {
      parseJobFile(content, 'empty_url.md');
    } catch (err) {
      expect(err.filename).toBe('empty_url.md');
    }
  });

  it('throws JobParseError when URL field is completely missing', () => {
    const content = [
      '# Test Job',
      '',
      '## Metadata',
      '- **Company:** Test Co',
      '- **Salary:** $100k',
      '- **Harvested:** 2026-05-30 09:00',
      '',
      '## Job Description',
      '',
      'Description.',
    ].join('\n');

    expect(() => {
      parseJobFile(content, 'no_url.md');
    }).toThrow(JobParseError);
  });

  it('throws JobParseError when ## Job Description section is missing', () => {
    const content = [
      '# Test Job',
      '',
      '## Metadata',
      '- **Company:** Test Co',
      '- **URL:** https://www.linkedin.com/jobs/view/1',
      '- **LinkedIn Job ID:** 1',
      '- **Harvested:** 2026-05-30 09:00',
      '',
    ].join('\n');

    expect(() => {
      parseJobFile(content, 'no_desc.md');
    }).toThrow(JobParseError);

    try {
      parseJobFile(content, 'no_desc.md');
    } catch (err) {
      expect(err.filename).toBe('no_desc.md');
    }
  });

  it('throws JobParseError when title (h1) is missing', () => {
    const content = [
      '## Metadata',
      '- **Company:** Test Co',
      '- **URL:** https://www.linkedin.com/jobs/view/1',
      '- **LinkedIn Job ID:** 1',
      '- **Harvested:** 2026-05-30 09:00',
      '',
      '## Job Description',
      '',
      'Description.',
    ].join('\n');

    expect(() => {
      parseJobFile(content, 'no_title.md');
    }).toThrow(JobParseError);

    try {
      parseJobFile(content, 'no_title.md');
    } catch (err) {
      expect(err.filename).toBe('no_title.md');
    }
  });

  it('sets company to empty string when Company field is absent', () => {
    const content = [
      '# Test Job',
      '',
      '## Metadata',
      '- **URL:** https://www.linkedin.com/jobs/view/1',
      '- **LinkedIn Job ID:** 1',
      '- **Harvested:** 2026-05-30 09:00',
      '',
      '## Job Description',
      '',
      'Description.',
    ].join('\n');
    const job = parseJobFile(content, 'test.md');
    expect(job.company).toBe('');
  });

  it('parses harvested field as a Date', () => {
    const content = loadFixture('sample_job_1.md');
    const job = parseJobFile(content, 'test.md');
    expect(job.harvested instanceof Date).toBe(true);
    expect(job.harvested.getTime()).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// sanitizeForFilename
// ---------------------------------------------------------------------------

describe('sanitizeForFilename', () => {
  it('replaces spaces with hyphens', () => {
    expect(sanitizeForFilename('Hello World', 60)).toBe('Hello-World');
  });

  it('removes ampersands', () => {
    expect(sanitizeForFilename('AT&T', 60)).toBe('ATT');
  });

  it('handles Johnson & Johnson', () => {
    expect(sanitizeForFilename('Johnson & Johnson', 60)).toBe('Johnson-Johnson');
  });

  it('removes parentheses and slash', () => {
    expect(sanitizeForFilename('Company (Inc.) / Division', 60)).toBe('Company-Inc.-Division');
  });

  it('collapses consecutive hyphens', () => {
    expect(sanitizeForFilename('A--B', 60)).toBe('A-B');
  });

  it('trims leading hyphens', () => {
    expect(sanitizeForFilename('-Leading', 60)).toBe('Leading');
  });

  it('trims trailing hyphens', () => {
    expect(sanitizeForFilename('Trailing-', 60)).toBe('Trailing');
  });

  it('truncates at maxLength', () => {
    const result = sanitizeForFilename('abcdefghijklmnopqrstuvwxyz', 10);
    expect(result).toBe('abcdefghij');
    expect(result.length).toBeLessThanOrEqual(10);
  });

  it('handles already-clean strings without modification', () => {
    expect(sanitizeForFilename('Clean-String', 60)).toBe('Clean-String');
  });

  it('removes all forbidden special chars', () => {
    const result = sanitizeForFilename('Hello! @World# $Test% ^&*()', 60);
    expect(result).toBe('Hello-World-Test');
  });

  it('removes single quotes and double quotes', () => {
    expect(sanitizeForFilename("It's a \"Test\"", 60)).toBe('Its-a-Test');
  });

  it('removes commas, colons, and semicolons', () => {
    expect(sanitizeForFilename('A, B: C; D', 60)).toBe('A-B-C-D');
  });

  it('removes angle brackets and pipe', () => {
    expect(sanitizeForFilename('A < B > C | D', 60)).toBe('A-B-C-D');
  });
});

// ---------------------------------------------------------------------------
// formatJobFile
// ---------------------------------------------------------------------------

describe('formatJobFile', () => {
  it('round-trips: parse -> format -> parse returns equivalent object (sample_job_1)', () => {
    const original = loadFixture('sample_job_1.md');
    const job = parseJobFile(original, 'sample_job_1.md');
    const formatted = formatJobFile(job);
    const reParsed = parseJobFile(formatted, 'sample_job_1.md');

    expect(reParsed.title).toBe(job.title);
    expect(reParsed.company).toBe(job.company);
    expect(reParsed.location).toBe(job.location);
    expect(reParsed.employmentType).toBe(job.employmentType);
    expect(reParsed.salary).toBe(job.salary);
    expect(reParsed.url).toBe(job.url);
    expect(reParsed.linkedInJobId).toBe(job.linkedInJobId);
    expect(reParsed.filename).toBe(job.filename);
    expect(reParsed.description).toBe(job.description);
  });

  it('round-trips with null salary (sample_job_2)', () => {
    const original = loadFixture('sample_job_2.md');
    const job = parseJobFile(original, 'sample_job_2.md');
    expect(job.salary).toBeNull();

    const formatted = formatJobFile(job);
    const reParsed = parseJobFile(formatted, 'sample_job_2.md');

    expect(reParsed.salary).toBeNull();
    expect(reParsed.title).toBe('AI Governance Analyst');
    expect(reParsed.company).toBe('Vantara Financial');
  });

  it('produces valid markdown string with all sections', () => {
    const content = loadFixture('sample_job_1.md');
    const job = parseJobFile(content, 'sample_job_1.md');
    const formatted = formatJobFile(job);

    expect(formatted).toContain('# Senior Privacy Manager');
    expect(formatted).toContain('## Metadata');
    expect(formatted).toContain('## Job Description');
    expect(formatted).toContain('- **Company:** Meridian Health Systems');
    expect(formatted).toContain('- **URL:** https://www.linkedin.com/jobs/view/3987654321');
  });

  it('formats null salary as "Not specified"', () => {
    const content = loadFixture('sample_job_2.md');
    const job = parseJobFile(content, 'sample_job_2.md');
    const formatted = formatJobFile(job);

    expect(formatted).toContain('- **Salary:** Not specified');
  });

  it('formats null linkedInJobId as "Not available"', () => {
    const content = buildJobMarkdown({
      url: 'https://example.com/job/12345',
      linkedInJobId: 'Not available',
    });
    const job = parseJobFile(content, 'test.md');
    expect(job.linkedInJobId).toBeNull();

    const formatted = formatJobFile(job);
    expect(formatted).toContain('- **LinkedIn Job ID:** Not available');
  });
});

// ---------------------------------------------------------------------------
// extractLinkedInJobId
// ---------------------------------------------------------------------------

describe('extractLinkedInJobId', () => {
  it('extracts numeric ID from standard LinkedIn jobs URL with trailing slash', () => {
    const id = extractLinkedInJobId('https://www.linkedin.com/jobs/view/3987654321/');
    expect(id).toBe('3987654321');
  });

  it('handles URL without trailing slash', () => {
    const id = extractLinkedInJobId('https://www.linkedin.com/jobs/view/3987654321');
    expect(id).toBe('3987654321');
  });

  it('returns null for non-LinkedIn URL', () => {
    const id = extractLinkedInJobId('https://example.com/job/123');
    expect(id).toBeNull();
  });

  it('returns null for LinkedIn URL without job ID pattern', () => {
    const id = extractLinkedInJobId('https://www.linkedin.com/feed/');
    expect(id).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(extractLinkedInJobId('')).toBeNull();
  });

  it('returns null for undefined input', () => {
    expect(extractLinkedInJobId(undefined)).toBeNull();
  });
});
