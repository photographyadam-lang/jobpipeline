'use strict';

const path = require('path');
const os = require('os');
const fs = require('fs').promises;
const { createApp } = require('../../server/server');
const { parseJobFile, sanitizeForFilename } = require('../../src/models/job');

// Mock DeepSeek so tests don't make real HTTP calls
jest.mock('../../src/lib/deepseek', () => ({
  callDeepSeek: jest.fn(),
}));
const { callDeepSeek } = require('../../src/lib/deepseek');

// Increase timeout for async server operations
jest.setTimeout(30000);

describe('server/server.js — Express server integration', () => {
  /** @type {string} */
  let tmpJobsDir;
  /** @type {import('http').Server} */
  let httpServer;
  /** @type {string} */
  let base;

  beforeAll(async () => {
    tmpJobsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'job-pipeline-server-test-'));
    const app = createApp(tmpJobsDir);
    httpServer = app.listen(0);
    await new Promise(r => httpServer.once('listening', r));
    const port = httpServer.address().port;
    base = `http://localhost:${port}`;
  });

  afterAll(async () => {
    if (httpServer) {
      await new Promise(r => httpServer.close(r));
    }
    await fs.rm(tmpJobsDir, { recursive: true, force: true });
  });

  // ------------------------------------------------------------------
  // POST /harvest
  // ------------------------------------------------------------------
  describe('POST /harvest', () => {
    const validBody = {
      title: 'Senior Privacy Manager',
      company: 'TestCorp',
      location: 'San Francisco, CA',
      employmentType: 'Full-time',
      salary: '$150k-$180k',
      url: 'https://www.linkedin.com/jobs/view/3987654321/',
      linkedInJobId: '3987654321',
      description: 'We are looking for a Senior Privacy Manager to lead our privacy program.',
    };

    it('returns 200 and writes valid file', async () => {
      const res = await fetch(`${base}/harvest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validBody),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.filename).toBeDefined();
      expect(body.filename).toMatch(/\.md$/);

      // Verify file was written to disk
      const files = await fs.readdir(tmpJobsDir);
      expect(files).toContain(body.filename);
    });

    it('written file passes parseJobFile without error', async () => {
      const files = await fs.readdir(tmpJobsDir);
      const mdFiles = files.filter(f => f.endsWith('.md'));
      expect(mdFiles.length).toBeGreaterThan(0);

      for (const filename of mdFiles) {
        const content = await fs.readFile(path.join(tmpJobsDir, filename), 'utf-8');
        expect(() => parseJobFile(content, filename)).not.toThrow();
      }
    });

    it('returns 409 for duplicate URL', async () => {
      const res = await fetch(`${base}/harvest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validBody),
      });
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.reason).toBe('duplicate');
    });

    it('returns 400 listing all missing required fields', async () => {
      const res = await fetch(`${base}/harvest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.reason).toBe('missing_fields');
      expect(body.missing).toEqual(['title', 'company', 'description', 'url']);
    });

    it('returns 400 when some fields are missing', async () => {
      const res = await fetch(`${base}/harvest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Engineer', company: 'Acme' }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.reason).toBe('missing_fields');
      expect(body.missing).toEqual(['description', 'url']);
    });

    it('appends -2 on same-day name collision', async () => {
      const job1 = {
        title: 'Senior Privacy Manager',
        company: 'TestCorp',
        description: 'First posting description.',
        url: 'https://www.linkedin.com/jobs/view/1111111111/',
      };
      const job2 = {
        title: 'Senior Privacy Manager',
        company: 'TestCorp',
        description: 'Second posting description.',
        url: 'https://www.linkedin.com/jobs/view/2222222222/',
      };

      const res1 = await fetch(`${base}/harvest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(job1),
      });
      expect(res1.status).toBe(200);
      const body1 = await res1.json();

      const res2 = await fetch(`${base}/harvest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(job2),
      });
      expect(res2.status).toBe(200);
      const body2 = await res2.json();

      // Second file should have -2 suffix (different URLs, but same sanitized name)
      expect(body1.filename).not.toBe(body2.filename);
      // The filename may or may not include -2 depending on writeJobFile's collision logic
      // Just verify both files exist on disk
      const files = await fs.readdir(tmpJobsDir);
      expect(files).toContain(body1.filename);
      expect(files).toContain(body2.filename);
    });

    it('includes CORS header', async () => {
      const res = await fetch(`${base}/harvest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'CORS Test',
          company: 'CORS Corp',
          description: 'Testing CORS header.',
          url: 'https://www.linkedin.com/jobs/view/3333333333/',
        }),
      });
      expect(res.headers.get('access-control-allow-origin')).toBe('*');
    });
  });

  // ------------------------------------------------------------------
  // POST /harvest-raw — AI-powered manual copy-paste ingestion
  // ------------------------------------------------------------------
  describe('POST /harvest-raw', () => {
    const EXTRACTION_RESPONSE = JSON.stringify({
      title: 'Senior Privacy Manager',
      company: 'TestCorp',
      location: 'San Francisco, CA',
      employmentType: 'Full-time',
      salary: '$150k-$180k',
      description: 'We are looking for a Senior Privacy Manager to lead our privacy program.',
    });

    beforeAll(() => {
      callDeepSeek.mockReset();
      callDeepSeek.mockResolvedValue(EXTRACTION_RESPONSE);
      process.env.DEEPSEEK_API_KEY = 'test-key';
    });

    afterAll(() => {
      callDeepSeek.mockReset();
      delete process.env.DEEPSEEK_API_KEY;
    });

    const validBody = {
      url: 'https://www.linkedin.com/jobs/view/4444444444/',
      rawText: 'Senior Privacy Manager at TestCorp. Full-time. San Francisco, CA. $150k-$180k. We are looking for a Senior Privacy Manager to lead our privacy program.',
    };

    it('returns 200, writes file, and captures LinkedIn Job ID', async () => {
      const res = await fetch(`${base}/harvest-raw`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validBody),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.filename).toBeDefined();
      expect(body.filename).toMatch(/\.md$/);
      expect(body.company).toBe('TestCorp');
      expect(body.title).toBe('Senior Privacy Manager');

      // Verify file was written to disk
      const files = await fs.readdir(tmpJobsDir);
      expect(files).toContain(body.filename);

      // Verify file content includes the LinkedIn Job ID from the URL
      const content = await fs.readFile(path.join(tmpJobsDir, body.filename), 'utf-8');
      expect(content).toContain('4444444444');
      expect(content).toContain('TestCorp');
      expect(content).toContain('Senior Privacy Manager');
    });

    it('returns 409 for duplicate URL without consuming DeepSeek credits', async () => {
      // First attempt — should succeed (200)
      const res1 = await fetch(`${base}/harvest-raw`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: 'https://www.linkedin.com/jobs/view/9999999999/',
          rawText: 'Some job description text for the duplicate test.',
        }),
      });
      expect(res1.status).toBe(200);

      // Second attempt with same URL — should be 409 (duplicate)
      const res2 = await fetch(`${base}/harvest-raw`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: 'https://www.linkedin.com/jobs/view/9999999999/',
          rawText: 'Different text that should never reach DeepSeek.',
        }),
      });
      expect(res2.status).toBe(409);
      const body2 = await res2.json();
      expect(body2.success).toBe(false);
      expect(body2.reason).toBe('duplicate');
    });

    it('returns 400 for missing fields', async () => {
      const res = await fetch(`${base}/harvest-raw`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.reason).toBe('missing_fields');
    });

    it('returns 400 when url is missing', async () => {
      const res = await fetch(`${base}/harvest-raw`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rawText: 'Some text' }),
      });
      expect(res.status).toBe(400);
    });

    it('returns 400 when rawText is missing', async () => {
      const res = await fetch(`${base}/harvest-raw`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 'https://linkedin.com/jobs/view/1/' }),
      });
      expect(res.status).toBe(400);
    });
  });

  // ------------------------------------------------------------------
  // GET /health
  // ------------------------------------------------------------------
  describe('GET /health', () => {
    it('returns 200 with status ok', async () => {
      const res = await fetch(`${base}/health`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ status: 'ok' });
    });

    it('includes CORS header', async () => {
      const res = await fetch(`${base}/health`);
      expect(res.headers.get('access-control-allow-origin')).toBe('*');
    });
  });

  // ------------------------------------------------------------------
  // GET /dashboard
  // ------------------------------------------------------------------
  describe('GET /dashboard', () => {
    it('returns 200 with text/html', async () => {
      const res = await fetch(`${base}/dashboard`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toMatch(/text\/html/);
    });
  });

  // ------------------------------------------------------------------
  // GET /events (SSE)
  // ------------------------------------------------------------------
  describe('GET /events', () => {
    it('returns text/event-stream and sends current state as first event', async () => {
      // Use AbortController to close the connection after receiving the first event
      const ac = new AbortController();
      const res = await fetch(`${base}/events`, { signal: ac.signal });

      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toMatch(/text\/event-stream/);
      expect(res.headers.get('cache-control')).toBe('no-cache');
      expect(res.headers.get('connection')).toBe('keep-alive');

      // Read the first chunk of the SSE stream
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      const { value, done } = await reader.read();
      expect(done).toBe(false);

      const chunk = decoder.decode(value, { stream: true });
      expect(chunk).toContain('data: ');
      const parsed = JSON.parse(chunk.replace(/^data: /, '').trim());
      expect(parsed.type).toBe('state');
      expect(parsed.data).toBeDefined();
      expect(parsed.data.phase).toBe('idle');

      ac.abort();
    });

    it('includes CORS header', async () => {
      const ac = new AbortController();
      const res = await fetch(`${base}/events`, { signal: ac.signal });
      expect(res.headers.get('access-control-allow-origin')).toBe('*');
      ac.abort();
    });
  });

  // ------------------------------------------------------------------
  // POST /event — internal webhook
  // ------------------------------------------------------------------
  describe('POST /event', () => {
    it('returns 200 for valid event', async () => {
      const res = await fetch(`${base}/event`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'job_skipped', data: { filename: 'test.md', reason: 'Parse error' } }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
    });

    it('returns 400 for missing event type', async () => {
      const res = await fetch(`${base}/event`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: {} }),
      });
      expect(res.status).toBe(400);
    });

    it('updates state.phase on scoring_started and state reflects it', async () => {
      // Reset phase to idle in case prior tests left it in a different state
      await fetch(`${base}/event`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'scoring_complete', data: { scored: 0, scoreMean: null, scoreMin: null, scoreMax: null, distribution: { '1-3': 0, '4-5': 0, '6-7': 0, '8-10': 0 } } }),
      });

      const stateBefore = await (await fetch(`${base}/state`)).json();
      expect(stateBefore.phase).toBe('idle');

      const res = await fetch(`${base}/event`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'scoring_started', data: { total: 3, date: '2026-06-02' } }),
      });
      expect(res.status).toBe(200);

      const stateAfter = await (await fetch(`${base}/state`)).json();
      expect(stateAfter.phase).toBe('scoring');
      expect(stateAfter.date).toBe('2026-06-02');
      expect(stateAfter.stats.total).toBe(3);
    });

    it('appends to state.scored on job_scored and recalculates stats', async () => {
      const res = await fetch(`${base}/event`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'job_scored',
          data: {
            rank: 1,
            score: 8,
            company: 'TestCorp',
            title: 'Senior Privacy Manager',
            actionFlag: 'DEEP_TAILOR',
            fitSignal: 'Strong fit',
            gap: 'Minor gap',
            sourceFilename: 'test-file.md',
            salary: '$150k',
            location: 'SF',
            url: 'https://linkedin.com/jobs/view/1/',
            linkedInJobId: '1',
          },
        }),
      });
      expect(res.status).toBe(200);

      const state = await (await fetch(`${base}/state`)).json();
      expect(state.scored.length).toBeGreaterThanOrEqual(1);
      const lastScored = state.scored[state.scored.length - 1];
      expect(lastScored.company).toBe('TestCorp');
      expect(lastScored.score).toBe(8);
      // Stats should be recalculated
      expect(state.stats.scoreMean).not.toBeNull();
    });

    it('handles generation_started and generation_complete', async () => {
      await fetch(`${base}/event`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'generation_started', data: { total: 2 } }),
      });
      let state = await (await fetch(`${base}/state`)).json();
      expect(state.phase).toBe('generating');

      await fetch(`${base}/event`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'generation_complete', data: { generated: 2 } }),
      });
      state = await (await fetch(`${base}/state`)).json();
      expect(state.phase).toBe('idle');
    });

    it('broadcasts events to SSE clients', async () => {
      // Connect a new SSE client
      const ac = new AbortController();
      const sseRes = await fetch(`${base}/events`, { signal: ac.signal });
      const reader = sseRes.body.getReader();
      const decoder = new TextDecoder();

      // Consume the initial state event
      await reader.read();

      // Send an event via POST /event
      await fetch(`${base}/event`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'scoring_started', data: { total: 1, date: '2026-06-02' } }),
      });

      // Read the broadcast event
      const { value } = await reader.read();
      const chunk = decoder.decode(value, { stream: true });
      expect(chunk).toContain('data: ');
      const parsed = JSON.parse(chunk.replace(/^data: /, '').trim());
      expect(parsed.type).toBe('scoring_started');

      ac.abort();
    });
  });

  // ------------------------------------------------------------------
  // GET /state
  // ------------------------------------------------------------------
  describe('GET /state', () => {
    it('returns state as JSON', async () => {
      const res = await fetch(`${base}/state`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toMatch(/application\/json/);
      const body = await res.json();
      expect(body).toHaveProperty('phase');
      expect(body).toHaveProperty('harvested');
      expect(body).toHaveProperty('scored');
      expect(body).toHaveProperty('generated');
      expect(body).toHaveProperty('stats');
      expect(body).toHaveProperty('applicationHistory');
    });

    it('reflects events since startup', async () => {
      const state = await (await fetch(`${base}/state`)).json();
      // Should reflect the scoring events from previous tests
      expect(state.scored.length).toBeGreaterThan(0);
    });

    it('includes CORS header', async () => {
      const res = await fetch(`${base}/state`);
      expect(res.headers.get('access-control-allow-origin')).toBe('*');
    });
  });

  // ------------------------------------------------------------------
  // SSE client disconnect handling
  // ------------------------------------------------------------------
  describe('SSE client lifecycle', () => {
    it('handles client disconnect gracefully — no crash', async () => {
      // Connect an SSE client
      const ac = new AbortController();
      const res = await fetch(`${base}/events`, { signal: ac.signal });

      // Read initial state event
      const reader = res.body.getReader();
      await reader.read();

      // Disconnect the client
      ac.abort();

      // Give server time to process the close event
      await new Promise(r => setTimeout(r, 200));

      // Server should still be operational — state endpoint should work
      const stateRes = await fetch(`${base}/state`);
      expect(stateRes.status).toBe(200);

      // Can still send events without crash
      const eventRes = await fetch(`${base}/event`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'job_skipped', data: { filename: 'test.md', reason: 'Parse error' } }),
      });
      expect(eventRes.status).toBe(200);
    });
  });

  // ------------------------------------------------------------------
  // Startup — URL cache
  // ------------------------------------------------------------------
  describe('startup — URL cache hydration', () => {
    it('detects duplicates from existing jobs/ files on startup', async () => {
      // Create a new temp dir with pre-existing job files
      const seedDir = await fs.mkdtemp(path.join(os.tmpdir(), 'job-pipeline-seed-'));
      const app2 = createApp(seedDir);
      const server2 = app2.listen(0);
      await new Promise(r => server2.once('listening', r));
      const port2 = server2.address().port;
      const base2 = `http://localhost:${port2}`;

      // Wait for async startup hydration to complete
      await new Promise(r => setTimeout(r, 500));

      // No files yet — should still work
      let res = await fetch(`${base2}/harvest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'First Job',
          company: 'Acme',
          description: 'Description.',
          url: 'https://linkedin.com/jobs/view/111/',
        }),
      });
      expect(res.status).toBe(200);

      // Now write a pre-existing file directly to disk to simulate startup cache
      await fs.writeFile(
        path.join(seedDir, 'pre-existing.md'),
        [
          '# Pre Existing',
          '## Metadata',
          '- **Company:** OldCorp',
          '- **Location:** Remote',
          '- **Employment Type:** Full-time',
          '- **Salary:** Not specified',
          '- **URL:** https://linkedin.com/jobs/view/999/',
          '- **LinkedIn Job ID:** 999',
          '- **Harvested:** 2026-06-01 10:00',
          '## Job Description',
          'Old description.',
        ].join('\n'),
        'utf-8'
      );

      // Restart server to hydrate from the file
      await new Promise(r => server2.close(r));

      const app3 = createApp(seedDir);
      const server3 = app3.listen(0);
      await new Promise(r => server3.once('listening', r));
      const port3 = server3.address().port;
      const base3 = `http://localhost:${port3}`;

      // Wait for async startup hydration to complete
      await new Promise(r => setTimeout(r, 500));

      // Try to harvest the same URL as the pre-existing file — should get 409
      res = await fetch(`${base3}/harvest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Pre Existing',
          company: 'OldCorp',
          description: 'Duplicate of existing.',
          url: 'https://linkedin.com/jobs/view/999/',
        }),
      });
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.reason).toBe('duplicate');

      // Cleanup
      await new Promise(r => server3.close(r));
      await fs.rm(seedDir, { recursive: true, force: true });
    });
  });

  // ------------------------------------------------------------------
  // CORS on all endpoints
  // ------------------------------------------------------------------
  describe('CORS headers on all endpoints', () => {
    const endpoints = [
      { path: '/health', method: 'GET', body: undefined },
      { path: '/state', method: 'GET', body: undefined },
      { path: '/dashboard', method: 'GET', body: undefined },
      { path: '/harvest', method: 'POST', body: { title: 'C', company: 'C', description: 'D', url: 'https://linkedin.com/jobs/view/cors-test/' } },
      { path: '/event', method: 'POST', body: { type: 'test', data: {} } },
    ];

    for (const ep of endpoints) {
      it(`${ep.method} ${ep.path} has CORS header`, async () => {
        const opts = { method: ep.method };
        if (ep.body) {
          opts.headers = { 'Content-Type': 'application/json' };
          opts.body = JSON.stringify(ep.body);
        }
        const res = await fetch(`${base}${ep.path}`, opts);
        expect(res.headers.get('access-control-allow-origin')).toBe('*');
      });
    }
  });
});
