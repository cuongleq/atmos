#!/usr/bin/env node
/**
 * NCEP GFS/GEFS Data Ingestion CLI
 * Downloads latest GFS deterministic + GEFS ensemble from AWS S3
 */

import { 
  getLatestGfsRun, 
  listGfsForecastHours, 
  downloadGfsForecasts,
  getLatestGefsRun,
  downloadGefsEnsemble,
  VN_BBOX 
} from './ncep-gfs-s3.js';
import { parseGrib2ToNetcdf } from './grib2-parser.js';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const OUTPUT_DIR = join(process.cwd(), 'data', 'raw', 'ncep');
const MAX_FORECAST_HOURS = 384; // 16 days * 24h = 384, but GFS goes to 384h (16 days)
const FORECAST_INTERVAL = 3; // 3-hourly

async function main() {
  console.log('🌩️  NCEP Data Ingestion Started');
  console.log('================================\n');

  try {
    // 1. Get latest run times
    const gfsRun = await getLatestGfsRun();
    const gefsRun = await getLatestGefsRun(gfsRun);
    
    console.log(`📅 GFS Run: ${gfsRun.toISOString()}`);
    console.log(`📅 GEFS Run: ${gefsRun.toISOString()}\n`);

    // 2. Get available forecast hours
    console.log('🔍 Checking available forecast hours...');
    const gfsHours = await listGfsForecastHours(gfsRun);
    const targetHours = gfsHours.filter(h => h <= MAX_FORECAST_HOURS && h % FORECAST_INTERVAL === 0);
    
    console.log(`   Available: ${gfsHours.length} hours (0-${Math.max(...gfsHours)}h)`);
    console.log(`   Target: ${targetHours.length} hours (0-${MAX_FORECAST_HOURS}h, every ${FORECAST_INTERVAL}h)\n`);

    // 3. Download GFS deterministic
    console.log('⬇️  Downloading GFS deterministic forecasts...');
    const gfsResults = await downloadGfsForecasts(gfsRun, targetHours, {
      concurrency: 4,
      onProgress: (p) => {
        process.stdout.write(`\r   Progress: ${p.completed}/${p.total} (${Math.round(p.completed/p.total*100)}%)`);
      }
    });
    console.log('\n');

    // 4. Process GFS data
    console.log('🔄 Processing GFS data...');
    const gfsProcessed = [];
    for (let i = 0; i < gfsResults.length; i++) {
      const item = gfsResults[i];
      const fhr = item.fhr;
      const data = item.data;
      if (data) {
        let netcdf = null;
        try {
          netcdf = await parseGrib2ToNetcdf(data.filePath, VN_BBOX);
          console.log(`   ✓ f${fhr.toString().padStart(3, '0')}: ${Object.keys(netcdf.variables).join(', ')}`);
        } catch (parseError) {
          if (parseError.code === 'ENOENT' && parseError.syscall === 'spawn wgrib2') {
            console.warn(`   ⚠️  f${fhr.toString().padStart(3, '0')}: wgrib2 not available, skipping NetCDF conversion`);
          } else {
            throw parseError;
          }
        }
        gfsProcessed.push({ fhr, data: netcdf, filePath: data.filePath });
      }
    }
    console.log(`   Total: ${gfsProcessed.length}/${targetHours.length} hours processed\n`);

    // 5. Download GEFS ensemble (first day)
    console.log('⬇️  Downloading GEFS ensemble (first day)...');
    const gefsHours = [0, 3, 6, 9, 12, 15, 18, 21, 24]; // First day
    const gefsResults = await downloadGefsEnsemble(gefsRun, gefsHours, { 
      members: 31, 
      concurrency: 4 
    });
    console.log(`   Downloaded ${gefsResults.filter(r => r).length}/${gefsHours.length * 31} member-hours\n`);

    // 6. Save processed data
    console.log('💾 Saving processed data...');
    mkdirSync(OUTPUT_DIR, { recursive: true });
    
    const outputFile = join(OUTPUT_DIR, `ncep_${gfsRun.toISOString().slice(0,10)}_${gfsRun.getUTCHours().toString().padStart(2,'0')}.json`);
    
    // Build output using traditional loops
    const gfsOutput = [];
    for (let i = 0; i < gfsProcessed.length; i++) {
      const p = gfsProcessed[i];
      gfsOutput.push({
        fhr: p.fhr,
        variables: p.data?.variables ? Object.keys(p.data.variables) : [],
        rawFile: p.rawFile || null,
        parsed: !!p.data
      });
    });
    const gefsOutput = [];
    for (let i = 0; i < gefsResults.length; i++) {
      const r = gefsResults[i];
      if (r) {
        gefsOutput.push({
          member: r.member,
          fhr: r.fhr,
          data: r.data
        });
      }
    });
    const output = {
      meta: {
        gfsRun: gfsRun.toISOString(),
        gefsRun: gefsRun.toISOString(),
        bbox: VN_BBOX,
        fetchedAt: new Date().toISOString(),
        forecastHours: targetHours,
        gefsHours: gefsHours,
      },
      gfs: gfsOutput,
      gefs: gefsOutput,
    };
    
    writeFileSync(outputFile, JSON.stringify(output, null, 2));
    console.log(`   ✓ Saved to: ${outputFile}`);
    console.log(`   Size: ${(JSON.stringify(output).length / 1024 / 1024).toFixed(2)} MB`);

    console.log('\n✅ NCEP Ingestion Complete!');
    console.log('============================');

  } catch (error) {
    console.error('\n❌ Ingestion failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

main().catch(console.error);