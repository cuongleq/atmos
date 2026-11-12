/**
 * NCEP GFS 0.25° Data Ingestion from AWS S3 (public bucket)
 * Uses NetCDF format (easier to parse with pure JS)
 */

import { pipeline } from 'node:stream/promises';
import { createWriteStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import NetCDFReader from 'netcdfjs';

// VN bounding box: [lon_min, lat_min, lon_max, lat_max]
export const VN_BBOX = [100, 5, 115, 25];

// Variables to extract from GFS NetCDF
// NetCDF variable names for GFS 0.25 degree
const TARGET_VARS = {
  temperature_2m: { varName: 'tmp2m', level: '2 m above ground' },
  relative_humidity_2m: { varName: 'rh2m', level: '2 m above ground' },
  u_wind_10m: { varName: 'ugrd10m', level: '10 m above ground' },
  v_wind_10m: { varName: 'vgrd10m', level: '10 m above ground' },
  precipitation_rate: { varName: 'prate', level: 'surface' },
  precipitation_accumulated: { varName: 'apcp', level: 'surface' },
  temperature_850hPa: { varName: 'tmp850', level: '850 mb' },
  relative_humidity_850hPa: { varName: 'rh850', level: '850 mb' },
  u_wind_850hPa: { varName: 'ugrd850', level: '850 mb' },
  v_wind_850hPa: { varName: 'vgrd850', level: '850 mb' },
  geopotential_height_500hPa: { varName: 'hgt500', level: '500 mb' },
  geopotential_height_850hPa: { varName: 'hgt850', level: '850 mb' },
};

const S3_BUCKET = 'noaa-gfs-bdp-pds';
const S3_REGION = 'us-east-1';
const S3_BASE_URL = `https://${S3_BUCKET}.s3.${S3_REGION}.amazonaws.com`;

// GEFS uses a different bucket
const GEFS_BUCKET = 'noaa-gefs-pds';
const GEFS_BASE_URL = `https://noaa-gefs-pds.s3.us-east-1.amazonaws.com`;

// VN bounding box: [lon_min, lat_min, lon_max, lat_max]
const VN_BBOX = [100, 5, 115, 25];

/**
 * Get latest available GFS run time (00, 06, 12, 18 UTC)
 * Checks S3 for the most recent available run
 */
async function getLatestGfsRun() {
  const now = new Date();
  // Try current and previous cycles (up to 48 hours back)
  for (let hoursBack = 0; hoursBack <= 48; hoursBack += 6) {
    const checkTime = new Date(now.getTime() - hoursBack * 3600 * 1000);
    const runHour = Math.floor(checkTime.getUTCHours() / 6) * 6;
    const checkRun = new Date(Date.UTC(
      checkTime.getUTCFullYear(),
      checkTime.getUTCMonth(),
      checkTime.getUTCDate(),
      runHour,
      0, 0, 0
    ));

    // Check if this run exists on S3
    const runStr = checkRun.toISOString().slice(0, 10).replace(/-/g, '');
    const runHourStr = checkRun.getUTCHours().toString().padStart(2, '0');
    const prefix = `gfs.${runStr}/${runHourStr}/atmos/`;
    
    try {
      const response = await fetch(`https://noaa-gfs-bdp-pds.s3.us-east-1.amazonaws.com?list-type=2&prefix=${encodeURIComponent(prefix)}&delimiter=/`, {
        signal: AbortSignal.timeout(10000),
      });
      if (response.ok) {
        const xml = await response.text();
        if (xml.includes('<Contents>') || xml.includes('<CommonPrefixes>')) {
          console.log(`Found available GFS run: ${checkRun.toISOString()}`);
          return checkRun;
        }
      } catch (e) {
        // Continue to next run
      }
    }
    // Fallback to current cycle
    const fallbackHour = Math.floor(now.getUTCHours() / 6) * 6;
    return new Date(Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      fallbackHour,
      0, 0, 0
    ));
  }
}

/**
 * List available forecast hours for a GFS run using S3 REST API
 */
