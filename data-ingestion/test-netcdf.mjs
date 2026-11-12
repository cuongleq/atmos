const fetch = require('node-fetch');
const { pipeline } = require('node:stream/promises');
const { createWriteStream } = require('fs');
const { join } = require('path');
const { tmpdir } = require('os');
const { NetCDFReader } = require('netcdfjs');
const { readFileSync } = require('fs');
const { join: pathJoin } = require('path');

async function test() {
  const url = 'https://noaa-gfs-bdp-pds.s3.us-east-1.amazonaws.com/gfs.20261111/00/atmos/gfs.t00z.atmf000.nc';
  const localPath = join(tmpdir(), 'test.nc');
  
  const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error('HTTP ' + response.status);
  await pipeline(response.body, createWriteStream(localPath));
  console.log('Downloaded:', localPath);
  
  const buffer = readFileSync(localPath);
  const reader = new NetCDFReader(buffer);
  console.log('Variables:', reader.getVariables().map(v => v.name));
  console.log('Dimensions:', reader.getDimensions());
}

test().catch(console.error);