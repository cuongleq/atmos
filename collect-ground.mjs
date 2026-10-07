import fs from 'fs/promises';
import { join } from 'path';

// Danh sách tọa độ các trạm Hàng không (METAR) tại Việt Nam
const VIETNAM_AIRPORTS = [
  { icao: 'VVNB', name: 'Nội Bài', lat: 21.2212, lon: 105.8072 },
  { icao: 'VVTS', name: 'Tân Sơn Nhất', lat: 10.8188, lon: 106.6519 },
  { icao: 'VVDN', name: 'Đà Nẵng', lat: 16.0439, lon: 108.1994 },
  { icao: 'VVDL', name: 'Liên Khương (Đà Lạt)', lat: 11.7508, lon: 108.3703 },
  { icao: 'VVCT', name: 'Cần Thơ', lat: 10.0844, lon: 105.7119 },
  { icao: 'VVCR', name: 'Cam Ranh (Nha Trang)', lat: 11.9981, lon: 109.2194 },
  { icao: 'VVPB', name: 'Phú Bài (Huế)', lat: 16.4017, lon: 107.7028 },
  { icao: 'VVCI', name: 'Cát Bi (Hải Phòng)', lat: 20.8194, lon: 106.7264 },
  { icao: 'VVVH', name: 'Vinh', lat: 18.7364, lon: 105.6711 },
  { icao: 'VVBM', name: 'Buôn Ma Thuột', lat: 12.6681, lon: 108.1200 },
  { icao: 'VVPQ', name: 'Phú Quốc', lat: 10.1658, lon: 103.9961 },
  { icao: 'VVPC', name: 'Phù Cát (Quy Nhơn)', lat: 13.9550, lon: 109.0433 },
  { icao: 'VVUI', name: 'Đồng Hới', lat: 17.5147, lon: 106.5906 },
  { icao: 'VVCA', name: 'Chu Lai (Quảng Nam)', lat: 15.4061, lon: 108.7061 },
  { icao: 'VVCS', name: 'Côn Đảo', lat: 8.7322, lon: 106.6292 },
  { icao: 'VVVK', name: 'Rạch Giá', lat: 9.9592, lon: 105.1344 },
  { icao: 'VVCM', name: 'Cà Mau', lat: 9.1764, lon: 105.1767 },
  { icao: 'VVTX', name: 'Tuy Hòa', lat: 13.0378, lon: 109.3278 },
  { icao: 'VVDB', name: 'Điện Biên Phủ', lat: 21.3975, lon: 103.0078 },
  { icao: 'VVVD', name: 'Vân Đồn', lat: 21.1167, lon: 107.4167 },
  { icao: 'VVTH', name: 'Thọ Xuân (Thanh Hóa)', lat: 19.9022, lon: 105.4678 }
];

// Hàm tính khoảng cách (km) giữa 2 tọa độ (Haversine formula)
function distanceKm(lat1, lon1, lat2, lon2) {
  const p = 0.017453292519943295; // Math.PI / 180
  const c = Math.cos;
  const a = 0.5 - c((lat2 - lat1) * p) / 2 + c(lat1 * p) * c(lat2 * p) * (1 - c((lon2 - lon1) * p)) / 2;
  return 12742 * Math.asin(Math.sqrt(a));
}

// Tìm trạm hàng không gần nhất trong bán kính tối đa 100km
function findNearestAirport(lat, lon, maxRadiusKm = 100) {
  let nearest = null;
  let minDist = Infinity;
  for (const apt of VIETNAM_AIRPORTS) {
    const d = distanceKm(lat, lon, apt.lat, apt.lon);
    if (d < minDist && d <= maxRadiusKm) {
      minDist = d;
      nearest = apt;
    }
  }
  return nearest;
}

async function fetchMetar(icao) {
  const res = await fetch(`https://aviationweather.gov/api/data/metar?ids=${icao}&format=json&taf=false`);
  if (!res.ok) throw new Error('Lỗi tải METAR');
  const data = await res.json();
  return data && data.length > 0 ? data[0] : null;
}

