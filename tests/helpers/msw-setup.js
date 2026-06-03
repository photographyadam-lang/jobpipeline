'use strict';

const { setupServer } = require('msw/node');
const { http, HttpResponse } = require('msw');

/**
 * Shared msw server for DeepSeek API mocking in E2E tests.
 *
 * Child processes (score.js, generate.js) use this via:
 *   NODE_OPTIONS='--require ./tests/helpers/msw-setup.js'
 *
 * Default handler returns a valid scoring response.
 * Tests override handlers via server.use() as needed.
 */
const server = setupServer(
  http.post('https://api.deepseek.com/v1/chat/completions', () => {
    return HttpResponse.json({
      choices: [
        {
          message: {
            content: JSON.stringify({
              score: 7,
              fit_signal: 'Strong alignment on governance program leadership and enterprise compliance scope.',
              gap: 'No direct healthcare domain experience.',
            }),
          },
        },
      ],
    });
  })
);

server.listen({ onUnhandledRequest: 'bypass' });
