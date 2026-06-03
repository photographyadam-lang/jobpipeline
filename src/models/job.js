'use strict';

const { JobParseError } = require('../lib/errors');
const { formatDateTimeString } = require('../lib/dateUtils');

/**
 * Parse a harvested .md string into a canonical JobFile object.
 *
 * @param {string} markdown - Raw content of a harvested job markdown file.
 * @param {string} filename - Source filename (passed through to JobFile).
 * @returns {object} JobFile
 * @throws {JobParseError} When required sections or fields are missing.
 */
function parseJobFile(markdown, filename) {
  // 1. Extract title from # heading
  const titleMatch = markdown.match(/^#\s+(.+)$/m);
  if (!titleMatch) {
    throw new JobParseError('Missing title (h1 heading)', filename);
  }
  const title = titleMatch[1].trim();

  // 2. Locate ## Metadata section
  const metadataMatch = markdown.match(/^## Metadata\s*\n([\s\S]*?)(?=\n## |$(?![\s\S]))/m);
  if (!metadataMatch) {
    throw new JobParseError('Missing ## Metadata section', filename);
  }
  const metadataBlock = metadataMatch[1];

  // 3. Parse metadata fields via line-by-line regex
  const fields = {};
  const fieldRegex = /^-\s+\*\*([^*:]+):\*\*[ \t]*(.*)$/gm;
  let fieldMatch;
  while ((fieldMatch = fieldRegex.exec(metadataBlock)) !== null) {
    const key = fieldMatch[1].trim();
    const value = fieldMatch[2].trim();
    fields[key] = value;
  }

  // 4. Extract company (optional — default empty string)
  const company = fields['Company'] || '';

  // 5. Extract location (optional — default "Not specified")
  const location = fields['Location'] || 'Not specified';

  // 6. Extract employment type (optional — default "Not specified")
  const employmentType = fields['Employment Type'] || 'Not specified';

  // 7. Extract salary — null when "Not specified" or absent
  let salary = null;
  if (fields['Salary'] && fields['Salary'] !== 'Not specified') {
    salary = fields['Salary'];
  }

  // 8. Extract URL — required field
  const rawUrl = fields['URL'] || '';
  if (!rawUrl) {
    throw new JobParseError('Missing URL in Metadata', filename);
  }
  const url = stripQueryParams(rawUrl);

  // 9. Extract linkedInJobId from URL
  const linkedInJobId = extractLinkedInJobId(url);

  // 10. Parse harvested date
  const rawHarvested = fields['Harvested'] || '';
  const harvested = rawHarvested ? new Date(rawHarvested) : new Date();

  // 11. Locate ## Job Description section
  const descMatch = markdown.match(/^## Job Description\s*\n([\s\S]*)$/m);
  if (!descMatch) {
    throw new JobParseError('Missing ## Job Description section', filename);
  }
  const description = descMatch[1].trim();

  // 12. Return canonical JobFile
  return {
    title,
    company,
    location,
    employmentType,
    salary,
    url,
    linkedInJobId,
    harvested,
    description,
    filename,
  };
}

/**
 * Strip query parameters and hash from a URL.
 *
 * @param {string} urlStr
 * @returns {string} URL with query params and hash removed.
 */
function stripQueryParams(urlStr) {
  try {
    const parsed = new URL(urlStr);
    return parsed.origin + parsed.pathname;
  } catch {
    return urlStr;
  }
}

/**
 * Sanitize a string for safe Windows filesystem use.
 *
 * Rules:
 * - Spaces → hyphens
 * - Remove: & ( ) / , ' " @ # $ % ^ * ! ? < > | \ : ;
 * - Collapse consecutive hyphens
 * - Trim leading/trailing hyphens
 * - Truncate to maxLength
 *
 * @param {string} str - Input string.
 * @param {number} maxLength - Maximum output length.
 * @returns {string} Sanitized string.
 */
function sanitizeForFilename(str, maxLength) {
  // Replace spaces with hyphens
  let result = str.replace(/\s+/g, '-');
  // Remove forbidden characters (forward slash inside character class is literal)
  result = result.replace(/[&()/, '"@#$%^*!?<>|\\:;]/g, '');
  // Collapse consecutive hyphens
  result = result.replace(/-+/g, '-');
  // Trim leading and trailing hyphens
  result = result.replace(/^-+/, '').replace(/-+$/, '');
  // Truncate
  result = result.slice(0, maxLength);
  return result;
}

/**
 * Serialize a JobFile back into canonical markdown string.
 *
 * @param {object} job - A JobFile object.
 * @returns {string} Canonical markdown representation.
 */
function formatJobFile(job) {
  const harvestedStr = formatDateTimeString(job.harvested);
  const linkedInJobIdStr = job.linkedInJobId || 'Not available';

  return [
    `# ${job.title}`,
    '',
    '## Metadata',
    `- **Company:** ${job.company}`,
    `- **Location:** ${job.location}`,
    `- **Employment Type:** ${job.employmentType}`,
    `- **Salary:** ${job.salary === null ? 'Not specified' : job.salary}`,
    `- **URL:** ${job.url}`,
    `- **LinkedIn Job ID:** ${linkedInJobIdStr}`,
    `- **Harvested:** ${harvestedStr}`,
    '',
    '## Job Description',
    '',
    job.description,
    '',
  ].join('\n');
}

/**
 * Extract the LinkedIn numeric job ID from a URL.
 *
 * Matches pattern: /jobs/view/([0-9]+)/?  (trailing slash optional)
 *
 * @param {string} url
 * @returns {string | null} The numeric job ID string, or null if unmatched.
 */
function extractLinkedInJobId(url) {
  if (!url) {
    return null;
  }
  const match = url.match(/\/jobs\/view\/([0-9]+)\/?/);
  return match ? match[1] : null;
}

module.exports = {
  parseJobFile,
  sanitizeForFilename,
  formatJobFile,
  extractLinkedInJobId,
};
