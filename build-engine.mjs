/**
 * Build engine bundles using esbuild.
 * Produces:
 *   - dist/engine.js (IIFE for browser, exposes globalThis.AtmosEngine)
 *   - dist/engine.mjs (ESM for Node)
 */

import { build } from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(__dirname, 'dist');
await fs.mkdir(DIST, { recursive: true });

// Browser bundle (IIFE) - use a wrapper to properly expose all exports
await build({
  entryPoints: ['src/engine/browser-entry.ts'],
  bundle: true,
  format: 'iife',
  globalName: 'AtmosEngine',
  outfile: path.join(DIST, 'engine.js'),
  platform: 'browser',
  target: 'ES2020',
  sourcemap: true,
  banner: {
    js: `/* ATMOS Engine v1.0.0 - ${new Date().toISOString()} */\n'use strict';`,
  },
});

console.log('✅ dist/engine.js (browser IIFE)');

// Node ESM bundle
await build({
  entryPoints: ['src/engine/index.ts'],
  bundle: true,
  format: 'esm',
  outfile: path.join(DIST, 'engine.mjs'),
  platform: 'node',
  target: 'node20',
  sourcemap: true,
  banner: {
    js: `/* ATMOS Engine v1.0.0 - ${new Date().toISOString()} */`,
  },
});

console.log('✅ dist/engine.mjs (Node ESM)');

// Also create a combined types declaration
await fs.mkdir(path.join(DIST, 'types'), { recursive: true });
await build({
  entryPoints: ['src/engine/index.ts'],
  bundle: true,
  format: 'esm',
  outfile: path.join(DIST, 'types', 'engine.d.ts'),
  platform: 'node',
  target: 'node20',
  write: false,
}).then(result => {
  if (result.outputFiles) {
    const dts = result.outputFiles.find(f => f.path.endsWith('.d.ts'));
    if (dts) {
      fs.writeFile(path.join(DIST, 'types', 'engine.d.ts'), dts.text);
      console.log('✅ dist/types/engine.d.ts');
    }
  }
});

console.log('\n✨ Engine build complete');