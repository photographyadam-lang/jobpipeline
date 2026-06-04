require('dotenv').config();

'use strict';

const express = require('express');
const path = require('path');
const { spawn } = require('child_process');
const { parseJobFile, sanitizeForFilename, extractLinkedInJobId } = require('../src/models/job');
const { readJobFiles, writeJobFile, readApplications } = require('../src/lib/fileStore');
const { callDeepSeek } = require('../src/lib/deepseek');
const logger = require('../src/lib/logger');

/**
 * Create an Express app configured for the pipeline server.
 *
 * The `jobsDir` parameter is the path to the directory where harvested
 * job files are stored. It is used to hydrate the in-memory URL cache
 * on startup and to write new files on POST /harvest.
 *
 * @param {string} jobsDir - Absolute path to the jobs directory.
 * @returns {object} Express app (not yet listening).
 */
function createApp(jobsDir) {
  const app = express();

  // ------------------------------------------------------------------
  // In-memory state (per spec Section 7.3)
  // ------------------------------------------------------------------
  const state = {
    date: null,
    phase: 'idle',
    harvested: [],
    scored: [],
    generated: [],
    stats: {
      total: 0,
      scoreMean: null,
      scoreMin: null,
      scoreMax: null,
      distribution: { '1-3': 0, '4-5': 0, '6-7': 0, '8-10': 0 },
    },
    applicationHistory: [],
  };

  /** @type {Set<string>} O(1) URL deduplication cache */
  const harvestedUrls = new Set();

  /** @type {import('express').Response[]} Active SSE response objects */
  const clients = [];

  /**
   * Tracks the currently executing pipeline subprocess.
   * Only one pipeline process may run at a time.
   * @type {import('child_process').ChildProcess|null}
   */
  let currentProcess = null;

  /**
   * Active pipeline-log SSE clients.
   * These receive raw stdout/stderr chunks from the running process.
   * @type {import('express').Response[]}
   */
  const pipelineClients = [];

  // ------------------------------------------------------------------
  // Startup: hydrate URL cache and application history
  // ------------------------------------------------------------------
  (async () => {
    try {
      // Scan existing .md files in jobsDir for URLs
      const existingFiles = await readJobFiles(jobsDir);
      for (const { content } of existingFiles) {
        try {
          const job = parseJobFile(content, '');
          if (job.url) {
            harvestedUrls.add(job.url);
          }
        } catch {
          // Skip unparseable files during hydration
        }
      }
      logger.info('[server]', `Hydrated ${harvestedUrls.size} URLs from ${jobsDir}`);
    } catch {
      // jobsDir may not exist yet — that's fine
      logger.info('[server]', `Could not read ${jobsDir} for URL hydration — directory may be empty`);
    }

    try {
      // Read applications.json, keep last 10 entries
      const projectRoot = path.resolve(__dirname, '..');
      const records = await readApplications(projectRoot);
      state.applicationHistory = records.slice(-10);
      logger.info('[server]', `Hydrated ${state.applicationHistory.length} application history entries`);
    } catch {
      // applications.json may not exist yet — that's fine
      logger.info('[server]', 'No applications.json found — starting with empty history');
    }
  })();

  // ------------------------------------------------------------------
  // Middleware
  // ------------------------------------------------------------------

  // CORS — allow bookmarklet from any origin
  app.use((_req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (_req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });

  app.use(express.json());

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------

  /**
   * Broadcast a payload to all connected SSE clients.
   * Never throws — pipeline must not fail because dashboard is unavailable.
   * @param {object} payload - Object to serialize and send.
   */
  function broadcast(payload) {
    const data = 'data: ' + JSON.stringify(payload) + '\n\n';
    for (let i = clients.length - 1; i >= 0; i--) {
      try {
        clients[i].write(data);
      } catch {
        // Client may have disconnected — remove it
        clients.splice(i, 1);
      }
    }
  }

  /**
   * Recalculate state.stats from state.scored array.
   */
  function recalcStats() {
    const scored = state.scored;
    if (scored.length === 0) {
      state.stats.scoreMean = null;
      state.stats.scoreMin = null;
      state.stats.scoreMax = null;
      state.stats.distribution = { '1-3': 0, '4-5': 0, '6-7': 0, '8-10': 0 };
      return;
    }

    const scores = scored.map(s => s.score);
    const sum = scores.reduce((a, b) => a + b, 0);
    const min = Math.min(...scores);
    const max = Math.max(...scores);
    const mean = Math.round((sum / scores.length) * 10) / 10;

    const dist = { '1-3': 0, '4-5': 0, '6-7': 0, '8-10': 0 };
    for (const s of scores) {
      if (s >= 1 && s <= 3) dist['1-3']++;
      else if (s >= 4 && s <= 5) dist['4-5']++;
      else if (s >= 6 && s <= 7) dist['6-7']++;
      else if (s >= 8 && s <= 10) dist['8-10']++;
    }

    state.stats.scoreMean = mean;
    state.stats.scoreMin = min;
    state.stats.scoreMax = max;
    state.stats.distribution = dist;
  }

  // ------------------------------------------------------------------
  // POST /harvest — Receive job from bookmarklet
  // ------------------------------------------------------------------
  app.post('/harvest', async (req, res) => {
    try {
      const body = req.body || {};

      // Validate required fields
      const required = ['title', 'company', 'description', 'url'];
      const missing = required.filter(f => !body[f] || (typeof body[f] === 'string' && body[f].trim() === ''));
      if (missing.length > 0) {
        res.status(400).json({
          success: false,
          reason: 'missing_fields',
          missing,
        });
        return;
      }

      // Check URL cache for duplicates
      const url = (body.url || '').trim();
      if (harvestedUrls.has(url)) {
        res.status(409).json({
          success: false,
          reason: 'duplicate',
          existingFile: null,
        });
        return;
      }

      // Build job content and write file
      const now = new Date();
      const yyyy = now.getFullYear();
      const mm = String(now.getMonth() + 1).padStart(2, '0');
      const dd = String(now.getDate()).padStart(2, '0');
      const dateStr = `${yyyy}-${mm}-${dd}`;

      const safeCompany = sanitizeForFilename(body.company, 60);
      const safeTitle = sanitizeForFilename(body.title, 60);
      const filename = `${dateStr}-${safeCompany}-${safeTitle}.md`;

      const content = [
        `# ${body.title}`,
        '',
        '## Metadata',
        `- **Company:** ${body.company}`,
        `- **Location:** ${body.location || 'Not specified'}`,
        `- **Employment Type:** ${body.employmentType || 'Not specified'}`,
        `- **Salary:** ${body.salary || 'Not specified'}`,
        `- **URL:** ${url}`,
        `- **LinkedIn Job ID:** ${body.linkedInJobId || 'Not available'}`,
        `- **Harvested:** ${dateStr} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
        '',
        '## Job Description',
        '',
        body.description,
        '',
      ].join('\n');

      const actualFilename = await writeJobFile(jobsDir, filename, content);

      // Update URL cache and state
      harvestedUrls.add(url);
      const harvestedEntry = {
        company: body.company,
        title: body.title,
        filename: actualFilename,
        url,
      };
      state.harvested.push(harvestedEntry);

      // Broadcast event
      broadcast({ type: 'job_harvested', data: harvestedEntry });

      res.status(200).json({
        success: true,
        filename: actualFilename,
      });
    } catch (err) {
      logger.error('[server]', `Harvest write error: ${err.message}`);
      res.status(500).json({
        success: false,
        reason: 'write_error',
        message: err.message,
      });
    }
  });

  // ------------------------------------------------------------------
  // POST /harvest-raw — AI-powered manual copy-paste ingestion
  // ------------------------------------------------------------------
  app.post('/harvest-raw', async (req, res) => {
    try {
      const { url, rawText } = req.body || {};

      // Validate both fields are present and non-empty
      if (!url || !rawText || !url.trim() || !rawText.trim()) {
        res.status(400).json({
          success: false,
          reason: 'missing_fields',
          missing: [],
        });
        return;
      }

      const trimmedUrl = url.trim();

      // Check URL cache for duplicates — prevents wasted DeepSeek API credits
      if (harvestedUrls.has(trimmedUrl)) {
        res.status(409).json({
          success: false,
          reason: 'duplicate',
          existingFile: null,
        });
        return;
      }

      // Extract LinkedIn Job ID from URL
      const linkedInJobId = extractLinkedInJobId(trimmedUrl);

      // Call DeepSeek to parse unstructured job text into structured data
      // NOTE: description is intentionally excluded from AI output — we stitch it
      // locally after parsing to avoid token truncation on long job descriptions.
      const systemPrompt =
        'You are a data-extraction utility. Read the raw job description text ' +
        'provided by the user and output EXCLUSIVELY a single, minified JSON object ' +
        'containing these metadata fields: title, company, location, employmentType, salary. ' +
        'Do not extract, include, or repeat the description text field. ' +
        'Do not include markdown wrappers, code fences, or conversational prose. ' +
        'Output ONLY the JSON object.';

      const responseContent = await callDeepSeek(systemPrompt, rawText);

      // Parse the LLM response — bulletproof brace extraction
      let parsed;
      try {
        const firstBrace = responseContent.indexOf('{');
        const lastBrace = responseContent.lastIndexOf('}');

        if (firstBrace === -1 || lastBrace === -1 || lastBrace < firstBrace) {
          logger.error('[server]', `No JSON object found in AI response: ${responseContent}`);
          res.status(500).json({
            success: false,
            message: 'Failed to parse AI response',
            errorDetails: 'No valid JSON object found — missing opening or closing brace',
            rawSnippet: responseContent.substring(0, 150),
          });
          return;
        }

        const jsonStr = responseContent.substring(firstBrace, lastBrace + 1);
        parsed = JSON.parse(jsonStr);

        // Stitch the description locally — preserves the downstream file-writing
        // contract while reducing the AI output payload to just a few lines of
        // metadata (prevents truncation on long job descriptions).
        parsed.description = rawText;
      } catch (parseErr) {
        logger.error('[server]', `Failed to parse AI response: ${responseContent}`);
        res.status(500).json({
          success: false,
          message: 'Failed to parse AI response',
          errorDetails: `${parseErr.name}: ${parseErr.message}`,
          rawSnippet: responseContent.substring(0, 150),
        });
        return;
      }

      // Merge operator-submitted URL and extracted LinkedIn Job ID
      parsed.url = trimmedUrl;
      parsed.linkedInJobId = linkedInJobId;

      // Validate that essential fields were extracted
      if (!parsed.title || !parsed.company || !parsed.description) {
        res.status(500).json({
          success: false,
          reason: 'extraction_incomplete',
          message: 'AI extraction missing required fields (title, company, description)',
        });
        return;
      }

      // Build job content and write file (same format as POST /harvest)
      const now = new Date();
      const yyyy = now.getFullYear();
      const mm = String(now.getMonth() + 1).padStart(2, '0');
      const dd = String(now.getDate()).padStart(2, '0');
      const dateStr = `${yyyy}-${mm}-${dd}`;

      const safeCompany = sanitizeForFilename(parsed.company, 60);
      const safeTitle = sanitizeForFilename(parsed.title, 60);
      const filename = `${dateStr}-${safeCompany}-${safeTitle}.md`;

      const content = [
        `# ${parsed.title}`,
        '',
        '## Metadata',
        `- **Company:** ${parsed.company || ''}`,
        `- **Location:** ${parsed.location || 'Not specified'}`,
        `- **Employment Type:** ${parsed.employmentType || 'Not specified'}`,
        `- **Salary:** ${parsed.salary || 'Not specified'}`,
        `- **URL:** ${trimmedUrl}`,
        `- **LinkedIn Job ID:** ${linkedInJobId || 'Not available'}`,
        `- **Harvested:** ${dateStr} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
        '',
        '## Job Description',
        '',
        parsed.description,
        '',
      ].join('\n');

      const actualFilename = await writeJobFile(jobsDir, filename, content);

      // Update URL cache and state
      harvestedUrls.add(trimmedUrl);
      const harvestedEntry = {
        company: parsed.company,
        title: parsed.title,
        filename: actualFilename,
        url: trimmedUrl,
      };
      state.harvested.push(harvestedEntry);

      // Broadcast event
      broadcast({ type: 'job_harvested', data: harvestedEntry });

      // Respond with company and title for toast notification on the dashboard
      res.status(200).json({
        success: true,
        filename: actualFilename,
        company: parsed.company,
        title: parsed.title,
      });
    } catch (err) {
      logger.error('[server]', `Harvest-raw error: ${err.message}`);
      res.status(500).json({
        success: false,
        reason: 'server_error',
        message: err.message,
      });
    }
  });

  // ------------------------------------------------------------------
  // GET /health — Health check
  // ------------------------------------------------------------------
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // ------------------------------------------------------------------
  // GET /dashboard — Serve dashboard HTML
  // ------------------------------------------------------------------
  app.get('/dashboard', (_req, res) => {
    const dashboardPath = path.join(__dirname, 'dashboard.html');
    res.sendFile(dashboardPath, (err) => {
      if (err) {
        res.status(404).type('text').send('dashboard.html not found');
      }
    });
  });

  // ------------------------------------------------------------------
  // GET /events — SSE stream
  // ------------------------------------------------------------------
  app.get('/events', (req, res) => {
    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    // Disable buffering
    res.flushHeaders();

    // Send current state immediately
    const statePayload = { type: 'state', data: state };
    res.write('data: ' + JSON.stringify(statePayload) + '\n\n');

    // Register client
    clients.push(res);

    // Remove client on disconnect
    req.on('close', () => {
      const idx = clients.indexOf(res);
      if (idx !== -1) {
        clients.splice(idx, 1);
      }
    });
  });

  // ------------------------------------------------------------------
  // POST /event — Internal webhook from score.js / generate.js
  // ------------------------------------------------------------------
  app.post('/event', (req, res) => {
    try {
      const { type, data } = req.body || {};

      if (!type) {
        res.status(400).json({ error: 'Missing event type' });
        return;
      }

      // Apply state mutations per spec Section 7.4
      switch (type) {
        case 'scoring_started':
          state.phase = 'scoring';
          state.date = (data && data.date) || null;
          state.stats.total = (data && data.total) || 0;
          break;

        case 'job_scored':
          if (data) {
            state.scored.push(data);
            recalcStats();
          }
          break;

        case 'job_skipped':
          // No state change — broadcast only
          break;

        case 'scoring_complete':
          state.phase = 'idle';
          if (data) {
            state.stats = {
              total: state.stats.total,
              scoreMean: data.scoreMean ?? null,
              scoreMin: data.scoreMin ?? null,
              scoreMax: data.scoreMax ?? null,
              distribution: data.distribution || { '1-3': 0, '4-5': 0, '6-7': 0, '8-10': 0 },
            };
          }
          break;

        case 'generation_started':
          state.phase = 'generating';
          break;

        case 'doc_generated':
          if (data) {
            state.generated.push(data);
          }
          break;

        case 'doc_skipped':
          // No state change — broadcast only
          break;

        case 'generation_complete':
          state.phase = 'idle';
          break;

        case 'job_harvested':
          if (data) {
            state.harvested.push(data);
          }
          break;

        default:
          // Unknown event types are broadcast but don't mutate state
          break;
      }

      // Broadcast event to all SSE clients
      broadcast({ type, data, timestamp: new Date().toISOString() });

      res.json({ ok: true });
    } catch (err) {
      logger.error('[server]', `Event processing error: ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  });

  // ------------------------------------------------------------------
  // GET /state — Return full in-memory state
  // ------------------------------------------------------------------
  app.get('/state', (_req, res) => {
    res.json(state);
  });

  // ------------------------------------------------------------------
  // POST /api/pipeline/run — Spawn a pipeline script via npm run
  // ------------------------------------------------------------------
  app.post('/api/pipeline/run', (req, res) => {
    try {
      const { task } = req.body || {};

      // Validate task
      const VALID_TASKS = ['score', 'generate', 'qa'];
      if (!task || !VALID_TASKS.includes(task)) {
        res.status(400).json({ error: `Invalid task. Must be one of: ${VALID_TASKS.join(', ')}` });
        return;
      }

      // Reject if another process is already running
      if (currentProcess) {
        res.status(409).json({ error: `Pipeline process already running (${task})` });
        return;
      }

      logger.info('[server]', `Spawning npm run ${task}`);

      // Spawn the npm run task
      const child = spawn('npm', ['run', task], {
        cwd: process.cwd(),
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: true,
      });

      currentProcess = child;

      // Forward stdout/stderr to pipeline SSE clients
      child.stdout.on('data', (chunk) => {
        const text = chunk.toString();
        const payload = 'data: ' + JSON.stringify({ text }) + '\n\n';
        for (let i = pipelineClients.length - 1; i >= 0; i--) {
          try {
            pipelineClients[i].write(payload);
          } catch {
            pipelineClients.splice(i, 1);
          }
        }
      });

      child.stderr.on('data', (chunk) => {
        const text = chunk.toString();
        const payload = 'data: ' + JSON.stringify({ text, stream: 'stderr' }) + '\n\n';
        for (let i = pipelineClients.length - 1; i >= 0; i--) {
          try {
            pipelineClients[i].write(payload);
          } catch {
            pipelineClients.splice(i, 1);
          }
        }
      });

      child.on('close', (code) => {
        currentProcess = null;
        const exitPayload = 'data: ' + JSON.stringify({ type: 'exit', code }) + '\n\n';
        for (let i = pipelineClients.length - 1; i >= 0; i--) {
          try {
            pipelineClients[i].write(exitPayload);
          } catch {
            pipelineClients.splice(i, 1);
          }
        }
        logger.info('[server]', `npm run ${task} exited with code ${code}`);
      });

      child.on('error', (err) => {
        currentProcess = null;
        const errPayload = 'data: ' + JSON.stringify({ type: 'error', text: err.message }) + '\n\n';
        for (let i = pipelineClients.length - 1; i >= 0; i--) {
          try {
            pipelineClients[i].write(errPayload);
          } catch {
            pipelineClients.splice(i, 1);
          }
        }
        logger.error('[server]', `npm run ${task} spawn error: ${err.message}`);
      });

      res.status(202).json({ ok: true, task });
    } catch (err) {
      logger.error('[server]', `Pipeline run error: ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  });

  // ------------------------------------------------------------------
  // GET /api/pipeline/logs — SSE stream for pipeline process output
  // ------------------------------------------------------------------
  app.get('/api/pipeline/logs', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    // Send an initial connection event
    res.write('data: ' + JSON.stringify({ type: 'connected' }) + '\n\n');

    // Register client
    pipelineClients.push(res);

    // Remove client on disconnect
    req.on('close', () => {
      const idx = pipelineClients.indexOf(res);
      if (idx !== -1) {
        pipelineClients.splice(idx, 1);
      }
    });
  });

  return app;
}

// ------------------------------------------------------------------
// Direct execution — start listening
// ------------------------------------------------------------------
if (require.main === module) {
  const port = parseInt(process.env.PIPELINE_PORT || '3000', 10);
  const jobsDir = path.resolve(__dirname, '..', 'jobs');
  const app = createApp(jobsDir);
  app.listen(port, () => {
    logger.info('[server]', `Pipeline server listening on port ${port}`);
  });
}

module.exports = { createApp };
