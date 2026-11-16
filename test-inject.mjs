import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST = join(__dirname, 'dist');
const SRC = join(__dirname, 'src');

mkdirSync(DIST, { recursive: true });

async function test() {
  await build({
    entryPoints: [join(SRC, 'engine/index.ts')],
    bundle: true,
    outfile: join(DIST, 'engine.js'),
    format: 'iife',
    globalName: 'AtmosEngine',
    platform: 'browser',
    target: 'ES2020',
    sourcemap: true,
    minify: true,
    treeShaking: true,
    define: {
      'import.meta.env.DEV': 'false',
      'import.meta.env.PROD': 'true',
    },
  });
  
  const enginePath = join(DIST, 'engine.js');
  let content = readFileSync(enginePath, 'utf8');
  console.log('Content length:', content.length);
  
  const injectionCode = `
// Ensure AtmosEngine is global (for Node.js ES modules)
if (typeof AtmosEngine !== "undefined" && typeof globalThis !== "undefined") {
  globalThis.AtmosEngine = AtmosEngine;
}

// Inject E namespace for backward compatibility
if (typeof AtmosEngine !== "undefined") {
  AtmosEngine.E = {
    finite: AtmosEngine.finite,
    meanS: AtmosEngine.meanS,
    varS: AtmosEngine.varS,
    quantile: AtmosEngine.quantile,
    ncdfInv: AtmosEngine.ncdfInv,
    rng: AtmosEngine.rng,
  };
}
`;
  
  const lastSourceMapIndex = content.lastIndexOf('//# sourceMappingURL=engine.js.map');
  console.log('Source map index:', lastSourceMapIndex);
  
  if (lastSourceMapIndex >= 0) {
    content = content.slice(0, lastSourceMapIndex) + injectionCode + '\n' + content.slice(lastSourceMapIndex);
  } else {
    content += injectionCode;
  }
  
  console.log('New content length:', content.length);
  console.log('Has E namespace:', content.includes('AtmosEngine.E'));
  
  writeFileSync(join(DIST, 'engine.js'), content);
  console.log('Written');
}

test().catch(console.error);