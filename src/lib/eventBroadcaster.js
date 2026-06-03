'use strict';

// Fire-and-forget POST to the pipeline event endpoint.
// NEVER throws — pipeline must not fail because the dashboard is unavailable.
// Reads PIPELINE_PORT env var (default 3000) — must match server port.
async function broadcastEvent(type, data) {
  const port = process.env.PIPELINE_PORT || '3000';
  try {
    await fetch(`http://localhost:${port}/event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, data, timestamp: new Date().toISOString() }),
      signal: AbortSignal.timeout(2000),
    });
  } catch {
    /* silent — dashboard may not be running */
  }
}

module.exports = { broadcastEvent };
