/**
 * ATMOS Health API - Generates static health.json for GitHub Pages
 * Run during build to create a static health endpoint
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

async function generateHealthJson() {
  const checks = {
    webapp: { 
      ok: true, 
      latency: 0, 
      message: 'Static health endpoint - deploy to verify' 
    },
    openMeteo: { 
      ok: true, 
      latency: 0, 
      message: 'Check via client-side monitoring' 
    },
    benchmark: { 
      ok: true, 
      ageHours: 0, 
      message: 'Check benchmark.json createdAt' 
    },
  };

  const health = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    checks,
    version: '1.0.0',
    note: 'This is a static health file. For real-time checks, use client-side monitoring in the web app.',
  };

  const distDir = join(process.cwd(), 'dist');
  mkdirSync(distDir, { recursive: true });
  writeFileSync(join(distDir, 'health.json'), JSON.stringify(health, null, 2));
  console.log('✅ health.json written to dist/health.json');
}

generateHealthJson().catch(console.error);