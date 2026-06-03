/**
 * @jest-environment jsdom
 */
'use strict';

// Polyfill TextEncoder/TextDecoder for jsdom in Node.js 24
const { TextEncoder, TextDecoder } = require('util');
global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;

const { JSDOM } = require('jsdom');
const { buildPostBody } = require('../../server/bookmarklet');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a jsdom Document from an HTML string, optionally specifying the URL.
 * @param {string} html
 * @param {string} [url]
 * @returns {Document}
 */
function createDoc(html, url) {
  url = url || 'https://www.linkedin.com/jobs/view/1234567890/';
  return new JSDOM(html, { url: url }).window.document;
}

/**
 * Create a document with the full LinkedIn-style HTML for the primary selectors.
 * @param {object} overrides - Override specific field values.
 * @returns {Document}
 */
function createLinkedInDoc(overrides) {
  overrides = overrides || {};
  var html =
    '<h1 class="job-details-jobs-unified-top-card__job-title">' +
      (overrides.title || 'Senior Software Engineer') +
    '</h1>' +
    '<a class="job-details-jobs-unified-top-card__company-name">' +
      (overrides.company || 'Acme Corp') +
    '</a>' +
    '<div class="job-details-jobs-unified-top-card__tertiary-description">' +
      (overrides.location || 'San Francisco, CA') +
    '</div>' +
    '<div class="salary">' +
      (overrides.salary || '$150,000 - $200,000') +
    '</div>' +
    '<div class="jobs-description__content">' +
      (overrides.description || '<p>Job description content.</p>') +
    '</div>' +
    '<li class="description__job-criteria-item">' +
      '<h3>Employment type</h3>' +
      '<span class="job-criteria__definition">' +
        (overrides.employmentType || 'Full-time') +
      '</span>' +
    '</li>';
  return createDoc(html);
}

// ---------------------------------------------------------------------------
// buildPostBody
// ---------------------------------------------------------------------------