async function listGfsForecastHours(runTime) {
  const runStr = runTime.toISOString().slice(0, 10).replace(/-/g, '');
  const runHour = runTime.getUTCHours().toString().padStart(2, '0');
  // NetCDF forecast files: gfs.t18z.atmf000.nc, gfs.t18z.atmf003.nc, etc.
  const prefix = `gfs.${runStr}/${runHour}/atmos/gfs.t${runHour}z.atmf`;
  
  const url = `https://noaa-gfs-bdp-pds.s3.us-east-1.amazonaws.com?list-type=2&prefix=${encodeURIComponent(prefix)}`;
  
  try {
    const response = await fetch(url, {
      headers: { 'Accept': 'application/xml' },
      signal: AbortSignal.timeout(30000),
    });
    
    if (!response.ok) {
      throw new Error(`S3 list failed: ${response.status} ${response.statusText}`);
    }
    
    const xmlText = await response.text();
    const hours = new Set();
    
    // Parse XML for NetCDF forecast files: gfs.t18z.atmf000.nc, gfs.t18z.atmf003.nc, etc.
    const keyRegex = /<Key>[^<]*atmf(\d{3})\.nc<\/Key>/g;
    let match;
    while ((match = keyRegex.exec(xmlText)) !== null) {
      hours.add(parseInt(match[1], 10));
    }
    
    return Array.from(hours).sort((a, b) => a - b);
  } catch (error) {
    console.error(`Failed to list GFS forecast hours:`, error.message);
    return [];
  }
}

/**
 * Download a single GFS forecast hour (NetCDF format)
 */
