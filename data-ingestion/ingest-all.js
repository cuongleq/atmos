#!/usr/bin/env node
/**
 * Combined Data Ingestion Pipeline
 * Runs NCEP + JMA ingestion sequentially
 */

import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

async function runScript(scriptPath, args = []) {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', [scriptPath, ...args], { 
      stdio: 'inherit',
      cwd: process.cwd(),
    });
    
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Script ${scriptPath} exited with code ${code}`));
    });
    
    proc.on('error', reject);
  });
}

async function main() {
  console.log('🚀  ATMOS Data Ingestion Pipeline');
  console.log('==================================\n');
  console.log('Pipeline: NCEP GFS/GEFS → JMA GSM → Calibration');
  console.log('');

  const startTime = Date.now();
  const logFile = join(process.cwd(), 'logs', `ingestion_${new Date().toISOString().replace(/[:.]/g, '-')}.log`);
  mkdirSync(join(process.cwd(), 'logs'), { recursive: true });

  try {
    // Step 1: NCEP Ingestion
    console.log('\n📥 STEP 1/3: NCEP GFS/GEFS Ingestion');
    console.log('------------------------------------');
    await runScript('data-ingestion/ingest-ncep.js');
    console.log('✅ NCEP ingestion complete\n');

    // Step 2: JMA Ingestion
    console.log('\n📥 STEP 2/3: JMA GSM Ingestion');
    console.log('--------------------------------');
    await runScript('data-ingestion/ingest-jma.js');
    console.log('✅ JMA ingestion complete\n');

    // Step 3: Calibration (placeholder)
    console.log('\n🔧 STEP 3/3: Calibration Pipeline');
    console.log('---------------------------------');
    console.log('⚠️  Calibration step not yet implemented');
    console.log('   Run: npm run calibrate (when ready)\n');

    const duration = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
    console.log(`\n✅ PIPELINE COMPLETE in ${duration} minutes`);
    console.log(`Log saved to: ${logFile}`);

  } catch (error) {
    console.error('\n❌ Pipeline failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

main().catch(console.error);