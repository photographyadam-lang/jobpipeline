'use strict';

/**
 * Build script for the bookmarklet.
 *
 * Reads `server/bookmarklet.js`, wraps it in a Self-Executing Function (IIFE),
 * minifies with terser, prepends `javascript:`, and writes
 * `server/bookmarklet.min.js`.
 *
 * Usage: node scripts/minify-bookmarklet.js
 * Called via: npm run build:bookmarklet
 */

const fs = require('fs');
const path = require('path');
const Terser = require('terser');

const SOURCE_FILE = path.resolve(__dirname, '..', 'server', 'bookmarklet.js');
const OUTPUT_FILE = path.resolve(__dirname, '..', 'server', 'bookmarklet.min.js');

async function main() {
  // Read the human-readable source
  const sourceCode = fs.readFileSync(SOURCE_FILE, 'utf8');

  // Wrap in an IIFE so it executes as a self-contained bookmarklet
  const iifeCode = '(function(){\n' + sourceCode + '\n})();';

  // Minify with terser
  const result = await Terser.minify(iifeCode, {
    compress: {
      passes: 2,
      unsafe: false,
    },
    mangle: {
      reserved: ['buildPostBody'],
    },
    output: {
      comments: false,
    },
  });

  if (result.error) {
    console.error('Minification failed:', result.error);
    process.exit(1);
  }

  // Prepend the bookmarklet protocol prefix
  const bookmarkletCode = 'javascript:' + result.code;

  // Write the output file
  fs.writeFileSync(OUTPUT_FILE, bookmarkletCode, 'utf8');

  console.log(
    '✓ bookmarklet.min.js written (%d bytes)',
    Buffer.byteLength(bookmarkletCode, 'utf8')
  );
}

main().catch(function (err) {
  console.error('Build failed:', err.message);
  process.exit(1);
});