async function fetchOpenMeteoCurrent(lat, lon) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m,wind_direction_10m&timezone=auto`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Lỗi tải Open-Meteo');
  return res.json();
}

async function run() {
  console.log('Khởi động thu thập dữ liệu quan trắc bề mặt (Ground Truth)...');
  const rawDir = join(process.cwd(), 'raw');
  await fs.mkdir(rawDir, { recursive: true });
  
  // Đọc danh sách địa điểm từ benchmark.json
  const benchmarkRaw = await fs.readFile(join(process.cwd(), 'dist', 'benchmark.json'), 'utf8');
  const benchmark = JSON.parse(benchmarkRaw);
  
  for (const loc of benchmark.locations) {
    console.log(`\n📍 Đang thu thập cho: ${loc.name} (${loc.id})`);
    
    let obsData = { id: loc.id, name: loc.name, timestamp: new Date().toISOString() };
    
    // CÁCH 1: Dùng dữ liệu METAR nếu có sân bay trong vòng 30km
    const nearestAirport = findNearestAirport(loc.lat, loc.lon);
    if (nearestAirport) {
      const icao = nearestAirport.icao;
      try {
        console.log(`  -> Đang lấy trạm METAR [${icao} - ${nearestAirport.name}] (cách ${distanceKm(loc.lat, loc.lon, nearestAirport.lat, nearestAirport.lon).toFixed(1)}km)...`);
        const metar = await fetchMetar(icao);
        if (metar) {
          obsData.source = 'METAR';
          obsData.stationId = icao;
          obsData.stationName = nearestAirport.name;
          obsData.temperature = metar.temp;
          obsData.dewpoint = metar.dewp;
          obsData.windSpeed_kmh = Math.round(metar.wspd * 1.852); // Đổi knots -> km/h
          obsData.windDirection = metar.wdir;
          console.log(`     ✔️ [METAR] Nhiệt độ: ${metar.temp}°C | Gió: ${obsData.windSpeed_kmh} km/h`);
        }
      } catch (e) {
        console.log(`     ❌ Không lấy được METAR: ${e.message}`);
      }
    }
    
    // CÁCH 2: Dùng dữ liệu mạng lưới trạm WMO qua API (fallback hoặc chi tiết mưa)
    if (!obsData.source) {
      try {
        console.log(`  -> Đang lấy trạm SYNOP/WMO (Open-Meteo Current)...`);
        const om = await fetchOpenMeteoCurrent(loc.lat, loc.lon);
        if (om && om.current) {
          obsData.source = 'SYNOP/WMO';
          obsData.temperature = om.current.temperature_2m;
          obsData.humidity = om.current.relative_humidity_2m;
          obsData.precipitation_mm = om.current.precipitation;
          obsData.windSpeed_kmh = om.current.wind_speed_10m;
          obsData.windDirection = om.current.wind_direction_10m;
          console.log(`     ✔️ [WMO] Nhiệt độ: ${obsData.temperature}°C | Mưa: ${obsData.precipitation_mm}mm`);
        }
      } catch (e) {
        console.log(`     ❌ Không lấy được WMO: ${e.message}`);
      }
    }
    
    // 3. Xử lý lưu trữ dạng chuỗi thời gian (Timeseries) để thay thế ERA5
    const outFile = join(rawDir, `${loc.id}-ground.json`);
    let timeseriesData = {
      latitude: loc.lat,
      longitude: loc.lon,
      hourly: {
        time: [],
        temperature_2m: [],
        relative_humidity_2m: [],
        wind_speed_10m: [],
        wind_direction_10m: [],
        precipitation: []
      }
    };

    // Đọc file cũ nếu có để nối tiếp dữ liệu
    try {
      const oldDataRaw = await fs.readFile(outFile, 'utf8');
      timeseriesData = JSON.parse(oldDataRaw);
    } catch (e) {
      // File chưa tồn tại, dùng khung mặc định
    }

    // Lấy mốc thời gian hiện tại (làm tròn về giờ)
    const now = new Date();
    now.setMinutes(0, 0, 0);
    const timeIso = now.toISOString().slice(0, 16);

    // Kiểm tra xem giờ này đã được lưu chưa để tránh trùng lặp
    const lastIdx = timeseriesData.hourly.time.indexOf(timeIso);
    if (lastIdx !== -1) {
      console.log(`     -> Giờ ${timeIso} đã tồn tại, ghi đè dữ liệu...`);
      timeseriesData.hourly.temperature_2m[lastIdx] = obsData.temperature || null;
      timeseriesData.hourly.relative_humidity_2m[lastIdx] = obsData.humidity ?? obsData.dewpoint ?? null;
      timeseriesData.hourly.precipitation[lastIdx] = obsData.precipitation_mm || 0;
      timeseriesData.hourly.wind_speed_10m[lastIdx] = obsData.windSpeed_kmh || null;
      timeseriesData.hourly.wind_direction_10m[lastIdx] = obsData.windDirection || null;
    } else {
      // Ghi thêm vào mảng (Append)
      timeseriesData.hourly.time.push(timeIso);
      timeseriesData.hourly.temperature_2m.push(obsData.temperature || null);
      timeseriesData.hourly.relative_humidity_2m.push(obsData.humidity ?? obsData.dewpoint ?? null);
      timeseriesData.hourly.precipitation.push(obsData.precipitation_mm || 0);
      timeseriesData.hourly.wind_speed_10m.push(obsData.windSpeed_kmh || null);
      timeseriesData.hourly.wind_direction_10m.push(obsData.windDirection || null);
    }

    await fs.writeFile(outFile, JSON.stringify(timeseriesData, null, 2));
    console.log(`  -> 💾 Đã cập nhật chuỗi thời gian vào ${outFile}`);
  }
  
  console.log('\n✅ Hoàn tất toàn bộ!');
}

run().catch(console.error);
