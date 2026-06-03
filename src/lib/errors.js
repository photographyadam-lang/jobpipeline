'use strict';

class JobParseError extends Error {
  constructor(message, filename) {
    super(message);
    this.name = 'JobParseError';
    this.filename = filename;
  }
}

class DeepSeekResponseError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.name = 'DeepSeekResponseError';
    this.statusCode = statusCode;
  }
}

class ConfigMissingError extends Error {
  constructor(filename) {
    super(`Config file not found: ${filename}`);
    this.name = 'ConfigMissingError';
    this.filename = filename;
  }
}

module.exports = { JobParseError, DeepSeekResponseError, ConfigMissingError };
