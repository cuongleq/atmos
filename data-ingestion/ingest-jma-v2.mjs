import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { writeFileSync, mkdirSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = join(__dirname, 'data', 'raw', 'jma');
const CALIBRATION_DIR = join(__dirname, 'data', 'calibration', 'jma');

import { fetchJmaForecast, fetchJmaHistorical, fetchJmaHistoricalBatch, VN_CALIBRATION_LOCATIONS, saveJmaData } from './jma-openmeteo.js?v=' + Date.now();

mkdirSync(OUTPUT_DIR, { recursive: true });
mkdirSync(CALIBRATION_DIR, { recursive: true });

async function main() {
  console.log('🌸  JMA GSM Data Ingestion Started');
  console.log('==================================\n');

  try {
    // 1. Fetch live forecasts for all calibration locations
    console.log('📍 Fetching JMA forecasts for 8 VN calibration locations...');
    const forecasts = await fetchJmaAllCalibrationLocations({
      forecastDays: 10,
      timezone: 'Asia/Ho_Chi_Minh',
    });

    console.log('\n📊 Results:');
    let successCount = 0;
    for (const [id, data] of Object.entries(forecasts)) {
      if (data.error) {
        console.log(`   ❌ ${id}: ${data.error}`);
      } else {
        const hours = data.hourly?.time?.length || 0;
        const vars = Object.keys(data.hourly?.data || {}).length;
        console.log(`   ✅ ${id}: ${hours} hours, ${vars} variables`);
        successCount++;
      }
    }
    console.log(`\n   Total: ${successCount}/${VN_CALIBRATION_LOCATIONS.length} locations successful\n`);

    // 2. Save live forecasts
    console.log('💾 Saving live forecasts...');
    const liveFile = join(OUTPUT_DIR, `jma_live_${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    writeFileSync(liveFile, JSON.stringify(forecasts, null, 2));
    console.log(`   ✓ Saved to: ${liveFile}`);

    // 3. Fetch historical data for calibration (last 30 days)
    console.log('\n📜 Fetching historical data for calibration (last 30 days)...');
    const endDate = new Date().toISOString().slice(0, 10);
    const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    
    console.log(`   Period: ${startDate} to ${endDate}`);
    
    const historical = await fetchJmaHistorical({
      latitude: 16.0,
      longitude: 108.0,
      startDate,
      endDate,
      timezone: 'Asia/Ho_Chi_Minh',
    });

    if (historical.hourly) {
      const hours = historical.hourly.time?.length || 0;
      console.log(`   ✓ Retrieved ${hours} hours of historical data`);
      
      // Save historical data
      const histFile = join(CALIBRATION_DIR, `jma_historical_${startDate}_to_${endDate}.json`);
      writeFileSync(histFile, JSON.stringify(historical, null, 2));
      console.log(`   ✓ Saved to: ${histFile}`);
    }

    // 3. Fetch for all calibration locations (historical) with rate limiting
    console.log('\n📜 Fetching historical data for all 8 calibration locations (with rate limiting)...');
    const { fetchJmaHistoricalBatch } = await import('./jma-openmeteo.js?v=' + Date.now());
    const historicalBatch = await fetchJmaHistoricalBatch(VN_CALIBRATION_LOCATIONS, {
      startDate,
      endDate,
      timezone: 'Asia/Ho_Chi_Minh',
    });

    console.log('\n📊 Historical results:');
    for (const [id, result] of Object.entries(historicalBatch)) {
      if (result.error) {
        console.log(`   ❌ ${id}: ${result.error}`);
      } else {
        const hours = result.data?.hourly?.time?.length || 0;
        console.log(`   ✅ ${id}: ${hours} hours`);
      }
    }

    // Save combined historical
    const histAllFile = join(CALIBRATION_DIR, `jma_historical_all_${startDate}_to_${endDate}.json`);
    writeFileSync(histAllFile, JSON.stringify(historicalBatch, null, 2));
    console.log(`\n   ✓ Combined historical saved to: ${histAllFile}`);

    console.log('\n✅ JMA Ingestion Complete!');
    console.log('============================');
    console.log(`Live forecasts: ${OUTPUT_DIR}`);
    console.log(`Calibration data: ${CALIBRATION_DIR}`);

  } catch (error) {
    console.error('\n❌ Ingestion failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

main().catch(console.error);