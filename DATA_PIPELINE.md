# ATMOS Data Pipeline Architecture

## Kiến trúc tổng quan

```
┌─────────────────────────────────────────────────────────────────┐
│                        ATMOS SYSTEM                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────────┐  │
│  │   WEB APP    │    │  DATA PIPE   │    │  CALIBRATION DB  │  │
│  │  (Browser)   │◄───│  (Linux)     │───►│  (benchmark.json)│  │
│  └──────┬───────┘    └──────┬───────┘    └────────┬──────────┘  │
│         │                   │                       │            │
│         │ Open-Meteo API    │ Linux + wgrib2        │            │
│         │ (Real-time)       │ (Scheduled)           │            │
│         ▼                   ▼                       ▼            │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                    USER INTERFACE                         │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

## Phân tách trách nhiệm

### 1. WEB APP (Browser) - `dist/index.html`
- **Nguồn dữ liệu real-time**: Open-Meteo API (free, 7 models, hourly 7 days)
- **Nguồn dữ liệu lịch sử**: `benchmark.json` (pre-computed calibration)
- **Nguồn cảnh báo**: NCHMF scraper (đã implement)
- **Radar**: Open-Meteo radar API
- **Không cần backend server** - static hosting (GitHub Pages, Netlify, Cloudflare Pages)

### 2. DATA PIPELINE (Linux only) - `data-ingestion/`
- **Chỉ chạy trên Linux** (cần `wgrib2`, `netcdfjs` optional)
- **Input**: NCEP GFS/GEFS (AWS S3), JMA GSM (Open-Meteo), NCHMF alerts
- **Output**: `dist/benchmark.json` (calibration coefficients)
- **Schedule**: Daily 06:00 UTC (sau khi GFS 00Z run xong)
- **Chỉ chạy trên Linux** (cần `wgrib2`, `netcdfjs` optional)

### 3. CALIBRATION DATA (`dist/benchmark.json`)
- Pre-computed EMOS coefficients cho 8 locations × 16 variables × 5 leads
- Commit vào repo → deploy cùng web app
- Web app load tại runtime → apply calibration lên Open-Meteo raw data

## File Structure

```
atmos/
├── dist/
│   ├── index.html          # Web app (static)
│   ├── app.js              # App logic (Open-Meteo API + calibration)
│   ├── engine.js           # EMOS engine (calibration engine)
│   ├── benchmark.json      # CALIBRATION DATA (committed)
│   └── style.css
├── data-ingestion/         # LINUX ONLY
│   ├── ncep-gfs-s3.js      # Download GFS/GEFS from AWS S3
│   ├── jma-openmeteo.js    # JMA GSM from Open-Meteo
│   ├── ncep-gfs-s3.js      # GFS/GEFS download + parse
│   ├── grib2-parser.js     # GRIB2 parser (needs wgrib2)
│   ├── ingest-ncep.cjs     # NCEP ingestion CLI
│   ├── ingest-jma.js       # JMA ingestion CLI
│   ├── calibrate.js        # EMOS calibration engine
│   ├── package.json
│   └── calibrate.js        # Calibration engine
├── src/
│   ├── engine/             # EMOS engine (shared)
│   ├── app/                # App components
│   └── schemas/            # Zod schemas
├── .github/workflows/      # CI/CD pipeline
│   └── daily-calibration.yml
└── package.json
```

## Deployment Strategy

### Web App (Static Hosting)
```bash
# Deploy to GitHub Pages / Netlify / Cloudflare Pages
npm run build    # Generates dist/
git push origin main
# GitHub Actions deploys dist/ to GitHub Pages
```

### Data Pipeline (GitHub Actions / VPS / Cron)
```yaml
# .github/workflows/daily-calibration.yml
name: Daily Calibration
on:
  schedule:
    - cron: '30 6 * * *'  # 06:30 UTC daily (after GFS 00Z)
  workflow_dispatch:

jobs:
  calibrate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Install wgrib2
        run: sudo apt-get update && sudo apt-get install -y wgrib2
      - name: Install Node.js
        uses: actions/setup-node@v4
        with: { node-version: '20' }
      - name: Install deps
        run: cd data-ingestion && npm ci
      - name: Run calibration
        run: cd data-ingestion && node ingest-all.js
      - name: Commit benchmark.json
        run: |
          git config user.name "github-actions"
          git config user.email "actions@github.com"
          git add dist/benchmark.json
          git commit -m "Update calibration $(date +%F)" || echo "No changes"
          git push
