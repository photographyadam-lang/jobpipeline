'use strict';

/**
 * Rank an array of ScoredJob objects, assigning dense ranks and action flags.
 *
 * Sorting domain: Strict descending order by the `score` parameter.
 * Dense ranking: Tied scores receive identical integer ranks (1, 2, 2, 3, ...).
 *
 * Action flag decision boundaries:
 *   - Dense rank 1–4 (or total jobs <= 4) → 'DEEP_TAILOR'
 *   - Straddle rule: if a score tie spans the dense-rank 4/5 boundary,
 *     all jobs at that score level receive 'DEEP_TAILOR'
 *   - Dense rank 5+, score >= 6 → 'AUTO_GENERATED'
 *   - Dense rank 5+, score < 6  → 'NO_DOCS'
 *
 * @param {object[]} jobs - Array of ScoredJob-like objects.
 * @returns {object[]} New array with rank and actionFlag populated.
 *                     The input array and its elements are never mutated.
 */
function rankJobs(jobs) {
  // Handle null, undefined, or empty input
  if (!jobs || jobs.length === 0) {
    return [];
  }

  // ── 1. Deep clone each job to guarantee immutability ──────────────
  const ranked = jobs.map(function (j) {
    return Object.assign({}, j);
  });

  // ── 2. Sort descending by score ──────────────────────────────────
  ranked.sort(function (a, b) {
    return b.score - a.score;
  });

  // ── 3. Assign dense ranks ────────────────────────────────────────
  var currentRank = 0;
  var previousScore = undefined;

  ranked.forEach(function (job) {
    if (job.score !== previousScore) {
      currentRank += 1;
      previousScore = job.score;
    }
    job.rank = currentRank;
  });

  // ── 4. Small-pool shortcut: <= 4 jobs all get DEEP_TAILOR ────────
  if (ranked.length <= 4) {
    ranked.forEach(function (job) {
      job.actionFlag = 'DEEP_TAILOR';
    });
    return ranked;
  }

  // ── 5. Straddle detection ────────────────────────────────────────
  // Find the score at dense rank 4. If any job at dense rank 5+ shares
  // that same score, those jobs are at the straddle boundary and also
  // receive DEEP_TAILOR.
  var scoreAtRank4 = null;
  var i;
  for (i = 0; i < ranked.length; i++) {
    if (ranked[i].rank === 4) {
      scoreAtRank4 = ranked[i].score;
      break;
    }
  }

  // ── 6. Assign action flags ───────────────────────────────────────
  ranked.forEach(function (job) {
    if (job.rank <= 4) {
      job.actionFlag = 'DEEP_TAILOR';
    } else if (job.score === scoreAtRank4) {
      // Straddle rule: same score as rank 4 jobs → DEEP_TAILOR
      job.actionFlag = 'DEEP_TAILOR';
    } else if (job.score >= 6) {
      job.actionFlag = 'AUTO_GENERATED';
    } else {
      job.actionFlag = 'NO_DOCS';
    }
  });

  return ranked;
}

module.exports = { rankJobs };
