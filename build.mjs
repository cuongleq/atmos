/**
 * ATMOS Build - Main build script
 * 1. Builds engine (ES modules -> dist/engine.js)
 * 2. Builds app (TypeScript -> dist/app.js)
 * 3. Assembles standalone HTML
 */

import { build } from 'esbuild';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST = join(__dirname, 'dist');
const SRC = join(__dirname, 'src');

mkdirSync(DIST, { recursive: true });

async function buildEngine() {
  console.log('🔨 Building engine...');
  
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
  
  // Post-process: ensure AtmosEngine is global and inject E namespace
  const enginePath = join(DIST, 'engine.js');
  let content = readFileSync(enginePath, 'utf8');
  
  // The minified bundle is an IIFE that assigns to global AtmosEngine.
  // In Node.js ES modules, the IIFE's var declaration is module-scoped.
  // We need to explicitly assign to globalThis.
  // Also inject E namespace for backward compatibility.
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
    K_MEMBERS: AtmosEngine.K_MEMBERS,
    FORWARD: AtmosEngine.FORWARD,
    INVERSE: AtmosEngine.INVERSE,
    pseudoMembers: AtmosEngine.pseudoMembers,
    gaussSolve: AtmosEngine.gaussSolve,
    solveRidge: AtmosEngine.solveRidge,
    solveNNLS: AtmosEngine.solveNNLS,
    LinearModel: AtmosEngine.LinearModel,
    Sigma2: AtmosEngine.Sigma2,
    TransformKind: AtmosEngine.TransformKind,
    pointScores: AtmosEngine.pointScores,
    eventScores: AtmosEngine.eventScores,
    probScores: AtmosEngine.probScores,
    probEnsembleScores: AtmosEngine.probEnsembleScores,
    pairedBootstrap: AtmosEngine.pairedBootstrap,
    Spec: AtmosEngine.Spec,
    VariableSpec: AtmosEngine.VariableSpec,
    DetModelId: AtmosEngine.DetModelId,
    LiveEnsModelId: AtmosEngine.LiveEnsModelId,
    PseudoMembersOptions: AtmosEngine.PseudoMembersOptions,
    rollingFolds: AtmosEngine.rollingFolds,
    calibrate: AtmosEngine.calibrate,
    evaluate: AtmosEngine.evaluate,
    calibrationBundle: AtmosEngine.calibrationBundle,
    predictFromCalibration: AtmosEngine.predictFromCalibration,
    CalibrationBundle: AtmosEngine.CalibrationBundle,
    regimeKey: AtmosEngine.regimeKey,
    condGroup: AtmosEngine.condGroup,
    conditionOf: AtmosEngine.conditionOf,
    VARIABLES: AtmosEngine.VARIABLES,
    distanceKm: AtmosEngine.distanceKm,
    bearingDeg: AtmosEngine.bearingDeg,
    toUms: AtmosEngine.toUms,
    airMass: AtmosEngine.airMass,
    thickness: AtmosEngine.thickness,
    frontalPassage: AtmosEngine.frontalPassage,
    trajectory: AtmosEngine.trajectory,
    floodLevels: AtmosEngine.floodLevels,
    nominalStage: AtmosEngine.nominalStage,
    riverRisk: AtmosEngine.riverRisk,
    lightningIndex: AtmosEngine.lightningIndex,
    lightningVerify: AtmosEngine.lightningVerify,
    logisticCalibrate: AtmosEngine.logisticCalibrate,
    isotonicCalibrate: AtmosEngine.isotonicCalibrate,
    dailyAccumulation: AtmosEngine.dailyAccumulation,
    evaluateCode: AtmosEngine.evaluateCode,
    evaluateDirection: AtmosEngine.evaluateDirection,
    modelSelection: AtmosEngine.modelSelection,
    evaluateScalar: AtmosEngine.evaluateScalar,
    evaluate: AtmosEngine.evaluate
  };
}
`;
  
  // Find the last occurrence of the source map comment and insert before it
  const lastSourceMapIndex = content.lastIndexOf('//# sourceMappingURL=engine.js.map');
  if (lastSourceMapIndex >= 0) {
    content = content.slice(0, lastSourceMapIndex) + injectionCode + '\n' + content.slice(lastSourceMapIndex);
  } else {
    // Fallback: append at the end
    content += injectionCode;
  }
  
  writeFileSync(join(DIST, 'engine.js'), content);
  
  console.log('✅ Engine built to dist/engine.js');
}

async function buildApp() {
  console.log('🔨 Building app...');
  
  await build({
    entryPoints: [join(SRC, 'app/app.ts')],
    bundle: true,
    outfile: join(DIST, 'app.js'),
    format: 'iife',
    globalName: 'AtmosApp',
    platform: 'browser',
    target: 'ES2020',
    sourcemap: true,
    minify: true,
    treeShaking: true,
    define: {
      'import.meta.env.DEV': 'false',
      'import.meta.env.PROD': 'true',
    },
    external: ['leaflet', '../../engine/index.js'],
  });
  
  console.log('✅ App built to dist/app.js');
}

async function assembleHtml() {
  console.log('📦 Assembling standalone HTML...');
  
  const templatePath = join(DIST, 'index.template.html');
  let html = readFileSync(templatePath, 'utf8');
  
  // Copy static assets
  const assets = ['style.css', 'benchmark.json', 'engine.js', 'app.js'];
  for (const file of assets) {
    const src = join(DIST, file);
    if (!existsSync(src)) {
      console.warn('⚠️  Missing asset: ' + file);
      continue;
    }
    let content = readFileSync(src, 'utf8');
    if (file === 'benchmark.json') {
      content = content.replace(/</g, '\\u003c');
    }
    html = html.replace('/*' + file.toUpperCase().replace('.', '_') + '*/', () => content);
  }
  
  // NCHMF data (optional)
  const nchmfPath = join(DIST, 'nchmf.json');
  let nchmf = { collectedAt: null, categories: [], errors: ['chua thu thap'], stub: true };
  if (existsSync(nchmfPath)) {
    nchmf = JSON.parse(readFileSync(nchmfPath, 'utf8'));
  }
  nchmf = JSON.stringify(nchmf).replace(/</g, '\\u003c');
  html = html.replace('/*NCHMF*/', () => nchmf);
  
  // Lightning data (optional)
  const ltPath = join(DIST, 'lightning.json');
  let lightning = { stub: true, locations: {}, summary: {}, limits: ['chua chay ltbench.mjs'] };
  if (existsSync(ltPath)) {
    lightning = JSON.parse(readFileSync(ltPath, 'utf8'));
  }
  lightning = JSON.stringify(lightning).replace(/</g, '\\u003c');
  html = html.replace('/*LIGHTNING*/', () => lightning);
  
  writeFileSync(join(DIST, 'index.html'), html);
  console.log('✅ Standalone HTML assembled:', Buffer.byteLength(html), 'bytes');
}

async function generateHealthJson() {
  const health = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    checks: {
      webapp: { ok: true, latency: 0, message: 'Static health endpoint' },
      openMeteo: { ok: true, latency: 0, message: 'Check via client-side' },
      benchmark: { ok: true, ageHours: 0, message: 'Check benchmark.json' },
    },
    version: '1.0.0',
  };
  writeFileSync(join(DIST, 'health.json'), JSON.stringify(health, null, 2));
  console.log('✅ health.json generated');
}

async function main() {
  try {
    // Build in parallel
    await Promise.all([
      buildEngine(),
      buildApp(),
    ]);
    
    // Sequential steps
    await assembleHtml();
    await generateHealthJson();
    await generateServiceWorker();
    
    console.log('\n🎉 Build complete!');
    console.log('📁 Output:', DIST);
    
  } catch (err) {
    console.error('❌ Build failed:', err);
    process.exit(1);
  }
}

async function generateServiceWorker() {
  console.log('🔨 Generating service worker with Workbox...');
  
  const { spawn } = await import('node:child_process');
  const workboxConfigPath = join(__dirname, 'workbox-config.cjs');
  
  return new Promise((resolve, reject) => {
    const isWindows = process.platform === 'win32';
    const child = spawn(isWindows ? 'npx.cmd' : 'npx', ['workbox-cli', 'generateSW', workboxConfigPath], {
      stdio: 'inherit',
      cwd: __dirname,
      shell: isWindows, // Required on Windows to find npx.cmd
    });
    
    child.on('close', (code) => {
      if (code === 0) {
        console.log('✅ Service worker generated: dist/sw.js');
        resolve();
      } else {
        reject(new Error(`Workbox exited with code ${code}`));
      }
    });
    
    child.on('error', reject);
  });
}