describe('buildPostBody', function () {
  // -----------------------------------------------------------------------
  // Title
  // -----------------------------------------------------------------------
  it('extracts title from primary selector', function () {
    var doc = createDoc(
      '<h1 class="job-details-jobs-unified-top-card__job-title">Senior Engineer</h1>'
    );
    expect(buildPostBody(doc).title).toBe('Senior Engineer');
  });

  it('falls back to secondary title selector', function () {
    var doc = createDoc(
      '<h1 class="topcard__title">Software Developer</h1>'
    );
    expect(buildPostBody(doc).title).toBe('Software Developer');
  });

  // -----------------------------------------------------------------------
  // Company
  // -----------------------------------------------------------------------
  it('extracts company name', function () {
    var doc = createDoc(
      '<a class="job-details-jobs-unified-top-card__company-name">Acme Corp</a>'
    );
    expect(buildPostBody(doc).company).toBe('Acme Corp');
  });

  it('falls back to secondary company selector', function () {
    var doc = createDoc(
      '<a class="topcard__org-name-link">Startup Inc</a>'
    );
    expect(buildPostBody(doc).company).toBe('Startup Inc');
  });

  // -----------------------------------------------------------------------
  // Location
  // -----------------------------------------------------------------------
  it('extracts location from primary selector', function () {
    var doc = createDoc(
      '<div class="job-details-jobs-unified-top-card__tertiary-description">' +
        'San Francisco, CA' +
      '</div>'
    );
    expect(buildPostBody(doc).location).toBe('San Francisco, CA');
  });

  it('falls back to secondary location selector', function () {
    var doc = createDoc(
      '<span class="topcard__flavor--bullet">Remote</span>'
    );
    expect(buildPostBody(doc).location).toBe('Remote');
  });

  // -----------------------------------------------------------------------
  // Employment type
  // -----------------------------------------------------------------------
  it('extracts employment type from criteria list', function () {
    var doc = createDoc(
      '<li class="description__job-criteria-item">' +
        '<h3>Employment type</h3>' +
        '<span class="job-criteria__definition">Contract</span>' +
      '</li>'
    );
    expect(buildPostBody(doc).employmentType).toBe('Contract');
  });

  it('returns empty string when employment type label not found', function () {
    var doc = createDoc(
      '<li class="description__job-criteria-item">' +
        '<h3>Seniority level</h3>' +
        '<span class="job-criteria__definition">Mid-Senior</span>' +
      '</li>' +
      '<li class="description__job-criteria-item">' +
        '<h3>Job function</h3>' +
        '<span class="job-criteria__definition">Engineering</span>' +
      '</li>'
    );
    expect(buildPostBody(doc).employmentType).toBe('');
  });

  // -----------------------------------------------------------------------
  // Salary
  // -----------------------------------------------------------------------
  it('extracts salary when present', function () {
    var doc = createDoc(
      '<div class="salary">$120,000 - $160,000</div>'
    );
    expect(buildPostBody(doc).salary).toBe('$120,000 - $160,000');
  });

  it('falls back to secondary salary selector', function () {
    var doc = createDoc(
      '<span class="compensation__salary">$100 - $150 per hour</span>'
    );
    expect(buildPostBody(doc).salary).toBe('$100 - $150 per hour');
  });

  it('returns empty string for salary when absent', function () {
    var doc = createDoc('<div><p>No salary info</p></div>');
    expect(buildPostBody(doc).salary).toBe('');
  });

  // -----------------------------------------------------------------------
  // Description
  // -----------------------------------------------------------------------
  it('extracts description from primary selector', function () {
    var doc = createDoc(
      '<div class="jobs-description__content">' +
        '<p>We need an engineer who can build things.</p>' +
      '</div>'
    );
    expect(buildPostBody(doc).description).toBe(
      '<p>We need an engineer who can build things.</p>'
    );
  });

  it('falls back to secondary description selector', function () {
    var doc = createDoc(
      '<div class="description__text">' +
        '<p>Fallback description here.</p>' +
      '</div>'
    );
    expect(buildPostBody(doc).description).toBe(
      '<p>Fallback description here.</p>'
    );
  });

  // -----------------------------------------------------------------------
  // URL
  // -----------------------------------------------------------------------
  it('strips query parameters from URL', function () {
    var doc = createDoc(
      '<html><body></body></html>',
      'https://www.linkedin.com/jobs/view/3987654321/?ref=123&tracking=abc&utm_source=linkedin'
    );
    expect(buildPostBody(doc).url).toBe(
      'https://www.linkedin.com/jobs/view/3987654321/'
    );
  });

  // -----------------------------------------------------------------------
  // LinkedIn Job ID
  // -----------------------------------------------------------------------
  it('extracts linkedInJobId from LinkedIn URL', function () {
    var doc = createDoc(
      '<html><body></body></html>',
      'https://www.linkedin.com/jobs/view/3987654321/'
    );
    expect(buildPostBody(doc).linkedInJobId).toBe('3987654321');
  });

  it('sets linkedInJobId to null for non-LinkedIn URL', function () {
    var doc = createDoc(
      '<html><body></body></html>',
      'https://www.indeed.com/job/12345'
    );
    expect(buildPostBody(doc).linkedInJobId).toBeNull();
  });

  // -----------------------------------------------------------------------
  // POST body shape
  // -----------------------------------------------------------------------
  it('returns correct POST body shape', function () {
    var doc = createLinkedInDoc();
    var result = buildPostBody(doc);

    // All 8 fields must be present
    expect(result).toHaveProperty('title');
    expect(result).toHaveProperty('company');
    expect(result).toHaveProperty('location');
    expect(result).toHaveProperty('employmentType');
    expect(result).toHaveProperty('salary');
    expect(result).toHaveProperty('url');
    expect(result).toHaveProperty('linkedInJobId');
    expect(result).toHaveProperty('description');

    // Type checks
    expect(typeof result.title).toBe('string');
    expect(typeof result.company).toBe('string');
    expect(typeof result.location).toBe('string');
    expect(typeof result.employmentType).toBe('string');
    expect(typeof result.salary).toBe('string');
    expect(typeof result.url).toBe('string');
    expect(result.linkedInJobId === null || typeof result.linkedInJobId === 'string').toBe(true);
    expect(typeof result.description).toBe('string');

    // Values from the full LinkedIn doc
    expect(result.title).toBe('Senior Software Engineer');
    expect(result.company).toBe('Acme Corp');
    expect(result.location).toBe('San Francisco, CA');
    expect(result.employmentType).toBe('Full-time');
    expect(result.salary).toBe('$150,000 - $200,000');
    expect(result.description).toBe('<p>Job description content.</p>');
  });
});