async function downloadGfsForecast(runTime, forecastHour, outputDir = tmpdir()) {
  const runStr = runTime.toISOString().slice(0, 10).replace(/-/g, '');
  const runHour = runTime.getUTCHours().toString().padStart(2, '0');
  const fhr = forecastHour.toString().padStart(3, '0');
  
  // NetCDF forecast file: gfs.t18z.atmf000.nc, gfs.t18z.atmf003.nc, etc.
  const key = `gfs.${runStr}/${runHour}/atmos/gfs.t${runHour}z.atmf${fhr}.nc`;
  const url = `${S3_BASE_URL}/${key}`;
  const localPath = join(outputDir, `gfs_${runStr}_${runHour}z_f${fhr}.nc`);

  try {
    const response = await fetch(`${S3_BASE_URL}/${key}`, {
      signal: AbortSignal.timeout(600000),
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    await pipeline(response.body, createWriteStream(localPath));
    
    // Parse NetCDF
    const data = await parseNetcdf(localPath, VN_BBOX);
    return { fhr: forecastHour, filePath: localPath, data };
  } catch (error) {
    console.error(`Failed to download ${key}:`, error.message);
    return null;
  }
}

/**
 * Download multiple forecast hours in parallel (with concurrency limit)
 */
async function downloadGfsForecasts(runTime, forecastHours, options = {}) {
  const { concurrency = 4, outputDir = tmpdir(), onProgress } = options;
  const results = [];
  
  for (let i = 0; i < forecastHours.length; i += concurrency) {
    const batch = forecastHours.slice(i, i + concurrency);
    const promises = batch.map(async (fhr) => {
      const result = await downloadGfsForecast(runTime, fhr);
      if (onProgress) onProgress({ completed: results.length + 1, total: forecastHours.length });
      return { fhr, data: result };
    });
    
    const batchResults = await Promise.all(promises);
    results.push(...batchResults);
  }
  
  return results;
}

/**
 * Get latest GEFS ensemble run time (00Z only for ensemble)
 */
function getLatestGefsRun(gfsRun) {
  // GEFS ensemble data is only available for 00Z cycle
  const date = new Date(gfsRun);
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

/**
 * Download GEFS ensemble member (NetCDF format)
 */
async function downloadGefsMember(runTime, member, forecastHour, outputDir = tmpdir()) {
  const runStr = runTime.toISOString().slice(0, 10).replace(/-/g, '');
  const runHour = runTime.getUTCHours().toString().padStart(2, '0');
  const fhr = forecastHour.toString().padStart(3, '0');
  const memberStr = member.toString().padStart(2, '0');
  
  // GEFS NetCDF: gefs.YYYYMMDD/HH/atmos/pgrb2ap5/gecXX.t00z.pgrb2a.0p50.fFFF
  // NetCDF format: gefs.YYYYMMDD/HH/atmos/gecXX.t00z.pgrb2a.0p50.fFFF.nc
  const key = `gefs.${runStr}/${runHour}/atmos/pgrb2ap5/gec${memberStr}.t00z.pgrb2a.0p50.f${fhr}.nc`;
  const url = `https://noaa-gefs-pds.s3.us-east-1.amazonaws.com/${key}`;
  const localPath = join(outputDir, `gefs_${runStr}_${runHour}z_m${memberStr}_f${fhr}.nc`);

  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(600000),
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    await pipeline(response.body, createWriteStream(localPath));
    
    const data = await parseNetcdf(localPath, VN_BBOX);
    return { member, fhr: forecastHour, filePath: localPath, data };
  } catch (error) {
    console.error(`Failed to download GEFS member ${member} f${forecastHour}:`, error.message);
    return null;
  }
}

/**
 * Download GEFS ensemble for multiple forecast hours
 */
async function downloadGefsEnsemble(runTime, forecastHours, options = {}) {
  const { members = 31, concurrency = 4 } = options;
  const results = [];
  
  for (const forecastHour of forecastHours) {
    for (let i = 0; i < members; i += concurrency) {
      const batch = Array.from({ length: Math.min(concurrency, members - i) }, (_, j) => i + j);
      const promises = batch.map(m => downloadGefsMember(runTime, m, forecastHour));
      const batchResults = await Promise.all(promises);
      results.push(...batchResults);
    }
  }
  
  return results;
}

/**
 * Parse NetCDF file and extract variables for VN bounding box
 */
async function parseNetcdf(filePath, bbox) {
  const [lonMin, latMin, lonMax, latMax] = bbox;
  
  const reader = new NetCDFReader();
  const buffer = readFileSync(filePath);
  const dataset = reader.read(buffer);
  
  // Get dimension info
  const latVar = dataset.getVariable('lat');
  const lonVar = dataset.getVariable('lon');
  
  if (!latVar || !lonVar) {
    throw new Error('Missing lat/lon variables in NetCDF');
  }
  
  const lats = latVar.data;
  const lons = lonVar.data;
  
  // Find indices within VN bounding box
  const latIndices = [];
  const lonIndices = [];
  
  for (let i = 0; i < lats.length; i++) {
    if (lats[i] >= latMin && lats[i] <= latMax) latIndices.push(i);
  }
  for (let j = 0; j < lons.length; j++) {
    if (lons[j] >= lonMin && lons[j] <= lonMax) lonIndices.push(j);
  }
  
  if (latIndices.length === 0 || lonIndices.length === 0) {
    throw new Error('No grid points within VN bounding box');
  }
  
  // Extract variables
  const result = {};
  for (const [name, { varName }] of Object.entries(TARGET_VARS)) {
    const variable = dataset.getVariable(varName);
    if (!variable) {
      console.warn(`Variable ${varName} not found in NetCDF`);
      continue;
    }
    
    // Extract data for VN region
    const data = variable.data;
    const dims = variable.shape; // [time, lat, lon] or [lat, lon]
    
    if (dims.length === 3) {
      // 3D: [time, lat, lon] - take first time step
      const timeDim = dims[0];
      const latDim = dims[1];
      const lonDim = dims[2];
      
      const subset = new Array(latIndices.length * lonIndices.length);
      let idx = 0;
      for (const li of latIndices) {
        for (const lj of lonIndices) {
          const idx3d = 0 * latDim * lonDim + li * lonDim + lj;
          subset[idx++] = data[idx3d];
        }
      }
      result[name] = subset;
    } else if (dims.length === 2) {
      // 2D: [lat, lon]
      const latDim = dims[0];
      const lonDim = dims[1];
      
      const subset = new Array(latIndices.length * lonIndices.length);
      let idx = 0;
      for (const li of latIndices) {
        for (const lj of lonIndices) {
          const idx2d = li * lonDim + lj;
          subset[idx++] = data[idx2d];
        }
      }
      result[name] = subset;
    }
  }
  
  return result;
}

export { VN_BBOX, TARGET_VARS, getLatestGfsRun, listGfsForecastHours, downloadGfsForecast, downloadGfsForecasts, getLatestGefsRun, downloadGefsMember, downloadGefsEnsemble };
export default {
  getLatestGfsRun,
  listGfsForecastHours,
  downloadGfsForecast,
  downloadGfsForecasts,
  getLatestGefsRun,
  downloadGefsMember,
  downloadGefsEnsemble,
  VN_BBOX,
  TARGET_VARS,
};