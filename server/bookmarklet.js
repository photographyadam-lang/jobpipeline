'use strict';

/**
 * Build the POST body for the /harvest endpoint from the current page DOM.
 * Pure function — no side effects. Exported for unit testing with jsdom.
 *
 * Selectors are tried in cascading order (primary → fallback). The first
 * non-empty match is returned.
 *
 * @param {Document} doc - The browser document object (or jsdom equivalent).
 * @returns {object} POST body matching the server's expected shape:
 *   { title, company, location, employmentType, salary, url,
 *     linkedInJobId, description }
 */
function buildPostBody(doc) {
  // ------------------------------------------------------------------
  // Helper: querySelector shorthand returning trimmed text or ''
  // ------------------------------------------------------------------
  function text(sel) {
    var el = doc.querySelector(sel);
    return el ? el.textContent.trim() : '';
  }

  // ------------------------------------------------------------------
  // Title: primary → fallback
  // ------------------------------------------------------------------
  var title = text('h1.job-details-jobs-unified-top-card__job-title') ||
              text('h1.topcard__title');

  // ------------------------------------------------------------------
  // Company: primary → fallback
  // ------------------------------------------------------------------
  var company = text('a.job-details-jobs-unified-top-card__company-name') ||
                text('a.topcard__org-name-link');

  // ------------------------------------------------------------------
  // Location: primary → fallback
  // ------------------------------------------------------------------
  var location = text('div.job-details-jobs-unified-top-card__tertiary-description') ||
                 text('span.topcard__flavor--bullet');

  // ------------------------------------------------------------------
  // Employment type: text scan of li.description__job-criteria-item
  // Search for the item whose label text is "Employment type", then
  // return the associated value text.
  // ------------------------------------------------------------------
  var employmentType = '';
  var criteriaItems = doc.querySelectorAll('li.description__job-criteria-item');
  for (var i = 0; i < criteriaItems.length; i++) {
    var item = criteriaItems[i];
    var labelEl = item.querySelector('h3') || item.querySelector('dt') ||
                  item.querySelector('span:first-child');
    if (labelEl && labelEl.textContent.trim() === 'Employment type') {
      var valueEl = item.querySelector('span.job-criteria__definition')
                    || item.querySelector('dd')
                    || item.querySelector('p');
      if (valueEl) {
        employmentType = valueEl.textContent.trim();
      }
      break;
    }
  }

  // ------------------------------------------------------------------
  // Salary: primary → fallback → empty string
  // ------------------------------------------------------------------
  var salary = text('div.salary') || text('span.compensation__salary') || '';

  // ------------------------------------------------------------------
  // Description: primary → fallback (use innerHTML for rich content)
  // ------------------------------------------------------------------
  var descEl = doc.querySelector('div.jobs-description__content') ||
               doc.querySelector('div.description__text');
  var description = descEl ? descEl.innerHTML.trim() : '';

  // ------------------------------------------------------------------
  // URL: strip all query / tracking parameters
  // ------------------------------------------------------------------
  var rawUrl = new URL(doc.defaultView.location.href);
  var url = rawUrl.origin + rawUrl.pathname;

  // ------------------------------------------------------------------
  // LinkedIn Job ID: extract numeric ID from URL path
  // ------------------------------------------------------------------
  var match = url.match(/\/jobs\/view\/([0-9]+)\//);
  var linkedInJobId = match ? match[1] : null;

  return {
    title: title,
    company: company,
    location: location,
    employmentType: employmentType,
    salary: salary,
    url: url,
    linkedInJobId: linkedInJobId,
    description: description,
  };
}

// ------------------------------------------------------------------
// Runtime — executes when the bookmarklet runs in the browser.
// Guard checks that `module` is undefined (i.e. NOT running under
// Node.js / jest) so that the runtime code does not fire when
// buildPostBody is imported for unit testing with jsdom.
// ------------------------------------------------------------------
if (typeof window !== 'undefined' && typeof document !== 'undefined' && typeof module === 'undefined') {
  (async function () {
    var port = parseInt(window.PIPELINE_PORT || '3000', 10);
    var body = buildPostBody(document);

    try {
      var res = await fetch('http://localhost:' + port + '/harvest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (res.status === 200) {
        showToast('Saved: ' + body.company + ' \u2014 ' + body.title, '#4caf50');
      } else if (res.status === 409) {
        showToast('Already saved: ' + body.company + ' \u2014 ' + body.title, '#ffc107');
      } else {
        alert('Harvest failed \u2014 is the server running? Start with: node server/server.js');
      }
    } catch (_err) {
      alert('Harvest failed \u2014 is the server running? Start with: node server/server.js');
    }
  })();
}

// ------------------------------------------------------------------
// Toast notification helper
// ------------------------------------------------------------------
function showToast(msg, bgColor) {
  var toast = document.createElement('div');
  toast.textContent = msg;
  toast.style.cssText =
    'position:fixed;bottom:20px;right:20px;z-index:999999;' +
    'background:' + bgColor + ';color:#fff;padding:12px 24px;' +
    'border-radius:6px;font:14px/1.4 sans-serif;' +
    'box-shadow:0 4px 12px rgba(0,0,0,0.3);';
  document.body.appendChild(toast);
  setTimeout(function () { toast.remove(); }, 3000);
}

module.exports = { buildPostBody: buildPostBody };
