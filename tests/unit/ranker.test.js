'use strict';

const { rankJobs } = require('../../src/lib/ranker');

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Create a minimal ScoredJob-like object for testing.
 *
 * @param {number} score - Score value (1-10).
 * @param {object} [overrides] - Additional properties to override.
 * @returns {object}
 */
function makeScoredJob(score) {
  var overrides = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {};
  return Object.assign({
    title: 'Test Job',
    company: 'Test Corp',
    location: 'Remote',
    employmentType: 'Full-time',
    salary: '$100,000-$120,000',
    url: 'https://example.com/job/1',
    linkedInJobId: '1234567890',
    harvested: new Date('2026-06-01 09:00'),
    description: 'Job description.',
    filename: 'test_job.md',
    score: score,
    fitSignal: 'Strong match on domain expertise.',
    gap: 'No stated gap.',
    rank: null,
    actionFlag: null,
  }, overrides);
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('rankJobs', function () {
  describe('descending score sort and rank assignment', function () {
    it('assigns ranks in descending score order', function () {
      var jobs = [
        makeScoredJob(5),
        makeScoredJob(10),
        makeScoredJob(7),
        makeScoredJob(3),
        makeScoredJob(8),
      ];

      var result = rankJobs(jobs);

      expect(result).toHaveLength(5);
      // Verify descending score order
      expect(result[0].score).toBe(10);
      expect(result[1].score).toBe(8);
      expect(result[2].score).toBe(7);
      expect(result[3].score).toBe(5);
      expect(result[4].score).toBe(3);
      // Verify ranks
      expect(result[0].rank).toBe(1);
      expect(result[1].rank).toBe(2);
      expect(result[2].rank).toBe(3);
      expect(result[3].rank).toBe(4);
      expect(result[4].rank).toBe(5);
    });

    it('assigns dense ranks for tied scores', function () {
      var jobs = [
        makeScoredJob(10),
        makeScoredJob(9),
        makeScoredJob(9),
        makeScoredJob(8),
      ];

      var result = rankJobs(jobs);

      // Dense ranks: [10->1, 9->2, 9->2, 8->3]
      expect(result[0].rank).toBe(1); // score 10
      expect(result[1].rank).toBe(2); // score 9
      expect(result[2].rank).toBe(2); // score 9 (tied)
      expect(result[3].rank).toBe(3); // score 8
    });
  });

  describe('action flag: DEEP_TAILOR', function () {
    it('assigns DEEP_TAILOR to top 4 jobs with distinct scores', function () {
      var jobs = [
        makeScoredJob(10),
        makeScoredJob(9),
        makeScoredJob(8),
        makeScoredJob(7),
        makeScoredJob(6),
        makeScoredJob(5),
        makeScoredJob(4),
        makeScoredJob(3),
        makeScoredJob(2),
        makeScoredJob(1),
      ];

      var result = rankJobs(jobs);

      expect(result[0].actionFlag).toBe('DEEP_TAILOR'); // rank 1, score 10
      expect(result[1].actionFlag).toBe('DEEP_TAILOR'); // rank 2, score 9
      expect(result[2].actionFlag).toBe('DEEP_TAILOR'); // rank 3, score 8
      expect(result[3].actionFlag).toBe('DEEP_TAILOR'); // rank 4, score 7
    });
  });

  describe('action flag: AUTO_GENERATED', function () {
    it('assigns AUTO_GENERATED to rank 5+ with score >= 6', function () {
      var jobs = [
        makeScoredJob(10),
        makeScoredJob(9),
        makeScoredJob(8),
        makeScoredJob(7),
        makeScoredJob(6), // rank 5, score 6 >= 6 → AUTO_GENERATED
      ];

      var result = rankJobs(jobs);

      expect(result[0].actionFlag).toBe('DEEP_TAILOR'); // rank 1
      expect(result[1].actionFlag).toBe('DEEP_TAILOR'); // rank 2
      expect(result[2].actionFlag).toBe('DEEP_TAILOR'); // rank 3
      expect(result[3].actionFlag).toBe('DEEP_TAILOR'); // rank 4
      expect(result[4].actionFlag).toBe('AUTO_GENERATED'); // rank 5, score 6
    });
  });

  describe('action flag: NO_DOCS', function () {
    it('assigns NO_DOCS to rank 5+ with score < 6', function () {
      var jobs = [
        makeScoredJob(10),
        makeScoredJob(9),
        makeScoredJob(8),
        makeScoredJob(7),
        makeScoredJob(5), // rank 5, score 5 < 6 → NO_DOCS
      ];

      var result = rankJobs(jobs);

      expect(result[0].actionFlag).toBe('DEEP_TAILOR'); // rank 1
      expect(result[1].actionFlag).toBe('DEEP_TAILOR'); // rank 2
      expect(result[2].actionFlag).toBe('DEEP_TAILOR'); // rank 3
      expect(result[3].actionFlag).toBe('DEEP_TAILOR'); // rank 4
      expect(result[4].actionFlag).toBe('NO_DOCS'); // rank 5, score 5
    });
  });

  describe('action flags: mixed thresholds at rank 5+', function () {
    it('applies AUTO_GENERATED and NO_DOCS correctly at rank 5+', function () {
      var jobs = [
        makeScoredJob(10),
        makeScoredJob(9),
        makeScoredJob(8),
        makeScoredJob(7), // rank 4: DEEP_TAILOR
        makeScoredJob(6), // rank 5, score 6 >= 6 → AUTO_GENERATED
        makeScoredJob(5), // rank 6, score 5 < 6 → NO_DOCS
        makeScoredJob(4), // rank 7, score 4 < 6 → NO_DOCS
        makeScoredJob(3), // rank 8, score 3 < 6 → NO_DOCS
        makeScoredJob(2), // rank 9, score 2 < 6 → NO_DOCS
        makeScoredJob(1), // rank 10, score 1 < 6 → NO_DOCS
      ];

      var result = rankJobs(jobs);

      expect(result[0].actionFlag).toBe('DEEP_TAILOR');
      expect(result[1].actionFlag).toBe('DEEP_TAILOR');
      expect(result[2].actionFlag).toBe('DEEP_TAILOR');
      expect(result[3].actionFlag).toBe('DEEP_TAILOR');
      expect(result[4].actionFlag).toBe('AUTO_GENERATED');
      expect(result[5].actionFlag).toBe('NO_DOCS');
      expect(result[6].actionFlag).toBe('NO_DOCS');
      expect(result[7].actionFlag).toBe('NO_DOCS');
      expect(result[8].actionFlag).toBe('NO_DOCS');
      expect(result[9].actionFlag).toBe('NO_DOCS');
    });
  });

  describe('small-pool fallback', function () {
    it('assigns DEEP_TAILOR to all when fewer than 4 jobs', function () {
      var jobs = [
        makeScoredJob(5),
        makeScoredJob(3),
        makeScoredJob(1),
      ];

      var result = rankJobs(jobs);

      expect(result).toHaveLength(3);
      result.forEach(function (job) {
        expect(job.actionFlag).toBe('DEEP_TAILOR');
      });
    });

    it('assigns DEEP_TAILOR to all when exactly 4 jobs', function () {
      var jobs = [
        makeScoredJob(10),
        makeScoredJob(7),
        makeScoredJob(5),
        makeScoredJob(3),
      ];

      var result = rankJobs(jobs);

      expect(result).toHaveLength(4);
      result.forEach(function (job) {
        expect(job.actionFlag).toBe('DEEP_TAILOR');
      });
    });

    it('assigns correct dense ranks in small-pool scenario', function () {
      var jobs = [
        makeScoredJob(10),
        makeScoredJob(5),
        makeScoredJob(3),
      ];

      var result = rankJobs(jobs);

      expect(result[0].rank).toBe(1); // score 10
      expect(result[1].rank).toBe(2); // score 5
      expect(result[2].rank).toBe(3); // score 3
    });
  });

  describe('straddle rule at rank 4/5 boundary', function () {
    it('handles tie at dense rank 4 — both tied jobs get DEEP_TAILOR', function () {
      // 8 jobs with a tie at score 7 which lands at dense rank 4
      // Scores: [10, 9, 8, 7, 7, 6, 5, 4]
      // Dense ranks: [1, 2, 3, 4, 4, 5, 6, 7]
      var jobs = [
        makeScoredJob(10),
        makeScoredJob(9),
        makeScoredJob(8),
        makeScoredJob(7),
        makeScoredJob(7), // tie with previous — both at rank 4
        makeScoredJob(6),
        makeScoredJob(5),
        makeScoredJob(4),
      ];

      var result = rankJobs(jobs);

      // Both rank-4 jobs (score 7) get DEEP_TAILOR
      expect(result[3].actionFlag).toBe('DEEP_TAILOR');
      expect(result[4].actionFlag).toBe('DEEP_TAILOR');
      expect(result[3].rank).toBe(4);
      expect(result[4].rank).toBe(4);

      // Rank 5 (score 6) → AUTO_GENERATED
      expect(result[5].actionFlag).toBe('AUTO_GENERATED');
      // Ranks 6-7 (scores 5, 4) → NO_DOCS
      expect(result[6].actionFlag).toBe('NO_DOCS');
      expect(result[7].actionFlag).toBe('NO_DOCS');
    });

    it('handles tie that causes straddle boundary effect', function () {
      // 7 jobs where the tie at score 7 pushes dense rank 4 to include
      // all three score-7 jobs, while score 6 lands at rank 5
      // Scores: [10, 9, 8, 7, 7, 7, 6]
      // Dense ranks: [1, 2, 3, 4, 4, 4, 5]
      var jobs = [
        makeScoredJob(10),
        makeScoredJob(9),
        makeScoredJob(8),
        makeScoredJob(7),
        makeScoredJob(7),
        makeScoredJob(7),
        makeScoredJob(6),
      ];

      var result = rankJobs(jobs);

      // All three rank-4 jobs get DEEP_TAILOR
      expect(result[3].actionFlag).toBe('DEEP_TAILOR');
      expect(result[4].actionFlag).toBe('DEEP_TAILOR');
      expect(result[5].actionFlag).toBe('DEEP_TAILOR');
      expect(result[3].rank).toBe(4);
      expect(result[4].rank).toBe(4);
      expect(result[5].rank).toBe(4);

      // Rank 5 (score 6) → AUTO_GENERATED
      expect(result[6].actionFlag).toBe('AUTO_GENERATED');
    });
  });

  describe('immutability', function () {
    it('does not mutate the input array', function () {
      var job1 = makeScoredJob(5, { url: 'https://example.com/job/1' });
      var job2 = makeScoredJob(8, { url: 'https://example.com/job/2' });
      var input = [job1, job2];
      var inputCopy = [Object.assign({}, job1), Object.assign({}, job2)];

      rankJobs(input);

      expect(input).toEqual(inputCopy);
    });

    it('does not mutate nested objects inside the input array', function () {
      var job1 = makeScoredJob(5);
      var job2 = makeScoredJob(8);
      var input = [job1, job2];
      var originalScore1 = job1.score;
      var originalScore2 = job2.score;

      rankJobs(input);

      expect(job1.score).toBe(originalScore1);
      expect(job2.score).toBe(originalScore2);
      expect(job1.rank).toBeNull();
      expect(job2.rank).toBeNull();
      expect(job1.actionFlag).toBeNull();
      expect(job2.actionFlag).toBeNull();
    });

    it('returns a new array — not the same reference', function () {
      var input = [makeScoredJob(5), makeScoredJob(8)];

      var result = rankJobs(input);

      expect(result).not.toBe(input);
    });
  });

  describe('edge cases', function () {
    it('handles empty array', function () {
      var result = rankJobs([]);

      expect(result).toEqual([]);
    });

    it('handles null input', function () {
      var result = rankJobs(null);

      expect(result).toEqual([]);
    });

    it('handles undefined input', function () {
      var result = rankJobs(undefined);

      expect(result).toEqual([]);
    });

    it('handles single-item array — DEEP_TAILOR with rank 1', function () {
      var job = makeScoredJob(7);
      var result = rankJobs([job]);

      expect(result).toHaveLength(1);
      expect(result[0].rank).toBe(1);
      expect(result[0].actionFlag).toBe('DEEP_TAILOR');
    });
  });

  describe('output structure', function () {
    it('returns jobs sorted descending by score', function () {
      var jobs = [
        makeScoredJob(3),
        makeScoredJob(9),
        makeScoredJob(6),
        makeScoredJob(10),
        makeScoredJob(1),
      ];

      var result = rankJobs(jobs);

      var scores = result.map(function (j) { return j.score; });
      expect(scores).toEqual([10, 9, 6, 3, 1]);
    });

    it('preserves all original ScoredJob fields in output', function () {
      var job = makeScoredJob(8, {
        title: 'Senior Engineer',
        company: 'Tech Corp',
        location: 'New York, NY',
        employmentType: 'Full-time',
        salary: '$150,000',
        url: 'https://example.com/job/senior-engineer',
        linkedInJobId: '9876543210',
        fitSignal: 'Excellent experience match.',
        gap: 'Minor industry gap.',
        filename: 'senior_engineer.md',
      });

      var result = rankJobs([job]);

      expect(result[0].title).toBe('Senior Engineer');
      expect(result[0].company).toBe('Tech Corp');
      expect(result[0].location).toBe('New York, NY');
      expect(result[0].employmentType).toBe('Full-time');
      expect(result[0].salary).toBe('$150,000');
      expect(result[0].url).toBe('https://example.com/job/senior-engineer');
      expect(result[0].linkedInJobId).toBe('9876543210');
      expect(result[0].fitSignal).toBe('Excellent experience match.');
      expect(result[0].gap).toBe('Minor industry gap.');
      expect(result[0].filename).toBe('senior_engineer.md');
      expect(result[0].score).toBe(8);
      expect(result[0].rank).toBe(1);
      expect(result[0].actionFlag).toBe('DEEP_TAILOR');
    });
  });
});
