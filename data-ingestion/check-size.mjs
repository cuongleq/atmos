const fetch = require('node-fetch');

async function test() {
  const url = 'https://noaa-gfs-bdp-pds.s3.us-east-1.amazonaws.com/gfs.20261111/00/atmos/gfs.t00z.atmanl.nc';
  const response = await fetch(url, { method: 'HEAD' });
  console.log('Content-Length:', response.headers.get('content-length'));
  console.log('Content-Type:', response.headers.get('content-type'));
}

test().catch(console.error);