'use strict';

const { deduplicateJobs } = require('../../src/lib/deduplicator');
const { sanitizeForFilename } = require('../../src/models/job');

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Create a minimal JobFile-like object for testing.
 *
 * @param {object} overrides
 * @returns {object}
 */
function makeJob(overrides = {}) {
  return {
    title: 'Senior Privacy Manager',
    company: 'Meridian Health Systems',
    location: 'Remote',
    employmentType: 'Full-time',
    salary: '$160,000–$185,000',
    url: 'https://www.linkedin.com/jobs/view/3987654321',
    linkedInJobId: '3987654321',
    harvested: new Date('2026-05-30 09:14'),
    description: 'Job description text.',
    filename: 'sample_job_1.md',
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('deduplicateJobs', () => {
  describe('URL deduplication (Pass 1)', () => {
    it('returns all jobs in unique when no duplicates exist', () => {
      const job1 = makeJob({ url: 'https://example.com/job/1' });
      const job2 = makeJob({
        url: 'https://example.com/job/2',
        company: 'Other Corp',
        title: 'Other Role',
      });
      const input = [job1, job2];

      const result = deduplicateJobs(input);

      expect(result.unique).toHaveLength(2);
      expect(result.duplicates).toHaveLength(0);
      expect(result.fuzzyWarnings).toHaveLength(0);
      expect(result.unique).toContain(job1);
      expect(result.unique).toContain(job2);
    });

    it('keeps the most recently harvested job on URL collision', () => {
      const newer = makeJob({ harvested: new Date('2026-05-30 09:14') });
      const older = makeJob({ harvested: new Date('2026-05-30 07:02') });
      const input = [newer, older];

      const result = deduplicateJobs(input);

      expect(result.unique).toHaveLength(1);
      expect(result.unique[0]).toBe(newer);
    });

    it('keeps the most recently harvested when input order is reversed', () => {
      const older = makeJob({ harvested: new Date('2026-05-30 07:02') });
      const newer = makeJob({ harvested: new Date('2026-05-30 09:14') });
      const input = [older, newer];

      const result = deduplicateJobs(input);

      expect(result.unique).toHaveLength(1);
      expect(result.unique[0]).toBe(newer);
    });

    it('reports the skipped duplicate in the duplicates array', () => {
      const newer = makeJob({ harvested: new Date('2026-05-30 09:14') });
      const older = makeJob({ harvested: new Date('2026-05-30 07:02') });
      const input = [newer, older];

      const result = deduplicateJobs(input);

      expect(result.duplicates).toHaveLength(1);
      expect(result.duplicates[0].kept).toBe(newer);
      expect(result.duplicates[0].skipped).toBe(older);
    });

    it('handles three jobs with two sharing a URL', () => {
      const unique_job = makeJob({
        url: 'https://example.com/job/unique',
        company: 'Other Corp',
        title: 'Other Role',
      });
      const newer = makeJob({ harvested: new Date('2026-05-30 09:14') });
      const older = makeJob({ harvested: new Date('2026-05-30 07:02') });
      const input = [unique_job, newer, older];

      const result = deduplicateJobs(input);

      expect(result.unique).toHaveLength(2);
      expect(result.unique).toContain(unique_job);
      expect(result.unique).toContain(newer);
      expect(result.duplicates).toHaveLength(1);
      expect(result.duplicates[0].kept).toBe(newer);
      expect(result.duplicates[0].skipped).toBe(older);
    });

    it('does not mutate the input array', () => {
      const newer = makeJob({ harvested: new Date('2026-05-30 09:14') });
      const older = makeJob({ harvested: new Date('2026-05-30 07:02') });
      const input = [newer, older];
      const inputCopy = [...input];

      deduplicateJobs(input);

      expect(input).toEqual(inputCopy);
    });

    it('handles empty array', () => {
      const result = deduplicateJobs([]);

      expect(result).toEqual({ unique: [], duplicates: [], fuzzyWarnings: [] });
    });

    it('handles null input', () => {
      const result = deduplicateJobs(null);

      expect(result).toEqual({ unique: [], duplicates: [], fuzzyWarnings: [] });
    });

    it('handles undefined input', () => {
      const result = deduplicateJobs(undefined);

      expect(result).toEqual({ unique: [], duplicates: [], fuzzyWarnings: [] });
    });

    it('handles single-item array', () => {
      const job = makeJob();
      const input = [job];

      const result = deduplicateJobs(input);

      expect(result.unique).toHaveLength(1);
      expect(result.unique[0]).toBe(job);
      expect(result.duplicates).toHaveLength(0);
      expect(result.fuzzyWarnings).toHaveLength(0);
    });

    it('maintains correct count relationship: unique.length === input.length - duplicates.length', () => {
      const job1 = makeJob({ url: 'https://example.com/job/1', company: 'A' });
      const job2 = makeJob({ url: 'https://example.com/job/1', company: 'A', harvested: new Date('2026-05-30 07:02') });
      const job3 = makeJob({ url: 'https://example.com/job/2', company: 'B', title: 'B Title' });
      const input = [job1, job2, job3];

      const result = deduplicateJobs(input);

      expect(result.unique.length).toBe(input.length - result.duplicates.length);
    });
  });

  describe('fuzzy duplicate detection (Pass 2)', () => {
    it('flags matching company+title with different URLs as a fuzzyWarning', () => {
      const jobA = makeJob({
        url: 'https://www.linkedin.com/jobs/view/3987654321',
        harvested: new Date('2026-05-30 09:14'),
      });
      const jobB = makeJob({
        url: 'https://www.linkedin.com/jobs/view/9998887776',
        harvested: new Date('2026-05-30 11:45'),
      });
      const input = [jobA, jobB];

      const result = deduplicateJobs(input);

      expect(result.unique).toHaveLength(2);
      expect(result.unique).toContain(jobA);
      expect(result.unique).toContain(jobB);
      expect(result.fuzzyWarnings).toHaveLength(1);
      expect(result.fuzzyWarnings[0].job1).toBe(jobA);
      expect(result.fuzzyWarnings[0].job2).toBe(jobB);
      expect(result.fuzzyWarnings[0].reason).toContain('Meridian Health Systems');
      expect(result.fuzzyWarnings[0].reason).toContain('Senior Privacy Manager');
    });

    it('does not flag exact URL duplicates as fuzzyWarnings', () => {
      const newer = makeJob({ harvested: new Date('2026-05-30 09:14') });
      const older = makeJob({ harvested: new Date('2026-05-30 07:02') });
      const input = [newer, older];

      const result = deduplicateJobs(input);

      expect(result.fuzzyWarnings).toHaveLength(0);
    });

    it('returns empty fuzzyWarnings when no fuzzy matches exist', () => {
      const job1 = makeJob({ url: 'https://example.com/job/1', company: 'Company A', title: 'Role A' });
      const job2 = makeJob({ url: 'https://example.com/job/2', company: 'Company B', title: 'Role B' });
      const input = [job1, job2];

      const result = deduplicateJobs(input);

      expect(result.fuzzyWarnings).toHaveLength(0);
    });

    it('handles a set with both URL duplicates and fuzzy duplicates', () => {
      // jobA (newer) and jobA_old (older) share URL → URL duplicate
      const jobA = makeJob({
        company: 'Meridian Health Systems',
        title: 'Senior Privacy Manager',
        url: 'https://www.linkedin.com/jobs/view/3987654321',
        harvested: new Date('2026-05-30 09:14'),
      });
      const jobA_old = makeJob({
        company: 'Meridian Health Systems',
        title: 'Senior Privacy Manager',
        url: 'https://www.linkedin.com/jobs/view/3987654321',
        harvested: new Date('2026-05-30 07:02'),
      });
      // jobB: same company+title but different URL → fuzzy warning with jobA
      const jobB = makeJob({
        company: 'Meridian Health Systems',
        title: 'Senior Privacy Manager',
        url: 'https://www.linkedin.com/jobs/view/9998887776',
        harvested: new Date('2026-05-30 11:45'),
      });
      // jobC: completely different → no match
      const jobC = makeJob({
        company: 'Vantara Financial',
        title: 'AI Governance Analyst',
        url: 'https://www.linkedin.com/jobs/view/1122334455',
        harvested: new Date('2026-05-30 10:30'),
      });

      const input = [jobA, jobA_old, jobB, jobC];
      const result = deduplicateJobs(input);

      // unique: jobA, jobB, jobC (3 — jobA_old is URL duplicate)
      expect(result.unique).toHaveLength(3);
      expect(result.unique).toContain(jobA);
      expect(result.unique).toContain(jobB);
      expect(result.unique).toContain(jobC);

      // duplicates: jobA_old skipped (1 entry)
      expect(result.duplicates).toHaveLength(1);
      expect(result.duplicates[0].kept).toBe(jobA);
      expect(result.duplicates[0].skipped).toBe(jobA_old);

      // fuzzyWarnings: jobA + jobB (1 entry, not jobA_old since it's a URL dup)
      expect(result.fuzzyWarnings).toHaveLength(1);
      expect(result.fuzzyWarnings[0].job1).toBe(jobA);
      expect(result.fuzzyWarnings[0].job2).toBe(jobB);
    });

    it('uses sanitizeForFilename for comparison — handles special characters in company/title', () => {
      const jobA = makeJob({
        company: 'AT&T',
        title: 'Senior Engineer',
        url: 'https://example.com/job/1',
        harvested: new Date('2026-05-30 09:14'),
      });
      const jobB = makeJob({
        company: 'AT&T', // will sanitize to 'ATT'
        title: 'Senior Engineer', // will sanitize to 'Senior-Engineer'
        url: 'https://example.com/job/2',
        harvested: new Date('2026-05-30 10:00'),
      });
      const input = [jobA, jobB];

      // Verify sanitization produces equal strings
      expect(sanitizeForFilename('AT&T', 60)).toBe('ATT');
      expect(sanitizeForFilename('Senior Engineer', 60)).toBe('Senior-Engineer');

      const result = deduplicateJobs(input);

      expect(result.fuzzyWarnings).toHaveLength(1);
    });

    it('does not flag same company but different titles as fuzzy', () => {
      const jobA = makeJob({
        company: 'Meridian Health Systems',
        title: 'Senior Privacy Manager',
        url: 'https://example.com/job/1',
      });
      const jobB = makeJob({
        company: 'Meridian Health Systems',
        title: 'Junior Privacy Analyst',
        url: 'https://example.com/job/2',
      });
      const input = [jobA, jobB];

      const result = deduplicateJobs(input);

      expect(result.fuzzyWarnings).toHaveLength(0);
    });
  });
});
