'use strict';

const timestamp = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

const logger = {
  info:  (prefix, msg) => console.log(`${timestamp()} ${prefix} ${msg}`),
  error: (prefix, msg) => console.error(`${timestamp()} ${prefix} ERROR: ${msg}`),
  warn:  (prefix, msg) => console.warn(`${timestamp()} ${prefix} WARN: ${msg}`),
};

module.exports = logger;
