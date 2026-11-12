const { pipeline } = require('node:stream/promises');
const { createWriteStream } = require('fs');
const { tmpdir } = require('os');
const { join } = require('path');
const { NetCDFReader } = require('netcdfjs');
const { readFileSync } = require('fs');

async function test() {
  // Use analysis file (smaller than forecast)
  const url = 'https://noaa-gfs-bdp-pds.s3.us-east-1.amazonaws.com/gfs.20261111/00/atmos/gfs.t00z.atmanl.nc';
  const localPath = require('path').join(tmpdir(), 'test.nc');
  
  const response = await fetch('https://noaa-gfs-bdp-pds.s3.us-east-1.amazonaws.com/gfs.20261111/00/atmos/gfs.t00z.atmanl.nc', { signal: AbortSignal.timeout(180000) });
  if (!response.ok) throw new Error('HTTP ' + response.status);
  await require('node:stream/promises').pipeline(response.body, createWriteStream(require('path').join(tmpdir(), 'test.nc')));
  console.log('Downloaded');
  
  const buffer = readFileSync(require('path').join(tmpdir(), 'test.nc'));
  const { NetCDFReader } = require('netcdfjs');
  const reader = new NetCDFReader(buffer);
  console.log('Variables:', reader.getVariables().map(v => v.name));
  console.log('Dimensions:', reader.getDimensions());
}

test().catch(console.error);