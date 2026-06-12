# Plan: Add JD Link to Application History Cards

## Goal

Add a "JD" hyperlink to each Application History card's right-hand section so the user can open the job description URL directly from the dashboard.

## Background

- The [`ApplicationRecord`](src/models/applicationRecord.js:30) model already stores a `url` field (the LinkedIn job posting URL).
- The [`renderAppHistory()`](server/dashboard.html:1296) function in `dashboard.html` already extracts `url` from each record (line 1384) and uses it to hyperlink the company name on the left side.
- The right side (`.h-right`) currently contains: status badge, folder link, and "Mark Applied" button.

## Changes Required

All changes are in a single file: [`server/dashboard.html`](server/dashboard.html).

### 1. CSS — Add `.h-jd-link` style

Add a new style class alongside the existing `.h-folder-link` CSS block (~line 385). The JD link should match the same design language — using [`accent-blue`](server/dashboard.html:14) to stay consistent with the stack rank table's "JD" links in the [`links-cell`](server/dashboard.html:298-306) styling.

```css
.h-jd-link {
  color: var(--accent-blue);
  text-decoration: none;
  font-size: 11px;
  cursor: pointer;
  white-space: nowrap;
}
.h-jd-link:hover { text-decoration: underline; }
```

### 2. JavaScript — Add JD link to card right section

In the [`renderAppHistory()`](server/dashboard.html:1296) function, modify the `rightParts` construction (around lines 1406-1414) to append a JD anchor tag when `url` is available:

**Before:**
```javascript
var rightParts = '<span class="h-status status-' + status + '">' + status + '</span>';

if (rec.outputPath) {
  rightParts += '<a href="#" class="h-folder-link" data-id="' + id + '" title="Open output folder in Explorer">\uD83D\uDCC1 Folder</a>';
}
```

**After:**
```javascript
var rightParts = '<span class="h-status status-' + status + '">' + status + '</span>';

if (url) {
  rightParts += '<a href="' + url + '" target="_blank" class="h-jd-link" title="Open job description in new tab">JD</a>';
}

if (rec.outputPath) {
  rightParts += '<a href="#" class="h-folder-link" data-id="' + id + '" title="Open output folder in Explorer">\uD83D\uDCC1 Folder</a>';
}
```

The `url` variable is already declared at line 1384 as `var url = rec.url ? escapeHtml(rec.url) : null;`, so no additional variable setup is needed.

## Rationale

- **Right side placement**: Keeps the link visually near the other actions (Folder, Mark Applied) for easy scanning, consistent with the stack rank table where "JD" is in the rightmost Links column.
- **Reuses existing `url` field**: No backend or data model changes needed — the `ApplicationRecord.url` is already populated during generation.
- **Minimal footprint**: ~5 lines of CSS + ~3 lines of JS. No new event handlers or API calls.

## Files Modified

| File | Change |
|------|--------|
| [`server/dashboard.html`](server/dashboard.html) | Add `.h-jd-link` CSS class (~line 385) and append JD anchor to `rightParts` in `renderAppHistory()` (~line 1408) |

## Testing

No new tests needed. Manual verification:
1. Load dashboard with existing `applications.json` data
2. Confirm each Application History card with a URL shows a "JD" link in the right section
3. Click the link — verify it opens the job posting in a new tab
4. Confirm cards without a URL do not show the JD link
