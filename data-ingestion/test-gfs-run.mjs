import fetch from 'node-fetch';

async function test() {
  const now = new Date();
  for (let hoursBack = 0; hoursBack <= 48; hoursBack += 6) {
    const checkTime = new Date(Date.now() - hoursBack * 3600 * 1000);
    const runHour = Math.floor(checkTime.getUTCHours() / 6) * 6;
    const checkRun = new Date(Date.UTC(
      checkTime.getUTCFullYear(),
      checkTime.getUTCMonth(),
      checkTime.getUTCDate(),
      runHour,
      0, 0, 0
    ));
    
    const runStr = checkRun.toISOString().slice(0, 10).replace(/-/g, '');
    const runHourStr = checkRun.getUTCHours().toString().padStart(2, '0');
    const prefix = 'gfs.' + runStr + '/' + runHourStr + '/atmos/';
    const url = 'https://noaa-gfs-bdp-pds.s3.us-east-1.amazonaws.com?list-type=2&prefix=' + encodeURIComponent(prefix) + '&delimiter=/';
    
    try {
      const response = await fetch('https://noaa-gfs-bdp-pds.s3.us-east-1.amazonaws.com?list-type=2&prefix=' + encodeURIComponent(prefix) + '&delimiter=/', {
        signal: AbortSignal.timeout(10000),
      });
      if (response.ok) {
        const xml = await response.text();
        if (xml.includes('<CommonPrefixes>')) {
          console.log('Found available GFS run:', checkRun.toISOString());
          return;
        }
      }
    } catch (e) {
      // Continue to next run
    }
  }
  console.log('No runs found');
}

test().catch(console.error);