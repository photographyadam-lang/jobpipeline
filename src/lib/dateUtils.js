'use strict';

// Format a Date object as "YYYY-MM-DD" in LOCAL time.
// Use for all file path construction.
// Never use Date.toISOString() for paths — that gives UTC and will shift
// the date in negative-offset timezones.
function formatDateString(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// Format a Date as "YYYY-MM-DD HH:MM" in local time.
function formatDateTimeString(date) {
  const h = String(date.getHours()).padStart(2, '0');
  const mi = String(date.getMinutes()).padStart(2, '0');
  return `${formatDateString(date)} ${h}:${mi}`;
}

module.exports = { formatDateString, formatDateTimeString };
