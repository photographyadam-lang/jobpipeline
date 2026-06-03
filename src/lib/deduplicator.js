'use strict';

const { sanitizeForFilename } = require('../models/job');

/**
 * Two-pass deduplication of a JobFile array.
 *
 * Pass 1 (URL): exact URL match → keep most recently harvested (by harvested Date),
 *   skip the older one. Skipped entries go to `duplicates`.
 *
 * Pass 2 (Fuzzy): scan `unique` array after Pass 1 for pairs where
 *   sanitizeForFilename(job1.company) === sanitizeForFilename(job2.company)
 *   AND sanitizeForFilename(job1.title) === sanitizeForFilename(job2.title)
 *   AND job1.url !== job2.url.
 *   These are warnings only — both remain in `unique`.
 *
 * Does not mutate the input array.
 *
 * @param {object[]} jobs - Array of JobFile objects.
 * @returns {{ unique: object[], duplicates: object[], fuzzyWarnings: object[] }}
 */
function deduplicateJobs(jobs) {
  // Defensive: return empty result for null/undefined/empty input
  if (!jobs || jobs.length === 0) {
    return { unique: [], duplicates: [], fuzzyWarnings: [] };
  }

  // ── Pass 1: URL deduplication ──────────────────────────────────────────
  // Group jobs by URL, keeping all jobs in each group.
  const urlGroups = new Map();

  for (const job of jobs) {
    const group = urlGroups.get(job.url);
    if (group) {
      group.push(job);
    } else {
      urlGroups.set(job.url, [job]);
    }
  }

  const unique = [];
  const duplicates = [];

  for (const [, group] of urlGroups) {
    if (group.length === 1) {
      // Only one job for this URL — it's unique
      unique.push(group[0]);
    } else {
      // Sort by harvested descending — keep the most recent
      group.sort((a, b) => {
        const aTime = a.harvested instanceof Date
          ? a.harvested.getTime()
          : new Date(a.harvested).getTime();
        const bTime = b.harvested instanceof Date
          ? b.harvested.getTime()
          : new Date(b.harvested).getTime();
        return bTime - aTime;
      });

      const kept = group[0];
      unique.push(kept);

      for (let i = 1; i < group.length; i++) {
        duplicates.push({ kept, skipped: group[i] });
      }
    }
  }

  // ── Pass 2: Fuzzy duplicate detection ──────────────────────────────────
  // Only scan jobs that ended up in `unique` (Pass 1 already removed URL dups).
  // Exact URL duplicates must NOT appear in fuzzyWarnings.
  const fuzzyWarnings = [];

  for (let i = 0; i < unique.length; i++) {
    for (let j = i + 1; j < unique.length; j++) {
      const jobA = unique[i];
      const jobB = unique[j];

      // Jobs with the same URL cannot be fuzzy warnings (already handled in Pass 1)
      if (jobA.url === jobB.url) {
        continue;
      }

      const companyA = sanitizeForFilename(jobA.company, 60);
      const companyB = sanitizeForFilename(jobB.company, 60);
      const titleA = sanitizeForFilename(jobA.title, 60);
      const titleB = sanitizeForFilename(jobB.title, 60);

      if (companyA === companyB && titleA === titleB) {
        fuzzyWarnings.push({
          job1: jobA,
          job2: jobB,
          reason: `"${jobA.company} — ${jobA.title}" appears at 2 different URLs`,
        });
      }
    }
  }

  return { unique, duplicates, fuzzyWarnings };
}

module.exports = { deduplicateJobs };
