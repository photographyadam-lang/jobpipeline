'use strict';

const { callDeepSeek } = require('../../src/lib/deepseek');
const { DeepSeekResponseError, ConfigMissingError } = require('../../src/lib/errors');

const DEEPSEEK_URL = 'https://api.deepseek.com/v1/chat/completions';

// A known test key used to verify it never leaks into error messages.
const TEST_API_KEY = 'sk-test-key-value-that-must-not-leak-12345';

/**
 * Build a mock Response object that mimics the fetch Response API.
 */
function mockResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

/**
 * A slow handler that never resolves before the timeout fires.
 */
function slowFetch(_url, init) {
  return new Promise((_, reject) => {
    // The AbortSignal will reject when the timeout fires.
    if (init && init.signal) {
      init.signal.addEventListener('abort', () => {
        const err = new Error('The operation was aborted');
        err.name = 'AbortError';
        reject(err);
      });
    }
  });
}

beforeEach(() => {
  jest.restoreAllMocks();
  delete process.env.DEEPSEEK_API_KEY;
});

describe('callDeepSeek', () => {
  describe('success path', () => {
    it('returns content string on 200', async () => {
      process.env.DEEPSEEK_API_KEY = TEST_API_KEY;

      jest.spyOn(global, 'fetch').mockResolvedValue(
        mockResponse({
          choices: [{ message: { content: 'mocked response content' } }],
        })
      );

      const result = await callDeepSeek('system prompt', 'user prompt', {
        maxTokens: 100,
        timeoutMs: 5000,
      });

      expect(result).toBe('mocked response content');
      expect(global.fetch).toHaveBeenCalledTimes(1);

      // Verify the fetch was called with the correct URL, method, and headers.
      const callArgs = global.fetch.mock.calls[0];
      expect(callArgs[0]).toBe(DEEPSEEK_URL);
      expect(callArgs[1].method).toBe('POST');
      expect(callArgs[1].headers['Authorization']).toBe(`Bearer ${TEST_API_KEY}`);
      expect(callArgs[1].headers['Content-Type']).toBe('application/json');

      // Verify the payload body contains the expected model and messages.
      const parsedBody = JSON.parse(callArgs[1].body);
      expect(parsedBody.model).toBe('deepseek-chat');
      expect(parsedBody.messages[0].role).toBe('system');
      expect(parsedBody.messages[0].content).toBe('system prompt');
      expect(parsedBody.messages[1].role).toBe('user');
      expect(parsedBody.messages[1].content).toBe('user prompt');
      expect(parsedBody.max_tokens).toBe(100);
    });
  });

  describe('HTTP error handling', () => {
    it('throws DeepSeekResponseError on 401 with "unauthorized" in message', async () => {
      process.env.DEEPSEEK_API_KEY = TEST_API_KEY;

      jest.spyOn(global, 'fetch').mockResolvedValue(
        mockResponse({ error: { message: 'Invalid API Key' } }, 401)
      );

      let thrown;
      try {
        await callDeepSeek('system', 'user', { maxTokens: 100, timeoutMs: 5000 });
      } catch (err) {
        thrown = err;
      }

      expect(thrown).toBeInstanceOf(DeepSeekResponseError);
      expect(thrown.statusCode).toBe(401);
      expect(thrown.message.toLowerCase()).toContain('unauthorized');
    });

    it('throws DeepSeekResponseError on 429 with "rate limit" in message', async () => {
      process.env.DEEPSEEK_API_KEY = TEST_API_KEY;

      jest.spyOn(global, 'fetch').mockResolvedValue(
        mockResponse({ error: { message: 'Rate limit exceeded' } }, 429)
      );

      let thrown;
      try {
        await callDeepSeek('system', 'user', { maxTokens: 100, timeoutMs: 5000 });
      } catch (err) {
        thrown = err;
      }

      expect(thrown).toBeInstanceOf(DeepSeekResponseError);
      expect(thrown.statusCode).toBe(429);
      expect(thrown.message.toLowerCase()).toContain('rate limit');
    });

    it('throws DeepSeekResponseError on 500', async () => {
      process.env.DEEPSEEK_API_KEY = TEST_API_KEY;

      jest.spyOn(global, 'fetch').mockResolvedValue(
        mockResponse({ error: { message: 'Internal server error' } }, 500)
      );

      let thrown;
      try {
        await callDeepSeek('system', 'user', { maxTokens: 100, timeoutMs: 5000 });
      } catch (err) {
        thrown = err;
      }

      expect(thrown).toBeInstanceOf(DeepSeekResponseError);
      expect(thrown.statusCode).toBe(500);
    });
  });

  describe('timeout and network error handling', () => {
    it('throws DeepSeekResponseError on request timeout', async () => {
      process.env.DEEPSEEK_API_KEY = TEST_API_KEY;

      // Replace fetch with a slow handler that aborts when the signal fires.
      jest.spyOn(global, 'fetch').mockImplementation(slowFetch);

      let thrown;
      try {
        // Use a very short timeout so the abort fires quickly.
        await callDeepSeek('system', 'user', { maxTokens: 100, timeoutMs: 50 });
      } catch (err) {
        thrown = err;
      }

      expect(thrown).toBeInstanceOf(DeepSeekResponseError);
      expect(thrown.message.toLowerCase()).toMatch(/timeout|timed out/);
    });

    it('throws DeepSeekResponseError on generic network failure', async () => {
      process.env.DEEPSEEK_API_KEY = TEST_API_KEY;

      // Simulate a DNS/connection failure (not a timeout).
      jest.spyOn(global, 'fetch').mockRejectedValue(
        new Error('fetch failed: connect ECONNREFUSED')
      );

      let thrown;
      try {
        await callDeepSeek('system', 'user', { maxTokens: 100, timeoutMs: 5000 });
      } catch (err) {
        thrown = err;
      }

      expect(thrown).toBeInstanceOf(DeepSeekResponseError);
      expect(thrown.message).toContain('Network error');
      expect(thrown.message).toContain('ECONNREFUSED');
    });
  });

  describe('missing API key', () => {
    it('throws ConfigMissingError when DEEPSEEK_API_KEY is not set', async () => {
      delete process.env.DEEPSEEK_API_KEY;

      let thrown;
      try {
        await callDeepSeek('system', 'user', { maxTokens: 100, timeoutMs: 5000 });
      } catch (err) {
        thrown = err;
      }

      expect(thrown).toBeInstanceOf(ConfigMissingError);
      expect(thrown.message).toContain('DEEPSEEK_API_KEY');
    });

    it('throws ConfigMissingError when DEEPSEEK_API_KEY is empty string', async () => {
      process.env.DEEPSEEK_API_KEY = '';

      let thrown;
      try {
        await callDeepSeek('system', 'user', { maxTokens: 100, timeoutMs: 5000 });
      } catch (err) {
        thrown = err;
      }

      expect(thrown).toBeInstanceOf(ConfigMissingError);
    });
  });

  describe('API key leak prevention', () => {
    it('does not expose API key in HTTP error messages', async () => {
      process.env.DEEPSEEK_API_KEY = TEST_API_KEY;

      jest.spyOn(global, 'fetch').mockResolvedValue(
        mockResponse({ error: { message: 'Invalid API Key' } }, 401)
      );

      let thrown;
      try {
        await callDeepSeek('system', 'user', { maxTokens: 100, timeoutMs: 5000 });
      } catch (err) {
        thrown = err;
      }

      expect(thrown).toBeInstanceOf(DeepSeekResponseError);
      // The test API key must NEVER appear in any error string.
      expect(thrown.message).not.toContain(TEST_API_KEY);
      expect(thrown.message).not.toContain('sk-test-key');
      expect(thrown.message).not.toContain('12345');
      // Also verify that serialized error doesn't leak the key.
      const serialized = JSON.stringify(thrown);
      expect(serialized).not.toContain(TEST_API_KEY);
      expect(serialized).not.toContain('sk-test-key');
      // Verify the key is not in the stack trace either.
      if (thrown.stack) {
        expect(thrown.stack).not.toContain(TEST_API_KEY);
      }
    });

    it('does not expose API key in timeout error messages', async () => {
      process.env.DEEPSEEK_API_KEY = TEST_API_KEY;

      jest.spyOn(global, 'fetch').mockImplementation(slowFetch);

      let thrown;
      try {
        await callDeepSeek('system', 'user', { maxTokens: 100, timeoutMs: 50 });
      } catch (err) {
        thrown = err;
      }

      expect(thrown).toBeInstanceOf(DeepSeekResponseError);
      expect(thrown.message).not.toContain(TEST_API_KEY);
      expect(thrown.message).not.toContain('sk-test-key');
      const serialized = JSON.stringify(thrown);
      expect(serialized).not.toContain(TEST_API_KEY);
    });

    it('does not expose API key in ConfigMissingError', async () => {
      delete process.env.DEEPSEEK_API_KEY;

      let thrown;
      try {
        await callDeepSeek('system', 'user', { maxTokens: 100, timeoutMs: 5000 });
      } catch (err) {
        thrown = err;
      }

      expect(thrown).toBeInstanceOf(ConfigMissingError);
      expect(thrown.message).not.toContain(TEST_API_KEY);
      const serialized = JSON.stringify(thrown);
      expect(serialized).not.toContain(TEST_API_KEY);
    });
  });
});
