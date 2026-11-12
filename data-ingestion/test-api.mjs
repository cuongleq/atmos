import fetch from 'node-fetch';

async function test() {
  const url = 'https://api.open-meteo.com/v1/forecast?latitude=10.8231&longitude=106.6297&hourly=temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m,wind_direction_10m&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&forecast_days=10&timezone=Asia%2FHo_Chi_Minh&models=jma_gsm';
  const response = await fetch(url);
  const data = await response.json();
  console.log('Keys:', Object.keys(data));
  console.log('Has timezone_abbreviation:', 'timezone_abbreviation' in data);
  if (data.timezone_abbreviation) console.log('Value:', data.timezone_abbreviation);
}

test().catch(console.error);