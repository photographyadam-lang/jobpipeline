'use strict';

const { ConfigMissingError, DeepSeekResponseError } = require('./errors.js');

/**
 * Call DeepSeek chat completions API.
 *
 * @param {string} systemPrompt - System-level instructions for the model.
 * @param {string} userPrompt   - User-level message (job description, career, etc.).
 * @param {{ maxTokens?: number, timeoutMs?: number }} [options] - Optional parameters.
 * @returns {Promise<string>} The content string from choices[0].message.content.
 * @throws {ConfigMissingError}     When DEEPSEEK_API_KEY env var is not set.
 * @throws {DeepSeekResponseError}  On non-200 status, timeout, or network failure.
 *                                  NEVER includes the API key in error messages.
 */
async function callDeepSeek(systemPrompt, userPrompt, options) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new ConfigMissingError('DEEPSEEK_API_KEY');
  }

  const timeoutMs = (options && options.timeoutMs !== undefined) ? options.timeoutMs : 30000;
  const maxTokens = (options && options.maxTokens !== undefined) ? options.maxTokens : 1024;

  const url = 'https://api.deepseek.com/v1/chat/completions';

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        max_tokens: maxTokens,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    // Timeout or network failure — never include the API key in the error message.
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      throw new DeepSeekResponseError('Request timed out', null);
    }
    throw new DeepSeekResponseError(`Network error: ${err.message}`, null);
  }

  if (!response.ok) {
    const statusCode = response.status;
    let errorMessage;
    switch (statusCode) {
      case 401:
        errorMessage = 'Unauthorized — check your DeepSeek API key';
        break;
      case 429:
        errorMessage = 'Rate limit exceeded — try again later';
        break;
      default:
        errorMessage = `DeepSeek API returned status ${statusCode}`;
    }
    throw new DeepSeekResponseError(errorMessage, statusCode);
  }

  const data = await response.json();
  const content = data.choices &&
    data.choices[0] &&
    data.choices[0].message &&
    data.choices[0].message.content;
  return content || '';
}

module.exports = { callDeepSeek };