```

## Data Sources & APIs

| Nguồn | Protocol | Format | Variables | Coverage | Cost |
|-------|----------|--------|-----------|----------|------|
| **Open-Meteo API** | REST/JSON | JSON | 16 variables | Global, 7 days | Free |
| **NCEP GFS/GEFS** | AWS S3 | GRIB2/NetCDF | 16 vars | Global, 16 days | Free |
| **JMA GSM** | Open-Meteo | JSON | 16 vars | Asia-Pacific | Free |
| **NCHMF Alerts** | HTML Scrape | HTML | Warnings | Vietnam | Free |
| **Radar** | Open-Meteo | Image/JSON | Reflectivity | SE Asia | Free |

## Variable Mapping (GFS → ATMOS)

| ATMOS Variable | GFS GRIB2 | GFS NetCDF | Unit |
|----------------|-----------|------------|------|
| Temperature | TMP (2m) | tmp2m | °C |
| Humidity | RH (2m) | rh2m | % |
| Wind Speed | UGRD/VGRD (10m) | ugrd10m/vgrd10m | km/h |
| Wind Dir | UGRD/VGRD (10m) | ugrd10m/vgrd10m | ° |
| Precipitation | PRATE/APCP | prate/apcp | mm/h |
| Pressure | PRES/MSL | pres/msl | hPa |
| Cloud Cover | TCDC | tcdc | % |
| Radiation | DSWRF | dswrf | W/m² |
| Cape/LI/CIN | CAPE/LI/CIN | cape/li/cin | J/kg |

## Calibration Engine (EMOS)

### Method
Ensemble Model Output Statistics (EMOS) với Ridge Regression:
- Predictors: 7 models + spread + 2 cross-vars + 4 harmonics
- Transform: Gaussian/log1p/logit tùy biến
- Variance: σ² = α + β·spread²
- Selection: 1-SE rule trên blocked CV (purge 7 days)

### Output Format (benchmark.json)
```json
{
  "createdAt": "2026-11-12T06:30:00Z",
  "period": { "start": "2025-11-12", "end": "2026-11-11" },
  "split": { "trainEnd": "2026-10-14", "testStart": "2026-10-22", "purgeDays": 7 },
  "locations": [
    {
      "id": "hcm",
      "name": "TP. Hồ Chí Minh",
      "lat": 10.8231, "lon": 106.6297,
      "tests": [
        {
          "variable": "temperature_2m",
          "lead": 1,
          "selected": { "family": "emos", "lambda": 0.01 },
          "calibration": {
            "family": "emos",
            "intercept": 0.123,
            "beta": [0.15, 0.12, ...],
            "centre": [...],
            "scale": [...],
            "sigma2": { "alpha": 0.45, "beta": 0.78 },
            "modelIds": ["gfs_global", "ecmwf_ifs025", ...],
            "crossVars": ["cloud_cover", "relative_humidity_2m"]
          },
          "mean": { "rmse": 1.23, "bias": -0.05 },
          "probabilistic": { "crps": 0.89, "coverage": { "p10p90": 0.81 } }
        }
      ]
    }
  ]
}
```

## Quick Start Commands

```bash
# 1. Install dependencies
cd data-ingestion && npm install

# 2. Run full pipeline (Linux only, needs wgrib2)
sudo apt-get install wgrib2
node ingest-ncep.cjs
node ingest-jma.js
node calibrate.js

# 3. Verify output
cat dist/benchmark.json | jq '.locations[0].tests[0]'

# 4. Deploy web app
# Push to GitHub → GitHub Actions deploys dist/ to GitHub Pages
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| `wgrib2 not found` | `sudo apt-get install wgrib2` (Ubuntu/Debian) |
| `ENOENT spawn wgrib2` | Chạy trên Linux, không phải Windows |
| `ECONNRESET` / timeout | Tăng timeout, giảm concurrency |
| `404 Not Found` on S3 | Run time chưa có data, thử run trước đó |
| NetCDF parse error | File quá lớn, dùng GRIB2 + wgrib2 |

## Environment Variables

```bash
# Optional
export NCEP_CONCURRENCY=4        # Parallel downloads
export NCEP_TIMEOUT=600000       # 10 min timeout
export OPENMETEO_RATE_LIMIT=10   # req/sec
export NCHMF_RATE_LIMIT=1        # req/sec
```