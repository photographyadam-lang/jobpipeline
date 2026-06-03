'use strict';

const path = require('path');
const os = require('os');
const fs = require('fs').promises;
const { createApp } = require('../../server/server');

// Increased timeout for async server setup
jest.setTimeout(30000);

describe('GET /dashboard — dashboard.html serving', () => {
  /** @type {string} */
  let tmpJobsDir;
  /** @type {import('http').Server} */
  let httpServer;
  /** @type {string} */
  let base;

  beforeAll(async () => {
    tmpJobsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'job-pipeline-dash-test-'));
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
  // Status and content type
  // ------------------------------------------------------------------
  it('returns 200 with text/html content type', async () => {
    const res = await fetch(`${base}/dashboard`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/html/);
  });

  // ------------------------------------------------------------------
  // Required element ID verification
  // ------------------------------------------------------------------
  it('HTML contains all required element IDs', async () => {
    const res = await fetch(`${base}/dashboard`);
    const html = await res.text();

    // Header elements
    expect(html).toContain('id="header-phase"');
    expect(html).toContain('id="header-date"');

    // Count indicators
    expect(html).toContain('id="count-harvested"');
    expect(html).toContain('id="count-scored"');
    expect(html).toContain('id="count-generated"');

    // Core panels
    expect(html).toContain('id="score-distribution"');
    expect(html).toContain('id="stack-rank-table"');
    expect(html).toContain('id="app-history"');
    expect(html).toContain('id="activity-log"');

    // Ingestion panel elements
    expect(html).toContain('id="ingestion-panel"');
    expect(html).toContain('id="raw-job-url"');
    expect(html).toContain('id="raw-job-text"');
    expect(html).toContain('id="harvest-raw-btn"');
  });

  // ------------------------------------------------------------------
  // Verify specific table column headers exist in the HTML
  // ------------------------------------------------------------------
  it('HTML contains stack rank table column headers', async () => {
    const res = await fetch(`${base}/dashboard`);
    const html = await res.text();

    expect(html).toContain('>Rank<');
    expect(html).toContain('>Score<');
    expect(html).toContain('>Flag<');
    expect(html).toContain('>Company<');
    expect(html).toContain('>Title<');
    expect(html).toContain('>Location<');
    expect(html).toContain('>Salary<');
    expect(html).toContain('>Fit<');
    expect(html).toContain('>Gap<');
    expect(html).toContain('>R★<');
    expect(html).toContain('>CL★<');
    expect(html).toContain('>Links<');
  });

  // ------------------------------------------------------------------
  // Verify score distribution has all 5 band labels
  // ------------------------------------------------------------------
  it('HTML contains score distribution bands 1-3, 4-5, 6, 7-8, 9-10', async () => {
    const res = await fetch(`${base}/dashboard`);
    const html = await res.text();

    expect(html).toContain('1-3');
    expect(html).toContain('4-5');
    expect(html).toContain('id="bar-6"');
    expect(html).toContain('7-8');
    expect(html).toContain('9-10');
  });

  // ------------------------------------------------------------------
  // Verify CORS header is present
  // ------------------------------------------------------------------
  it('includes CORS header', async () => {
    const res = await fetch(`${base}/dashboard`);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  // ------------------------------------------------------------------
  // Verify the dashboard HTML is a complete document
  // ------------------------------------------------------------------
  it('is a complete HTML document with DOCTYPE', async () => {
    const res = await fetch(`${base}/dashboard`);
    const html = await res.text();
    expect(html.trim().startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html).toContain('</html>');
  });
});

// =========================================================================
// jsdom-based UI lifecycle test — verifies the frontend event-binding
// architecture is perfectly wired (prevents regressions of silent ingestion
// failures).
// =========================================================================
describe('Dashboard UI — jsdom lifecycle integration test', () => {
  let dom;
  let window;
  let document;
  let fetchMock;

  beforeEach(() => {
    const htmlPath = path.resolve(__dirname, '../../server/dashboard.html');
    const htmlContent = require('fs').readFileSync(htmlPath, 'utf-8');

    // Default mock — must resolve so init() fetch('/state') doesn't crash
    fetchMock = jest.fn().mockResolvedValue({
      status: 200,
      json: async function() { return {}; },
    });

    dom = new (require('jsdom').JSDOM)(htmlContent, {
      url: 'http://localhost:3000/dashboard',
      runScripts: 'dangerously',
      beforeParse(win) {
        // Mock fetch to prevent real network calls
        win.fetch = fetchMock;
        // Mock EventSource to prevent connection errors
        win.EventSource = function EventSourceMock() {
          // no-op
        };
        win.EventSource.CONNECTING = 0;
        win.EventSource.OPEN = 1;
        win.EventSource.CLOSED = 2;
        win.EventSource.prototype = { close: function() {} };
      },
    });

    window = dom.window;
    document = window.document;

    // Clear call history from init() so each test starts fresh;
    // the mock implementation (resolved promise) is preserved.
    fetchMock.mockClear();
  });

  afterEach(() => {
    if (dom) dom.window.close();
  });

  // ------------------------------------------------------------------
  // Element existence and default state
  // ------------------------------------------------------------------
  it('has #harvest-raw-btn with correct default text and enabled state', () => {
    const btn = document.getElementById('harvest-raw-btn');
    expect(btn).not.toBeNull();
    expect(btn.tagName).toBe('BUTTON');
    expect(btn.textContent).toBe('Harvest via AI Engine');
    expect(btn.disabled).toBe(false);
  });

  // ------------------------------------------------------------------
  // Empty fields — should show warning and NOT call fetch
  // ------------------------------------------------------------------
  it('shows toast warning when clicking with empty fields and does not call fetch', () => {
    const btn = document.getElementById('harvest-raw-btn');
    const urlInput = document.getElementById('raw-job-url');
    const textInput = document.getElementById('raw-job-text');

    // Ensure empty
    urlInput.value = '';
    textInput.value = '';

    btn.click();

    // A warning toast should have been created
    const container = document.getElementById('toast-container');
    expect(container.children.length).toBe(1);
    expect(container.children[0].className).toContain('warning');
    expect(container.children[0].textContent).toMatch(/fill in both/i);

    // fetch must NOT have been called with /harvest-raw (init() calls fetch('/state'))
    var harvestCalls = fetchMock.mock.calls.filter(function(c) { return c[0] === '/harvest-raw'; });
    expect(harvestCalls.length).toBe(0);
  });

  // ------------------------------------------------------------------
  // Valid fields — should POST to /harvest-raw
  // ------------------------------------------------------------------
  it('calls /harvest-raw when both fields are filled', async () => {
    const btn = document.getElementById('harvest-raw-btn');
    const urlInput = document.getElementById('raw-job-url');
    const textInput = document.getElementById('raw-job-text');

    // Fill in valid values
    urlInput.value = 'https://www.linkedin.com/jobs/view/12345';
    textInput.value = 'Company: TestCorp\nTitle: Engineer\nJob description text...';

    // Mock a successful response from the server
    const successBody = { company: 'TestCorp', title: 'Engineer' };
    fetchMock.mockResolvedValue({
      status: 200,
      json: async function() { return successBody; },
    });

    btn.click();

    // Wait for the async click handler's microtasks to resolve
    await new Promise(function(r) { setTimeout(r, 0); });

    // Verify fetch was called with correct endpoint and payload
    expect(fetchMock).toHaveBeenCalledWith('/harvest-raw', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: 'https://www.linkedin.com/jobs/view/12345',
        rawText: 'Company: TestCorp\nTitle: Engineer\nJob description text...',
      }),
    });

    // A success toast should have been created
    const container = document.getElementById('toast-container');
    expect(container.children.length).toBeGreaterThanOrEqual(1);
    // The last toast should be a success
    var toasts = container.querySelectorAll('.toast');
    var lastToast = toasts[toasts.length - 1];
    expect(lastToast.className).toContain('success');
  });
});
