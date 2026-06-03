'use strict';
const path = require('path');

module.exports = {
  testEnvironment: 'node',
  testPathIgnorePatterns: ['/node_modules/', '/tests/fixtures/', '/tests/helpers/'],
  collectCoverageFrom: [
    'src/**/*.js',
    'score.js', 'generate.js', 'cleanup.js', 'apply.js', 'server/server.js',
  ],
  coverageThreshold: {
    [path.resolve(__dirname, 'src/models/job.js')]: {
      branches: 90,
      functions: 90,
      lines: 90,
      statements: 90,
    },
    [path.resolve(__dirname, 'src/models/scoredJob.js')]: {
      branches: 90,
      functions: 90,
      lines: 90,
      statements: 90,
    },
    [path.resolve(__dirname, 'src/models/stackRank.js')]: {
      branches: 90,
      functions: 90,
      lines: 90,
      statements: 90,
    },
    [path.resolve(__dirname, 'src/models/applicationRecord.js')]: {
      branches: 90,
      functions: 90,
      lines: 90,
      statements: 90,
    },
    [path.resolve(__dirname, 'src/lib/fileStore.js')]: {
      branches: 85,
      functions: 85,
      lines: 85,
      statements: 85,
    },
    [path.resolve(__dirname, 'src/lib/ranker.js')]: {
      branches: 90,
      functions: 95,
      lines: 95,
      statements: 95,
    },
    [path.resolve(__dirname, 'src/lib/promptBuilder.js')]: {
      branches: 90,
      functions: 90,
      lines: 90,
      statements: 90,
    },
    [path.resolve(__dirname, 'src/lib/deepseek.js')]: {
      branches: 85,
      functions: 85,
      lines: 85,
      statements: 85,
    },
  },
};
