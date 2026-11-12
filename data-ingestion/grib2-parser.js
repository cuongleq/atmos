/**
 * GRIB2 Parser for NCEP GFS/GEFS data
 * Uses grib2json or custom parsing
 */

import { spawn } from 'node:child_process';
import { writeFileSync, readFileSync, unlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Parse GRIB2 file using wgrib2 (if available) or grib2json
 * Returns array of variables with data arrays
 */
export async function parseGrib2(filePath, bbox = [100, 5, 115, 25]) {
  const [lonMin, latMin, lonMax, latMax] = bbox;
  
  try {
    // Try wgrib2 first (most reliable for GRIB2)
    return await parseWithWgrib2(filePath, bbox);
  } catch (e) {
    console.warn('wgrib2 not available, trying grib2json...');
    try {
      return await parseWithGrib2json(filePath, bbox);
    } catch (e2) {
      console.error('Both wgrib2 and grib2json failed:', e2.message);
      throw new Error('No GRIB2 parser available. Install wgrib2 or grib2json.');
    }
  }
}

/**
 * Parse using wgrib2 (most reliable)
 */
async function parseWithWgrib2(filePath, bbox) {
  const [lonMin, latMin, lonMax, latMax] = bbox;
  
  return new Promise((resolve, reject) => {
    // wgrib2 -csv output for specific variables
    const args = [
      filePath,
      '-match', '(TMP|RH|UGRD|VGRD|PRATE|APCP|HGT):',
      '-match', '(2 m above ground|10 m above ground|surface|850 mb|500 mb):',
      '-csv', '-'
    ];
    
    const proc = spawn('wgrib2', args);
    let stdout = '';
    let stderr = '';
    
    proc.stdout.on('data', (data) => { stdout += data.toString(); });
    proc.stderr.on('data', (data) => { stderr += data.toString(); });
    
    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`wgrib2 failed: ${stderr}`));
        return;
      }
      
      try {
        const data = parseWgrib2Csv(stdout);
        resolve(filterByBbox(data, bbox));
      } catch (e) {
        reject(e);
      }
    });
  });
}

/**
 * Parse wgrib2 CSV output
 */
function parseWgrib2Csv(csv) {
  const lines = csv.trim().split('\n');
  const variables = {};
  
  for (const line of lines) {
    const parts = line.split(',');
    if (parts.length < 7) continue;
    
    const [_, __, varName, level, ___, ____, dataStr] = parts;
    const key = `${varName}:${level}`;
    
    // Parse data array
    const values = dataStr.split(';').map(v => {
      const n = parseFloat(v);
      return isNaN(n) ? null : n;
    });
    
    if (!variables[key]) variables[key] = { name: varName, level, values: [] };
    variables[key].values.push(...values);
  }
  
  // Combine same variable across forecast hours
  const result = {};
  for (const [key, v] of Object.entries(variables)) {
    result[v.name] = {
      level: v.level,
      data: v.values
    };
  }
  
  return result;
}

/**
 * Parse using grib2json (fallback)
 */
async function parseWithGrib2json(filePath, bbox) {
  const outputFile = join(tmpdir(), `grib2json_${Date.now()}.json`);
  
  return new Promise((resolve, reject) => {
    const proc = spawn('grib2json', ['-o', outputFile, '-n', '-v', filePath]);
    
    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error('grib2json failed'));
        return;
      }
      
      try {
        const data = JSON.parse(readFileSync(outputFile, 'utf8'));
        unlinkSync(outputFile);
        resolve(filterByBbox(transformGrib2json(data), bbox));
      } catch (e) {
        reject(e);
      }
    });
  });
}

/**
 * Transform grib2json output to our format
 */
function transformGrib2json(grib2json) {
  const variables = {};
  
  for (const msg of grib2json) {
    const { parameterCategory, parameterNumber, levelType, levelValue, data, gridDefinitionTemplate } = msg;
    const varName = getVarName(parameterCategory, parameterNumber);
    const level = `${levelType} ${levelValue}`;
    const key = `${varName}:${level}`;
    
    if (!variables[key]) variables[key] = { name: varName, level, values: [] };
    variables[key].values.push(...data);
  }
  
  const result = {};
  for (const [key, v] of Object.entries(variables)) {
    result[v.name] = { level: v.level, data: v.values };
  }
  
  return result;
}

/**
 * Map GRIB2 parameter category/number to variable name
 */
function getVarName(category, number) {
  const map = {
    '0:0': 'TMP',      // Temperature
    '1:0': 'RH',       // Relative humidity
    '2:2': 'UGRD',     // U-component of wind
    '2:3': 'VGRD',     // V-component of wind
    '3:0': 'PRATE',    // Precipitation rate
    '3:1': 'APCP',     // Precipitation accumulated
    '3:5': 'HGT',      // Geopotential height
  };
  return map[`${category}:${number}`] || `VAR_${category}_${number}`;
}

/**
 * Filter data by bounding box
 * Note: This is simplified - real implementation needs grid navigation
 */
function filterByBbox(data, bbox) {
  const [lonMin, latMin, lonMax, latMax] = bbox;
  
  // For now, return all data - proper filtering requires grid navigation
  // which depends on gridDefinitionTemplate in GRIB2
  console.log(`BBox filtering not fully implemented for ${Object.keys(data).join(', ')}`);
  return { ...data, _bbox: bbox };
}

/**
 * Parse GRIB2 to NetCDF-like structure for easier consumption
 */
export async function parseGrib2ToNetcdf(filePath, bbox) {
  const raw = await parseGrib2(filePath, bbox);
  
  // Convert to NetCDF-like structure
  const dimensions = { time: 1, lat: 0, lon: 0 }; // Will be inferred
  const variables = {};
  
  for (const [name, { level, data }] of Object.entries(raw)) {
    if (name.startsWith('_')) continue;
    variables[name] = {
      dimensions: ['time', 'lat', 'lon'],
      data: data,
      attributes: { level, units: getUnits(name) }
    };
  }
  
  return { dimensions, variables, bbox };
}

function getUnits(varName) {
  const units = {
    'TMP': 'K',
    'RH': '%',
    'UGRD': 'm/s',
    'VGRD': 'm/s',
    'PRATE': 'kg/m2/s',
    'APCP': 'kg/m2',
    'HGT': 'm',
  };
  return units[varName] || 'unknown';
}

export default {
  parseGrib2,
  parseGrib2ToNetcdf,
  VN_BBOX: [100, 5, 115, 25],
};