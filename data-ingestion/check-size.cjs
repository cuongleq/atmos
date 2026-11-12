const axios = require('axios');

async function test() {
  const url = 'https://noaa-gfs-bdp-pds.s3.us-east-1.amazonaws.com/gfs.20261111/00/atmos/gfs.t00z.atmanl.nc';
  const response = await axios.head(url);
  console.log('Content-Length:', response.headers['content-length']);
  console.log('Content-Type:', response.headers['content-type']);
}

test().catch(console.error);