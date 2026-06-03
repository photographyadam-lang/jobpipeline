'use strict';

const { JobParseError, DeepSeekResponseError, ConfigMissingError } = require('../../src/lib/errors');
const logger = require('../../src/lib/logger');
const { formatDateString, formatDateTimeString } = require('../../src/lib/dateUtils');
const { broadcastEvent } = require('../../src/lib/eventBroadcaster');

// ---------------------------------------------------------------------------
// JobParseError
// ---------------------------------------------------------------------------
describe('JobParseError', () => {
  it('is instanceof Error', () => {
    const err = new JobParseError('test message', 'test.md');
    expect(err).toBeInstanceOf(Error);
  });

  it('has name "JobParseError"', () => {
    const err = new JobParseError('test message', 'test.md');
    expect(err.name).toBe('JobParseError');
  });

  it('has filename property matching constructor argument', () => {
    const err = new JobParseError('test message', 'test.md');
    expect(err.filename).toBe('test.md');
  });

  it('message is set correctly', () => {
    const err = new JobParseError('test message', 'test.md');
    expect(err.message).toBe('test message');
  });
});

// ---------------------------------------------------------------------------
// DeepSeekResponseError
// ---------------------------------------------------------------------------
describe('DeepSeekResponseError', () => {
  it('is instanceof Error', () => {
    const err = new DeepSeekResponseError('API error', 401);
    expect(err).toBeInstanceOf(Error);
  });

  it('has name "DeepSeekResponseError"', () => {
    const err = new DeepSeekResponseError('API error', 401);
    expect(err.name).toBe('DeepSeekResponseError');
  });

  it('has statusCode property', () => {
    const err = new DeepSeekResponseError('API error', 401);
    expect(err.statusCode).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// ConfigMissingError
// ---------------------------------------------------------------------------
describe('ConfigMissingError', () => {
  it('is instanceof Error', () => {
    const err = new ConfigMissingError('config/scoring_prompt.md');
    expect(err).toBeInstanceOf(Error);
  });

  it('message contains the filename', () => {
    const err = new ConfigMissingError('config/scoring_prompt.md');
    expect(err.message).toContain('config/scoring_prompt.md');
    expect(err.message).toContain('Config file not found');
  });

  it('filename property equals constructor argument', () => {
    const err = new ConfigMissingError('config/scoring_prompt.md');
    expect(err.filename).toBe('config/scoring_prompt.md');
  });
});

// ---------------------------------------------------------------------------
// logger
// ---------------------------------------------------------------------------
describe('logger', () => {
  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('info output matches YYYY-MM-DD HH:MM:SS format', () => {
    logger.info('[test]', 'msg');
    const output = console.log.mock.calls[0][0];
    expect(output).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/);
  });

  it('info includes prefix and message', () => {
    logger.info('[test]', 'msg');
    const output = console.log.mock.calls[0][0];
    expect(output).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} \[test\] msg$/);
  });
});

// ---------------------------------------------------------------------------
// dateUtils
// ---------------------------------------------------------------------------
describe('dateUtils', () => {
  it('formatDateString returns YYYY-MM-DD in local time', () => {
    // Month is 0-indexed: month 4 = May
    const result = formatDateString(new Date(2026, 4, 30));
    expect(result).toBe('2026-05-30');
  });

  it('formatDateString handles month padding (January = 01)', () => {
    const result = formatDateString(new Date(2026, 0, 5));
    expect(result).toBe('2026-01-05');
  });

  it('formatDateString handles day padding (1st = 01)', () => {
    const result = formatDateString(new Date(2026, 0, 1));
    expect(result).toBe('2026-01-01');
  });

  it('formatDateTimeString returns YYYY-MM-DD HH:MM', () => {
    const result = formatDateTimeString(new Date(2026, 4, 30, 14, 32));
    expect(result).toBe('2026-05-30 14:32');
  });
});

// ---------------------------------------------------------------------------
// eventBroadcaster
// ---------------------------------------------------------------------------
describe('eventBroadcaster', () => {
  beforeEach(() => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('resolves without throwing when no server is running', async () => {
    await expect(broadcastEvent('test', {})).resolves.toBeUndefined();
  });

  it('resolves without throwing on timeout', async () => {
    jest.restoreAllMocks();
    jest.spyOn(global, 'fetch').mockImplementation(() => {
      return new Promise((_, reject) => {
        setTimeout(() => reject(new Error('timeout')), 3000);
      });
    });
    await expect(broadcastEvent('test', {})).resolves.toBeUndefined();
  });

  it('uses PIPELINE_PORT env var in URL', async () => {
    jest.restoreAllMocks();
    const mockFetch = jest.spyOn(global, 'fetch');
    // Temporarily set PIPELINE_PORT to '9999'
    const originalPort = process.env.PIPELINE_PORT;
    process.env.PIPELINE_PORT = '9999';
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));

    await broadcastEvent('test', { key: 'value' });

    expect(mockFetch).toHaveBeenCalled();
    const url = mockFetch.mock.calls[0][0];
    expect(url).toContain('localhost:9999/event');

    // Restore
    if (originalPort === undefined) {
      delete process.env.PIPELINE_PORT;
    } else {
      process.env.PIPELINE_PORT = originalPort;
    }
  });
});
