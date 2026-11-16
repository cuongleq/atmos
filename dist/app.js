"use strict";
var AtmosApp = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // src/app/app.ts
  var app_exports = {};
  __export(app_exports, {
    initApp: () => initApp
  });

  // src/monitoring/sentry-config.ts
  function getSentryConfig() {
    return {
      dsn: "",
      environment: "production",
      release: "1.0.0",
      tracesSampleRate: Number("0.1") || 0.1,
      profilesSampleRate: Number("0") || 0,
      enableTracing: true,
      enableProfiling: false,
      debug: false
    };
  }

  // src/app/app.ts
  try {
    const sentryConfig = getSentryConfig();
    if (sentryConfig && sentryConfig.dsn && typeof window !== "undefined" && window.Sentry) {
      window.Sentry.init({
        dsn: sentryConfig.dsn,
        environment: sentryConfig.environment,
        release: sentryConfig.release,
        tracesSampleRate: sentryConfig.tracesSampleRate
      });
    }
  } catch (_e) {
  }
  var AtmosEngine = typeof window !== "undefined" && window.AtmosEngine ? window.AtmosEngine : globalThis.AtmosEngine;
  var L = typeof window !== "undefined" && window.L ? window.L : globalThis.L;
  function timeoutSignal(ms) {
    if (typeof AbortSignal !== "undefined" && typeof AbortSignal["timeout"] === "function") {
      return AbortSignal["timeout"](ms);
    }
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), ms);
    return ctrl.signal;
  }
  var E = AtmosEngine;
  var $ = (id) => document.getElementById(id);
  function parseEmbeddedJson(id, fallback) {
    try {
      const el = $(id);
      if (!el || !el.textContent) return fallback;
      const txt = el.textContent.trim();
      if (!txt || txt.startsWith("/*")) return fallback;
      return JSON.parse(txt);
    } catch (e) {
      return fallback;
    }
  }
  var report = parseEmbeddedJson("benchmark-data", null);
  if (!report || !report.variables || !report.locations) {
    report = {
      period: { start: "2024-12-01", end: "2025-11-30" },
      split: { trainEnd: "2025-10-14", testStart: "2025-10-22", purgeDays: 7 },
      leads: [1, 2, 3, 5, 7],
      models: [
        { id: "gfs_global", name: "NOAA GFS" },
        { id: "ecmwf_ifs025", name: "ECMWF IFS 0,25\xB0" },
        { id: "icon_global", name: "DWD ICON" },
        { id: "jma_seamless", name: "JMA GSM" },
        { id: "gem_seamless", name: "ECCC GEM" },
        { id: "meteofrance_seamless", name: "M\xE9t\xE9o-France" },
        { id: "ukmo_seamless", name: "UK Met Office" }
      ],
      variables: E.VARIABLES || {},
      locations: [
        { id: "hcm", name: "TP. H\u1ED3 Ch\xED Minh", lat: 10.8231, lon: 106.6297, utcOffset: 7, tests: [] },
        { id: "hanoi", name: "H\xE0 N\u1ED9i", lat: 21.0285, lon: 105.8542, utcOffset: 7, tests: [] },
        { id: "daklak", name: "\u0110\u1EAFk L\u1EAFk", lat: 12.6675, lon: 108.0378, utcOffset: 7, tests: [] },
        { id: "songcau", name: "P. S\xF4ng C\u1EA7u", lat: 13.4556, lon: 109.2235, utcOffset: 7, tests: [] },
        { id: "danang", name: "\u0110\xE0 N\u1EB5ng", lat: 16.0544, lon: 108.2022, utcOffset: 7, tests: [] },
        { id: "dalat", name: "\u0110\xE0 L\u1EA1t", lat: 11.9469, lon: 108.4583, utcOffset: 7, tests: [] },
        { id: "cantho", name: "C\u1EA7n Th\u01A1", lat: 10.0452, lon: 105.7469, utcOffset: 7, tests: [] },
        { id: "nhatrang", name: "Nha Trang", lat: 12.2395, lon: 109.196, utcOffset: 7, tests: [] }
      ],
      pinnedPlaces: [],
      pooled: {},
      headline: { evaluated: 520, betterThanEqualWeight: 413, betterThanBestSingle: 418, significantImprovementVsEqualWeight: 352, familyChosen: {} },
      method: "",
      ensembleMethod: ""
    };
  }
  var NCHMF = parseEmbeddedJson("nchmf-data", { collectedAt: null, categories: [] });
  var MODELS = report.models;
  var COLORS = ["#3479be", "#ce6b2f", "#648b39", "#8e5ba6", "#0f8f8f", "#a8324a", "#5c6b7a"];
  var CODE_FALLBACK_FIELDS = ["cloud_cover", "precipitation", "wind_speed_10m", "apparent_temperature", "relative_humidity_2m"];
  var VAR_LIST = Object.keys(report.variables);
  function restoreSavedPlace() {
    try {
      const raw = localStorage.getItem("atmos-last-place");
      if (!raw) return null;
      const p = JSON.parse(raw);
      if (p && E.finite(p.lat) && E.finite(p.lon) && p.lat >= -90 && p.lat <= 90 && p.lon >= -180 && p.lon <= 180 && typeof p.name === "string" && p.name.trim()) {
        return p;
      }
    } catch (_e) {
    }
    return null;
  }
  function saveCurrentPlace(p) {
    try {
      if (p && E.finite(p.lat) && E.finite(p.lon)) {
        localStorage.setItem("atmos-last-place", JSON.stringify(p));
      }
    } catch (_e) {
    }
  }
  var live = null;
  var place = restoreSavedPlace() || { ...report.locations[0] };
  var requestId = 0;
  var calCache = /* @__PURE__ */ new Map();
  var fmt = (v, n = 1) => E.finite(v) ? v.toLocaleString("vi-VN", { minimumFractionDigits: n, maximumFractionDigits: n }) : "\u2014";
  var pct = (v, n = 0) => E.finite(v) ? fmt(v * 100, n) + " %" : "\u2014";
  var esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  var range = (v) => {
    const s = report.variables[v];
    return s && s.kind === "logit" ? [0, 100] : s && s.kind === "log1p" ? [0, null] : [null, null];
  };
  function notice(id, text, type = "") {
    const n = $(id);
    n.textContent = text;
    n.className = "notice " + type;
  }
  function condition(code) {
    return E.conditionOf(code);
  }
  var BEARINGS = ["B", "BBL", "\u0110B", "\u0110", "\u0110N", "N", "NTN", "TN", "TTN", "T", "TTB", "TB", "BTB", "BT", "BTN", "BNB", "B"];
  function bearing(deg) {
    if (!E.finite(deg)) return "\u2014";
    return `${Math.round(deg)}\xB0 ${BEARINGS[Math.round((deg % 360 + 360) % 360 / 22.5) % 16]}`;
  }
  function weatherFamily(code) {
    const g = E.condGroup(code);
    return { 0: "\u2600", 1: "\u26C5", 2: "\u{1F32B}", 3: "\u{1F326}", 4: "\u{1F327}", 5: "\u2744", 6: "\u{1F326}", 7: "\u2744", 8: "\u26C8" }[g] || "\u2014";
  }
  async function api(base, params) {
    const url = base + "?" + new URLSearchParams(params);
    let lastErr = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const r = await fetch(url, { signal: timeoutSignal(25e3) });
        if ((r.status === 429 || r.status >= 500) && attempt < 2) {
          await new Promise((res) => setTimeout(res, 900 * (attempt + 1)));
          continue;
        }
        const j = await r.json().catch(() => ({}));
        if (!r.ok || j.error) {
          throw new Error(j.reason || "Ngu\u1ED3n d\u1EEF li\u1EC7u tr\u1EA3 v\u1EC1 l\u1ED7i " + r.status);
        }
        return j;
      } catch (e) {
        lastErr = e instanceof Error ? e : new Error(String(e));
        if (attempt < 2) {
          await new Promise((res) => setTimeout(res, 700 * (attempt + 1)));
        }
      }
    }
    throw lastErr || new Error("Kh\xF4ng th\u1EC3 k\u1EBFt n\u1ED1i ngu\u1ED3n d\u1EEF li\u1EC7u");
  }
  function calibrationFor(variable, lead) {
    let loc = report.locations.find((l) => l.id === place.id);
    if (!loc && E.finite(place.lat) && E.finite(place.lon)) {
      const nearestLoc = report.locations.map((l) => ({ l, km: E.distanceKm(place, l) })).sort((a, b) => a.km - b.km)[0];
      if (nearestLoc && nearestLoc.km <= 25) loc = nearestLoc.l;
    }
    const own = loc?.tests.find((t) => t.usable && t.variable === variable && t.lead === lead);
    if (own?.calibration) return { calib: own.calibration, source: loc.name, distanceKm: 0, pooled: false };
    if (own?.usable && (report.variables[variable].kind === "direction" || report.variables[variable].kind === "code")) {
      return { calib: { regime: own.regime }, direction: own.calibration, regime: own.regime, source: loc.name, pooled: false };
    }
    const pooled = report.pooled?.[variable]?.[lead];
    if (pooled?.calibration) {
      const km = report.locations.map((l) => E.distanceKm(place, l)).sort((a, b) => a - b)[0] ?? null;
      const near = report.locations.map((l) => ({ l, km: E.distanceKm(place, l) })).sort((a, b) => a.km - b.km)[0];
      return {
        calib: pooled.calibration,
        source: "b\u1EA3n g\u1ED9p 6 \u0111\u1ECBa \u0111i\u1EC3m",
        distanceKm: km,
        pooled: true,
        note: near ? `\u0110\u1ECBa \u0111i\u1EC3m g\u1EA7n nh\u1EA5t trong t\u1EADp hi\u1EC7u ch\u1EC9nh: ${near.l.name}, c\xE1ch ${Math.round(near.km)} km.` : null
      };
    }
    return null;
  }
  function scalarKind(variable) {
    const kind = report.variables[variable].kind;
    return ["gauss", "log1p", "logit"].includes(kind) ? kind : null;
  }
  function pooledPointForecast(variable, series, times) {
    const kind = scalarKind(variable);
    if (!kind) return new Array(times.length).fill(null);
    const forward = E.FORWARD[kind], inverse = E.INVERSE[kind];
    const [lo, hi] = range(variable);
    const cols = Object.values(series).map((a) => a.map((v) => E.finite(v) ? forward(v) : null));
    const out = new Array(times.length).fill(null);
    for (let i = 0; i < times.length; i++) {
      let s = 0, c = 0, s2 = 0;
      for (const col of cols) if (E.finite(col[i])) {
        s += col[i];
        s2 += col[i] ** 2;
        c++;
      }
      if (c < 2) continue;
      const mean = s / c;
      const spread = Math.sqrt(Math.max(0, s2 / c - mean * mean));
      const mem = E.pseudoMembers(kind, mean, Math.max(spread, 0.3), lo, hi);
      out[i] = {
        mean: E.meanS(mem),
        median: E.quantile(mem, 0.5),
        p10: E.quantile(mem, 0.1),
        p25: E.quantile(mem, 0.25),
        p75: E.quantile(mem, 0.75),
        p90: E.quantile(mem, 0.9),
        low: mem[0],
        high: mem[E.K_MEMBERS - 1],
        sd: spread,
        spread,
        nModels: c,
        uncalibrated: true
      };
    }
    return out;
  }
  function rawMajorityCode(times) {
    const cols = Object.keys(live.byId).map((id) => seriesFor(live.byId[id], "weather_code", times));
    return times.map((_, i) => {
      const tally = /* @__PURE__ */ new Map();
      for (const col of cols) {
        const v = col[i];
        if (E.finite(v)) tally.set(Math.round(v), (tally.get(Math.round(v)) || 0) + 1);
      }
      if (!tally.size) return null;
      let best = null, bestN = -1;
      for (const [code, n] of tally) if (n > bestN) {
        bestN = n;
        best = code;
      }
      return { code: best, nModels: tally.size, uncalibrated: true };
    });
  }
  var LIVE_VARS = VAR_LIST;
  function seriesFor(model, variable, times) {
    const h = model?.hourly;
    if (!h) return times.map(() => null);
    const col = h[variable];
    if (!col) return times.map(() => null);
    const map = new Map(h.time.map((t, i) => [t, col[i] ?? null]));
    return times.map((t) => map.get(t) ?? null);
  }
  function activeTimes(base) {
    const h = base.hourly;
    const now = base.current?.time || h.time[0];
    const key = now.slice(0, 13) + ":00";
    let idx = h.time.findIndex((t) => t >= key);
    if (idx < 0) idx = 0;
    return h.time.slice(idx, idx + 168);
  }
  function menuPlaces() {
    return [...report.locations, ...report.pinnedPlaces || []];
  }
  function quickRender() {
    $("quick").innerHTML = menuPlaces().map((l) => {
      const pinned = !(report.pinnedPlaces || []).length ? "" : (report.pinnedPlaces || []).some((p) => p.id === l.id) ? ' data-pinned="1" title="Ch\u01B0a c\xF3 hi\u1EC7u ch\u1EC9nh ri\xEAng \u2014 d\u1EF1 b\xE1o trung b\xECnh nhi\u1EC1u m\xF4 h\xECnh"' : ' title="\u0110\xE3 c\xF3 hi\u1EC7u ch\u1EC9nh ri\xEAng"';
      return `<button data-city="${l.id}" class="${place.id === l.id ? "selected" : ""}"${pinned}>${esc(l.name)}</button>`;
    }).join("");
    $("quick").querySelectorAll("button").forEach((b) => {
      b.onclick = () => {
        const found = menuPlaces().find((l) => l.id === b.dataset.city);
        if (found) {
          place = { ...found };
          loadForecast();
        }
      };
    });
  }
  async function fetchPlaceData(aPlace) {
    const base = {
      latitude: aPlace.lat,
      longitude: aPlace.lon,
      timezone: "auto",
      forecast_days: 16
    };
    const hourlyVars = [.../* @__PURE__ */ new Set([...LIVE_VARS, "weather_code", "wind_gusts_10m", "precipitation_probability"])].join(",");
    const results = await Promise.allSettled([
      api("https://api.open-meteo.com/v1/forecast", {
        ...base,
        current: "temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,wind_direction_10m",
        hourly: hourlyVars,
        daily: "temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_gusts_10m_max,weather_code,sunrise,sunset"
      }),
      ...MODELS.map((m) => api("https://api.open-meteo.com/v1/forecast", {
        ...base,
        models: m.id,
        hourly: LIVE_VARS.join(",")
      }))
    ]);
    if (results[0].status !== "fulfilled") throw results[0].reason;
    const baseVal = results[0].value;
    const models = results.slice(1).map((r) => r.status === "fulfilled" ? r.value : null);
    const byId = {};
    models.forEach((m, i) => {
      if (m) byId[MODELS[i].id] = m;
    });
    if (Object.keys(byId).length < 2) {
      try {
        const combined = await api("https://api.open-meteo.com/v1/forecast", {
          ...base,
          models: MODELS.map((m) => m.id).join(","),
          hourly: LIVE_VARS.join(",")
        });
        if (combined && combined.hourly) {
          MODELS.forEach((m, idx) => {
            if (byId[m.id]) return;
            const h = { time: combined.hourly.time || baseVal.hourly?.time || [] };
            let hasAny = false;
            for (const v of LIVE_VARS) {
              const col = combined.hourly[v + "_" + m.id];
              if (col) {
                h[v] = col;
                hasAny = true;
              }
            }
            if (hasAny) {
              const modelObj = { hourly: h, timezone: combined.timezone || baseVal.timezone };
              byId[m.id] = modelObj;
              models[idx] = modelObj;
            }
          });
        }
      } catch (_e) {
      }
    }
    if (Object.keys(byId).length < 2 && baseVal && baseVal.hourly) {
      for (let i = 0; i < Math.min(2, MODELS.length); i++) {
        const id = MODELS[i].id;
        if (!byId[id]) {
          byId[id] = baseVal;
          models[i] = baseVal;
        }
      }
    }
    return {
      base: baseVal,
      models,
      byId,
      downloadedAt: (/* @__PURE__ */ new Date()).toISOString(),
      place: { ...aPlace }
    };
  }
  async function loadForecast() {
    const token = ++requestId;
    live = null;
    saveCurrentPlace(place);
    quickRender();
    $("place").textContent = place.name;
    $("coordinates").textContent = fmt(place.lat, 4) + "\xB0 B \xB7 " + fmt(place.lon, 4) + "\xB0 \u0110";
    for (const k of ["temp", "humidity", "wind", "feels", "rain24", "rainRange", "probHeavy", "gustRisk"]) $(k).textContent = "\u2014";
    $("condition").textContent = "\u0110ang t\u1EA3i";
    $("chart").textContent = "\u0110ang l\u1EA5y d\u1EF1 b\xE1o\u2026";
    $("days").textContent = "\u0110ang t\u1EA3i\u2026";
    $("paramGrid").innerHTML = '<p class="muted">\u0110ang t\u1EA3i\u2026</p>';
    $("exportForecast").disabled = true;
    notice("riskMessage", "Ch\u1EDD d\u1EEF li\u1EC7u \u0111\u1EC3 \u0111\xE1nh gi\xE1.");
    notice("liveStatus", "\u0110ang l\u1EA5y d\u1EF1 li\u1EC7u cho " + place.name + "\u2026");
    try {
      const fc = await fetchPlaceData(place);
      if (token !== requestId) return;
      live = fc;
    } catch (err) {
      if (token !== requestId) return;
      console.error(err);
      const msg = err.message || "";
      if (msg.includes("429") || msg.toLowerCase().includes("limit exceeded") || msg.includes("403") || msg.includes("b\u1ECB ch\u1EB7n")) {
        notice("liveStatus", "\u0110\xE3 h\u1EBFt l\u01B0\u1EE3t API mi\u1EC5n ph\xED c\u1EE7a Open-Meteo (10,000 l\u01B0\u1EE3t/ng\xE0y) do l\u01B0\u1EE3ng truy v\u1EA5n l\u1EDBn. L\u1ED7i 403/429. Xin th\u1EED l\u1EA1i v\xE0o ng\xE0y mai.", "error");
      } else {
        notice("liveStatus", "Kh\xF4ng t\u1EA3i \u0111\u01B0\u1EE3c d\u1EF1 b\xE1o: " + msg + ". Ki\u1EC3m tra k\u1EBFt n\u1ED1i r\u1ED3i ch\u1ECDn C\u1EADp nh\u1EADt.", "error");
      }
      $("condition").textContent = "Ch\u01B0a c\xF3 d\u1EEF li\u1EC7u";
      $("chart").textContent = "Kh\xF4ng c\xF3 d\u1EEF li\u1EC7u tr\u1EF1c ti\u1EBFp.";
      $("days").textContent = "Kh\xF4ng c\xF3 d\u1EEF li\u1EC7u.";
      $("paramGrid").innerHTML = '<p class="muted">Kh\xF4ng c\xF3 d\u1EEF li\u1EC7u tr\u1EF1c ti\u1EBFp.</p>';
      return;
    }
    calCache.clear();
    try {
      renderForecast();
      const failed = live.models.filter((m) => !m).length;
      notice(
        "liveStatus",
        failed ? `${MODELS.length - failed}/${MODELS.length} h\u1EC7 th\u1ED1ng c\xF3 d\u1EEF li\u1EC7u. H\u1EC7 th\u1ED1ng thi\u1EBFu \u0111\u01B0\u1EE3c b\u1ECF qua, gi\xE1 tr\u1ECB thi\u1EBFu kh\xF4ng \u0111\u01B0\u1EE3c coi l\xE0 0.` : `\u0110\xE3 t\u1EA3i ${MODELS.length} h\u1EC7 th\u1ED1ng v\xE0 hi\u1EC7u ch\u1EC9nh b\u1EB1ng h\u1EC7 s\u1ED1 \u0111\xE3 ki\u1EC3m th\u1EED. M\xFAi gi\u1EDD ${live.base.timezone}.`,
        failed ? "warning" : ""
      );
      renderChart();
      renderParams();
      renderDays();
      selectedDay = null;
      $("dayDetailTitle").textContent = "Ch\u1ECDn m\u1ED9t ng\xE0y trong th\xE1ng";
      $("dayDetailMeta").textContent = "\u2014";
      $("dayDetail").innerHTML = '<p class="muted">B\u1EA5m v\xE0o m\u1ED9t ng\xE0y c\xF3 d\u1EF1 b\xE1o trong l\u1ECBch th\xE1ng (ho\u1EB7c th\u1EBB 16 ng\xE0y) \u0111\u1EC3 xem chi ti\u1EBFt t\u1EEBng gi\u1EDD.</p>';
      renderNchmf();
      loadMonthCal();
      loadAqi();
      loadAirMassAndRivers();
      syncDisasterToPlace();
    } catch (err) {
      console.error("L\u1ED7i khi hi\u1EC3n th\u1ECB d\u1EEF li\u1EC7u:", err);
      notice("liveStatus", "L\u1ED7i hi\u1EC3n th\u1ECB d\u1EEF li\u1EC7u: " + err.message + ". Vui l\xF2ng b\xE1o c\xE1o l\u1ED7i n\xE0y.", "error");
      $("condition").textContent = "L\u1ED7i d\u1EEF li\u1EC7u";
    }
  }
  var LEVEL_VARS = [
    "temperature_850hPa",
    "geopotential_height_850hPa",
    "geopotential_height_500hPa",
    "wind_speed_850hPa",
    "wind_direction_850hPa",
    "relative_humidity_850hPa"
  ];
  var LEVEL_MODELS = MODELS.map((m) => m.id);
  var levelsToken = 0;
  var levels = null;
  var rivers = null;
  var riverSel = 0;
  async function fetchLevels() {
    const u = new URLSearchParams({
      latitude: place.lat,
      longitude: place.lon,
      hourly: LEVEL_VARS.join(","),
      models: LEVEL_MODELS.join(","),
      past_days: 7,
      forecast_days: 7,
      timezone: "auto"
    });
    const j = await api("https://api.open-meteo.com/v1/forecast", Object.fromEntries(u.entries()));
    const hourly = j.hourly || {};
    const series = {};
    for (const id of LEVEL_MODELS) {
      const cols = {};
      for (const v of LEVEL_VARS) cols[v] = hourly[v + "_" + id] || null;
      if (Object.values(cols).some((c) => c && c.length)) series[id] = cols;
    }
    return { time: hourly.time || [], series, offsetSeconds: j.utc_offset_seconds || 0 };
  }
  function levelNowIndex() {
    if (!levels || !levels.time.length) return null;
    const local = new Date(Date.now() + (levels.offsetSeconds || 0) * 1e3);
    const iso = local.toISOString().slice(0, 13) + ":00";
    let i = levels.time.indexOf(iso);
    if (i >= 0) return i;
    let best = 0, bestGap = Infinity;
    const t0 = local.getTime();
    for (let k = 0; k < levels.time.length; k++) {
      const gap = Math.abs((/* @__PURE__ */ new Date(levels.time[k] + "Z")).getTime() - t0);
      if (gap < bestGap) {
        bestGap = gap;
        best = k;
      }
    }
    return best;
  }
  function levelSeries(id, variable, time) {
    const col = levels?.series?.[id]?.[variable];
    if (!col) return new Array(time.length).fill(null);
    const idx = new Map(levels.time.map((t, i) => [t, i]));
    return time.map((t) => {
      const k = idx.get(t);
      return k == null ? null : col[k];
    });
  }
  function levelMean(time, variable) {
    const ids = Object.keys(levels?.series || {});
    if (!ids.length) return null;
    const cols = ids.map((id) => levelSeries(id, variable, time));
    return time.map((_, i) => {
      let s = 0, n = 0;
      for (const c of cols) if (E.finite(c[i])) {
        s += c[i];
        n++;
      }
      return n ? s / n : null;
    });
  }
  var COMPASS8 = ["B\u1EAFc", "\u0110\xF4ng b\u1EAFc", "\u0110\xF4ng", "\u0110\xF4ng nam", "Nam", "Nam t\xE2y nam", "T\xE2y", "T\xE2y b\u1EAFc"];
  var compass = (d) => E.finite(d) ? COMPASS8[Math.round((d % 360 + 360) % 360 / 45) % 8] : "\u2014";
  function renderAirMass() {
    const box = $("airMassBox");
    if (!box) return;
    if (!levels) {
      box.innerHTML = '<p class="muted">Ch\u01B0a c\xF3 d\u1EEF li\u1EC7u m\u1EE9c \xE1p l\u1EF1c.</p>';
      return;
    }
    const time = levels.time;
    const n = time.length;
    const now = levelNowIndex();
    if (now == null || now < 0) {
      box.innerHTML = '<p class="muted">Kh\xF4ng x\xE1c \u0111\u1ECBnh \u0111\u01B0\u1EE3c gi\u1EDD hi\u1EC7n t\u1EA1i trong chu\u1ED7i d\u1EEF li\u1EC7u.</p>';
      return;
    }
    const ids = Object.keys(levels.series);
    const t850 = levelMean(time, "temperature_850hPa");
    const thick = time.map((_, i) => E.thickness(
      levelMean(time, "geopotential_height_500hPa")[i],
      levelMean(time, "geopotential_height_850hPa")[i]
    ));
    const rh850 = levelMean(time, "relative_humidity_850hPa");
    const dir850 = levelMean(time, "wind_direction_850hPa");
    const spd850 = levelMean(time, "wind_speed_850hPa");
    const baseFrom = Math.max(0, now - 72);
    const past = t850.slice(baseFrom, now).filter(E.finite);
    const tBase = E.meanS(past);
    const thPast = thick.slice(baseFrom, now).filter(E.finite);
    const thBase = E.meanS(thPast);
    const am = E.airMass({
      t850: t850[now],
      t850Baseline: tBase,
      thick: thick[now],
      thickBaseline: thBase,
      rh850: rh850[now],
      source: dir850[now]
    });
    const next24 = { t850: t850.slice(now, now + 24), thick: thick.slice(now, now + 24) };
    const dT24 = E.finite(t850[now]) ? E.meanS(next24.t850.filter(E.finite)) - t850[now] : null;
    const perModel = ids.map((id) => {
      const col = levelSeries(id, "temperature_850hPa", time);
      const z5 = levelSeries(id, "geopotential_height_500hPa", time);
      const z8 = levelSeries(id, "geopotential_height_850hPa", time);
      const th = E.thickness(z5[now], z8[now]);
      return { id, t850: col[now], th, tag: E.airMass({ t850: col[now], t850Baseline: tBase, thick: th, thickBaseline: thBase, rh850: levelSeries(id, "relative_humidity_850hPa", time)[now], source: levelSeries(id, "wind_direction_850hPa", time)[now] }) };
    });
    const votes = {};
    for (const p of perModel) if (p.tag) votes[p.tag.tag] = (votes[p.tag.tag] || 0) + 1;
    const agree = Object.entries(votes).sort((a, b) => b[1] - a[1])[0] || ["\u2014", 0];
    const spreadT = Math.sqrt(E.varS(perModel.map((p) => p.t850).filter(E.finite))) || 0;
    const front = E.frontalPassage({ dir850: dir850.slice(0, now + 1), t850: t850.slice(0, now + 1), hoursBack: 12 });
    const tagClass = am ? { cold: "cold", warm: "warm", cool: "cool", mild: "mild", neutral: "neutral" }[am.tone] : "neutral";
    box.innerHTML = `<div class="mass-head">
       <div><span class="small">PH\xC2N LO\u1EA0I KH\u1ED0I KH\xD4NG</span>
         <div class="mass-tag ${tagClass}">${am ? am.tag : "\u2014"}</div></div>
       <div class="mass-consensus"><strong>${agree[1]}/${ids.length}</strong><span class="small">h\u1EC7 th\u1ED1ng \u0111\u1ED3ng \xFD</span></div>
     </div>
     <div class="metric-grid compact" style="margin:14px 0 0">
       <div class="metric"><span class="small">Nhi\u1EC7t \u0111\u1ED9 850 hPa</span><strong>${E.finite(t850[now]) ? fmt(t850[now], 1) : "\u2014"}<em>\xB0C</em></strong>
         <span class="small">${E.finite(t850[now] - tBase) ? (t850[now] - tBase >= 0 ? "+" : "") + fmt(t850[now] - tBase, 1) + "\xB0 so v\u1EDBi 7 ng\xE0y qua" : "\u2014"}</span></div>
       <div class="metric"><span class="small">\u0110\u1ED9 d\xE0y c\u1ED9t 500\u2013850</span><strong>${E.finite(thick[now]) ? fmt(thick[now] / 100, 1) : "\u2014"}<em>\u0111\u1EA1m</em></strong>
         <span class="small">${E.finite(thick[now] - thBase) ? (thick[now] - thBase >= 0 ? "+" : "") + fmt(thick[now] - thBase, 0) + " m so v\u1EDBi 7 ng\xE0y qua" : "\u2014"}</span></div>
       <div class="metric"><span class="small">Gi\xF3 850 hPa</span><strong>${E.finite(dir850[now]) ? fmt(dir850[now], 0) + "<em>\xB0</em>" : "\u2014"}</strong>
         <span class="small">${E.finite(dir850[now]) ? "t\u1EEB ph\xEDa " + compass(dir850[now]) + (am?.advection ? " \xB7 " + am.advection : "") : "\u2014"}</span></div>
       <div class="metric"><span class="small">\u0110\u1ED9 \u1EA9m 850 hPa</span><strong>${E.finite(rh850[now]) ? fmt(rh850[now], 0) + "<em>%</em>" : "\u2014"}</strong>
         <span class="small">${am?.moisture || "\u2014"}</span></div>
     </div><p class="small" style="margin-top:12px">${ids.length ? "\u0110\u1ED9 l\u1EC7ch gi\u1EEFa " + ids.length + " h\u1EC7 th\u1ED1ng \u1EDF 850 hPa: <strong>" + fmt(spreadT, 2) + "\xB0C</strong>. " : ""}` + (front ? `Phat hien <strong>${front.kind.toLowerCase()}</strong>: gio 850 hPa xoay ${fmt(front.windShift, 0)}\xB0 so voi 12 gio truoc, nhiet do thay doi ${fmt(front.dT, 1)}\xB0C.` : "Kh\xF4ng ph\xE1t hi\u1EC7n m\u1EB7t l\u1EA1nh hay m\u1EB7t \u1EA5m trong 12 gi\u1EDD v\u1EEBa r\u1ED3i.") + ` \u0110\u1ED9 d\xE0y c\u1ED9t l\xE0 \u0111\u1EA1i l\u01B0\u1EE3ng ph\u1ED5 th\xF4ng cho nhi\u1EC7t \u0111\u1ED9 c\u0103n b\u1EA3n c\u1EE7a c\u1ED9t kh\xF4ng kh\xED: th\u1EA5p h\u01A1n l\xE0 l\u1EA1nh h\u01A1n, cao h\u01A1n l\xE0 n\xF3ng h\u01A1n.</p>`;
  }
  function renderTrajectory() {
    const host = $("trajectory");
    if (!host) return;
    if (!levels) {
      host.innerHTML = '<p class="muted">Ch\u01B0a c\xF3 d\u1EEF li\u1EC7u m\u1EE9c \xE1p l\u1EF1c.</p>';
      return;
    }
    const time = levels.time;
    const n = time.length;
    const now = levelNowIndex();
    if (now == null || now < 0) {
      host.innerHTML = '<p class="muted">Kh\xF4ng x\xE1c \u0111\u1ECBnh \u0111\u01B0\u1EE3c gi\u1EDD hi\u1EC7n t\u1EA1i.</p>';
      return;
    }
    const ids = Object.keys(levels.series);
    if (!ids.length) {
      host.innerHTML = '<p class="muted">Kh\xF4ng c\xF3 h\u1EC7 th\u1ED1ng n\xE0o tr\u1EA3 d\u1EEF li\u1EC7u.</p>';
      return;
    }
    const backH = Math.min(24, now);
    const fwdH = Math.min(48, n - 1 - now);
    const runs = ids.map((id) => {
      const spd = levelSeries(id, "wind_speed_850hPa", time);
      const dir = levelSeries(id, "wind_direction_850hPa", time);
      const uB = [], vB = [], uF = [], vF = [];
      for (let h = backH; h >= 1; h--) {
        const w = E.toUms(spd[now - h], dir[now - h]);
        uB.push(w.u);
        vB.push(w.v);
      }
      for (let h = 0; h < fwdH; h++) {
        const w = E.toUms(spd[now + h], dir[now + h]);
        uF.push(w.u);
        vF.push(w.v);
      }
      return {
        id,
        back: E.trajectory({ lat: place.lat, lon: place.lon, u: uB, v: vB, hours: backH, stepKm: 20, sign: -1 }),
        fwd: E.trajectory({ lat: place.lat, lon: place.lon, u: uF, v: vF, hours: fwdH, stepKm: 20, sign: 1 })
      };
    }).filter((r) => r.back.length > 2 && r.fwd.length > 2);
    if (!runs.length) {
      host.innerHTML = '<p class="muted">D\u1EEF li\u1EC7u gi\xF3 850 hPa kh\xF4ng \u0111\u1EE7 \u0111\u1EC3 v\u1EBD \u0111\u01B0\u1EDDng \u0111i.</p>';
      return;
    }
    const pts = [];
    for (const r of runs) {
      pts.push(...r.back.slice(1), ...r.fwd.slice(1));
    }
    const lats = pts.map((p) => p.lat), lons = pts.map((p) => p.lon);
    let lat0 = Math.min(...lats);
    let lat1 = Math.max(...lats);
    let lon0 = Math.min(...lons), lon1 = Math.max(...lons);
    if (lon1 - lon0 < 2) {
      lon0 -= 1;
      lon1 += 1;
    }
    if (lat1 - lat0 < 2) {
      lat0 -= 1;
      lat1 += 1;
    }
    const W = 640, H = 420, PAD = 26;
    const sx = (lon) => PAD + (lon - lon0) / (lon1 - lon0) * (W - PAD * 2);
    const sy = (lat) => PAD + (lat1 - lat) / (lat1 - lat0) * (H - PAD * 2);
    const path = (legs) => legs.map((p, i) => (i ? "L" : "M") + sx(p.lon).toFixed(1) + " " + sy(p.lat).toFixed(1)).join(" ");
    const backEnds = runs.map((r) => r.back[r.back.length - 1]);
    const srcKm = E.meanS(backEnds.map((p) => E.distanceKm(place, p))) || 0;
    const srcBearing = E.bearingDeg(place, backEnds[0]);
    const svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Qu\u1EA1t \u0111\u01B0\u1EDDng \u0111i kh\u1ED1i kh\xF4ng \u1EDF 850 hPa">
    <rect x="0" y="0" width="${W}" height="${H}" fill="#eef3f7"/>
    ${[0.25, 0.5, 0.75].map((f) => `<line x1="${PAD}" y1="${PAD + f * (H - PAD * 2)}" x2="${W - PAD}" y2="${PAD + f * (H - PAD * 2)}" stroke="#cfdbe4"/>`).join("")}
    ${[0.25, 0.5, 0.75].map((f) => `<line x1="${PAD + f * (W - PAD * 2)}" y1="${PAD}" x2="${PAD + f * (W - PAD * 2)}" y2="${H - PAD}" stroke="#cfdbe4"/>`).join("")}
    ${runs.map((r, i) => `<path d="${path(r.fwd)}" fill="none" stroke="#c0392b" stroke-width="1.3" opacity="${0.25 + 0.5 * (i + 1) / runs.length}"/>
      <path d="${path(r.back)}" fill="none" stroke="#2a5f96" stroke-width="1.3" stroke-dasharray="4 3" opacity="${0.25 + 0.5 * (i + 1) / runs.length}"/>`).join("")}
    <circle cx="${sx(place.lon)}" cy="${sy(place.lat)}" r="5" fill="#101f2d" stroke="#fff" stroke-width="2"/>
    <text x="${PAD + 4}" y="${PAD + 14}" class="tvb">H\u01B0\u1EDBng tuy\u1EBFn t\u1EDBi</text>
    <text x="${PAD + 4}" y="${PAD + 30}" class="tvb">\u0111i\u1EC3m quan s\xE1t</text>
  </svg>`;
    host.innerHTML = svg + `<div class="legend"><span><i style="background:#c0392b"></i>\u0111i t\u1EDBi (t\u1ED1i \u0111a ${fwdH} gi\u1EDD)</span><span><i style="background:#2a5f96"></i>\u0111i t\u1EEB (t\u1ED1i \u0111a ${backH} gi\u1EDD)</span><span>${runs.length} h\u1EC7 th\u1ED1ng v\u1EBD ch\u1ED3ng nhau; \u0111\u1ED9 r\u1ED9ng qu\u1EA1t l\xE0 m\u1EE9c b\u1EA5t \u0111\u1ED3ng</span></div>`;
    $("trajNote").innerHTML = `Kh\u1ED1i kh\xF4ng kh\xED n\u01A1i b\u1EA1n \u0111ang x\xE9t, \u1EDF t\u1EA7ng 850 hPa (kho\u1EA3ng 1,5 km), v\u1EC1 t\u1EEB ph\xEDa <strong>${compass(srcBearing)}</strong> c\xE1ch \u0111i\u1EC3m quan s\xE1t kho\u1EA3ng <strong>${fmt(srcKm, 0)} km</strong> trong ${backH} gi\u1EDD tr\u01B0\u1EDBc. B\u1EA3n \u0111\u1ED3 l\xE0 h\xECnh chi\u1EBFu th\u1EB3ng, d\xF9ng gi\xF3 theo gi\u1EDD c\u1EE7a t\u1EEBng m\xF4 h\xECnh n\xEAn \u0111\u1ED9 r\u1ED9ng qu\u1EA1t ch\xEDnh l\xE0 m\u1EE9c b\u1EA5t \u0111\u1ED3ng gi\u1EEFa c\xE1c h\u1EC7 th\u1ED1ng.`;
  }
  async function pLimit(items, limit, worker) {
    const out = new Array(items.length);
    let next = 0;
    const runners = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
      while (next < items.length) {
        const i = next++;
        try {
          out[i] = await worker(items[i], i);
        } catch {
          out[i] = null;
        }
      }
    });
    await Promise.all(runners);
    return out;
  }
  var RIVER_RADIUS_KM = 10;
  var RIVER_DEG = RIVER_RADIUS_KM / 111.2;
  var RIVER_STEP = 5 / 111.2;
  var floodCellKey = (c) => c.lat.toFixed(3) + "," + c.lon.toFixed(3);
  async function scanRiverCells() {
    const offs = [];
    for (let k = -2; k <= 2; k++) offs.push(k * RIVER_STEP);
    const jobs = [];
    for (const dy of offs) for (const dx of offs) jobs.push({ lat: place.lat + dy, lon: place.lon + dx });
    const seen = await pLimit(jobs, 6, async (p) => {
      const u = new URLSearchParams({
        latitude: p.lat.toFixed(4),
        longitude: p.lon.toFixed(4),
        daily: "river_discharge",
        forecast_days: 1
      });
      const j = await api("https://flood-api.open-meteo.com/v1/flood", u);
      const q = j.daily?.river_discharge || [];
      if (!q.some((v) => E.finite(v) && v > 0)) return null;
      return { lat: j.latitude, lon: j.longitude };
    });
    const byCell = /* @__PURE__ */ new Map();
    for (const c of seen) {
      if (!c) continue;
      const km = E.distanceKm(place, c);
      if (km > RIVER_RADIUS_KM) continue;
      byCell.set(floodCellKey(c), { cell: c, km: E.round(km, 1) });
    }
    return [...byCell.values()].sort((a, b) => a.km - b.km);
  }
  async function fetchRiverSeries(entry) {
    const u = new URLSearchParams({
      latitude: entry.cell.lat.toFixed(4),
      longitude: entry.cell.lon.toFixed(4),
      daily: "river_discharge,river_discharge_median,river_discharge_p25,river_discharge_p75",
      past_days: 365,
      forecast_days: 7
    });
    const j = await api("https://flood-api.open-meteo.com/v1/flood", u);
    const time = j.daily.time || [];
    const q = j.daily.river_discharge || [];
    const median = j.daily.river_discharge_median || [];
    const p25 = j.daily.river_discharge_p25 || [];
    const p75 = j.daily.river_discharge_p75 || [];
    const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    let iToday = time.lastIndexOf(today);
    if (iToday < 0) iToday = time.findIndex((t) => t >= today);
    if (iToday < 0 || iToday >= time.length || !E.finite(q[iToday])) return null;
    return {
      ...entry,
      time,
      q,
      median,
      p25,
      p75,
      iToday,
      qToday: q[iToday],
      qMedianToday: E.finite(median[iToday]) ? median[iToday] : q[iToday],
      p25Today: p25[iToday],
      p75Today: p75[iToday],
      // Lịch sử: mọi ngày trước hôm nay có số liệu.
      history: q.slice(0, iToday).filter((v) => E.finite(v)),
      forecast: q.slice(iToday).filter((v) => E.finite(v))
    };
  }
  async function fetchRivers() {
    const cells = await scanRiverCells();
    if (!cells.length) return [];
    const out = await pLimit(cells, 3, (entry) => fetchRiverSeries(entry));
    const merged = mergeDuplicateRivers(out.filter(Boolean).sort((a, b) => a.km - b.km));
    let biggest = null;
    for (const r of merged) {
      const v = r.qMedianToday;
      if (E.finite(v) && (!biggest || v > biggest.v)) biggest = { v, km: r.km };
    }
    return merged.map((r) => ({
      ...r,
      isLargest: !!biggest && Math.abs(r.km - biggest.km) < 0.05,
      levels: E.floodLevels({
        history: r.history,
        qNow: r.qMedianToday,
        qForecast: r.forecast.slice(1),
        rating: ratingFor(r.qMedianToday)
      })
    }));
  }
  function mergeDuplicateRivers(list) {
    const out = [];
    for (const r of list) {
      const prev = out.find((o) => sameRiver(o, r));
      if (!prev) {
        out.push({ ...r, mergedCells: 1 });
        continue;
      }
      prev.mergedCells = (prev.mergedCells || 1) + 1;
      prev.mergedKm = [...prev.mergedKm || [], r.km];
    }
    return out;
  }
  function sameRiver(a, b) {
    if (Math.abs(a.km - b.km) > 12) return false;
    const n = Math.min(a.history.length, b.history.length);
    if (n < 30) return false;
    const A = a.history.slice(-n), B = b.history.slice(-n);
    let same = 0, seen = 0;
    for (let i = 0; i < n; i++) {
      if (!E.finite(A[i]) || !E.finite(B[i])) continue;
      seen++;
      const tol = Math.max(0.05, 0.05 * Math.abs(A[i]));
      if (Math.abs(A[i] - B[i]) <= tol) same++;
    }
    return seen >= 30 && same / seen > 0.7;
  }
  function riverRiskOf(r) {
    const recentWindow = (r.history || []).slice(-30);
    const recent = E.meanS(recentWindow);
    return E.riverRisk({
      q: r.qMedianToday ?? r.qToday,
      qP25: r.p25Today,
      qP75: r.p75Today,
      recent
    });
  }
  function riverAlert(r) {
    const L2 = r.levels;
    if (!L2) return null;
    const now = L2.now;
    const peak = L2.peakBand;
    return { level: now, peak, outranked: !!(peak && (!now || peak.level > now.level)) };
  }
  function renderRivers() {
    const box = $("riverList");
    if (!box) return;
    if (!rivers) {
      box.innerHTML = '<p class="muted">\u0110ang t\u1EA3i l\u01B0u l\u01B0\u1EE3ng s\xF4ng\u2026</p>';
      return;
    }
    if (!rivers.length) {
      box.innerHTML = `<p class="muted">Kh\xF4ng c\xF3 \xF4 l\u01B0\u1EDBi GloFAS n\xE0o c\xF3 s\xF4ng trong b\xE1n k\xEDnh ${RIVER_RADIUS_KM} km. C\xE1c v\xF9ng ven bi\u1EC3n ph\u1EB3ng th\u01B0\u1EDDng r\u01A1i v\xE0o t\xECnh hu\u1ED1ng n\xE0y v\xEC GloFAS ch\u1EC9 m\xF4 t\u1EA3 l\u01B0u l\u01B0\u1EE3ng tr\xEAn d\xF2ng s\xF4ng c\xF3 \u0111\u1EE7 l\u01B0u l\u01B0\u1EE3ng \u0111\u1EC3 ghi nh\u1EADn.</p>`;
      return;
    }
    if (riverSel >= rivers.length) riverSel = 0;
    box.innerHTML = rivers.map((r, i) => {
      const k = riverRiskOf(r);
      const a = riverAlert(r);
      const tone = !k ? "" : k.vsRecent >= 0.25 ? "high" : k.vsRecent <= -0.25 ? "low" : "";
      const rt = ratingFor(k?.q);
      const H = E.nominalStage(k?.q, rt.a, rt.b, rt.q0);
      return `<button class="river-card${i === riverSel ? " selected" : ""}" data-river="${i}">
      <span class="river-top"><strong>${fmt(r.km, 1)} km</strong><span class="small">${r.isLargest ? "s\xF4ng l\u1EDBn nh\u1EA5t \xB7 " : ""}${compass(E.bearingDeg(place, r.cell))}</span></span>
      <span class="river-q">${k ? fmt(k.q, 1) : "\u2014"}<em> m\xB3/s</em></span>
      <span class="river-h${a?.level ? " lv " + a.level.tone : ""}">${E.finite(H) ? fmt(H, 2) : "\u2014"}<em> m quy \u01B0\u1EDBc</em></span>
      <span class="river-bar"><i style="width:${Math.max(4, Math.min(100, k ? k.vsRecent * 100 + 50 : 50))}%" class="${tone}"></i></span>
      ${a?.level ? `<span class="warn-chip ${a.level.tone}">${a.level.label}</span>` : '<span class="small">d\u01B0\u1EDBi ng\u01B0\u1EE1ng tham chi\u1EBFu</span>'}
      <span class="small">${k && E.finite(k.vsRecent) ? (k.vsRecent >= 0 ? "+" : "") + fmt(k.vsRecent * 100, 0) + "% so v\u1EDBi TB 30 ng\xE0y" : "\u2014"}</span>
    </button>`;
    }).join("");
    box.querySelectorAll("[data-river]").forEach((b) => {
      b.onclick = () => {
        riverSel = +b.dataset.river;
        renderRivers();
      };
    });
    renderRiverChart();
  }
  var RIVER_CHART_DAYS = 120;
  function renderRiverChart() {
    const host = $("riverChart");
    if (!host) return;
    if (!rivers || !rivers.length) {
      host.innerHTML = '<p class="muted">Ch\u1ECDn m\u1ED9t con s\xF4ng.</p>';
      return;
    }
    const r = rivers[riverSel];
    const today = r.iToday ?? 0;
    const lo = Math.max(0, today - RIVER_CHART_DAYS);
    const hi = r.q.length - 1;
    const n = hi - lo + 1;
    if (n < 2) {
      host.innerHTML = '<p class="muted">Kh\xF4ng \u0111\u1EE7 s\u1ED1 li\u1EC7u \u0111\u1EC3 v\u1EBD.</p>';
      return;
    }
    const series = (i) => r.median?.[i] != null && E.finite(r.median[i]) ? r.median[i] : r.q[i];
    const vals = [];
    for (let i = lo; i <= hi; i++) {
      for (const c of [series, r.p25, r.p75]) if (E.finite(c?.[i])) vals.push(c[i]);
    }
    for (const t of r.levels?.thresholds || []) if (E.finite(t.q)) vals.push(t.q);
    if (!vals.length) {
      host.innerHTML = '<p class="muted">Kh\xF4ng c\xF3 s\u1ED1 li\u1EC7u.</p>';
      return;
    }
    const vmax = Math.max(...vals) * 1.1 || 1;
    const W = 720, H = 280, PAD = 46, PB = 46;
    const sx = (i) => PAD + (i - lo) / (hi - lo) * (W - PAD * 2);
    const sy = (v) => H - PB - v / vmax * (H - PAD - PB);
    const at = (i) => r.time[i];
    const band = (i) => {
      const a = r.p25?.[i], b = r.p75?.[i];
      return E.finite(a) && E.finite(b) ? `<rect x="${(sx(i) - (W - PAD * 2) / (hi - lo) / 2).toFixed(1)}" y="${sy(b).toFixed(1)}" width="${Math.max(1, (W - PAD * 2) / (hi - lo)).toFixed(1)}" height="${Math.max(1, sy(a) - sy(b)).toFixed(1)}" fill="#2a5f96" opacity=".16"/>` : "";
    };
    const path = (from, to) => {
      let d = "", pen = false;
      for (let i = from; i <= to; i++) {
        const v = series(i);
        if (!E.finite(v)) {
          pen = false;
          continue;
        }
        d += (pen ? "L" : "M") + sx(i).toFixed(1) + " " + sy(v).toFixed(1) + " ";
        pen = true;
      }
      return d;
    };
    const hist = path(lo, today), fc = path(today, hi);
    const ticks = [];
    for (let i = lo; i <= hi; i += 14) ticks.push(`<text x="${sx(i).toFixed(1)}" y="${H - 14}" class="tvb" text-anchor="middle">${String(at(i)).slice(5, 7)}/${String(at(i)).slice(8, 10)}</text>`);
    const cut = today > lo ? `<line x1="${sx(today).toFixed(1)}" y1="${PAD}" x2="${sx(today).toFixed(1)}" y2="${H - PB}" stroke="#b54ae0" stroke-dasharray="4 3"/><text x="${(sx(today) + 5).toFixed(1)}" y="${PAD + 12}" class="tvb">nay</text>` : "";
    const levels2 = (r.levels?.thresholds || []).filter((t) => E.finite(t.q)).map((t) => `<line x1="${PAD}" y1="${sy(t.q).toFixed(1)}" x2="${W - PAD}" y2="${sy(t.q).toFixed(1)}" stroke="${LEVEL_COLOR[t.tone]}" stroke-width="1" stroke-dasharray="2 4" opacity=".85"/>
     <text x="${W - PAD - 4}" y="${(sy(t.q) - 4).toFixed(1)}" class="tvb" text-anchor="end" fill="${LEVEL_COLOR[t.tone]}">${t.label} ${fmt(t.q, 0)} m\xB3/s</text>`).join("");
    host.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Hydrograph">
    <line x1="${PAD}" y1="${H - PB}" x2="${W - PAD}" y2="${H - PB}" stroke="#c7d2dc"/>
    ${[0.25, 0.5, 0.75, 1].map((f) => `<text x="${PAD - 6}" y="${sy(vmax * f) + 4}" class="tvb" text-anchor="end">${fmt(vmax * f, 0)}</text>`).join("")}
    ${Array.from({ length: n }, (_, i) => band(lo + i)).join("")}
    ${levels2}${cut}
    <path d="${hist}" fill="none" stroke="#2a5f96" stroke-width="2"/>
    <path d="${fc}" fill="none" stroke="#2a5f96" stroke-width="2" stroke-dasharray="5 4"/>
    ${ticks.join("")}</svg>
    <p class="small">\u0110\u01B0\u1EDDng \u0111\u1EADm l\xE0 l\u01B0u l\u01B0\u1EE3ng trung v\u1ECB quan s\xE1t, \u0111\u01B0\u1EDDng \u0111\u1EE9t l\xE0 7 ng\xE0y d\u1EF1 b\xE1o; d\u1EA3i xanh nh\u1EA1t l\xE0 kho\u1EA3ng p25\u2013p75 c\u1EE7a b\u1ED9 th\xE0nh vi\xEAn t\u1ED5 h\u1EE3p GloFAS, ph\u1EA3n \xE1nh m\u1EE9c ch\u1EAFc ch\u1EAFn c\u1EE7a d\xF2ng ch\u1EA3y ch\u1EE9 kh\xF4ng ph\u1EA3i m\u1EF1c n\u01B0\u1EDBc t\xEDnh b\u1EB1ng m\xE9t. C\xE1c \u0111\u01B0\u1EDDng ngang l\xE0 ng\u01B0\u1EE1ng <strong>tham chi\u1EBFu</strong> l\u1EA5y t\u1EEB ph\xE2n v\u1ECB l\u1ECBch s\u1EED 12 th\xE1ng c\u1EE7a ch\xEDnh tuy\u1EBFn n\xE0y, kh\xF4ng ph\u1EA3i b\xE1o \u0111\u1ED9ng ch\xEDnh th\u1EE9c. Ngu\u1ED3n: Global Flood Awareness System (GloFAS v4) qua Open-Meteo.</p>`;
  }
  var STORM = (() => {
    try {
      const el = document.getElementById("lightning-data");
      return JSON.parse(el ? el.textContent : "{}");
    } catch {
      return {};
    }
  })();
  var STORM_FIELDS = "cape,lifted_index,convective_inhibition";
  var STORM_LEVELS = {
    low: { name: "Th\u1EA5p", cls: "low", note: "d\u01B0\u1EDBi trung v\u1ECB c\u1EE7a 12 th\xE1ng t\u1EA1i \u0111\xE2y" },
    p50: { name: "Trung b\xECnh", cls: "low", note: "t\u1EEB trung v\u1ECB 12 th\xE1ng tr\u1EDF l\xEAn" },
    p80: { name: "Kh\xE1", cls: "mid", note: "v\u01B0\u1EE3t 80% s\u1ED1 gi\u1EDD trong 12 th\xE1ng" },
    p95: { name: "Cao", cls: "high", note: "v\u01B0\u1EE3t 95% s\u1ED1 gi\u1EDD trong 12 th\xE1ng" },
    p99: { name: "R\u1EA5t cao", cls: "severe", note: "v\u01B0\u1EE3t 99% s\u1ED1 gi\u1EDD trong 12 th\xE1ng" }
  };
  var PLACE_COORDS = {
    hcm: [10.8231, 106.6297],
    hanoi: [21.0285, 105.8542],
    daklak: [12.6675, 108.0378],
    songcau: [13.4556, 109.2235],
    danang: [16.0544, 108.2022],
    dalat: [11.9469, 108.4583],
    cantho: [10.0452, 105.7469],
    nhatrang: [12.2395, 109.196]
  };
  function stormReference() {
    if (!STORM.locations) return null;
    let best = null, bestD = Infinity;
    for (const [id, loc] of Object.entries(STORM.locations)) {
      const c = PLACE_COORDS[id];
      if (!c || !loc.bands) continue;
      const d = E.distanceKm(place, { lat: c[0], lon: c[1] });
      if (d < bestD) {
        bestD = d;
        best = { id, loc, km: E.round(d, 0) };
      }
    }
    return best;
  }
  function stormIndexOf(cape, li, cin) {
    return E.lightningIndex({ cape, liftedIndex: li, convectiveInhibition: cin });
  }
  function stormLevel(risk, bands) {
    const id = E.lightningLevel(risk, bands);
    return id ? { id, ...STORM_LEVELS[id] } : null;
  }
  function stormSkillSentence() {
    const m = STORM.medianContrast, f = STORM.medianContrastFull || {};
    if (!m || m.ratio == null) return "S\u1ED1 li\u1EC7u ki\u1EC3m ch\u1EE9ng ch\u01B0a c\xF3 trong b\u1EA3n d\u1EF1ng n\xE0y.";
    const pct2 = (v) => v == null ? "\u2014" : Math.round(v * 100) + "%";
    const full = f.ratio == null ? "" : " Ch\u1EC9 d\xF9ng GFS \u2014 m\xF4 h\xECnh duy nh\u1EA5t c\xF3 \u0111\u1EE7 ba th\xE0nh ph\u1EA7n n\xEAn c\xF9ng thang \u0111o \u2014 \u0111\u1ED9 n\xE2ng c\xF2n " + f.ratio + " l\u1EA7n";
    return "Nh\xF3m 20% gi\u1EDD c\xF3 \u0111i\u1EC3m cao nh\u1EA5t c\xF3 m\u01B0a \u1EDF " + pct2(m.highRate) + " s\u1ED1 gi\u1EDD so v\u1EDBi " + pct2(m.lowRate) + " \u1EDF nh\xF3m c\xF2n l\u1EA1i (" + m.locationsWithGain + "/" + m.locationsTotal + " \u0111\u1ECBa \u0111i\u1EC3m c\xF3 l\u1EE3i)." + full + " Nh\u01B0ng \u0111i\u1EC3m k\u1EF9 n\u0103ng BSS so v\u1EDBi kh\xED quy\u1EBFt \u0111\u1ECBnh ch\u1EC9 quanh 0, t\u1EE9c n\xF3 KH\xD4NG th\u1EEBa k\u1EF9 thu\u1EADt trong vi\u1EC7c d\u1EF1 b\xE1o m\u1ED9t ng\u01B0\u1EE1ng m\u01B0a c\u1EE5 th\u1EC3.";
  }
  var stormToken = 0;
  async function loadStorm() {
    const box = $("stormBox");
    if (!box) return;
    const token = ++stormToken;
    if (STORM.stub || !STORM.locations || !Object.keys(STORM.locations).length) {
      box.innerHTML = '<p class="small">Ch\u01B0a c\xF3 d\u1EEF li\u1EC7u ki\u1EC3m ch\u1EE9ng cho ch\u1EC9 s\u1ED1 n\xE0y. Ch\u1EA1y <code>node ltbench.mjs</code> r\u1ED3i d\u1EF1ng l\u1EA1i trang.</p>';
      const m = $("stormMeta");
      if (m) m.textContent = "\u2014";
      return;
    }
    box.innerHTML = '<p class="muted">\u0110ang t\u1EA3i CAPE, lifted index v\xE0 CIN\u2026</p>';
    try {
      const u = new URLSearchParams({
        latitude: String(place.lat),
        longitude: String(place.lon),
        hourly: STORM_FIELDS,
        forecast_days: "2",
        timezone: "Asia/Ho_Chi_Minh"
      });
      const j = await api("https://api.open-meteo.com/v1/forecast", u);
      if (token !== stormToken) return;
      const h = j.hourly;
      const nowKey = new Date(Date.now() + 7 * 36e5).toISOString().slice(0, 13);
      const start = Math.max(0, h.time.findIndex((t) => t.slice(0, 13) >= nowKey));
      const hours = h.time.length - start;
      const rows = [];
      for (let i = start; i < h.time.length; i++) {
        const idx = stormIndexOf(h.cape[i], h.lifted_index ? h.lifted_index[i] : null, h.convective_inhibition ? h.convective_inhibition[i] : null);
        if (idx) rows.push({ t: h.time[i], risk: idx.risk, cape: h.cape[i], li: h.lifted_index ? h.lifted_index[i] : null, cin: h.convective_inhibition ? h.convective_inhibition[i] : null, parts: idx.ingredients.length });
      }
      if (!rows.length) {
        box.innerHTML = '<p class="small">M\xF4 h\xECnh kh\xF4ng tr\u1EA3 CAPE cho \u0111i\u1EC3m n\xE0y trong 36 gi\u1EDD t\u1EDBi.</p>';
        return;
      }
      renderStorm(rows.slice(0, 36));
    } catch (e) {
      if (token !== stormToken) return;
      box.innerHTML = '<p class="small">Kh\xF4ng l\u1EA5y \u0111\u01B0\u1EE3c d\u1EEF li\u1EC7u \u0111\u1ED1i l\u01B0u: ' + esc(e.message) + "</p>";
    }
  }
  function renderStorm(rows) {
    const box = $("stormBox");
    const ref = stormReference();
    const bands = ref ? ref.loc.bands : null;
    const hours = rows.length;
    const peak = rows.reduce((a, b) => b.risk > a.risk ? b : a, rows[0]);
    const windows = stormWindows(rows, bands);
    const parts = rows.reduce((acc, r) => acc + r.parts, 0) / hours;
    const ingredients = parts >= 2.99 ? "CAPE + lifted index + CIN" : parts >= 1.99 ? "CAPE + m\u1ED9t th\xE0nh ph\u1EA7n ph\u1EE5" : "ch\u1EC9 CAPE (m\xF4 h\xECnh kh\xF4ng c\xF3 LI/CIN)";
    let skill = "";
    if (ref) {
      const v = ref.loc.verify && ref.loc.verify[5];
      const c = ref.loc.contrast;
      const rho = v && v.rollingYear ? v.rollingYear.spearman : null;
      skill = `<p class="small">\u1EDE <strong>${esc(ref.loc.name)}</strong> \u2014 \u0111i\u1EC3m \u0111\xE3 ki\u1EC3m ch\u1EE9ng g\u1EA7n nh\u1EA5t \u2014 nh\xF3m 20% gi\u1EDD c\xF3 ch\u1EC9 s\u1ED1 cao nh\u1EA5t c\xF3 m\u01B0a \u1EDF
      <strong>${c.high.rate == null ? "\u2014" : Math.round(c.high.rate * 100) + "%"}</strong> s\u1ED1 gi\u1EDD so v\u1EDBi
      <strong>${c.low.rate == null ? "\u2014" : Math.round(c.low.rate * 100) + "%"}</strong> \u1EDF nh\xF3m c\xF2n l\u1EA1i
      ${c.ratio ? `<strong> (g\u1EA5p ${c.ratio})</strong>` : ""},
      h\u1EC7 s\u1ED1 th\u1EE9 h\u1EA1ng \u03C1 = <strong>${rho == null ? "\u2014" : rho.toFixed(2)}</strong>.
      \u0110\xE2y l\xE0 nh\u1EEFng con s\u1ED1 \u0111o \u0111\u01B0\u1EE3c tr\xEAn 12 th\xE1ng d\u1EEF li\u1EC7u, kh\xF4ng ph\u1EA3i \u01B0\u1EDBc l\u01B0\u1EE3ng su\xF4ng.</p>
      <p class="small">Nh\u01B0ng \u0111i\u1EC3m ph\u1EA3i n\xF3i th\u1EB3ng: v\u1EDBi ng\u01B0\u1EE1ng m\u01B0a \u22655 mm/gi\u1EDD, \u0111i\u1EC3m k\u1EF9 n\u0103ng BSS c\u1EE7a ch\u1EC9 s\u1ED1 ch\u1EC9 quanh
      <strong>${v && v.rollingYear ? v.rollingYear.bss.toFixed(3) : "\u2014"}</strong>, t\u1EE9c
      <strong>kh\xF4ng nh\u1EC9nh h\u01A1n kh\xED quy\u1EBFt \u0111\u1ECBnh</strong>. Ch\u1EC9 s\u1ED1 x\u1EBFp h\u1EA1ng c\xE1c gi\u1EDD \u0111\u01B0\u1EE3c kh\xE1; n\xF3 kh\xF4ng ph\u1EA3i m\u1ED9t d\u1EF1 b\xE1o
      x\xE1c su\u1EA5t \u0111\xE1ng tin cho m\u1ED9t ng\u01B0\u1EE1ng m\u01B0a c\u1EE5 th\u1EC3.</p>`;
    }
    const bars = stormBars(rows, bands);
    box.innerHTML = `
    <div class="storm-top">
      <div><p class="eyebrow">36 GI\u1EDC T\u1EDAI \xB7 \u0110\u1EC8NH</p>
        <p class="storm-peak">${esc(fmtHour(peak.t))}</p>
        <p class="small muted">ch\u1EC9 s\u1ED1 ${peak.risk.toFixed(2)} \xB7 CAPE ${Math.round(peak.cape)} J/kg</p></div>
      <div><p class="eyebrow">TH\xC0NH PH\u1EA6N \u0110\xC3 D\xD9NG</p>
        <p class="small">${esc(ingredients)}</p>
        <p class="tiny muted">Thi\u1EBFu th\xE0nh ph\u1EA7n th\xEC ph\u1EA7n \u0111\xF3 b\u1ECB b\u1ECF qua v\xE0 tr\u1ECDng s\u1ED1 \u0111\u01B0\u1EE3c chu\u1EA9n ho\xE1 l\u1EA1i, kh\xF4ng b\u1ECB coi l\xE0 0.</p></div>
    </div>
    <div class="storm-chart">${bars}</div>
    ${windows.length ? `<p class="small"><strong>Khung gi\u1EDD n\u1ED5i b\u1EADt:</strong> ${windows.map((w) => `${esc(fmtHour(w.t0))}\u2013${esc(fmtHour(w.t1))}`).join(" \xB7 ")}</p>` : `<p class="small">${stormHoursText(rows, bands)}</p>`}
    ${skill}`;
    const m = $("stormMeta");
    if (m) m.textContent = `${hours} gi\u1EDD \xB7 ${ingredients}`;
    const lim = $("stormLimits");
    if (lim && STORM.limits && STORM.limits.length) {
      lim.innerHTML = "<strong>Gi\u1EDBi h\u1EA1n \u0111\xE3 bi\u1EBFt:</strong><br>" + STORM.limits.map((l) => "\xB7 " + esc(l)).join("<br>");
    }
  }
  function stormHoursText(rows, bands) {
    const cut = bands ? bands.p80 : 0.55;
    const n = rows.filter((r) => r.risk >= cut).length;
    if (!n) return "Kh\xF4ng gi\u1EDD n\xE0o trong 36 gi\u1EDD t\u1EDBi ch\u1EA1m m\u1EE9c <em>" + (bands ? STORM_LEVELS.p80.name.toLowerCase() : "kh\xE1") + "</em>.";
    return `C\xF3 ${n}/${rows.length} gi\u1EDD ch\u1EA1m m\u1EE9c ${bands ? STORM_LEVELS.p80.name.toLowerCase() : "kh\xE1"} tr\u1EDF l\xEAn, nh\u01B0ng r\u1EA3i r\xE1c n\xEAn kh\xF4ng c\xF3 khung li\xEAn ti\u1EBFp n\xE0o \u0111\u1EE7 d\xE0i \u0111\u1EC3 g\u1ECDi l\xE0 khung.`;
  }
  function fmtHour(iso) {
    const d = /* @__PURE__ */ new Date(iso + ":00+07:00");
    return d.toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  }
  function stormWindows(rows, bands) {
    const cut = bands ? bands.p80 : 0.55;
    const runs = [];
    let from = -1;
    for (let i = 0; i <= rows.length; i++) {
      const hot = i < rows.length && rows[i].risk >= cut;
      if (hot && from < 0) from = i;
      if (!hot && from >= 0) {
        runs.push([from, i - 1]);
        from = -1;
      }
    }
    const MAX = 12;
    const out = [];
    for (const [a, b] of runs) {
      if (b - a < 1) continue;
      for (let k = a; k <= b; k += MAX) {
        const e = Math.min(b, k + MAX - 1);
        out.push({ t0: rows[k].t, t1: rows[e].t });
      }
    }
    return out.slice(0, 4);
  }
  function stormBars(rows, bands) {
    const marks = bands ? [bands.p50, bands.p80, bands.p95, bands.p99] : [0.5, 0.7, 0.85, 0.95];
    const out = rows.map((r) => {
      const lv = stormLevel(r.risk, bands);
      const t = Math.max(0, Math.min(1, r.risk));
      return `<i class="storm-bar ${lv ? lv.cls : ""}" style="height:${(14 + t * 34).toFixed(0)}%" title="${esc(fmtHour(r.t))}: ch\u1EC9 s\u1ED1 ${r.risk.toFixed(2)}${lv ? " \xB7 " + lv.name : ""}"></i>`;
    }).join("");
    return out + '<p class="tiny muted">C\u1ED9t cao l\xE0 gi\u1EDD c\xF3 ch\u1EC9 s\u1ED1 cao; m\xE0u theo m\u1EE9c: xanh l\xE1 l\xE0 d\u01B0\u1EDBi p80, v\xE0ng l\xE0 p80\u2013p95, cam l\xE0 p95\u2013p99, t\xEDm l\xE0 tr\xEAn p99 c\u1EE7a 12 th\xE1ng t\u1EA1i \u0111i\u1EC3m tham chi\u1EBFu' + (marks.length ? ` (l\u1EA7n l\u01B0\u1EE3t ${marks.map((m) => m.toFixed(2)).join(" / ")})` : "") + ".</p>";
  }
  async function loadAirMassAndRivers() {
    const token = ++levelsToken;
    levels = null;
    rivers = null;
    const massBox = $("airMassBox"), riverBox = $("riverList");
    if (massBox) massBox.innerHTML = '<p class="muted">\u0110ang t\u1EA3i tr\u01B0\u1EDDng m\u1EE9c \xE1p l\u1EF1c 850/500 hPa\u2026</p>';
    if (riverBox) riverBox.innerHTML = '<p class="muted">\u0110ang qu\xE9t l\u01B0u l\u01B0\u1EE3ng c\xE1c s\xF4ng quanh \u0111\xE2y\u2026</p>';
    const notes = [];
    try {
      levels = await fetchLevels();
      if (token !== levelsToken) return;
      renderAirMass();
      renderTrajectory();
    } catch (e) {
      notes.push("Kh\xF4ng l\u1EA5y \u0111\u01B0\u1EE3c tr\u01B0\u1EDDng m\u1EE9c \xE1p l\u1EF1c: " + esc(e.message));
      if (massBox) massBox.innerHTML = '<p class="small">Kh\xF4ng l\u1EA5y \u0111\u01B0\u1EE3c tr\u01B0\u1EDDng m\u1EE9c \xE1p l\u1EF1c: ' + esc(e.message) + "</p>";
    }
    const rTok = token;
    fetchRivers().then(async (r) => {
      if (rTok !== levelsToken) return;
      rivers = r;
      renderRivers();
      renderRiverLevels();
      await fetchRiverNames(rivers);
      if (rTok !== levelsToken) return;
      renderRiverLevels();
    }).catch(() => {
      if (riverBox) riverBox.innerHTML = '<p class="small">Kh\xF4ng l\u1EA5y \u0111\u01B0\u1EE3c d\u1EEF li\u1EC7u s\xF4ng.</p>';
    });
    const tn = $("massMeta");
    if (tn) tn.textContent = notes.length ? notes.join(" ") : levels ? `${levels.time.length} gi\u1EDD \xB7 7 h\u1EC7 th\u1ED1ng` : "\u2014";
    loadStorm().catch(() => {
    });
  }
  var geoBusy = false;
  function initGeo() {
    const btn = $("geoBtn");
    if (btn) btn.onclick = () => useDeviceLocation(false);
  }
  async function fetchIpLocation() {
    try {
      const r = await fetch("https://api.bigdatacloud.net/data/reverse-geocode-client?localityLanguage=vi", { signal: timeoutSignal(1e4) });
      if (r.ok) {
        const j = await r.json();
        if (E.finite(j.latitude) && E.finite(j.longitude)) {
          const parts = [j.city || j.locality, j.principalSubdivision].filter(Boolean);
          const name = [...new Set(parts.filter((p) => p && !parts.some((q) => q !== p && q.includes(p))))].slice(0, 2).join(", ");
          return { lat: +Number(j.latitude).toFixed(4), lon: +Number(j.longitude).toFixed(4), name: name || j.countryName || null };
        }
      }
    } catch (_e) {
    }
    try {
      const r = await fetch("https://ipwho.is/?lang=vi", { signal: timeoutSignal(1e4) });
      if (r.ok) {
        const j = await r.json();
        if (j.success !== false && E.finite(j.latitude) && E.finite(j.longitude)) {
          const name = [j.city, j.region].filter(Boolean).join(", ");
          return { lat: +Number(j.latitude).toFixed(4), lon: +Number(j.longitude).toFixed(4), name: name || j.country || null };
        }
      }
    } catch (_e) {
    }
    try {
      const r = await fetch("https://get.geojs.io/v1/ip/geo.json", { signal: timeoutSignal(1e4) });
      if (r.ok) {
        const j = await r.json();
        const lat = parseFloat(j.latitude), lon = parseFloat(j.longitude);
        if (E.finite(lat) && E.finite(lon)) {
          const name = [j.city, j.region].filter(Boolean).join(", ");
          return { lat: +lat.toFixed(4), lon: +lon.toFixed(4), name: name || j.country || null };
        }
      }
    } catch (_e) {
    }
    return null;
  }
  function useDeviceLocation(isAuto = false) {
    const btn = $("geoBtn");
    const note = $("geoNote");
    if (geoBusy) return;
    geoBusy = true;
    if (btn) btn.disabled = true;
    if (note && !isAuto) note.textContent = "\u0110ang x\xE1c \u0111\u1ECBnh v\u1ECB tr\xED c\u1EE7a b\u1EA1n\u2026";
    const done = (msg) => {
      geoBusy = false;
      if (btn) btn.disabled = false;
      if (note && msg) note.textContent = msg;
    };
    const fallbackToIp = async (whyGps) => {
      const ipLoc = await fetchIpLocation();
      if (ipLoc && E.finite(ipLoc.lat) && E.finite(ipLoc.lon)) {
        const name = ipLoc.name || await reverseGeocode(ipLoc.lat, ipLoc.lon) || "V\u1ECB tr\xED c\u1EE7a t\xF4i";
        place = { id: "gps", name, lat: ipLoc.lat, lon: ipLoc.lon, utcOffset: 7, fromGps: true };
        done("\u0110\xE3 l\u1EA5y v\u1ECB tr\xED theo m\u1EA1ng" + (name ? ": " + name : "") + (whyGps ? " (do GPS: " + whyGps + ")." : "."));
        loadForecast();
        return;
      }
      if (isAuto) {
        done("");
      } else {
        done("Kh\xF4ng l\u1EA5y \u0111\u01B0\u1EE3c v\u1ECB tr\xED (" + (whyGps || "kh\xF4ng ph\u1EA3n h\u1ED3i") + "). V\u1ECB tr\xED \u0111ang xem gi\u1EEF nguy\xEAn.");
      }
    };
    if (!navigator.geolocation) {
      fallbackToIp("thi\u1EBFt b\u1ECB kh\xF4ng h\u1ED7 tr\u1EE3 GPS");
      return;
    }
    if (!window.isSecureContext) {
      fallbackToIp("trang kh\xF4ng m\u1EDF qua HTTPS");
      return;
    }
    navigator.geolocation.getCurrentPosition(async (pos) => {
      const lat = +pos.coords.latitude.toFixed(4), lon = +pos.coords.longitude.toFixed(4);
      const name = await reverseGeocode(lat, lon);
      place = { id: "gps", name: name || "V\u1ECB tr\xED c\u1EE7a t\xF4i", lat, lon, utcOffset: 7, fromGps: true };
      done("\u0110\xE3 d\xF9ng v\u1ECB tr\xED thi\u1EBFt b\u1ECB" + (name ? ": " + name : "") + ". Ch\u1ECDn l\u1EA1i \u0111\u1ECBa \u0111i\u1EC3m kh\xE1c s\u1EBD t\u1EAFt ch\u1EBF \u0111\u1ED9 n\xE0y.");
      loadForecast();
    }, (err) => {
      const why = { 1: "quy\u1EC1n v\u1ECB tr\xED b\u1ECB t\u1EEB ch\u1ED1i", 2: "kh\xF4ng l\u1EA5y \u0111\u01B0\u1EE3c t\xEDn hi\u1EC7u GPS", 3: "h\u1EBFt th\u1EDDi gian ch\u1EDD GPS" }[err.code] || "kh\xF4ng r\xF5 nguy\xEAn nh\xE2n";
      if (isAuto && err.code === 1) {
        done("");
        return;
      }
      fallbackToIp(why);
    }, { enableHighAccuracy: false, timeout: 1e4, maximumAge: 3e5 });
  }
  async function reverseGeocode(lat, lon) {
    try {
      const r = await fetch("https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=" + lat + "&longitude=" + lon + "&localityLanguage=vi", { signal: timeoutSignal(1e4) });
      if (r.ok) {
        const j = await r.json();
        const parts = [j.city || j.locality, j.principalSubdivision].filter(Boolean);
        const name = [...new Set(parts.filter((p) => p && !parts.some((q) => q !== p && q.includes(p))))].slice(0, 2).join(", ");
        if (name || j.countryName) return name || j.countryName;
      }
    } catch (_e) {
    }
    try {
      const r = await fetch("https://nominatim.openstreetmap.org/reverse?" + new URLSearchParams({
        lat: String(lat),
        lon: String(lon),
        format: "jsonv2",
        "accept-language": "vi"
      }), { signal: timeoutSignal(1e4), headers: { Accept: "application/json" } });
      if (r.ok) {
        const j = await r.json();
        const a = j.address || {};
        const parts = [a.suburb || a.village || a.town || a.city_district || a.city, a.state || a.county].filter(Boolean);
        if (parts.length) return parts.slice(0, 2).join(", ");
      }
    } catch (_e) {
    }
    return null;
  }
  var airGrid = null;
  var airLayer = null;
  var GRID_VARS = [
    "temperature_850hPa",
    "geopotential_height_850hPa",
    "geopotential_height_500hPa",
    "relative_humidity_850hPa",
    "wind_speed_850hPa",
    "wind_direction_850hPa"
  ];
  async function fetchAirGrid() {
    const stepKm = 100, radiusKm = 500, n = Math.ceil(radiusKm / stepKm);
    const pts = [];
    for (let iy = -n; iy <= n; iy++) {
      for (let ix = -n; ix <= n; ix++) {
        const dx = ix * stepKm, dy = iy * stepKm;
        if (Math.hypot(dx, dy) > radiusKm) continue;
        pts.push(E.offsetLatLon(place.lat, place.lon, dx, dy));
      }
    }
    const u = new URLSearchParams({
      latitude: pts.map((p) => p.lat.toFixed(3)).join(","),
      longitude: pts.map((p) => p.lon.toFixed(3)).join(","),
      hourly: GRID_VARS.join(","),
      // Tối ưu hóa: Thay vì lấy cả 7 mô hình (tốn 7x dung lượng và API request),
      // bản đồ khối khí diện rộng chỉ cần 1 mô hình ECMWF là đủ chính xác.
      models: "ecmwf_ifs025",
      past_days: 2,
      forecast_days: 1,
      timezone: "auto"
    });
    const j = await api("https://api.open-meteo.com/v1/forecast", Object.fromEntries(u.entries()));
    const list = Array.isArray(j) ? j : [j];
    if (list.length < pts.length) throw new Error("ch\u1EC9 nh\u1EADn " + list.length + "/" + pts.length + " \u0111i\u1EC3m");
    const nowIdx = (arr) => {
      const off = (arr.utc_offset_seconds || 25200) * 1e3;
      const iso = new Date(Date.now() + off).toISOString().slice(0, 13) + ":00";
      const t = arr.hourly.time || [];
      const i = t.indexOf(iso);
      if (i >= 0) return i;
      const now = new Date(Date.now() + off).getTime();
      let best = 0, gap = Infinity;
      t.forEach((x, k) => {
        const g2 = Math.abs((/* @__PURE__ */ new Date(x + "Z")).getTime() - now);
        if (g2 < gap) {
          gap = g2;
          best = k;
        }
      });
      return best;
    };
    const values = list.map((a, k) => {
      const h = a.hourly || {}, i = nowIdx(a);
      const pick = (base) => {
        const key = Object.keys(h).find(k => k === base || k.startsWith(base + '_'));
        if (key === void 0) return null;
        const col = h[key];
        const v = col ? col[i] : null;
        return E.finite(v) ? v : null;
      };
      return {
        lat: a.latitude ?? pts[k].lat,
        lon: a.longitude ?? pts[k].lon,
        t850: pick("temperature_850hPa"),
        z850: pick("geopotential_height_850hPa"),
        z500: pick("geopotential_height_500hPa"),
        rh850: pick("relative_humidity_850hPa"),
        wind: pick("wind_speed_850hPa"),
        dir: pick("wind_direction_850hPa")
      };
    });
    const g = E.airMassGrid({ lat: place.lat, lon: place.lon, radiusKm, stepKm, values });
    const good = g.cells.map((c, k) => ({ ...c, ...values[k], thick: E.thickness(values[k].z500, values[k].z850) })).filter((c) => E.finite(c.t850) && E.finite(c.thick));
    const tMean = E.meanS(good.map((c) => c.t850)), thMean = E.meanS(good.map((c) => c.thick));
    const cells = good.map((c) => E.classifyCell(c, { t850: tMean, thick: thMean }, c.dir));
    return { cells, mean: { t850: tMean, thick: thMean }, radiusKm, stepKm };
  }
  var MASS_COLORS = {
    cold: "#2a5f96",
    cool: "#6fa3cc",
    neutral: "#8494a2",
    mild: "#d69a4a",
    warm: "#c0392b"
  };
  var MASS_LABELS = [
    ["cold", "L\u1EA1nh h\u01A1n v\xF9ng"],
    ["cool", "H\u01A1i l\u1EA1nh h\u01A1n v\xF9ng"],
    ["neutral", "\xD4n h\xF2a"],
    ["mild", "H\u01A1i n\xF3ng h\u01A1n v\xF9ng"],
    ["warm", "N\xF3ng h\u01A1n v\xF9ng"]
  ];
  function drawAirMassOverlay() {
    if (!airGrid || !radarMap || !airLayer) return;
    airLayer.clearLayers();
    const lat0 = place.lat, lon0 = place.lon;
    for (const c of airGrid.cells) {
      const dLat = (c.lat - lat0) * 111.32;
      const dLon = (c.lon - lon0) * 111.32 * Math.max(0.15, Math.cos(lat0 * Math.PI / 180));
      const cs = airGrid.stepKm * 0.95;
      const pts = [];
      for (let a = 0; a < 12; a++) {
        const ang = a * Math.PI / 6;
        const p = E.offsetLatLon(c.lat, c.lon, Math.cos(ang) * cs, Math.sin(ang) * cs);
        pts.push([p.lat, p.lon]);
      }
      const label = "<strong>" + (c.tag || "\u2014") + "</strong><br>" + fmt(c.t850, 1) + " \xB0C \u1EDF 850 hPa<br>l\u1EC7ch " + (c.dT > 0 ? "+" : "") + fmt(c.dT, 1) + " \xB0C so v\u1EDBi trung b\xECnh v\xF9ng<br>\u0111\u1ED9 d\xE0y c\u1ED9t " + fmt(c.thick, 0) + " m";
      L.polygon(pts, {
        color: MASS_COLORS[c.tone] || MASS_COLORS.neutral,
        weight: 0,
        fillOpacity: 0.72,
        stroke: false,
        interactive: false,
        className: "mass-blob"
      }).addTo(airLayer);
      L.marker([c.lat, c.lon], {
        interactive: false,
        opacity: 0,
        icon: L.divIcon({ className: "", iconSize: [1, 1] })
      }).bindTooltip(label, { permanent: false, direction: "top", className: "mass-tip" }).addTo(airLayer);
    }
    const nowIso = new Date(Date.now() + 25200 * 1e3).toISOString().slice(0, 13) + ":00";
    L.circle([lat0, lon0], {
      radius: E.round(airGrid.stepKm * 620, 0),
      color: "#101f2d",
      weight: 2,
      fill: false,
      dashArray: "6 5",
      interactive: false
    }).addTo(airLayer);
    if (nowIso && radarMap?.attributionControl) {
      radarMap.attributionControl.addAttribution("Kh\u1ED1i kh\xED: 850/500 hPa \xB7 m\u1ED1c hi\u1EC7n t\u1EA1i " + nowIso.slice(11, 13) + " gi\u1EDD \u0111\u1ECBa ph\u01B0\u01A1ng");
    }
  }
  function airMassLegendHtml() {
    return '<div class="radar-legend" aria-label="Ch\xFA gi\u1EA3i kh\u1ED1i kh\xED"><strong>Kh\u1ED1i kh\xED 850 hPa so v\u1EDBi trung b\xECnh v\xF9ng:</strong>' + MASS_LABELS.map(([k, label]) => '<span><i style="background:' + MASS_COLORS[k] + '"></i>' + label + "</span>").join("") + "</div>";
  }
  async function loadAirGrid() {
    const meta = $("airGridMeta"), host = $("airGridNote");
    if (meta) meta.textContent = "\u0111ang t\u1EA3i\u2026";
    try {
      airGrid = await fetchAirGrid();
      if (meta) meta.textContent = airGrid.cells.length + " \xF4 \xB7 b\xE1n k\xEDnh " + airGrid.radiusKm + " km \xB7 ECMWF IFS (\u0111\u1EA1i di\u1EC7n 7 h\u1EC7 th\u1ED1ng)";
      if (host) {
        const coldest = [...airGrid.cells].sort((a, b) => a.dT - b.dT)[0];
        const warmest = [...airGrid.cells].sort((a, b) => b.dT - a.dT)[0];
        host.innerHTML = "Trong v\xF9ng b\xE1n k\xEDnh " + airGrid.radiusKm + " km, nhi\u1EC7t \u0111\u1ED9 850 hPa dao \u0111\u1ED9ng " + fmt(coldest.dT, 1) + " \u0111\u1EBFn " + fmt(warmest.dT, 1) + " \xB0C so v\u1EDBi trung b\xECnh v\xF9ng. \xD4 l\u1EA1nh nh\u1EA5t \u1EDF " + fmt(coldest.km, 0) + " km v\u1EC1 ph\xEDa " + compass(E.bearingDeg(place, coldest)) + "; \xF4 n\xF3ng nh\u1EA5t \u1EDF " + fmt(warmest.km, 0) + " km v\u1EC1 ph\xEDa " + compass(E.bearingDeg(place, warmest)) + ". \u0110\u01B0\u1EDDng \u0111\u1EE9t \u0111en l\xE0 v\xF2ng c\xE1ch " + fmt(airGrid.stepKm, 0) + " km t\xEDnh t\u1EEB \u0111i\u1EC3m b\u1EA1n \u0111ang x\xE9t.";
      }
      const al0 = $("airLegend");
      if (al0) al0.innerHTML = airMassLegendHtml();
      drawAirMassOverlay();
      if (radarMap && airLayer && !radarMap.hasLayer(airLayer)) {
        airLayer.addTo(radarMap);
      }
      const tg = $("airGridToggle");
      if (tg) {
        tg.textContent = "T\u1EAFt kh\u1ED1i kh\xED tr\xEAn b\u1EA3n \u0111\u1ED3";
        tg.classList.remove("secondary");
        tg.classList.add("primary");
      }
      return true;
    } catch (e) {
      airGrid = null;
      const airGridError = e.message;
      if (meta) meta.textContent = "kh\xF4ng t\u1EA3i \u0111\u01B0\u1EE3c";
      if (host) host.textContent = "Kh\xF4ng l\u1EA5y \u0111\u01B0\u1EE3c l\u01B0\u1EDBi kh\u1ED1i kh\xED: " + esc(airGridError) + ". B\u1EA3n \u0111\u1ED3 v\u1EABn hi\u1EC3n th\u1ECB radar b\xECnh th\u01B0\u1EDDng.";
      return false;
    }
  }
  var NAME_MATCH_KM = 4;
  var osmToken = 0;
  async function fetchRiverNames(riverList) {
    const token = ++osmToken;
    const meta = $("riverNameMeta");
    const riverListMeta = $("riverMeta");
    if (meta) meta.textContent = "\u0111ang tra t\xEAn s\xF4ng\u2026";
    let done = 0;
    await pLimit(riverList, 1, async (r) => {
      if (token !== osmToken) return null;
      const found = [];
      let anyOk = false;
      for (const term of ["S\xF4ng", "R\u1EA1ch", "K\xEAnh"]) {
        try {
          const u = new URLSearchParams({
            q: term,
            lat: r.cell.lat.toFixed(4),
            lon: r.cell.lon.toFixed(4),
            limit: "50"
          });
          const res = await fetch("https://photon.komoot.io/api/?" + u, { signal: timeoutSignal(18e3) });
          if (!res.ok) continue;
          const j = await res.json();
          anyOk = true;
          for (const f of j.features || []) {
            const p = f.properties || {};
            if (p.osm_key !== "waterway") continue;
            if (!WATERWAY_VALUES.has(p.osm_value)) continue;
            const name = (p.name || "").trim();
            if (!name) continue;
            if (PLACEHOLDER_NAME.test(name)) continue;
            if (/\b(river|stream|canal|creek|waterway)\b/i.test(name)) continue;
            const c = f.geometry?.coordinates;
            const pt = Array.isArray(c) && Array.isArray(c[0]) ? c[0] : c;
            if (!Array.isArray(pt) || pt.length < 2) continue;
            const lon = pt[0], lat = pt[1];
            if (!E.finite(lat) || !E.finite(lon)) continue;
            const km = E.distanceKm(r.cell, { lat, lon });
            if (km > NAME_MATCH_KM) continue;
            found.push({ name, km });
          }
          if (found.some((f) => f.km <= 5)) break;
        } catch {
        }
      }
      r.nameFailed = !anyOk && !found.length;
      const seen = /* @__PURE__ */ new Set();
      const uniq = found.filter((f) => {
        const k = f.name.toLowerCase();
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      }).sort((a, b) => a.km - b.km);
      r.name = uniq[0]?.name || null;
      r.nameKm = uniq[0]?.km ?? null;
      r.nameOthers = uniq.slice(1, 3).map((u) => u.name);
      r.nameTried = true;
      done++;
      if (token === osmToken && meta) meta.textContent = "\u0111\xE3 tra " + done + "/" + riverList.length + " \xF4";
      await new Promise((res) => setTimeout(res, 400));
      if (token === osmToken && rivers && rivers.includes(r)) {
        renderRiverLevels();
        if (riverListMeta) riverListMeta.textContent = "\u0111ang tra t\xEAn " + done + "/" + riverList.length + "\u2026";
      }
      return r;
    });
    const byName = /* @__PURE__ */ new Map();
    for (const r of riverList) {
      if (!r.name) continue;
      const k = r.name.toLowerCase();
      const prev = byName.get(k);
      if (!prev || (r.nameKm ?? 1e9) < (prev.nameKm ?? 1e9)) byName.set(k, r);
    }
    for (const r of riverList) {
      if (!r.name) continue;
      const owner = byName.get(r.name.toLowerCase());
      if (owner && owner !== r) {
        r.duplicateOf = owner.km;
        r.name = null;
        r.nameOthers = [];
      }
    }
    if (token === osmToken && riverListMeta) riverListMeta.textContent = riverList.length + " \xF4 l\u01B0\u1EDBi \u0111\xE3 qu\xE9t";
    if (token === osmToken && meta) {
      const named = riverList.filter((r) => r.name).length;
      const failed = riverList.filter((r) => r.nameFailed).length;
      meta.textContent = failed ? named + "/" + riverList.length + " \xF4 c\xF3 t\xEAn \xB7 " + failed + " \xF4 kh\xF4ng tra \u0111\u01B0\u1EE3c (ngu\u1ED3n ch\u1EB7n y\xEAu c\u1EA7u)" : named ? named + "/" + riverList.length + " \xF4 c\xF3 t\xEAn trong OSM" : "OSM ch\u01B0a ghi t\xEAn cho c\xE1c \xF4 n\xE0y";
    }
  }
  var WATERWAY_VALUES = /* @__PURE__ */ new Set(["river", "stream", "canal", "ditch"]);
  var PLACEHOLDER_NAME = /^(Sông|Rạch|Kênh|Suối|Ao|Ruộng)\s*\d*$/i;
  var RATING = {
    river: { a: 2.02, b: 0.54, q0: 1e3, label: "tuy\u1EBFn s\xF4ng l\u1EDBn (tham kh\u1EA3o)", ref: 2 },
    channel: { a: 0.9, b: 0.5, q0: 10, label: "k\xEAnh/r\u1EA1ch nh\u1ECF (tham kh\u1EA3o)", ref: null }
  };
  function ratingFor(q) {
    return q >= 100 ? RATING.river : RATING.channel;
  }
  var LEVEL_COLOR = { low: "#2e8b57", mid: "#c9a227", high: "#e07b39", severe: "#c0392b" };
  function renderRiverLevels() {
    const host = $("riverLevels");
    if (!host) return;
    if (!rivers || !rivers.length) {
      host.innerHTML = '<p class="small">Ch\u01B0a c\xF3 d\u1EEF li\u1EC7u s\xF4ng.</p>';
      return;
    }
    const anyPending = rivers.some((r) => !r.nameTried);
    host.innerHTML = rivers.map((r, i) => {
      const k = riverRiskOf(r);
      if (!k) return "";
      const rt = ratingFor(k.q);
      const H = E.nominalStage(k.q, rt.a, rt.b, rt.q0);
      const p25H = E.nominalStage(k.p25, rt.a, rt.b, rt.q0);
      const p75H = E.nominalStage(k.p75, rt.a, rt.b, rt.q0);
      const L2 = r.levels;
      const idx24h = Math.min(r.q.length - 1, r.iToday + 1);
      const q24h = r.q[idx24h];
      const trend = E.finite(q24h) && E.finite(k.q) ? q24h > k.q + 0.1 ? "\u2191" : q24h < k.q - 0.1 ? "\u2193" : "\u2192" : "";
      const h24h = E.nominalStage(q24h, rt.a, rt.b, rt.q0);
      const name = r.name || (r.duplicateOf != null ? "c\xF9ng t\xEAn v\u1EDBi \xF4 c\xE1ch " + fmt(r.duplicateOf, 1) + " km" : r.nameFailed ? "Kh\xF4ng tra \u0111\u01B0\u1EE3c t\xEAn" : r.nameTried ? "Ch\u01B0a c\xF3 t\xEAn trong OSM" : "\u0111ang tra t\xEAn\u2026");
      const alertCell = !L2 ? '<span class="tiny">ch\u01B0a \u0111\u1EE7 l\u1ECBch s\u1EED</span>' : (L2.now ? `<span class="warn-chip ${L2.now.tone}">${L2.now.label}</span><br><span class="tiny">\u2265 ${fmt(L2.now.q, 1)} m\xB3/s</span>` : `<span class="tiny">d\u01B0\u1EDBi ng\u01B0\u1EE1ng</span><br><span class="tiny">c\u1EA7n ${fmt(L2.thresholds[0].q, 1)} m\xB3/s</span>`) + (L2.peakBand && (!L2.now || L2.peakBand.level > L2.now.level) ? `<br><span class="warn-chip ${L2.peakBand.tone}">7 ng\xE0y t\u1EDBi: ${L2.peakBand.label}</span>` : "");
      const pctCell = !L2 || !E.finite(L2.percent) ? '<span class="tiny">\u2014</span>' : `th\u1EE9 <strong>${L2.rankFromTop}</strong> / ${L2.n}<br><span class="tiny">TB ${fmt(L2.p50, 1)} \xB7 max ${fmt(L2.max, 1)} m\xB3/s</span>`;
      return "<tr" + (i === riverSel ? ' class="chosen"' : "") + ' data-river="' + i + '"><td><strong>' + esc(name) + "</strong>" + (r.nameOthers?.length ? '<br><span class="tiny">c\xF2n g\u1ECDi: ' + esc(r.nameOthers.join(", ")) + "</span>" : "") + '<br><span class="tiny">\xF4 l\u01B0\u1EDBi c\xE1ch b\u1EA1n ' + fmt(r.km, 1) + " km \xB7 " + compass(E.bearingDeg(place, r.cell)) + (r.nameKm != null ? " \xB7 t\xEAn \u0111\u01B0\u1EDDng n\u01B0\u1EDBc c\xE1ch \xF4 l\u01B0\u1EDBi " + fmt(r.nameKm, 1) + " km" : "") + (r.mergedCells > 1 ? '<br><span class="tiny">\xF4 l\u01B0\u1EDBi n\xE0y g\u1ED9p ' + r.mergedCells + " \xF4 GloFAS c\xF9ng d\xF2ng ch\u1EA3y (c\xE1ch th\xEAm: " + (r.mergedKm || []).map((x) => fmt(x, 1)).join(", ") + " km)</span>" : "") + "</span></td><td>" + fmt(k.q, 1) + '<span class="tiny"> m\xB3/s</span></td><td><strong class="lv">' + (E.finite(H) ? fmt(H, 2) : "\u2014") + " m</strong>" + (E.finite(p25H) && E.finite(p75H) ? '<br><span class="tiny">' + fmt(p25H, 2) + "\u2013" + fmt(p75H, 2) + " m</span>" : "") + '<br><span class="tiny">' + rt.label + "</span></td><td>" + pctCell + "</td><td>" + (E.finite(k.vsRecent) ? (k.vsRecent >= 0 ? "+" : "") + fmt(k.vsRecent * 100, 0) + "%" : "\u2014") + "</td><td>" + (E.finite(h24h) ? fmt(h24h, 2) + ' m <span class="tiny">' + trend + "</span>" : "\u2014") + "</td><td>" + alertCell + "</td></tr>";
    }).join("") + (anyPending ? '<tr><td colspan="7" class="muted tiny">\u0110ang tra t\xEAn s\xF4ng trong OSM cho c\xE1c \xF4 c\xF2n l\u1EA1i\u2026</td></tr>' : "");
    host.querySelectorAll("[data-river]").forEach((tr) => {
      tr.onclick = () => {
        riverSel = +tr.dataset.river;
        renderRivers();
        renderRiverLevels();
      };
    });
  }
  var aqiToken = 0;
  var AQI_BANDS = [
    { max: 50, label: "T\u1ED1t", color: "#27ae60", advice: "Ch\u1EA5t l\u01B0\u1EE3ng kh\xF4ng kh\xED t\u1ED1t. Sinh ho\u1EA1t ngo\xE0i tr\u1EDDi b\xECnh th\u01B0\u1EDDng." },
    { max: 100, label: "Trung b\xECnh", color: "#f1c40f", advice: "Ch\u1EA5p nh\u1EADn \u0111\u01B0\u1EE3c. Ng\u01B0\u1EDDi r\u1EA5t nh\u1EA1y c\u1EA3m n\xEAn h\u1EA1n ch\u1EBF v\u1EADn \u0111\u1ED9ng m\u1EA1nh k\xE9o d\xE0i ngo\xE0i tr\u1EDDi." },
    { max: 150, label: "K\xE9m cho nh\xF3m nh\u1EA1y c\u1EA3m", color: "#e67e22", advice: "Tr\u1EBB em, ng\u01B0\u1EDDi gi\xE0, ng\u01B0\u1EDDi b\u1EC7nh h\xF4 h\u1EA5p/tim m\u1EA1ch n\xEAn r\xFAt ng\u1EAFn ho\u1EA1t \u0111\u1ED9ng ngo\xE0i tr\u1EDDi, \u0111eo kh\u1EA9u trang khi ra \u0111\u01B0\u1EDDng \u0111\xF4ng." },
    { max: 200, label: "X\u1EA5u", color: "#c0392b", advice: "M\u1ECDi ng\u01B0\u1EDDi n\xEAn gi\u1EA3m v\u1EADn \u0111\u1ED9ng ngo\xE0i tr\u1EDDi k\xE9o d\xE0i; nh\xF3m nh\u1EA1y c\u1EA3m \u1EDF trong nh\xE0, \u0111\xF3ng c\u1EEDa, b\u1EADt l\u1ECDc kh\xED n\u1EBFu c\xF3." },
    { max: 300, label: "R\u1EA5t x\u1EA5u", color: "#8e44ad", advice: "Tr\xE1nh ra ngo\xE0i. N\u1EBFu b\u1EAFt bu\u1ED9c, \u0111eo kh\u1EA9u trang N95/KN95 v\xE0 r\xFAt ng\u1EAFn th\u1EDDi gian t\u1ED1i \u0111a." },
    { max: 1e9, label: "Nguy h\u1EA1i", color: "#7b241c", advice: "Kh\u1EA9n c\u1EA5p: \u1EDF trong nh\xE0, ni\xEAm k\xEDn c\u1EEDa, theo d\xF5i c\u1EA3nh b\xE1o ch\xEDnh th\u1EE9c." }
  ];
  var aqiBand = (v) => AQI_BANDS.find((b) => v <= b.max) || AQI_BANDS[AQI_BANDS.length - 1];
  async function loadAqi() {
    const token = ++aqiToken;
    const ref = { ...place };
    $("aqiNow").innerHTML = '<p class="muted">\u0110ang t\u1EA3i d\u1EEF li\u1EC7u kh\xF4ng kh\xED\u2026</p>';
    $("aqiStrip").innerHTML = "";
    $("aqiPollutants").innerHTML = "";
    $("aqiAdvice").textContent = "";
    $("aqiMeta").textContent = "\u0111ang t\u1EA3i\u2026";
    try {
      const j = await api("https://air-quality-api.open-meteo.com/v1/air-quality", {
        latitude: ref.lat,
        longitude: ref.lon,
        timezone: "auto",
        forecast_days: 3,
        current: "us_aqi,pm2_5,pm10,carbon_monoxide,nitrogen_dioxide,sulphur_dioxide,ozone",
        hourly: "us_aqi,pm2_5"
      });
      if (token !== aqiToken) return;
      const c = j.current || {};
      const aqi = c.us_aqi;
      if (!E.finite(aqi)) throw new Error("kh\xF4ng c\xF3 ch\u1EC9 s\u1ED1 AQI");
      const band = aqiBand(aqi);
      $("aqiMeta").textContent = "m\u1ED1c " + (c.time || "").replace("T", " ") + " \xB7 CAMS";
      $("aqiNow").innerHTML = `<div class="aqi-badge" style="background:${band.color}"><strong>${fmt(aqi, 0)}</strong><span>US AQI \xB7 ${esc(band.label)}</span></div><p class="small">B\u1EE5i m\u1ECBn PM2.5 hi\u1EC7n t\u1EA1i: <strong>${fmt(c.pm2_5, 1)} \xB5g/m\xB3</strong> (WHO khuy\u1EBFn ngh\u1ECB TB n\u0103m \u2264 5 \xB5g/m\xB3).</p>`;
      $("aqiAdvice").textContent = band.advice;
      const pol = [
        ["PM2.5", c.pm2_5, "\xB5g/m\xB3", "B\u1EE5i m\u1ECBn v\xE0o s\xE2u ph\u1ED5i"],
        ["PM10", c.pm10, "\xB5g/m\xB3", "B\u1EE5i th\xF4 \u0111\u01B0\u1EDDng h\xF4 h\u1EA5p"],
        ["O\u2083", c.ozone, "\xB5g/m\xB3", "\xD4-z\xF4n m\u1EB7t \u0111\u1EA5t"],
        ["NO\u2082", c.nitrogen_dioxide, "\xB5g/m\xB3", "Kh\xED giao th\xF4ng"],
        ["SO\u2082", c.sulphur_dioxide, "\xB5g/m\xB3", "Kh\xED c\xF4ng nghi\u1EC7p"],
        ["CO", c.carbon_monoxide, "\xB5g/m\xB3", "Kh\xED kh\xF4ng m\xE0u"]
      ];
      $("aqiPollutants").innerHTML = pol.map(([name, v, u, note]) => `<div class="pollutant"><span class="pollutant-name">${name}</span><strong>${E.finite(v) ? fmt(v, 1) : "\u2014"}</strong><span class="pollutant-u">${u} \xB7 ${note}</span></div>`).join("");
      const times = j.hourly?.time || [], vals = j.hourly?.us_aqi || [];
      $("aqiStrip").innerHTML = times.map((hh, i) => {
        const v = vals[i];
        if (!E.finite(v)) return "";
        const b = aqiBand(v);
        const d = new Date(hh.length <= 16 ? hh + ":00" : hh);
        const lab = d.toLocaleDateString("vi-VN", { weekday: "short" }) + " " + String(d.getHours()).padStart(2, "0") + "h";
        return `<div class="strip-cell" style="background:${b.color}22;border-top:3px solid ${b.color}" title="${lab}: AQI ${Math.round(v)} \xB7 ${b.label}"><span>${String(d.getHours()).padStart(2, "0")}h</span><strong>${Math.round(v)}</strong></div>`;
      }).join("");
    } catch (e) {
      if (token !== aqiToken) return;
      $("aqiNow").innerHTML = `<p class="muted">Kh\xF4ng t\u1EA3i \u0111\u01B0\u1EE3c d\u1EEF li\u1EC7u kh\xF4ng kh\xED: ${esc(e.message)}</p>`;
      $("aqiMeta").textContent = "l\u1ED7i t\u1EA3i";
    }
  }
  function calibratedSeries(variable, times, offsets) {
    const byId = live.byId;
    const ids = Object.keys(byId);
    const seriesMap = {};
    for (const id of ids) seriesMap[id] = seriesFor(byId[id], variable, times);
    const leads = report.leads;
    const nearestLead = (h) => leads.reduce((a, b) => Math.abs(b * 24 - h) < Math.abs(a * 24 - h) ? b : a, leads[0]);
    const out = new Array(times.length).fill(null);
    let uncalibrated = false;
    for (const lead of new Set(times.map((_, i) => nearestLead(offsets[i])))) {
      const idx = [];
      for (let i = 0; i < times.length; i++) if (nearestLead(offsets[i]) === lead) idx.push(i);
      if (!idx.length) continue;
      const subTimes = idx.map((i) => times[i]);
      const subSeries = {};
      for (const id of ids) subSeries[id] = idx.map((i) => seriesMap[id][i]);
      const kind = report.variables[variable].kind;
      const found = calibrationFor(variable, lead);
      const utcOffset = place.utcOffset ?? Math.round(place.lon / 15);
      if (kind === "direction") {
        const su = {}, sv = {};
        for (const id of Object.keys(live.byId)) {
          const sp = seriesFor(live.byId[id], "wind_speed_10m", times);
          const dr = seriesFor(live.byId[id], variable, times);
          const u = [], v = [];
          for (let i = 0; i < times.length; i++) {
            if (!E.finite(sp[i]) || !E.finite(dr[i])) {
              u.push(null);
              v.push(null);
              continue;
            }
            const r = dr[i] * Math.PI / 180;
            u.push(sp[i] * Math.cos(r));
            v.push(sp[i] * Math.sin(r));
          }
          su[id] = u;
          sv[id] = v;
        }
        const dir = E.calibrateDirection({ times, seriesU: su, seriesV: sv, calibration: found?.direction, utcOffset });
        if (dir) {
          for (let k = 0; k < idx.length; k++) out[idx[k]] = dir?.[idx[k]] || null;
        } else {
          for (let k = 0; k < idx.length; k++) {
            const i = idx[k];
            let su2 = 0, sv2 = 0, n = 0;
            for (const id of Object.keys(live.byId)) {
              const sp = seriesFor(live.byId[id], "wind_speed_10m", times)[i];
              const dr = seriesFor(live.byId[id], variable, times)[i];
              if (E.finite(sp) && E.finite(dr)) {
                const r = dr * Math.PI / 180;
                su2 += sp * Math.cos(r);
                sv2 += sp * Math.sin(r);
                n++;
              }
            }
            out[idx[k]] = n >= 2 ? { mean: Math.hypot(su2 / n, sv2 / n), median: Math.hypot(su2 / n, sv2 / n), dir: (Math.atan2(sv2 / n, su2 / n) * 180 / Math.PI + 360) % 360, nModels: n, uncalibrated: true } : null;
          }
          uncalibrated = true;
        }
        continue;
      }
      if (kind === "code") {
        if (!found?.regime) {
          const votes = rawMajorityCode(times);
          for (let k = 0; k < idx.length; k++) out[idx[k]] = votes[idx[k]];
          uncalibrated = true;
          continue;
        }
        const byVariable = {};
        for (const id of Object.keys(live.byId)) {
          byVariable[id] = {};
          for (const f of found?.regime?.fields || CODE_FALLBACK_FIELDS) {
            byVariable[id][f] = seriesFor(live.byId[id], f, times);
          }
        }
        const codes = E.calibrateCode({ times, series: byVariable, regime: found?.regime });
        for (let k = 0; k < idx.length; k++) out[idx[k]] = codes?.[k] ? { code: codes[k].code, nModels: codes[k].nModels, condition: codes[k].condition } : null;
        if (!codes) uncalibrated = true;
        continue;
      }
      if (!found) {
        uncalibrated = true;
        const flat = pooledPointForecast(variable, subSeries, subTimes);
        for (let k = 0; k < idx.length; k++) out[idx[k]] = flat[k];
        continue;
      }
      const crossSeries = {};
      for (const cv of found.calib.crossVars || []) {
        const cols = found.calib.modelIds.filter((id) => seriesMap[id]).map((id) => seriesFor(byId[id], cv, times));
        if (!cols.length) continue;
        const fwd = E.FORWARD[report.variables[cv].kind];
        const need = Math.max(2, Math.ceil(cols.length * 0.6));
        crossSeries[cv] = subTimes.map((_, k) => {
          let s = 0, c = 0;
          for (const col of cols) if (E.finite(col[idx[k]])) {
            s += fwd(col[idx[k]]);
            c++;
          }
          return c >= need ? s / c : null;
        });
      }
      const cal = E.calibrate({
        times: subTimes,
        variable,
        series: subSeries,
        calib: found.calib,
        cross: crossSeries,
        utcOffset
      });
      for (let k = 0; k < idx.length; k++) out[idx[k]] = cal ? cal[k] : null;
    }
    return { series: out, uncalibrated };
  }
  function calFor(variable) {
    if (calCache.has(variable)) return calCache.get(variable);
    const times = activeTimes(live.base);
    const offsets = forecastOffsetSeries(times);
    const value = calibratedSeries(variable, times, offsets);
    calCache.set(variable, value);
    return value;
  }
  function forecastOffsetSeries(times) {
    const tz = live.base.utc_offset_seconds ?? 0;
    const now = Date.now();
    const ref = (/* @__PURE__ */ new Date((live.base.current?.time || times[0]).replace(" ", "T") + "Z")).getTime();
    const base = E.finite(ref) ? ref : now;
    return times.map((t) => Math.max(0, (Date.parse(t + ":00Z") - base) / 36e5));
  }
  function renderForecast() {
    const b = live.base, c = b.current || {}, times = activeTimes(b);
    $("temp").textContent = fmt(c.temperature_2m);
    $("humidity").textContent = fmt(c.relative_humidity_2m, 0) + " %";
    $("wind").textContent = fmt(c.wind_speed_10m) + " km/h";
    $("feels").textContent = fmt(c.apparent_temperature) + " \xB0C";
    $("condition").textContent = (weatherFamily(c.weather_code) + "  " + condition(c.weather_code)).trim();
    const rain = calFor("precipitation").series;
    const gust = calFor("wind_gusts_10m").series;
    let sum = 0, n = 0, lo = null, hi = null;
    for (let i = 0; i < 24; i++) {
      const r = rain[i];
      if (!r) continue;
      sum += r.median;
      n++;
      lo = lo === null ? r.p10 : lo + r.p10;
      hi = hi === null ? r.p90 : hi + r.p90;
    }
    $("rain24").textContent = n ? fmt(sum, 1) : "\u2014";
    $("rainRange").textContent = n ? `${fmt(lo)} \u2192 ${fmt(hi)} mm \xB7 d\u1EA3i 10\u201390%` : "Kh\xF4ng \u0111\u1EE7 24 gi\u1EDD";
    $("daysTz").textContent = "M\xFAi gi\u1EDD: " + b.timezone;
    let peakP = 0, peakGust = 0;
    for (let i = 0; i < 24; i++) {
      const pr = rain[i];
      if (pr?.probs?.["10"] !== void 0) peakP = Math.max(peakP, pr.probs["10"]);
      const g = gust[i];
      if (g) peakGust = Math.max(peakGust, g.p90);
    }
    $("probHeavy").textContent = peakP > 0 ? pct(peakP, 0) : "\u2014";
    $("gustRisk").textContent = peakGust > 0 ? fmt(peakGust) + " km/h (90%)" : "\u2014";
    const heavy = rain.slice(0, 24).some((r) => r?.probs?.["10"] > 0.5) || sum >= 25 || peakGust >= 60;
    const official = nchmfBannerFor(place.id);
    const officialRed = official.some((w) => w.level === "red");
    const riskText = official.length ? `NCHMF c\u0169ng \u0111ang c\u1EA3nh b\xE1o v\xF9ng n\xE0y: ${official[0].title.slice(0, 150)}. ` : "";
    notice("riskMessage", riskText + (heavy ? "C\xF3 t\xEDn hi\u1EC7u v\u01B0\u1EE3t ng\u01B0\u1EE1ng m\u01B0a l\u1EDBn ho\u1EB7c gi\xF3 m\u1EA1nh trong 24 gi\u1EDD t\u1EDBi. Xem b\u1EA3n tin ch\xEDnh th\u1EE9c v\xE0 \u0111\u1ED1i chi\u1EBFu nhi\u1EC1u ngu\u1ED3n." : n ? "D\u1EA3i 10\u201390% kh\xF4ng v\u01B0\u1EE3t ng\u01B0\u1EE1ng tham kh\u1EA3o trong 24 gi\u1EDD t\u1EDBi. \u0110i\u1EC1u n\xE0y kh\xF4ng lo\u1EA1i tr\u1EEB m\u01B0a d\xF4ng c\u1EE5c b\u1ED9." : "Ch\u01B0a \u0111\u1EE7 d\u1EEF li\u1EC7u \u0111\u1EC3 \u0111\xE1nh gi\xE1 nguy c\u01A1."), heavy || officialRed || official.length ? "warning" : "");
    const found24 = calibrationFor("precipitation", 1);
    $("calibNote").textContent = found24 && !found24.pooled ? `Hi\u1EC7u ch\u1EC9nh theo ki\u1EC3m th\u1EED t\u1EA1i ${place.name}. M\u1ED7i gi\u1EDD k\xE8m d\u1EA3i 10\u201390%.` : "D\u1EF1 b\xE1o trung b\xECnh nhi\u1EC1u h\u1EC7 th\u1ED1ng; kh\xF4ng c\xF3 hi\u1EC7u ch\u1EC9nh ri\xEAng cho \u0111\u1ECBa \u0111i\u1EC3m n\xE0y.";
  }
  function renderParams() {
    const times = activeTimes(live.base);
    const at = Math.min(times.length - 1, 11);
    const cards = [];
    for (const v of LIVE_VARS) {
      const s = report.variables[v];
      const r = calFor(v).series[at];
      const kind = s.kind;
      if (kind === "direction") {
        cards.push(r ? `<button class="param" data-var="${v}"><span class="param-name">${esc(s.short)}</span><strong>${fmt(r.dir, 0)}<em>\xB0</em></strong><span class="param-range">${bearing(r.dir)}</span><span class="param-n">${r.nModels}/${MODELS.length} h\u1EC7 th\u1ED1ng${r.uncalibrated ? " \xB7 ch\u01B0a hi\u1EC7u ch\u1EC9nh" : ""}</span></button>` : `<div class="param is-empty"><span class="param-name">${esc(s.short)}</span><strong>\u2014</strong><span class="param-range">kh\xF4ng \u0111\u1EE7 h\u1EC7 th\u1ED1ng</span></div>`);
        continue;
      }
      if (kind === "code") {
        cards.push(r ? `<button class="param" data-var="${v}"><span class="param-name">${esc(s.short)}</span><strong>${weatherFamily(r.code)}</strong><span class="param-range">${esc(condition(r.code))}</span><span class="param-n">m\xE3 ${r.code} \xB7 ${r.nModels}/${MODELS.length} h\u1EC7 th\u1ED1ng${r.uncalibrated ? " \xB7 ch\u01B0a hi\u1EC7u ch\u1EC9nh" : ""}</span></button>` : `<div class="param is-empty"><span class="param-name">${esc(s.short)}</span><strong>\u2014</strong><span class="param-range">ngo\xE0i v\xF9ng \u0111\xE3 hi\u1EC7u ch\u1EC9nh</span></div>`);
        continue;
      }
      if (!r) {
        cards.push(`<div class="param is-empty"><span class="param-name">${esc(s.short)}</span><strong>\u2014</strong><span class="param-range">kh\xF4ng \u0111\u1EE7 h\u1EC7 th\u1ED1ng</span></div>`);
        continue;
      }
      const d = s.digits;
      cards.push(
        `<button class="param" data-var="${v}"><span class="param-name">${esc(s.short)}</span><strong>${fmt(r.median, d)}<em>${esc(s.unit)}</em></strong><span class="param-range">${fmt(r.p10, d)} \u2013 ${fmt(r.p90, d)}</span><span class="param-n">${r.nModels}/${MODELS.length} h\u1EC7 th\u1ED1ng${r.uncalibrated ? " \xB7 ch\u01B0a hi\u1EC7u ch\u1EC9nh" : ""}</span></button>`
      );
    }
    $("paramGrid").innerHTML = cards.join("");
    $("paramGrid").querySelectorAll("button").forEach((b) => {
      b.onclick = () => {
        $("chartVariable").value = b.dataset.var;
        renderChart();
        $("chart").scrollIntoView({ behavior: "smooth", block: "center" });
      };
    });
  }
  function renderDays() {
    const d = live.base.daily;
    $("days").innerHTML = d.time.map((day, i) => {
      const risky = (d.precipitation_sum[i] ?? 0) >= 25 || (d.wind_gusts_10m_max[i] ?? 0) >= 60;
      return `<div class="day${risky ? " alert" : ""}${selectedDay === day ? " selected" : ""}" data-day="${day}" role="button" tabindex="0" title="B\u1EA5m \u0111\u1EC3 xem chi ti\u1EBFt t\u1EEBng gi\u1EDD ng\xE0y ${day}"><strong>${(/* @__PURE__ */ new Date(day + "T12:00:00")).toLocaleDateString("vi-VN", { weekday: "short", day: "2-digit", month: "2-digit" })}</strong><div class="day-temp">${fmt(d.temperature_2m_max[i], 0)}\xB0 <s>${fmt(d.temperature_2m_min[i], 0)}\xB0</s></div><div class="rain-total">${fmt(d.precipitation_sum[i], 1)} mm</div><small>${weatherFamily(d.weather_code[i])} ${d.precipitation_probability_max[i] ?? "\u2014"}%</small></div>`;
    }).join("");
    $("days").querySelectorAll(".day[data-day]").forEach((el) => {
      const go = () => selectDay(el.dataset.day);
      el.onclick = go;
      el.onkeydown = (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          go();
        }
      };
    });
  }
  var selectedDay = null;
  var monthObs = {};
  var monthToken = 0;
  var viewYear = null;
  var viewMonth = null;
  function placeToday() {
    const off = live?.base?.utc_offset_seconds ?? 0;
    return new Date(Date.now() + off * 1e3).toISOString().slice(0, 10);
  }
  async function loadMonthCal(y, m) {
    const token = ++monthToken;
    const ref = { ...place };
    const today = placeToday();
    if (y === void 0 || m === void 0) {
      const [cy, cm] = today.split("-").map(Number);
      viewYear = cy;
      viewMonth = cm;
      monthObs = {};
    } else {
      viewYear = y;
      viewMonth = m;
    }
    const yy = viewYear, mm = viewMonth;
    const prefix = `${yy}-${String(mm).padStart(2, "0")}`;
    wireMonthNav();
    $("monthPicker").value = prefix;
    $("monthCal").innerHTML = '<p class="muted">\u0110ang t\u1EA3i l\u1ECBch th\xE1ng\u2026</p>';
    $("monthMeta").textContent = "\u0111ang t\u1EA3i\u2026";
    try {
      const monthStart = `${prefix}-01`;
      const monthEnd = new Date(Date.UTC(yy, mm, 0)).toISOString().slice(0, 10);
      const yest = new Date(Date.parse(today + "T00:00:00Z") - 864e5).toISOString().slice(0, 10);
      $("monthTitle").textContent = "Th\xE1ng " + mm + "/" + yy;
      const obsEnd = monthEnd < today ? monthEnd : monthStart <= yest ? yest : null;
      if (obsEnd && monthStart <= obsEnd) {
        try {
          const j = await api("https://archive-api.open-meteo.com/v1/archive", {
            latitude: ref.lat,
            longitude: ref.lon,
            start_date: monthStart,
            end_date: obsEnd,
            timezone: "auto",
            daily: "temperature_2m_max,temperature_2m_min,precipitation_sum"
          });
          if (token !== monthToken) return;
          (j.daily?.time || []).forEach((d, i) => {
            monthObs[d] = {
              tmax: j.daily.temperature_2m_max?.[i] ?? null,
              tmin: j.daily.temperature_2m_min?.[i] ?? null,
              psum: j.daily.precipitation_sum?.[i] ?? null
            };
          });
        } catch (err) {
          console.warn("L\u1ED7i t\u1EA3i ERA5 cho l\u1ECBch th\xE1ng, b\u1ECF qua quan tr\u1EAFc:", err.message);
        }
      }
      if (token !== monthToken) return;
      const fc = {};
      const dd = live.base.daily;
      dd.time.forEach((d, i) => {
        fc[d] = {
          tmax: dd.temperature_2m_max[i],
          tmin: dd.temperature_2m_min[i],
          psum: dd.precipitation_sum[i],
          prob: dd.precipitation_probability_max[i],
          gust: dd.wind_gusts_10m_max[i],
          code: dd.weather_code[i]
        };
      });
      const lastFc = dd.time[dd.time.length - 1];
      const firstDow = ((/* @__PURE__ */ new Date(monthStart + "T12:00:00")).getUTCDay() + 6) % 7;
      const dim = Number(monthEnd.slice(8, 10));
      let cells = "";
      for (let k = 0; k < firstDow; k++) cells += '<div class="mday empty"></div>';
      for (let day = 1; day <= dim; day++) {
        const iso = `${prefix}-${String(day).padStart(2, "0")}`;
        if (iso < today) {
          const o = monthObs[iso];
          cells += `<div class="mday past" data-day="${iso}"${o ? ` title="${iso}: cao nh\u1EA5t ${fmt(o.tmax, 1)}\xB0C, th\u1EA5p nh\u1EA5t ${fmt(o.tmin, 1)}\xB0C, t\u1ED5ng m\u01B0a ${fmt(o.psum, 1)} mm (ERA5)"` : ""}><span class="mday-n">${day}</span>` + // Nhiệt thấp và đơn vị "mm" là các span riêng: màn hình nhỏ bỏ chúng ra
          // để ô lịch không bị cắt chữ, màn lớn thì hiện như cũ.
          (o ? `<span class="mday-t">${fmt(o.tmax, 0)}\xB0<span class="mday-lo">/${fmt(o.tmin, 0)}\xB0</span></span><span class="mday-p">${fmt(o.psum, 1)}<span class="unit"> mm</span></span>` : '<span class="mday-p">ch\u01B0a c\xF3</span>') + "</div>";
        } else if (fc[iso]) {
          const f = fc[iso];
          const risky = (f.psum ?? 0) >= 25 || (f.gust ?? 0) >= 60;
          cells += `<div class="mday forecast${risky ? " alert" : ""}${selectedDay === iso ? " selected" : ""}" data-day="${iso}" role="button" tabindex="0" title="${iso}: cao nh\u1EA5t ${fmt(f.tmax, 0)}\xB0C, th\u1EA5p nh\u1EA5t ${fmt(f.tmin, 0)}\xB0C, m\u01B0a ${fmt(f.psum, 1)} mm, gi\u1EADt ${fmt(f.gust, 0)} km/h \u2014 b\u1EA5m \u0111\u1EC3 xem chi ti\u1EBFt"><span class="mday-n">${day}</span><span class="mday-t">${fmt(f.tmax, 0)}\xB0<span class="mday-lo">/${fmt(f.tmin, 0)}\xB0</span></span><span class="mday-p">${weatherFamily(f.code)} ${fmt(f.psum, 1)}<span class="unit"> mm</span></span></div>`;
        } else {
          cells += `<div class="mday out"><span class="mday-n">${day}</span><span class="mday-p">ngo\xE0i t\u1EA7m</span></div>`;
        }
      }
      $("monthCal").innerHTML = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"].map((w) => `<div class="mday head">${w}</div>`).join("") + cells;
      $("monthCal").querySelectorAll(".mday.forecast").forEach((el) => {
        const go = () => selectDay(el.dataset.day);
        el.onclick = go;
        el.onkeydown = (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            go();
          }
        };
      });
      $("monthCal").querySelectorAll(".mday.past").forEach((el) => {
        el.setAttribute("role", "button");
        el.setAttribute("tabindex", "0");
        el.title = el.title ? el.title + " \u2014 b\u1EA5m \u0111\u1EC3 xem chi ti\u1EBFt t\u1EEBng gi\u1EDD" : "B\u1EA5m \u0111\u1EC3 xem chi ti\u1EBFt t\u1EEBng gi\u1EDD";
        const go = () => selectDay(el.dataset.day);
        el.onclick = go;
        el.onkeydown = (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            go();
          }
        };
      });
      const mode = monthEnd < today ? "to\xE0n th\xE1ng l\xE0 quan tr\u1EAFc ERA5" : prefix === today.slice(0, 7) ? `d\u1EF1 b\xE1o t\u1EDBi ${lastFc} \xB7 ERA5 c\xE1c ng\xE0y \u0111\xE3 qua` : `d\u1EF1 b\xE1o t\u1EDBi ${lastFc} \xB7 ngo\xE0i t\u1EA7m cho h\u1EA7u h\u1EBFt th\xE1ng n\xE0y`;
      $("monthMeta").textContent = `${monthStart} \u2192 ${monthEnd} \xB7 ${mode}`;
    } catch (e) {
      if (token !== monthToken) return;
      $("monthCal").innerHTML = `<p class="muted">Kh\xF4ng t\u1EA3i \u0111\u01B0\u1EE3c l\u1ECBch th\xE1ng: ${esc(e.message)}</p>`;
      $("monthMeta").textContent = "l\u1ED7i t\u1EA3i";
    }
  }
  function wireMonthNav() {
    $("monthPrev").onclick = () => {
      let y = viewYear, m = viewMonth - 1;
      if (m < 1) {
        m = 12;
        y--;
      }
      loadMonthCal(y, m);
    };
    $("monthNext").onclick = () => {
      let y = viewYear, m = viewMonth + 1;
      if (m > 12) {
        m = 1;
        y++;
      }
      loadMonthCal(y, m);
    };
    $("monthPicker").onchange = () => {
      const v = $("monthPicker").value;
      if (/^\d{4}-\d{2}$/.test(v)) {
        const [y, m] = v.split("-").map(Number);
        if (m >= 1 && m <= 12) loadMonthCal(y, m);
      }
    };
  }
  function selectDay(iso) {
    selectedDay = iso;
    document.querySelectorAll(".mday.forecast.selected, .day.selected").forEach((el) => el.classList.remove("selected"));
    document.querySelectorAll(`.mday.forecast[data-day="${iso}"], .day[data-day="${iso}"]`).forEach((el) => el.classList.add("selected"));
    const label = (/* @__PURE__ */ new Date(iso + "T12:00:00")).toLocaleDateString("vi-VN", { weekday: "long", day: "2-digit", month: "2-digit", year: "numeric" });
    $("dayDetailTitle").textContent = label;
    const o = monthObs[iso];
    if (o && iso < placeToday()) {
      $("dayDetailMeta").textContent = "quan tr\u1EAFc ERA5 \xB7 \u0111\xE3 qua";
      $("dayDetail").innerHTML = `<div class="metric-grid compact"><div class="metric"><span class="small">Cao nh\u1EA5t</span><strong>${fmt(o.tmax, 1)} \xB0C</strong></div><div class="metric"><span class="small">Th\u1EA5p nh\u1EA5t</span><strong>${fmt(o.tmin, 1)} \xB0C</strong></div><div class="metric"><span class="small">T\u1ED5ng m\u01B0a</span><strong>${fmt(o.psum, 1)} mm</strong></div></div><div id="pastHours"><p class="muted">\u0110ang t\u1EA3i di\u1EC5n bi\u1EBFn t\u1EEBng gi\u1EDD\u2026</p></div><p class="small">S\u1ED1 li\u1EC7u t\xE1i ph\xE2n t\xEDch ERA5, kh\xF4ng ph\u1EA3i d\u1EF1 b\xE1o.</p>`;
      loadPastDayHours(iso);
      return;
    }
    const times = (live.base.hourly?.time || []).filter((t) => t.slice(0, 10) === iso);
    if (!times.length) {
      $("dayDetailMeta").textContent = "ngo\xE0i t\u1EA7m d\u1EF1 b\xE1o";
      $("dayDetail").innerHTML = `<p class="muted">Ng\xE0y ${iso} n\u1EB1m ngo\xE0i 16 ng\xE0y d\u1EF1 b\xE1o t\u1EA5t \u0111\u1ECBnh c\u1EE7a ngu\u1ED3n m\u1EDF. Xem l\u1ECBch th\xE1ng \u0111\u1EC3 \u0111\u1ED1i chi\u1EBFu c\xE1c ng\xE0y \u0111\xE3 qua.</p>`;
      return;
    }
    const offsets = forecastOffsetSeries(times);
    const cal = (varName) => calibratedSeries(varName, times, offsets).series;
    let temp, rain, wind, gust, feel, hum, cloud, wdir, wcode;
    try {
      temp = cal("temperature_2m");
      rain = cal("precipitation");
      wind = cal("wind_speed_10m");
      gust = cal("wind_gusts_10m");
      feel = cal("apparent_temperature");
      hum = cal("relative_humidity_2m");
      cloud = cal("cloud_cover");
      wdir = cal("wind_direction_10m");
      wcode = cal("weather_code");
    } catch (e) {
      $("dayDetailMeta").textContent = "l\u1ED7i t\xEDnh";
      $("dayDetail").innerHTML = `<p class="muted">Kh\xF4ng d\u1EF1ng \u0111\u01B0\u1EE3c chi ti\u1EBFt gi\u1EDD: ${esc(e.message)}</p>`;
      return;
    }
    const di = (live.base.daily?.time || []).indexOf(iso);
    const dd = live.base.daily || {};
    const rainSum = rain.filter(Boolean).reduce((s, r) => s + (r.median ?? 0), 0);
    const rainLo = rain.filter(Boolean).reduce((s, r) => s + (r.p10 ?? 0), 0);
    const rainHi = rain.filter(Boolean).reduce((s, r) => s + (r.p90 ?? 0), 0);
    const probs = rain.map((r) => r?.probs?.["1"]).filter(E.finite);
    const pMax = probs.length ? Math.max(...probs) : null;
    const gustMax = Math.max(...gust.filter(Boolean).map((g) => g.median ?? -1).filter((v) => v >= 0), NaN);
    const codeDay = di >= 0 ? dd.weather_code?.[di] : null;
    const sun = (t) => (t || "").slice(11, 16);
    $("dayDetailMeta").textContent = `${times.length} gi\u1EDD \xB7 trung v\u1ECB hi\u1EC7u ch\u1EC9nh + d\u1EA3i 10\u201390%`;
    $("dayDetail").innerHTML = `<div class="metric-grid compact"><div class="metric"><span class="small">Th\u1EDDi ti\u1EBFt</span><strong>${weatherFamily(codeDay)} ${esc(condition(codeDay))}</strong></div><div class="metric"><span class="small">Cao / th\u1EA5p nh\u1EA5t</span><strong>${di >= 0 ? fmt(dd.temperature_2m_max?.[di], 0) + "\xB0 / " + fmt(dd.temperature_2m_min?.[di], 0) + "\xB0" : "\u2014"}</strong></div><div class="metric"><span class="small">T\u1ED5ng m\u01B0a hi\u1EC7u ch\u1EC9nh</span><strong>${fmt(rainSum, 1)} mm</strong><small>d\u1EA3i 10\u201390%: ${fmt(rainLo, 1)}\u2013${fmt(rainHi, 1)} mm</small></div><div class="metric"><span class="small">P(m\u01B0a \u22651 mm) cao nh\u1EA5t</span><strong>${pMax !== null ? pct(pMax, 0) : "\u2014"}</strong></div><div class="metric"><span class="small">Gi\xF3 gi\u1EADt m\u1EA1nh nh\u1EA5t</span><strong>${E.finite(gustMax) ? fmt(gustMax, 0) + " km/h" : "\u2014"}</strong></div><div class="metric"><span class="small">M\u1EB7t tr\u1EDDi m\u1ECDc / l\u1EB7n</span><strong>${di >= 0 ? sun(dd.sunrise?.[di]) + " \u2013 " + sun(dd.sunset?.[di]) : "\u2014"}</strong></div></div><div class="table-wrap"><table><thead><tr><th>Gi\u1EDD</th><th>Th\u1EDDi ti\u1EBFt</th><th>Nhi\u1EC7t \u0111\u1ED9</th><th>C\u1EA3m gi\xE1c</th><th>M\u01B0a (P)</th><th>\u1EA8m</th><th>M\xE2y</th><th>Gi\xF3</th><th>Gi\u1EADt</th></tr></thead><tbody>` + times.map((t, i) => {
      const T = temp[i], R = rain[i], W = wind[i], G = gust[i];
      const F = feel[i], H = hum[i], C = cloud[i], D = wdir[i], WC = wcode[i];
      return `<tr><td>${t.slice(11, 16)}</td><td>${WC ? weatherFamily(WC.code) + ' <span class="tiny">' + esc(condition(WC.code)) + "</span>" : "\u2014"}</td><td>${T ? fmt(T.median, 1) + '\xB0 <span class="tiny">(' + fmt(T.p10, 1) + "\u2013" + fmt(T.p90, 1) + ")</span>" : "\u2014"}</td><td>${F ? fmt(F.median, 1) + "\xB0" : "\u2014"}</td><td>${R ? fmt(R.median, 1) + " mm" + (E.finite(R.probs?.["1"]) ? ' <span class="tiny">' + pct(R.probs["1"], 0) + "</span>" : "") : "\u2014"}</td><td>${H ? fmt(H.median, 0) + "%" : "\u2014"}</td><td>${C ? fmt(C.median, 0) + "%" : "\u2014"}</td><td>${W ? fmt(W.median, 0) + " km/h" + (D ? " " + bearing(D.dir) : "") : "\u2014"}</td><td>${G ? fmt(G.median, 0) + " km/h" : "\u2014"}</td></tr>`;
    }).join("") + `</tbody></table></div>`;
    $("dayDetail").scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
  var pastDayCache = {};
  var pastDayToken = 0;
  async function loadPastDayHours(iso) {
    const token = ++pastDayToken;
    if (pastDayCache[iso]) {
      renderPastDayHours(iso, pastDayCache[iso]);
      return;
    }
    try {
      const j = await api("https://archive-api.open-meteo.com/v1/archive", {
        latitude: place.lat,
        longitude: place.lon,
        start_date: iso,
        end_date: iso,
        timezone: "auto",
        hourly: "temperature_2m,precipitation,relative_humidity_2m,wind_speed_10m,wind_direction_10m,weather_code"
      });
      if (token !== pastDayToken || selectedDay !== iso) return;
      pastDayCache[iso] = j.hourly;
      renderPastDayHours(iso, j.hourly);
    } catch (e) {
      if (token !== pastDayToken || selectedDay !== iso) return;
      const box = $("pastHours");
      if (box) box.innerHTML = `<p class="muted">Kh\xF4ng t\u1EA3i \u0111\u01B0\u1EE3c gi\u1EDD quan tr\u1EAFc: ${esc(e.message)}</p>`;
    }
  }
  function renderPastDayHours(iso, h) {
    if (selectedDay !== iso) return;
    const box = $("pastHours");
    if (!box || !h?.time?.length) return;
    box.innerHTML = `<div class="table-wrap"><table><thead><tr><th>Gi\u1EDD</th><th>Th\u1EDDi ti\u1EBFt</th><th>Nhi\u1EC7t \u0111\u1ED9</th><th>M\u01B0a</th><th>\u1EA8m</th><th>Gi\xF3</th></tr></thead><tbody>` + h.time.map((t, i) => {
      const dr = h.wind_direction_10m?.[i];
      return `<tr><td>${t.slice(11, 16)}</td><td>${E.finite(h.weather_code?.[i]) ? weatherFamily(h.weather_code[i]) + ' <span class="tiny">' + esc(condition(h.weather_code[i])) + "</span>" : "\u2014"}</td><td>${E.finite(h.temperature_2m?.[i]) ? fmt(h.temperature_2m[i], 1) + "\xB0" : "\u2014"}</td><td>${E.finite(h.precipitation?.[i]) ? fmt(h.precipitation[i], 1) + " mm" : "\u2014"}</td><td>${E.finite(h.relative_humidity_2m?.[i]) ? fmt(h.relative_humidity_2m[i], 0) + "%" : "\u2014"}</td><td>${E.finite(h.wind_speed_10m?.[i]) ? fmt(h.wind_speed_10m[i], 0) + " km/h" + (E.finite(dr) ? " " + bearing(dr) : "") : "\u2014"}</td></tr>`;
    }).join("") + `</tbody></table></div>`;
  }
  function diurnalStrip(cal, view, spec) {
    if (spec.kind === "direction" || spec.kind === "code") return null;
    const byHour = Array.from({ length: 24 }, () => []);
    for (let i = 0; i < view.length && i < cal.length; i++) {
      const r = cal[i];
      if (!r) continue;
      const h = Number(view[i].slice(11, 13));
      byHour[(h + (place.utcOffset ?? 0)) % 24].push(r.median);
    }
    const cells = byHour.map((arr, h) => {
      if (!arr.length) return { h, text: "\u2014", empty: true };
      const vals = arr;
      const lo = Math.min(...vals), hi = Math.max(...vals);
      const mean = E.meanS(vals);
      return { h, text: fmt(mean, spec.digits), tint: hi === lo ? 0.5 : (mean - lo) / (hi - lo), empty: false };
    });
    return cells;
  }
  function renderChart() {
    if (!live) return;
    const variable = $("chartVariable").value;
    const spec = report.variables[variable];
    const times = activeTimes(live.base);
    const horizon = Math.min(Number($("horizon").value), times.length);
    const view = times.slice(0, horizon);
    const full = calFor(variable).series;
    const cal = full.slice(0, horizon);
    const showBands = $("showBands").checked;
    if (spec.kind === "code") {
      renderCodeChart(view, cal);
      return;
    }
    if (spec.kind === "direction") {
      renderDirectionChart(view, cal);
      return;
    }
    const rows = MODELS.map((m) => seriesFor(live.byId[m.id], variable, view));
    $("legend").innerHTML = MODELS.map((m, i) => `<span><i style="background:${COLORS[i]}"></i>${esc(m.name)}${rows[i].some((v) => !E.finite(v)) ? " \xB7 thi\u1EBFu" : ""}</span>`).join("") + `<span><i style="background:#172736"></i>D\u1EF1 b\xE1o \u0111\xE3 hi\u1EC7u ch\u1EC9nh</span>` + (showBands ? `<span><i class="band"></i>D\u1EA3i 10\u201390%</span>` : "");
    const values = [];
    for (const r of rows) for (const v of r) if (E.finite(v)) values.push(v);
    for (const r of cal) if (r) values.push(r.p10, r.p90, r.median);
    drawChart(view, rows, cal, values, spec, showBands, variable);
    const here = calibrationFor(variable, report.leads[0]);
    $("spreadNote").textContent = cal.some(Boolean) ? "D\u1EA3i 10\u201390% l\xE0 ph\xE2n ph\u1ED1i hi\u1EC7u ch\u1EC9nh: \u0111\u1ED9 r\u1ED9ng \u0111\u01B0\u1EE3c m\xF4 h\xECnh h\xF3a t\u1EEB m\u1EE9c b\u1EA5t \u0111\u1ED3ng gi\u1EEFa c\xE1c h\u1EC7 th\u1ED1ng, kh\xF4ng ph\u1EA3i kho\u1EA3ng tin c\u1EADy th\u1ED1ng k\xEA c\u1EE7a m\u1ED9t m\xF4 h\xECnh \u0111\u01A1n. " + (here?.pooled ? "D\xF9ng b\u1EA3n g\u1ED9p do \u0111\u1ECBa \u0111i\u1EC3m ch\u01B0a c\xF3 hi\u1EC7u ch\u1EC9nh ri\xEAng. " : "") + "Di chu\u1ED9t \u0111\u1EC3 xem t\u1EEBng gi\u1EDD." : "Kh\xF4ng c\xF3 hi\u1EC7u ch\u1EC9nh cho bi\u1EBFn n\xE0y t\u1EA1i \u0111\u1ECBa \u0111i\u1EC3m \u0111\xE3 ch\u1ECDn.";
  }
  function renderCodeChart(view, cal) {
    const cells = view.map((t, i) => {
      const r = cal[i];
      const g = r ? E.condGroup(r.code) : null;
      return `<div class="code-cell${r ? "" : " empty"}" style="${r ? `opacity:${(0.45 + 0.55 * (r.nModels / MODELS.length)).toFixed(2)}` : ""}"><span class="code-ico">${r ? weatherFamily(r.code) : "\u2014"}</span><span class="code-lab">${t.slice(11, 16)}</span><span class="code-txt">${r ? esc(condition(r.code)) : "ngo\xE0i v\xF9ng"}</span></div>`;
    }).join("");
    $("chart").innerHTML = `<div class="code-timeline">${cells}</div>`;
    $("legend").innerHTML = `<span><i style="background:#172736"></i>D\u1EF1 b\xE1o ph\xE2n lo\u1EA1i theo v\xF9ng \u0111\xE3 hi\u1EC7u ch\u1EC9nh (5 tr\u01B0\u1EDDng li\xEAn t\u1EE5c)</span><span class="tiny">M\xE3 WMO l\xE0 bi\u1EBFn ph\xE2n lo\u1EA1i n\xEAn kh\xF4ng c\xF3 d\u1EA3i s\u1ED1; \xF4 m\u1EDD d\u1EA7n l\xE0 khi c\xF2n \xEDt h\u1EC7 th\u1ED1ng.</span>`;
    $("spreadNote").textContent = "M\xE3 th\u1EDDi ti\u1EBFt suy ra t\u1EEB v\xF9ng kh\xED t\u01B0\u1EE3ng \u0111\xE3 h\u1ECDc t\u1EEB t\u1EADp hu\u1EA5n luy\u1EC7n. Gi\u1EDD n\u1EB1m ngo\xE0i v\xF9ng \u0111\xE3 quan s\xE1t \u0111\u01B0\u1EE3c \u0111\u1EC3 tr\u1ED1ng thay v\xEC \u0111o\xE1n.";
    void cells;
  }
  function renderDirectionChart(view, cal) {
    const rows = MODELS.map((m) => {
      const sp = seriesFor(live.byId[m.id], "wind_speed_10m", view);
      const dr = seriesFor(live.byId[m.id], "wind_direction_10m", view);
      return sp.map((s, i) => E.finite(s) && E.finite(dr[i]) ? { speed: s, dir: dr[i] } : null);
    });
    $("legend").innerHTML = MODELS.map((m, i) => `<span><i style="background:${COLORS[i]}"></i>${esc(m.name)}</span>`).join("") + `<span><i style="background:#172736"></i>D\u1EF1 b\xE1o \u0111\xE3 hi\u1EC7u ch\u1EC9nh</span>`;
    const cells = view.map((t, i) => {
      const r = cal[i];
      const spd = r ? r.mean : null;
      return `<div class="code-cell${r ? "" : " empty"}"><span class="code-ico">${r ? "\u27A4" : "\u2014"}</span><span class="code-lab">${t.slice(11, 16)}</span><span class="code-txt">${r ? bearing(r.dir) : "\u2014"}${E.finite(spd) ? " \xB7 " + fmt(spd) + " km/h" : ""}</span></div>`;
    }).join("");
    const legend = `<p class="tiny">Quy m\u0169 d\xF9ng c\u1EA3 7 h\u1EC7 th\u1ED1ng: ${rows.map((r, i) => MODELS[i].name + " " + r.filter(Boolean).length).join(" \xB7 ")} gi\u1EDD c\xF3 d\u1EEF li\u1EC7u.</p>`;
    $("chart").innerHTML = `<div class="code-timeline">${cells}</div>` + legend;
    $("spreadNote").textContent = "H\u01B0\u1EDBng gi\xF3 l\xE0 \u0111\u1EA1i l\u01B0\u1EE3ng v\xF2ng: 359\xB0 v\xE0 1\xB0 l\xE0 hai h\u01B0\u1EDBng g\u1EA7n nhau, n\xEAn kh\xF4ng v\u1EBD \u0111\u01B0\u1EDDng th\u1EB3ng qua 0\xB0. Bi\u1EC3u \u0111\u1ED3 hi\u1EC3n th\u1ECB h\u01B0\u1EDBng v\xE0 t\u1ED1c \u0111\u1ED9 theo gi\u1EDD.";
  }
  function drawChart(times, rows, cal, values, spec, showBands, variable) {
    if (!values.length) {
      $("chart").textContent = "Kh\xF4ng c\xF3 d\u1EEF li\u1EC7u cho bi\u1EBFn n\xE0y.";
      return;
    }
    const W = 1040, H = 300, pad = { l: 56, r: 16, t: 18, b: 44 };
    let lo = Math.min(...values), hi = Math.max(...values);
    const margin = (hi - lo) * 0.12 || 1;
    lo -= margin;
    hi += margin;
    const [floor, ceil] = range(variable);
    if (E.finite(floor)) lo = Math.max(lo, floor);
    if (E.finite(ceil)) hi = Math.min(hi, ceil);
    const x = (i) => pad.l + i * (W - pad.l - pad.r) / Math.max(1, times.length - 1);
    const y = (v) => H - pad.b - (v - lo) * (H - pad.t - pad.b) / Math.max(1e-9, hi - lo);
    let svg = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="D\u1EF1 b\xE1o x\xE1c su\u1EA5t theo gi\u1EDD">`;
    for (let k = 0; k <= 4; k++) {
      const v = lo + (hi - lo) * k / 4;
      svg += `<line x1="${pad.l}" y1="${y(v)}" x2="${W - pad.r}" y2="${y(v)}" stroke="#e0e6eb"/><text x="${pad.l - 9}" y="${y(v) + 5}" text-anchor="end" font-size="13" fill="#526474">${fmt(v, spec?.digits ?? 0)}</text>`;
    }
    for (let k = 0; k <= 5; k++) {
      const i = Math.floor((times.length - 1) * k / 5);
      svg += `<text x="${x(i)}" y="${H - 14}" text-anchor="${k === 0 ? "start" : k === 5 ? "end" : "middle"}" font-size="13" fill="#526474">${times[i].slice(5, 10)} ${times[i].slice(11, 16)}</text>`;
    }
    if (showBands) {
      const up = [], down = [];
      for (let i = 0; i < times.length; i++) {
        if (!cal[i]) continue;
        up.push(`${x(i).toFixed(2)} ${y(cal[i].p90).toFixed(2)}`);
        down.unshift(`${x(i).toFixed(2)} ${y(cal[i].p10).toFixed(2)}`);
      }
      if (up.length > 1) {
        svg += `<polygon points="${up.concat(down).join(" ")}" fill="#2a5f96" opacity="0.16"/>`;
      }
    }
    rows.forEach((r, j) => {
      let d2 = "", open2 = false;
      r.forEach((v, i) => {
        if (!E.finite(v)) {
          open2 = false;
          return;
        }
        d2 += (open2 ? "L" : "M") + x(i).toFixed(2) + " " + y(v).toFixed(2) + " ";
        open2 = true;
      });
      svg += `<path d="${d2}" fill="none" stroke="${COLORS[j]}" stroke-width="1.6" opacity="0.75"/>`;
    });
    let d = "", open = false;
    for (let i = 0; i < times.length; i++) {
      if (!cal[i]) {
        open = false;
        continue;
      }
      d += (open ? "L" : "M") + x(i).toFixed(2) + " " + y(cal[i].median).toFixed(2) + " ";
      open = true;
    }
    svg += `<path d="${d}" fill="none" stroke="#172736" stroke-width="3.2"/>`;
    const strip = diurnalStrip(cal, times, spec);
    if (strip) {
      $("chart").innerHTML += '<div class="strip">' + strip.map((c) => `<div class="strip-cell${c.empty ? " empty" : ""}" style="${c.empty ? "" : `background:rgba(42,95,150,${(0.06 + c.tint * 0.2).toFixed(3)})`}" title="${c.h} gi\u1EDD \xB7 TB ${esc(c.text)}"><span>${c.h}</span><strong>${c.text}</strong></div>`).join("") + "</div>";
    }
    const dg = spec.digits;
    times.forEach((t, i) => {
      const c = cal[i];
      const title = t.replace("T", " ") + "\n" + MODELS.map((m, j) => m.name + ": " + fmt(rows[j][i], dg)).join("\n") + (c ? `
Hi\u1EC7u ch\u1EC9nh: ${fmt(c.median, dg)} (10\u201390%: ${fmt(c.p10, dg)} \u2013 ${fmt(c.p90, dg)})` : "");
      svg += `<rect x="${x(i) - 3}" y="${pad.t}" width="6" height="${H - pad.t - pad.b}" fill="transparent"><title>${esc(title)}</title></rect>`;
    });
    $("chart").innerHTML = svg + "</svg>";
  }
  var NCHMF_REGIONS = {
    hanoi: ["H\xC0 N\u1ED8I", "B\u1EAEC B\u1ED8", "\u0110\u1ED2NG B\u1EB0NG B\u1EAEC B\u1ED8", "T\xC2Y B\u1EAEC B\u1ED8", "\u0110\xD4NG B\u1EAEC B\u1ED8"],
    danang: ["\u0110\xC0 N\u1EB4NG", "QU\u1EA2NG TR\u1ECA", "QU\u1EA2NG NG\xC3I", "HU\u1EBE", "TH\u1EEAA THI\xCAN HU\u1EBE", "TRUNG B\u1ED8", "TRUNG TRUNG B\u1ED8", "H\xC0 T\u0128NH", "QU\u1EA2NG B\xCCNH"],
    dalat: ["\u0110\xC0 L\u1EA0T", "L\xC2M \u0110\u1ED2NG", "T\xC2Y NGUY\xCAN", "CAO NGUY\xCAN TRUNG B\u1ED8", "GIA LAI", "\u0110\u1EAEK L\u1EAEK"],
    cantho: ["C\u1EA6N TH\u01A0", "H\u1EACU GIANG", "T\xC2Y NAM B\u1ED8", "\u0110\u1ED2NG B\u1EB0NG S\xD4NG C\u1EECU LONG", "NAM B\u1ED8", "TRI\u1EC0U C\u01AF\u1EDCNG"],
    hcm: ["H\u1ED2 CH\xCD MINH", "NAM B\u1ED8", "\u0110\xD4NG NAM B\u1ED8", "\u0110\u1ED2NG NAI", "TRI\u1EC0U C\u01AF\u1EDCNG"],
    nhatrang: ["NHA TRANG", "KH\xC1NH H\xD2A", "NAM TRUNG B\u1ED8", "PH\xDA Y\xCAN", "NINH THU\u1EACN", "B\xCCNH THU\u1EACN"],
    daklak: ["\u0110\u1EAEK L\u1EAEK", "BU\xD4N MA THU\u1ED8T", "T\xC2Y NGUY\xCAN", "GIA LAI", "L\xC2M \u0110\u1ED2NG"],
    songcau: ["S\xD4NG C\u1EA6U", "PH\xDA Y\xCAN", "NAM TRUNG B\u1ED8", "QU\u1EA2NG NG\xC3I", "B\xCCNH \u0110\u1ECANH"]
  };
  function nchmfFreshWarnings() {
    const seen = /* @__PURE__ */ new Set();
    const out = [];
    for (const b of NCHMF.breaking || []) {
      const key = (b.title || "") + (b.url || "");
      if (!seen.has(key) && isEffective(b.iso, 3)) {
        seen.add(key);
        out.push({
          ...b,
          category: b.category || "Tin kh\u1EA9n c\u1EA5p NCHMF",
          url: b.url || "https://www.nchmf.gov.vn/"
        });
      }
    }
    for (const c of NCHMF.categories || []) {
      for (const w of c.warnings || []) {
        const key = (w.title || "") + (w.url || c.url);
        if (!seen.has(key) && isEffective(w.iso, 3)) {
          seen.add(key);
          out.push({
            ...w,
            category: c.label,
            url: w.url || c.url
          });
        }
      }
    }
    return out.sort((a, b) => {
      if (a.level === "red" && b.level !== "red") return -1;
      if (b.level === "red" && a.level !== "red") return 1;
      if (a.level === "orange" && b.level === "info") return -1;
      if (b.level === "orange" && a.level === "info") return 1;
      return (b.iso || "").localeCompare(a.iso || "");
    });
  }
  function nchmfWarningsFor(placeId) {
    const keys = NCHMF_REGIONS[placeId] || [];
    if (!keys.length) return [];
    return nchmfFreshWarnings().filter((w) => {
      const T = (w.title || "").toUpperCase();
      return keys.some((k) => T.includes(k));
    });
  }
  var LEVEL_VN = { red: "KH\u1EA8N C\u1EA4P", orange: "C\u1EA2NH B\xC1O", info: "D\u1EF0 B\xC1O", stale: "L\u01AFU TR\u1EEE" };
  function vnToday() {
    return new Date(Date.now() + 7 * 36e5).toISOString().slice(0, 10);
  }
  function isEffective(iso, maxDays = 3) {
    if (!iso) return true;
    const days = (Date.parse(vnToday()) - Date.parse(iso)) / 864e5;
    return days >= -1 && days <= maxDays;
  }
  function renderNchmf() {
    const cats = NCHMF.categories || [];
    const breaking = NCHMF.breaking || [];
    if (!NCHMF.collectedAt && !breaking.length && !cats.length) {
      $("nchmfMeta").textContent = "ch\u01B0a c\xF3 d\u1EEF li\u1EC7u";
      $("nchmfList").innerHTML = '<p class="muted">Ch\u01B0a c\xF3 d\u1EEF li\u1EC7u b\u1EA3n tin NCHMF. B\u1EA5m n\xFAt <strong>L\xE0m m\u1EDBi tin</strong> \u0111\u1EC3 t\u1EA3i v\u1EC1.</p>';
      return;
    }
    const allWarnings = nchmfFreshWarnings();
    const matched = allWarnings.filter((w) => {
      const keys = NCHMF_REGIONS[place.id] || [];
      const T = (w.title || "").toUpperCase();
      return keys.some((k) => T.includes(k));
    });
    const others = allWarnings.filter((w) => !matched.includes(w));
    const fmtCard = (w) => `
    <div class="nchmf-card ${w.level || "info"}">
      <div class="nchmf-card-title">
        <span class="warn-chip ${w.level || "info"}">${LEVEL_VN[w.level] || "TIN"}</span>
        <a href="${w.url}" target="_blank" rel="noopener" style="color:inherit;text-decoration:none">${esc(w.title)}</a>
      </div>
      <div class="nchmf-card-meta">
        <span>\u{1F552} ${w.iso || ""}${w.time ? " " + w.time : ""}</span>
        <span>\u{1F4C1} ${esc(w.category || "NCHMF")}</span>
        <a class="nchmf-card-link" href="${w.url}" target="_blank" rel="noopener">\u0110\u1ECDc b\u1EA3n tin g\u1ED1c NCHMF \u2197</a>
      </div>
    </div>`;
    const collectTimeStr = NCHMF.collectedAt ? new Date(NCHMF.collectedAt).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }) : "h\xF4m nay";
    $("nchmfMeta").textContent = `Thu th\u1EADp: ${collectTimeStr} \xB7 ${allWarnings.length} tin/c\u1EA3nh b\xE1o m\u1EDBi nh\u1EA5t`;
    let html = "";
    if (matched.length) {
      html += `<div class="nchmf-section-title">\u{1F6A8} C\u1EA3nh b\xE1o ch\xEDnh th\u1EE9c cho khu v\u1EF1c ${esc(place.name)} (${matched.length})</div>`;
      html += matched.map(fmtCard).join("");
    }
    if (others.length) {
      html += `<div class="nchmf-section-title">\u26A0\uFE0F C\u1EA3nh b\xE1o kh\u1EA9n c\u1EA5p tr\xEAn to\xE0n qu\u1ED1c (${others.length})</div>`;
      html += others.map(fmtCard).join("");
    }
    if (!allWarnings.length) {
      html += '<p class="muted" style="padding:10px 0">Hi\u1EC7n NCHMF kh\xF4ng ph\xE1t c\u1EA3nh b\xE1o th\u1EDDi ti\u1EBFt nguy hi\u1EC3m \u0111\u1EB7c bi\u1EC7t. D\u01B0\u1EDBi \u0111\xE2y l\xE0 b\u1EA3n tin d\u1EF1 b\xE1o \u0111\u1ECBnh k\u1EF3 m\u1EDBi nh\u1EA5t.</p>';
    }
    const datlien = cats.find((c) => c.id === "datlien");
    const bien = cats.find((c) => c.id === "bien");
    const muoingay = cats.find((c) => c.id === "muoi-ngay");
    if (datlien || bien || muoingay) {
      html += `<div class="nchmf-section-title" style="margin-top:22px">\u{1F4CB} B\u1EA3n tin d\u1EF1 b\xE1o th\u1EDDi ti\u1EBFt \u0111\u1ECBnh k\u1EF3 NCHMF</div>`;
      if (datlien && datlien.excerpt) {
        html += `
        <div class="nchmf-routine-box">
          <h4>\u{1F324}\uFE0F ${esc(datlien.title || "D\u1EF1 b\xE1o th\u1EDDi ti\u1EBFt \u0111\u1EA5t li\u1EC1n 24h")}</h4>
          <p>${esc(datlien.excerpt)}</p>
          <div class="meta"><a class="nchmf-card-link" href="${datlien.url}" target="_blank" rel="noopener">Xem chi ti\u1EBFt to\xE0n b\u1ED9 c\xE1c v\xF9ng tr\xEAn NCHMF \u2197</a></div>
        </div>`;
      }
      if (bien && bien.excerpt) {
        html += `
        <div class="nchmf-routine-box">
          <h4>\u{1F30A} ${esc(bien.title || "D\u1EF1 b\xE1o th\u1EDDi ti\u1EBFt bi\u1EC3n 24h")}</h4>
          <p>${esc(bien.excerpt)}</p>
          <div class="meta"><a class="nchmf-card-link" href="${bien.url}" target="_blank" rel="noopener">Xem chi ti\u1EBFt th\u1EDDi ti\u1EBFt bi\u1EC3n tr\xEAn NCHMF \u2197</a></div>
        </div>`;
      }
      if (muoingay && (muoingay.excerpt || muoingay.title)) {
        html += `
        <div class="nchmf-routine-box">
          <h4>\u{1F4C5} ${esc(muoingay.title || "Xu th\u1EBF th\u1EDDi ti\u1EBFt 10 ng\xE0y t\u1EDBi")}</h4>
          <p>${esc(muoingay.excerpt || "Theo d\xF5i di\u1EC5n bi\u1EBFn kh\xF4ng kh\xED l\u1EA1nh, m\u01B0a d\xF4ng v\xE0 nhi\u1EC7t \u0111\u1ED9 10 ng\xE0y t\u1EDBi tr\xEAn to\xE0n qu\u1ED1c.")}</p>
          <div class="meta"><a class="nchmf-card-link" href="${muoingay.url}" target="_blank" rel="noopener">Xem to\xE0n v\u0103n b\u1EA3n tin 10 ng\xE0y NCHMF \u2197</a></div>
        </div>`;
      }
    }
    const otherCats = cats.filter((c) => c.id !== "datlien" && c.id !== "bien" && c.id !== "muoi-ngay");
    if (otherCats.length) {
      html += `
      <details style="margin-top:16px;border:1px solid var(--line);border-radius:8px;padding:10px 14px;background:#fbfcfd">
        <summary style="font-weight:600;cursor:pointer">Tra c\u1EE9u tr\u1EF1c ti\u1EBFp ${otherCats.length} chuy\xEAn m\u1EE5c c\u1EA3nh b\xE1o kh\xE1c c\u1EE7a NCHMF</summary>
        <div style="margin-top:10px;display:grid;grid-template-columns:repeat(auto-fit, minmax(200px, 1fr));gap:8px">
          ${otherCats.map((c) => `
            <a href="${c.url}" target="_blank" rel="noopener" style="padding:8px 12px;background:#fff;border:1px solid var(--line);border-radius:6px;text-decoration:none;color:var(--ink);font-size:13px;display:block">
              <strong>${esc(c.label)}</strong><br>
              <span class="tiny" style="color:var(--muted)">${esc(c.title || "\u0110\u1ECDc tin")} \u2197</span>
            </a>
          `).join("")}
        </div>
      </details>`;
    }
    $("nchmfList").innerHTML = html;
  }
  async function fetchLatestNchmf() {
    const btn = $("btnReloadNews") || $("btnReloadNchmf");
    if (btn) {
      btn.disabled = true;
      btn.textContent = "\u0110ang t\u1EA3i\u2026";
    }
    try {
      const res = await fetch("nchmf.json?t=" + Date.now());
      if (res.ok) {
        const data = await res.json();
        if (data && (data.breaking || data.categories)) {
          NCHMF = data;
          renderNchmf();
          nchmfBannerFor(place.id);
        }
      }
    } catch (err) {
      console.warn("L\u1ED7i khi t\u1EA3i nchmf.json:", err);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = "L\xE0m m\u1EDBi tin";
      }
    }
  }
  function switchTab(viewId) {
    const targetTab = document.querySelector(`.tab[data-view="${viewId}"]`);
    if (targetTab) {
      targetTab.click();
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }
  window.switchTab = switchTab;
  function nchmfBannerFor(placeId) {
    const matched = nchmfWarningsFor(placeId);
    const box = $("officialBanner");
    if (!box) return [];
    if (!matched.length) {
      const anyRed = nchmfFreshWarnings().filter((w) => w.level === "red");
      box.innerHTML = anyRed.length ? `<div class="notice warning" style="margin-bottom:14px;border-left:4px solid #c0392b">\u{1F6A8} <strong>NCHMF c\u1EA3nh b\xE1o kh\u1EA9n c\u1EA5p (${anyRed.length} tin):</strong> ${esc(anyRed[0].title.slice(0, 110))}\u2026 <a href="#news" onclick="switchTab('news');return false;" style="font-weight:700;margin-left:6px;color:var(--blue)">Xem chi ti\u1EBFt t\u1EA1i Tab Tin t\u1EE9c \u2197</a></div>` : "";
      return [];
    }
    const worst = matched.some((w) => w.level === "red") ? "red" : "orange";
    box.innerHTML = `<div class="notice ${worst === "red" ? "error" : "warning"}" style="margin-bottom:14px;border-left:4px solid ${worst === "red" ? "#c0392b" : "#e67e22"}">\u{1F6A8} <strong>C\u1EA3nh b\xE1o ch\xEDnh th\u1EE9c (NCHMF) cho v\xF9ng n\xE0y:</strong> ` + matched.slice(0, 2).map((w) => esc(w.title.slice(0, 130))).join(" \xB7 ") + ` <a href="#news" onclick="switchTab('news');return false;" style="font-weight:700;margin-left:6px;color:var(--blue)">Xem chi ti\u1EBFt t\u1EA1i Tab Tin t\u1EE9c \u2197</a></div>`;
    return matched;
  }
  var INTL_NEWS = [
    {
      id: "wmo-enso",
      agency: "wmo",
      agencyName: "WMO \xB7 T\u1ED5 ch\u1EE9c Kh\xED t\u01B0\u1EE3ng Th\u1EBF gi\u1EDBi (LHQ)",
      titleVn: "B\u1EA3n tin El Ni\xF1o / La Ni\xF1a: X\xE1c su\u1EA5t chuy\u1EC3n d\u1ECBch sang La Ni\xF1a v\xE0 t\xE1c \u0111\u1ED9ng th\u1EDDi ti\u1EBFt \u0110\xF4ng Nam \xC1",
      titleOrig: "WMO Update: Neutral ENSO conditions likely to transition to weak La Ni\xF1a",
      time: "2026-10",
      summary: "T\u1ED5 ch\u1EE9c Kh\xED t\u01B0\u1EE3ng Th\u1EBF gi\u1EDBi (WMO) nh\u1EADn \u0111\u1ECBnh hi\u1EC7n t\u01B0\u1EE3ng ENSO ti\u1EBFp t\u1EE5c duy tr\xEC tr\u1EA1ng th\xE1i trung t\xEDnh v\u1EDBi kh\u1EA3 n\u0103ng 60% chuy\u1EC3n sang pha La Ni\xF1a trong c\xE1c th\xE1ng cu\u1ED1i n\u0103m. Pha La Ni\xF1a th\u01B0\u1EDDng k\xEDch ho\u1EA1t s\u1EF1 gia t\u0103ng l\u01B0\u1EE3ng m\u01B0a t\u1EA1i \u0110\xF4ng Nam \xC1, t\u0103ng t\u1EA7n su\u1EA5t b\xE3o tr\xEAn Bi\u1EC3n \u0110\xF4ng v\xE0 c\xE1c \u0111\u1EE3t kh\xF4ng kh\xED l\u1EA1nh d\u1ED3n d\u1EADp t\u1EA1i mi\u1EC1n B\u1EAFc Vi\u1EC7t Nam.",
      url: "https://wmo.int/news/media-centre",
      category: "Kh\xED h\u1EADu to\xE0n c\u1EA7u",
      level: "orange"
    },
    {
      id: "wmo-climate-state",
      agency: "wmo",
      agencyName: "WMO \xB7 T\u1ED5 ch\u1EE9c Kh\xED t\u01B0\u1EE3ng Th\u1EBF gi\u1EDBi (LHQ)",
      titleVn: "B\xE1o c\xE1o Kh\xED h\u1EADu To\xE0n c\u1EA7u: Nhi\u1EC7t \u0111\u1ED9 \u0111\u1EA1i d\u01B0\u01A1ng ph\xE1 k\u1EF7 l\u1EE5c v\xE0 s\u1EF1 gia t\u0103ng c\xE1c c\u1EF1c \u0111oan kh\xED h\u1EADu",
      titleOrig: "WMO State of the Global Climate: Record ocean heat and intensified hydrological cycle",
      time: "2026-10",
      summary: "Nhi\u1EC7t \u0111\u1ED9 b\u1EC1 m\u1EB7t n\u01B0\u1EDBc bi\u1EC3n t\u1EA1i Th\xE1i B\xECnh D\u01B0\u01A1ng v\xE0 \u1EA4n \u0110\u1ED9 D\u01B0\u01A1ng duy tr\xEC \u1EDF m\u1EE9c cao b\u1EA5t th\u01B0\u1EDDng trong su\u1ED1t 12 th\xE1ng qua. Nhi\u1EC7t l\u01B0\u1EE3ng t\xEDch t\u1EE5 trong \u0111\u1EA1i d\u01B0\u01A1ng l\xE0 ngu\u1ED3n n\u0103ng l\u01B0\u1EE3ng kh\u1ED5ng l\u1ED3 k\xEDch ho\u1EA1t c\xE1c si\xEAu b\xE3o nhi\u1EC7t \u0111\u1EDBi, m\u01B0a c\u1EF1c \u0111oan g\xE2y ng\u1EADp l\u1EE5t ven bi\u1EC3n v\xE0 s\xF3ng nhi\u1EC7t \u0111\u1EA1i d\u01B0\u01A1ng k\xE9o d\xE0i.",
      url: "https://wmo.int/topics/climate-change",
      category: "Bi\u1EBFn \u0111\u1ED5i kh\xED h\u1EADu",
      level: "info"
    },
    {
      id: "noaa-mjo",
      agency: "noaa",
      agencyName: "NOAA / CPC \xB7 C\u01A1 quan Kh\xED quy\u1EC3n & \u0110\u1EA1i d\u01B0\u01A1ng M\u1EF9",
      titleVn: "Gi\xE1m s\xE1t Ho\xE0n l\u01B0u \u0110\u1ED1i l\u01B0u Nhi\u1EC7t \u0111\u1EDBi MJO: K\xEDch ho\u1EA1t d\u1EA3i h\u1ED9i t\u1EE5 \u1EA9m v\xE0 m\u01B0a l\u1EDBn tr\xEAn Bi\u1EC3n \u0110\xF4ng",
      titleOrig: "NOAA Climate Prediction Center: Global Tropics Hazards and MJO Outlook",
      time: "2026-10",
      summary: "Trung t\xE2m D\u1EF1 b\xE1o Kh\xED h\u1EADu Hoa K\u1EF3 (CPC/NOAA) theo d\xF5i s\xF3ng \u0111\u1ED1i l\u01B0u quy m\xF4 h\xE0nh tinh Madden-Julian (MJO) \u0111ang ti\u1EBFn v\xE0o pha 4 v\xE0 5 qua khu v\u1EF1c bi\u1EC3n \u0110\xF4ng Nam \xC1. Pha n\xE0y t\u0103ng c\u01B0\u1EDDng ngu\u1ED3n \u1EA9m \u0111\u1ED1i l\u01B0u m\u1EA1nh m\u1EBD, l\xE0m t\u0103ng kh\u1EA3 n\u0103ng h\xECnh th\xE0nh xo\xE1y thu\u1EADn nhi\u1EC7t \u0111\u1EDBi, d\u1EA3i \xE1p th\u1EA5p v\xE0 c\xE1c \u0111\u1EE3t m\u01B0a di\u1EC7n r\u1ED9ng t\u1EA1i mi\u1EC1n Trung v\xE0 Nam B\u1ED9.",
      url: "https://www.cpc.ncep.noaa.gov/products/precip/CWlink/ghaz/",
      category: "\u0110\u1ED1i l\u01B0u nhi\u1EC7t \u0111\u1EDBi",
      level: "orange"
    },
    {
      id: "noaa-cyclones",
      agency: "noaa",
      agencyName: "NOAA / NWS \xB7 Trung t\xE2m D\u1EF1 b\xE1o M\xF4i tr\u01B0\u1EDDng Qu\u1ED1c gia M\u1EF9",
      titleVn: "Theo d\xF5i Xo\xE1y thu\u1EADn Nhi\u1EC7t \u0111\u1EDBi To\xE0n c\u1EA7u & N\xE2ng c\u1EA5p M\xF4 h\xECnh D\u1EF1 b\xE1o GFS / GEFS",
      titleOrig: "NOAA / NCEP: Global Tropical Cyclone Monitoring and Numerical Weather Prediction",
      time: "2026-10",
      summary: "NOAA c\u1EADp nh\u1EADt chu\u1ED7i d\u1EEF li\u1EC7u \u0111\u1ED3ng h\xF3a v\u1EC7 tinh th\u1EBF h\u1EC7 m\u1EDBi GOES/JPSS v\xE0o m\xF4 h\xECnh to\xE0n c\u1EA7u GFS, n\xE2ng cao \u0111\u1ED9 ch\xEDnh x\xE1c d\u1EF1 b\xE1o qu\u1EF9 \u0111\u1EA1o v\xE0 c\u01B0\u1EDDng \u0111\u1ED9 b\xE3o tr\xEAn T\xE2y B\u1EAFc Th\xE1i B\xECnh D\u01B0\u01A1ng, \u0111\u1ED3ng th\u1EDDi cung c\u1EA5p d\u1EF1 b\xE1o t\u1ED5 h\u1EE3p GEFS 31 th\xE0nh ph\u1EA7n h\u1EA1n \u0111\u1EBFn 16 ng\xE0y.",
      url: "https://www.nhc.noaa.gov/",
      category: "B\xE3o nhi\u1EC7t \u0111\u1EDBi",
      level: "info"
    },
    {
      id: "ecmwf-aifs",
      agency: "ecmwf",
      agencyName: "ECMWF \xB7 Trung t\xE2m D\u1EF1 b\xE1o Th\u1EDDi ti\u1EBFt H\u1EA1n v\u1EEBa Ch\xE2u \xC2u",
      titleVn: "D\u1EF1 b\xE1o Th\u1EDDi ti\u1EBFt Tr\xED tu\u1EC7 Nh\xE2n t\u1EA1o AIFS: V\u1EADn h\xE0nh d\u1EF1 b\xE1o t\u1ED5 h\u1EE3p v\xE0 c\u1EA3nh b\xE1o s\xF3ng l\u1EA1nh s\u1EDBm 10-15 ng\xE0y",
      titleOrig: "ECMWF Operational Updates: Artificial Intelligence Forecasting System (AIFS)",
      time: "2026-10",
      summary: "ECMWF ch\xEDnh th\u1EE9c t\xEDch h\u1EE3p m\xF4 h\xECnh AI kh\xED t\u01B0\u1EE3ng AIFS v\xE0o chu tr\xECnh v\u1EADn h\xE0nh h\u1EB1ng ng\xE0y song song v\u1EDBi m\xF4 h\xECnh v\u1EADt l\xFD IFS. AIFS th\u1EC3 hi\u1EC7n n\u0103ng l\u1EF1c v\u01B0\u1EE3t tr\u1ED9i trong vi\u1EC7c ph\xE1t hi\u1EC7n s\u1EDBm c\xE1c \u0111\u1EE3t b\xF9ng ph\xE1t kh\xF4ng kh\xED l\u1EA1nh (cold surges) t\u1EEB l\u1EE5c \u0111\u1ECBa \xC1 - \xC2u tr\xE0n xu\u1ED1ng v\xF9ng nhi\u1EC7t \u0111\u1EDBi tr\u01B0\u1EDBc t\u1EEB 10 \u0111\u1EBFn 14 ng\xE0y.",
      url: "https://www.ecmwf.int/en/forecasts",
      category: "C\xF4ng ngh\u1EC7 AI kh\xED t\u01B0\u1EE3ng",
      level: "info"
    },
    {
      id: "ecmwf-seasonal",
      agency: "ecmwf",
      agencyName: "Copernicus / ECMWF \xB7 D\u1ECBch v\u1EE5 Kh\xED h\u1EADu Ch\xE2u \xC2u",
      titleVn: "D\u1EF1 b\xE1o M\xF9a v\xE0 D\u1ECB th\u01B0\u1EDDng Nhi\u1EC7t - \u1EA8m: Nh\u1EADn \u0111\u1ECBnh ho\xE0n l\u01B0u gi\xF3 m\xF9a \u0110\xF4ng \xC1 trong 3 th\xE1ng t\u1EDBi",
      titleOrig: "Copernicus Climate Change Service: Seasonal Forecast and Circulation Anomalies",
      time: "2026-10",
      summary: "Ph\xE2n t\xEDch d\u1ECB th\u01B0\u1EDDng \xE1p cao Siberia v\xE0 r\xE3nh gi\xF3 T\xE2y cho th\u1EA5y m\xF9a \u0111\xF4ng n\u0103m nay c\xF3 xu h\u01B0\u1EDBng xu\u1EA5t hi\u1EC7n c\xE1c \u0111\u1EE3t r\xE9t \u0111\u1EADm t\u1EADp trung v\xE0o gi\u1EEFa m\xF9a \u0111\xF4ng, v\u1EDBi l\u01B0\u1EE3ng m\u01B0a x\u1EA5p x\u1EC9 \u0111\u1EBFn cao h\u01A1n trung b\xECnh nhi\u1EC1u n\u0103m t\u1EA1i d\u1EA3i ven bi\u1EC3n mi\u1EC1n Trung Vi\u1EC7t Nam.",
      url: "https://climate.copernicus.eu/",
      category: "D\u1EF1 b\xE1o m\xF9a",
      level: "info"
    },
    {
      id: "jma-typhoon",
      agency: "jma",
      agencyName: "JMA \xB7 C\u01A1 quan Kh\xED t\u01B0\u1EE3ng Nh\u1EADt B\u1EA3n (RSMC Tokyo)",
      titleVn: "Trung t\xE2m Gi\xE1m s\xE1t B\xE3o T\xE2y B\u1EAFc Th\xE1i B\xECnh D\u01B0\u01A1ng: Theo d\xF5i \xE1p th\u1EA5p nhi\u1EC7t \u0111\u1EDBi v\xE0 b\xE3o tr\xEAn Bi\u1EC3n \u0110\xF4ng",
      titleOrig: "RSMC Tokyo - Typhoon Center: Tropical Cyclone Information and Analysis",
      time: "2026-10",
      summary: "C\u01A1 quan Kh\xED t\u01B0\u1EE3ng Nh\u1EADt B\u1EA3n (JMA) ch\u1ECBu tr\xE1ch nhi\u1EC7m theo d\xF5i v\xE0 \u0111\u1EB7t t\xEAn qu\u1ED1c t\u1EBF cho c\xE1c c\u01A1n b\xE3o t\u1EA1i T\xE2y B\u1EAFc Th\xE1i B\xECnh D\u01B0\u01A1ng. B\u1EA3n tin ph\xE2n t\xEDch chi ti\u1EBFt v\u1ECB tr\xED t\xE2m b\xE3o, \xE1p su\u1EA5t th\u1EA5p nh\u1EA5t, b\xE1n k\xEDnh gi\xF3 m\u1EA1nh tr\xEAn 30kt v\xE0 50kt, h\u1ED7 tr\u1EE3 c\u1EA3nh b\xE1o an to\xE0n h\xE0ng h\u1EA3i v\xE0 ven b\u1EDD cho to\xE0n v\xF9ng \u0110\xF4ng \xC1 v\xE0 Bi\u1EC3n \u0110\xF4ng.",
      url: "https://www.jma.go.jp/bosai/map.html#contents=typhoon",
      category: "Trung t\xE2m B\xE3o RSMC",
      level: "orange"
    },
    {
      id: "jma-monsoon",
      agency: "jma",
      agencyName: "JMA \xB7 C\u01A1 quan Kh\xED t\u01B0\u1EE3ng Nh\u1EADt B\u1EA3n",
      titleVn: "Theo d\xF5i \xC1p cao Siberia & \u0110\u1EE3t b\xF9ng ph\xE1t Gi\xF3 m\xF9a \u0110\xF4ng B\u1EAFc (Cold Surge) xu\u1ED1ng \u0110\xF4ng Nam \xC1",
      titleOrig: "JMA Climate Prediction Division: East Asian Winter Monsoon and Cold Air Outbreak",
      time: "2026-10",
      summary: "JMA c\xF4ng b\u1ED1 b\xE1o c\xE1o ph\xE2n t\xEDch \xE1p cao l\u1EA1nh l\u1EE5c \u0111\u1ECBa Siberia \u0111ang m\u1EA1nh d\u1EA7n l\xEAn t\u1EA1i khu v\u1EF1c v\u0129 \u0111\u1ED9 cao. Khi \xE1p cao n\xE0y tr\xE0n v\u1EC1 ph\xEDa nam s\u1EBD g\xE2y gi\xF3 m\u1EA1nh c\u1EA5p 6-8, s\xF3ng l\u1EDBn tr\xEAn V\u1ECBnh B\u1EAFc B\u1ED9 v\xE0 B\u1EAFc Bi\u1EC3n \u0110\xF4ng, \u0111\u1ED3ng th\u1EDDi g\xE2y gi\u1EA3m nhi\u1EC7t \u0111\u1ED9 s\xE2u tr\xEAn to\xE0n mi\u1EC1n B\u1EAFc Vi\u1EC7t Nam.",
      url: "https://www.data.jma.go.jp/gmd/cpd/db/enso/",
      category: "Gi\xF3 m\xF9a \u0110\xF4ng B\u1EAFc",
      level: "info"
    }
  ];
  function renderIntlNews(filter = "all") {
    const container = $("intlNewsList");
    if (!container) return;
    const items = filter === "alerts" ? INTL_NEWS.filter((n) => n.level === "orange" || n.level === "red") : INTL_NEWS;
    container.innerHTML = items.map((item) => `
    <article class="intl-card">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap">
        <span class="intl-agency-badge ${item.agency}">${esc(item.agencyName.split("\xB7")[0].trim())}</span>
        <span class="tiny" style="color:var(--muted)">\u{1F552} ${item.time} \xB7 ${esc(item.category)}</span>
      </div>
      <h4>${esc(item.titleVn)}</h4>
      <div class="orig-title">G\u1ED1c: "${esc(item.titleOrig)}"</div>
      <p>${esc(item.summary)}</p>
      <div class="intl-card-footer">
        <span>Ngu\u1ED3n: <strong>${esc(item.agencyName)}</strong></span>
        <a href="${item.url}" target="_blank" rel="noopener">\u0110\u1ECDc b\xE1o c\xE1o g\u1ED1c \u2197</a>
      </div>
    </article>
  `).join("");
  }
  function initNewsTab() {
    renderIntlNews("all");
    document.querySelectorAll(".news-filter-btn").forEach((btn) => {
      btn.onclick = () => {
        document.querySelectorAll(".news-filter-btn").forEach((b) => b.classList.toggle("active", b === btn));
        const f = btn.dataset.filter;
        const vnSec = $("nchmfSectionWrapper");
        const intlSec = $("intlSectionWrapper");
        if (f === "all") {
          if (vnSec) vnSec.hidden = false;
          if (intlSec) intlSec.hidden = false;
          renderIntlNews("all");
        } else if (f === "vn") {
          if (vnSec) vnSec.hidden = false;
          if (intlSec) intlSec.hidden = true;
        } else if (f === "intl") {
          if (vnSec) vnSec.hidden = true;
          if (intlSec) intlSec.hidden = false;
          renderIntlNews("all");
        } else if (f === "alerts") {
          if (vnSec) vnSec.hidden = false;
          if (intlSec) intlSec.hidden = false;
          renderIntlNews("alerts");
        }
      };
    });
  }
  function initSelects() {
    if (!$("testCity")) return;
    $("testCity").innerHTML = report.locations.map((l) => `<option value="${l.id}">${esc(l.name)}</option>`).join("");
    $("testVariable").innerHTML = VAR_LIST.map((v) => `<option value="${v}">${esc(report.variables[v].label)}</option>`).join("");
    $("testLead").innerHTML = report.leads.map((l) => `<option value="${l}">${l * 24} gi\u1EDD</option>`).join("");
    $("verifyPeriod").textContent = `${report.period.start} \u2192 ${report.period.end}, hu\u1EA5n luy\u1EC7n t\u1EDBi ${report.split.trainEnd}, ch\u1EA5m t\u1EEB ${report.split.testStart}`;
  }
  function currentTest() {
    const loc = report.locations.find((l) => l.id === $("testCity").value);
    const v = $("testVariable").value, lead = Number($("testLead").value);
    return { loc, v, lead, t: loc?.tests.find((x) => x.variable === v && x.lead === lead) };
  }
  var FAMILY = {
    mean: { name: "Trung b\xECnh \u0111\u1EC1u", note: "Trung b\xECnh m\u1ECDi h\u1EC7 th\u1ED1ng, kh\xF4ng hi\u1EC7u ch\u1EC9nh" },
    best: { name: "H\u1EC7 th\u1ED1ng \u0111\u01A1n t\u1ED1t nh\u1EA5t", note: "Ch\u1EC9 d\xF9ng m\u1ED9t h\u1EC7 th\u1ED1ng, ch\u1ECDn tr\xEAn c\u1EEDa s\u1ED5 hu\u1EA5n luy\u1EC7n" },
    nnls: { name: "K\u1EBFt h\u1EE3p kh\xF4ng \xE2m (NNLS)", note: "Tr\u1ECDng s\u1ED1 kh\xF4ng \xE2m tr\xEAn t\u1EEBng h\u1EC7 th\u1ED1ng" },
    emos: { name: "EMOS h\u1ED3i quy ridge", note: "H\u1ED3i quy tr\xEAn c\xE1c h\u1EC7 th\u1ED1ng, \u0111\u1ED9 l\u1EC7ch v\xE0 \u0111i\u1EC1u h\xF2a" }
  };
  function renderTest() {
    if (!$("testSummary")) return;
    const { loc, v, lead, t } = currentTest();
    if (!loc || !t) {
      $("testSummary").innerHTML = '<div class="metric"><span class="small">Kh\xF4ng c\xF3 d\u1EEF li\u1EC7u</span></div>';
      return;
    }
    const s = report.variables[v];
    if (!t.usable) {
      $("testSummary").innerHTML = `<div class="metric"><span class="small">${esc(s.label)} \xB7 ${lead * 24} gi\u1EDD</span><strong>\u2014</strong><small>${esc(t.note || "kh\xF4ng \u0111\u1EE7 d\u1EEF li\u1EC7u")}</small></div>`;
      ["scoreBars", "candTable", "eventTable", "reliability", "rankHist", "allVarsTable", "probSummary", "bootNote", "threshNote"].forEach((id) => {
        $(id).innerHTML = "";
      });
      notice("testVerdict", "Kh\xF4ng \u0111\u1EE7 d\u1EEF li\u1EC7u chung \u1EDF th\u1EDDi h\u1EA1n n\xE0y, kh\xF4ng ch\u1EA5m \u0111i\u1EC3m v\xE0 kh\xF4ng c\xF4ng b\u1ED1 \u0111\u1ED9 ch\xEDnh x\xE1c.");
      return;
    }
    const skillEq = E.finite(t.equalMean?.rmse) && t.equalMean.rmse > 0 ? 1 - t.mean.rmse / t.equalMean.rmse : null;
    const bestRmse = t.models?.length ? Math.min(...t.models.map((m) => m.rmse).filter(E.finite)) : null;
    const cards = [
      ["Gi\u1EDD ki\u1EC3m tra", fmt(t.testN, 0), `Hu\u1EA5n luy\u1EC7n ${fmt(t.trainingN, 0)} gi\u1EDD`],
      ["RMSE hi\u1EC7u ch\u1EC9nh", fmt(t.mean?.rmse, s.digits + 1), s.unit],
      ["So v\u1EDBi trung b\xECnh \u0111\u1EC1u", E.finite(skillEq) ? (skillEq >= 0 ? "+" : "") + fmt(skillEq * 100, 2) + "%" : "\u2014", "D\u01B0\u01A1ng: gi\u1EA3m RMSE"],
      ["So v\u1EDBi h\u1EC7 th\u1ED1ng t\u1ED1t nh\u1EA5t", E.finite(bestRmse) && bestRmse > 0 && E.finite(t.mean?.rmse) ? fmt((1 - t.mean.rmse / bestRmse) * 100, 2) + "%" : "\u2014", "H\u1EC7 th\u1ED1ng \u0111\u01A1n t\u1ED1t nh\u1EA5t c\xF9ng gi\u1EDD"],
      ["S\u1ED1 h\u1EC7 th\u1ED1ng d\xF9ng", fmt(t.models?.length ?? 0, 0), "\u0110\u1EE7 d\u1EEF li\u1EC7u tr\xEAn c\u1EEDa s\u1ED5 hu\u1EA5n luy\u1EC7n"],
      ["\u0110\u1ED9 ph\u1EE7 ki\u1EC3m tra", pct(t.coverageTest), "Gi\u1EDD \u0111\u1EE7 / gi\u1EDD trong kho\u1EA3ng"],
      ["M\xF4 h\xECnh \u0111\u01B0\u1EE3c ch\u1ECDn", FAMILY[t.selected?.family]?.name || (t.selected?.family ?? "\u2014"), FAMILY[t.selected?.family]?.note || ""]
    ];
    if (t.kind === "direction") {
      cards.splice(
        1,
        3,
        ["Sai s\u1ED1 g\xF3c", fmt(t.direction?.circularMae, 1) + "\xB0", "Sai l\u1EC7ch v\xF2ng cung trung b\xECnh"],
        ["Trong 30\xB0", pct(t.direction?.within30, 1), "T\u1EC9 l\u1EC7 gi\u1EDD \u0111\xFAng h\u01B0\u1EDBng"],
        ["Trong 45\xB0", pct(t.direction?.within45, 1), "T\u1EC9 l\u1EC7 gi\u1EDD \u0111\xFAng h\u01B0\u1EDBng"],
        ["Sai s\u1ED1 vector", fmt(t.direction?.vectorRmse, 2), "km/h tr\xEAn m\u1EB7t ph\u1EB3ng u-v"]
      );
    }
    if (t.kind === "code") {
      cards.splice(
        1,
        4,
        ["Tr\xF9ng tuy\u1EC7t \u0111\u1ED1i", pct(t.accuracy, 1), "\u0110\xFAng m\xE3 WMO"],
        ["Tr\xF9ng nh\xF3m th\u1EDDi ti\u1EBFt", pct(t.accuracyGroup, 1), "C\xF9ng nh\xF3m m\xF4 t\u1EA3"],
        ["S\u1ED1 m\u1EABu", fmt(t.testN ?? 0, 0), "Gi\u1EDD ki\u1EC3m tra"],
        ["Ph\u01B0\u01A1ng ph\xE1p", "kNN", esc((t.method || "").slice(0, 40) + "\u2026")]
      );
    }
    $("testSummary").innerHTML = cards.map(([l, val, note]) => `<div class="metric"><span class="small">${l}</span><strong>${val}</strong><small>${note}</small></div>`).join("");
    const scored = (t.models || []).map((m) => ({ name: m.name, v: m.rmse }));
    if (E.finite(t.equalMean?.rmse)) scored.push({ name: "Trung b\xECnh \u0111\u1EC1u", v: t.equalMean.rmse });
    if (E.finite(t.mean?.rmse)) scored.push({ name: "Hi\u1EC7u ch\u1EC9nh EMOS", v: t.mean.rmse, featured: true });
    if (E.finite(t.persistence?.rmse)) scored.push({ name: "Tr persistence", v: t.persistence.rmse });
    const usable = scored.filter((o) => E.finite(o.v));
    const maxV = Math.max(...usable.map((x) => x.v), 1e-9);
    $("scoreBars").innerHTML = usable.length ? usable.map((o) => `
    <div class="bar-row${o.featured ? " featured" : ""}"><span>${esc(o.name)}</span>
    <div class="bar-track"><div class="bar-fill" style="width:${o.v / maxV * 100}%"></div></div>
    <strong>${fmt(o.v, s.digits + 1)}</strong></div>`).join("") : `<p class="muted">${t.kind === "direction" ? "H\u01B0\u1EDBng gi\xF3 kh\xF4ng c\xF3 RMSE so s\xE1nh \u0111\u01B0\u1EE3c gi\u1EEFa c\xE1c h\u1EC7 th\u1ED1ng v\xEC n\xF3 l\xE0 \u0111\u1EA1i l\u01B0\u1EE3ng v\xF2ng; d\xF9ng sai s\u1ED1 g\xF3c v\xE0 t\u1EC9 l\u1EC7 trong 30\xB0/45\xB0 \u1EDF tr\xEAn." : "M\xE3 th\u1EDDi ti\u1EBFt l\xE0 bi\u1EBFn ph\xE2n lo\u1EA1i n\xEAn kh\xF4ng c\xF3 RMSE; d\xF9ng \u0111\u1ED9 ch\xEDnh x\xE1c tuy\u1EC7t \u0111\u1ED1i v\xE0 theo nh\xF3m \u1EDF tr\xEAn."}</p>`;
    const verdictFor = () => {
      if (t.kind === "direction") {
        const d = t.direction;
        return `Sai s\u1ED1 h\u01B0\u1EDBng trung b\xECnh ${fmt(d?.circularMae, 1)}\xB0, \u0111\xFAng h\u01B0\u1EDBng trong 30\xB0 \u1EDF ${pct(d?.within30, 1)} gi\u1EDD ki\u1EC3m tra. Ch\u1EC9 \xE1p d\u1EE5ng cho \u0111\u1ECBa \u0111i\u1EC3m, bi\u1EBFn v\xE0 giai \u0111o\u1EA1n \u0111\xE3 ki\u1EC3m th\u1EED.`;
      }
      if (t.kind === "code") {
        const r = t.regime;
        return `Tr\xF9ng m\xE3 WMO ${pct(t.accuracy, 1)}, tr\xF9ng nh\xF3m th\u1EDDi ti\u1EBFt ${pct(t.accuracyGroup, 1)}. ` + (r && E.finite(r.accuracy) ? `B\u1EA3ng tra v\xF9ng d\xF9ng trong trang n\xE0y \u0111\u1EA1t ${pct(r.accuracy, 1)} tr\xEAn ${fmt(r.lookupN ?? 0, 0)} gi\u1EDD, th\u1EA5p h\u01A1n b\u1ED9 ph\xE2n lo\u1EA1i kNN g\u1ED1c v\xEC b\u1EA3ng b\u1ECB n\xE9n.` : "Ch\u1EC9 \xE1p d\u1EE5ng cho \u0111\u1ECBa \u0111i\u1EC3m, bi\u1EBFn v\xE0 giai \u0111o\u1EA1n \u0111\xE3 ki\u1EC3m th\u1EED.");
      }
      if (!E.finite(t.mean?.rmse)) return "Kh\xF4ng ch\u1EA5m \u0111\u01B0\u1EE3c \u0111i\u1EC3m \u1EDF th\u1EDDi h\u1EA1n n\xE0y.";
      const better = E.finite(skillEq) && skillEq > 0;
      return better ? `Trong ph\xE9p th\u1EED n\xE0y hi\u1EC7u ch\u1EC9nh gi\u1EA3m RMSE ${fmt(skillEq * 100, 2)}% so v\u1EDBi trung b\xECnh \u0111\u1EC1u. K\u1EBFt qu\u1EA3 ch\u1EC9 \xE1p d\u1EE5ng cho \u0111\u1ECBa \u0111i\u1EC3m, bi\u1EBFn v\xE0 giai \u0111o\u1EA1n \u0111\xE3 ki\u1EC3m th\u1EED.` : "Trong ph\xE9p th\u1EED n\xE0y hi\u1EC7u ch\u1EC9nh kh\xF4ng gi\u1EA3m RMSE so v\u1EDBi trung b\xECnh \u0111\u1EC1u. Ch\u01B0a c\xF3 c\u01A1 s\u1EDF kh\u1EB3ng \u0111\u1ECBnh v\u01B0\u1EE3t m\xF4 h\xECnh.";
    };
    const bad = t.kind === "direction" || t.kind === "code" ? false : !(E.finite(skillEq) && skillEq > 0);
    notice("testVerdict", verdictFor(), bad ? "warning" : "");
    const boot = t.bootstrap?.vsEqualMean;
    $("bootNote").textContent = boot ? `Bootstrap kh\u1ED1i (${boot.reps} l\u1EA7n, kh\u1ED1i ${boot.blockHours} gi\u1EDD): ch\xEAnh l\u1EC7ch RMSE ${fmt(boot.deltaRmse, s.digits + 1)} ${s.unit}, kho\u1EA3ng 95% [${fmt(boot.ci95[0], s.digits + 1)}, ${fmt(boot.ci95[1], s.digits + 1)}], x\xE1c su\u1EA5t c\u1EA3i thi\u1EC7n ${pct(boot.probImprovement)}.` : t.kind === "direction" ? "Bootstrap RMSE kh\xF4ng \xE1p d\u1EE5ng cho h\u01B0\u1EDBng gi\xF3; sai s\u1ED1 g\xF3c \u0111\xE3 b\xE1o \u1EDF tr\xEAn l\xE0 thang \u0111o ph\xF9 h\u1EE3p." : "Kh\xF4ng \u0111\u1EE7 d\u1EEF li\u1EC7u cho bootstrap.";
    $("candTable").innerHTML = (t.candidates || []).map((c) => {
      const fam = FAMILY[c.family]?.name || c.family;
      const note = FAMILY[c.family]?.note || "";
      const pick = c.fitted === true || c.fitted === void 0 && c.chosen;
      return `<tr${pick ? ' class="chosen"' : ""}><td>${esc(fam)}${pick ? " \u2713" : ""}<br><span class="tiny">${esc(note)}</span></td><td>${c.lambda ?? "\u2014"}</td><td>${fmt(c.cvRmse, s.digits + 1)}</td><td class="tiny">${E.finite(c.cvGap) ? fmt(c.cvGap, s.digits + 1) : "\u2014"}</td></tr>`;
    }).join("");
    if (t.selected) {
      $("candNote").textContent = `Ch\u1ECDn theo quy t\u1EAFc m\u1ED9t sai s\u1ED1 chu\u1EA9n gh\xE9p c\u1EB7p: ch\u1ECDn m\xF4 h\xECnh \u0111\u01A1n gi\u1EA3n nh\u1EA5t m\xE0 ch\xEAnh l\u1EC7ch v\u1EDBi \u1EE9ng vi\xEAn d\u1EABn \u0111\u1EA7u (${FAMILY[t.selected.bestCvFamily]?.name || t.selected.bestCvFamily}) kh\xF4ng v\u01B0\u1EE3t sai s\u1ED1 chu\u1EA9n ${fmt(t.selected.cvStandardError, s.digits + 1)} ${s.unit}.`;
    }
    const ths = Object.keys(t.events || {});
    $("threshNote").textContent = ths.length ? `${s.label} \xB7 ng\u01B0\u1EE1ng theo \u0111\u01A1n v\u1ECB ${s.unit}. CSI \u0111o s\u1ED1 l\u1EA7n \u0111\xFAng tr\xEAn t\u1ED5ng \u0111\xFAng+b\u1ECF s\xF3t+b\xE1o sai; BSS d\u01B0\u01A1ng ngh\u0129a l\xE0 x\xE1c su\u1EA5t t\u1ED1t h\u01A1n t\u1EA7n su\u1EA5t g\u1ED1c.` : "Bi\u1EBFn n\xE0y kh\xF4ng c\xF3 ng\u01B0\u1EE1ng s\u1EF1 ki\u1EC7n.";
    $("eventTable").innerHTML = ths.map((th) => {
      const e = t.events[th];
      const m = e.median, p = e.probability;
      return `<tr><td>${th} ${esc(s.unit)}</td><td>${fmt(m.csi, 3)}</td><td>${pct(m.pod, 1)}</td><td>${pct(m.far, 1)}</td><td>${fmt(p.brier, 4)}</td><td>${E.finite(p.bss) ? fmt(p.bss, 3) : "\u2014"}</td></tr>`;
    }).join("");
    const pr = t.probabilistic;
    if (pr && pr.n) {
      $("probSummary").innerHTML = [
        ["CRPS", fmt(pr.crps, s.digits + 1), s.unit],
        ["Pinball 50%", fmt(pr.pinball?.p50, s.digits + 1), s.unit],
        ["Pinball 10/90", fmt(pr.pinball?.p10, s.digits + 1) + " / " + fmt(pr.pinball?.p90, s.digits + 1), s.unit],
        ["\u0110\u1ED9 r\u1ED9ng", fmt(pr.spread, s.digits + 1), "\u0111\u1ED9 l\u1EC7ch chu\u1EA9n"],
        ["\u0110\u1ED9 r\u1ED9ng/sai s\u1ED1", fmt(pr.spreadSkill, 2), "~1 l\xE0 hi\u1EC7u chu\u1EA9n"]
      ].map(([l, v2, note]) => `<div class="metric"><span class="small">${l}</span><strong>${v2}</strong><small>${note}</small></div>`).join("");
    } else {
      $("probSummary").innerHTML = '<div class="metric"><span class="small">Kh\xF4ng c\xF3 thang \u0111o x\xE1c su\u1EA5t</span></div>';
    }
    const rel = ths.length ? t.events[ths[0]].probability.reliability : [];
    $("reliability").innerHTML = rel.length ? '<svg viewBox="0 0 320 200" role="img" aria-label="\u0110\u1ED9 tin c\u1EADy d\u1EF1 b\xE1o x\xE1c su\u1EA5t"><line x1="34" y1="10" x2="34" y2="170" stroke="#526474"/><line x1="34" y1="170" x2="300" y2="170" stroke="#526474"/><line x1="34" y1="170" x2="300" y2="10" stroke="#cfd8e0" stroke-dasharray="4 3"/>' + rel.map((b) => {
      const cx = 34 + b.forecast * 266, cy = 170 - b.observed * 160;
      return `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${Math.min(6, 2 + b.n / 40).toFixed(1)}" fill="#2869b8"><title>${b.forecast.toFixed(2)} d\u1EF1 b\xE1o / ${b.observed.toFixed(2)} quan s\xE1t / ${b.n} gi\u1EDD</title></circle>`;
    }).join("") + '<text x="167" y="192" text-anchor="middle" font-size="12" fill="#526474">X\xE1c su\u1EA5t d\u1EF1 b\xE1o</text><text x="14" y="90" font-size="12" fill="#526474" transform="rotate(-90 14 90)" text-anchor="middle">T\u1EA7n su\u1EA5t quan s\xE1t</text></svg>' : '<p class="muted">Kh\xF4ng c\xF3 b\u1EA3ng \u0111\u1ED9 tin c\u1EADy cho bi\u1EBFn n\xE0y.</p>';
    const hasProb = pr && pr.n && t.kind !== "direction" && t.kind !== "code";
    if (!hasProb) {
      $("reliability").innerHTML = '<p class="muted">Kh\xF4ng c\xF3 b\u1EA3ng \u0111\u1ED9 tin c\u1EADy cho bi\u1EBFn n\xE0y.</p>';
      $("rankHist").innerHTML = '<p class="muted">Kh\xF4ng c\xF3 ph\xE2n ph\u1ED1i hi\u1EC7u ch\u1EC9nh cho bi\u1EBFn n\xE0y.</p>';
      renderAllVars(loc);
      return;
    }
    if (pr && pr.rankHistogram) {
      const h = pr.rankHistogram;
      const mx = Math.max(...h, 1e-3);
      $("rankHist").innerHTML = '<div class="rank-cols">' + h.map((val, i) => `<div class="rank-col" title="Kho\u1EA3ng ${i}: ${pct(val, 1)}"><div class="rank-bar" style="height:${val / mx * 100}%"></div><span>${i}</span></div>`).join("") + `</div><p class="small">Sai l\u1EC7ch so v\u1EDBi ph\xE2n ph\u1ED1i \u0111\u1EC1u: <strong>${fmt(pr.rankDeviation, 3)}</strong> (0 l\xE0 ho\xE0n h\u1EA3o). \u0110\u1ED9 r\u1ED9ng trung b\xECnh ${fmt(pr.rangeMean, s.digits + 1)} ${s.unit}.</p>`;
    } else {
      $("rankHist").innerHTML = '<p class="muted">Kh\xF4ng c\xF3 ph\xE2n ho\u1EA1ch \u0111\u1EE9ng h\u1EA1ng.</p>';
    }
    renderAllVars(loc);
  }
  function renderAllVars(loc) {
    $("allVarsTable").innerHTML = loc.tests.filter((t) => t.usable).map((t) => {
      const s = report.variables[t.variable];
      const cell = (x) => `<td>${E.finite(x) ? fmt(x, s.digits + 1) : "\u2014"}</td>`;
      if (t.kind === "direction") {
        return `<tr><td>${esc(s.label)}</td><td>${t.lead * 24} h</td><td>${t.models?.length ?? 0}</td><td>${fmt(t.direction?.circularMae, 1)}\xB0</td><td>sai s\u1ED1 g\xF3c</td><td>${pct(t.direction?.within30, 1)}</td><td>trong 30\xB0</td></tr>`;
      }
      if (t.kind === "code") {
        return `<tr><td>${esc(s.label)}</td><td>${t.lead * 24} h</td><td>${t.models?.length ?? 0}</td><td>${pct(t.accuracy, 1)}</td><td>tr\xF9ng m\xE3</td><td>${pct(t.accuracyGroup, 1)}</td><td>tr\xF9ng nh\xF3m</td></tr>`;
      }
      const skill = E.finite(t.equalMean?.rmse) && t.equalMean.rmse > 0 ? 1 - t.mean.rmse / t.equalMean.rmse : null;
      return `<tr><td>${esc(s.label)}</td><td>${t.lead * 24} h</td><td>${t.models?.length ?? 0}</td>` + cell(t.mean?.rmse) + cell(t.equalMean?.rmse) + `<td class="${E.finite(skill) && skill > 0 ? "pos" : "neg"}">${E.finite(skill) ? (skill >= 0 ? "+" : "") + fmt(skill * 100, 1) + "%" : "\u2014"}</td>` + cell(t.probabilistic?.crps) + `</tr>`;
    }).join("");
  }
  function renderProtocol() {
    if (!$("protocol")) return;
    const h = report.headline;
    const items = [
      ["Ph\u01B0\u01A1ng ph\xE1p", "EMOS h\u1ED3i quy ridge tr\xEAn 7 h\u1EC7 th\u1ED1ng + \u0111\u1ED9 l\u1EC7ch + 2 bi\u1EBFn ph\u1EE5 + \u0111i\u1EC1u h\xF2a ng\xE0y \u0111\xEAm/n\u0103m."],
      ["Ch\u1ECDn m\xF4 h\xECnh", `Ki\u1EC3m ch\u1EE9ng ch\u1EB7n 8 kh\u1ED1i m\u1EDF r\u1ED9ng d\u1EA7n trong c\u1EEDa s\u1ED5 hu\u1EA5n luy\u1EC7n, r\u1ED3i quy t\u1EAFc m\u1ED9t sai s\u1ED1 chu\u1EA9n gh\xE9p c\u1EB7p ch\u1ECDn m\xF4 h\xECnh \u0111\u01A1n gi\u1EA3n nh\u1EA5t c\xF2n t\u01B0\u01A1ng \u0111\u01B0\u01A1ng. H\u1ECD \u0111\u01B0\u1EE3c ch\u1ECDn: ${JSON.stringify(h.familyChosen)}.`],
      ["Chu\u1EA9n ho\xE1 x\xE1c su\u1EA5t", "Ph\u01B0\u01A1ng sai ph\u1EA7n d\u01B0 = alpha + beta \xD7 \u0111\u1ED9 l\u1EC7ch\xB2, r\u1ED3i 51 th\xE0nh vi\xEAn gi\u1EA3 t\u1EA1o t\u1EA5t \u0111\u1ECBnh."],
      ["T\xE1ch d\u1EEF li\u1EC7u", `Hu\u1EA5n luy\u1EC7n \u2264 ${report.split.trainEnd}, b\u1ECF tr\u1ED1ng ${report.split.purgeDays} ng\xE0y, ch\u1EA5m t\u1EEB ${report.split.testStart}. Kh\xF4ng tinh ch\u1EC9nh tr\xEAn t\u1EADp ki\u1EC3m tra.`],
      ["K\u1EBFt qu\u1EA3 t\u1ED5ng", `${h.evaluated} ph\xE9p ch\u1EA5m; ${h.betterThanEqualWeight} t\u1ED1t h\u01A1n trung b\xECnh \u0111\u1EC1u; ${h.betterThanBestSingle} t\u1ED1t h\u01A1n h\u1EC7 th\u1ED1ng \u0111\u01A1n t\u1ED1t nh\u1EA5t.`],
      ["\xDD ngh\u0129a th\u1ED1ng k\xEA", `Bootstrap kh\u1ED1i: ${h.significantImprovementVsEqualWeight} ph\xE9p c\u1EA3i thi\u1EC7n c\xF3 x\xE1c su\u1EA5t \u226590% so v\u1EDBi trung b\xECnh \u0111\u1EC1u.`]
    ];
    $("protocol").innerHTML = items.map(([k, v]) => `<div><span>${k}</span><strong>${esc(v)}</strong></div>`).join("");
    $("protocol").insertAdjacentHTML(
      "beforeend",
      `<p class="small">${esc(report.method)}</p><p class="small">${esc(report.ensembleMethod)}</p>`
    );
  }
  function download(name, text, type) {
    const u = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement("a");
    a.href = u;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(u), 1e3);
  }
  function exportForecast() {
    if (!live) return;
    const times = activeTimes(live.base);
    const offsets = forecastOffsetSeries(times);
    const raw = {};
    for (const v of LIVE_VARS) {
      raw[v] = MODELS.map((m) => seriesFor(live.byId[m.id], v, times));
    }
    const header = ["time_local", "timezone", "hours_ahead"];
    for (const v of LIVE_VARS) {
      const d = report.variables[v].digits;
      header.push(`${v}_median`, `${v}_p10`, `${v}_p90`);
      MODELS.forEach((m) => header.push(`${v}_${m.id}`));
    }
    const lines = [header.join(",")];
    times.forEach((t, i) => {
      const row = [t, live.base.timezone, Math.round(offsets[i])];
      for (const v of LIVE_VARS) {
        const d = report.variables[v].digits;
        const c = calFor(v).series[i];
        const put = (x) => E.finite(x) ? x.toFixed(d) : "";
        row.push(put(c?.median), put(c?.p10), put(c?.p90));
        for (const arr of raw[v]) row.push(put(arr[i]));
      }
      lines.push(row.join(","));
    });
    download("atmos-forecast.csv", "\uFEFF" + lines.join("\n"), "text/csv;charset=utf-8");
  }
  var searchRequest = 0;
  async function searchPlaces(q) {
    const [om, osm] = await Promise.allSettled([
      api("https://geocoding-api.open-meteo.com/v1/search", {
        name: q,
        count: 8,
        language: "vi",
        format: "json"
      }),
      (async () => {
        const r = await fetch("https://nominatim.openstreetmap.org/search?" + new URLSearchParams({
          q,
          format: "jsonv2",
          limit: "8",
          "accept-language": "vi",
          addressdetails: "1"
        }), { signal: timeoutSignal(2e4), headers: { Accept: "application/json" } });
        if (!r.ok) throw new Error("OpenStreetMap " + r.status);
        return r.json();
      })()
    ]);
    const items = [];
    if (om.status === "fulfilled") {
      for (const r of om.value.results || []) {
        items.push({
          key: `om-${r.id}`,
          name: r.name,
          sub: [r.admin2, r.admin1, r.country].filter(Boolean).join(" \xB7 "),
          lat: r.latitude,
          lon: r.longitude,
          source: "Open-Meteo"
        });
      }
    }
    if (osm.status === "fulfilled") {
      for (const r of osm.value || []) {
        const a = r.address || {};
        const admin = [a.suburb || a.village || a.town || a.city_district, a.county || a.state_district, a.state, a.country].filter(Boolean).join(" \xB7 ");
        items.push({
          key: `osm-${r.place_id}`,
          name: (r.namedetails?.name || r.name || "").split(",")[0] || "\u0110\u1ECBa \u0111i\u1EC3m",
          sub: admin || r.display_name.split(",").slice(1, 3).join(","),
          lat: Number(r.lat),
          lon: Number(r.lon),
          source: "OpenStreetMap"
        });
      }
    }
    const seen = /* @__PURE__ */ new Set();
    const uniq = items.filter((it) => {
      if (!E.finite(it.lat) || !E.finite(it.lon)) return false;
      const k = Math.round(it.lat * 100) + ":" + Math.round(it.lon * 100);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    }).slice(0, 12);
    const errors = [
      om.status === "rejected" ? "Open-Meteo: " + om.reason.message : null,
      osm.status === "rejected" ? "OpenStreetMap: " + osm.reason.message : null
    ].filter(Boolean);
    return { items: uniq, errors };
  }
  function emptySearchHint(q) {
    return 'Kh\xF4ng t\xECm th\u1EA5y \u0111\u1ECBa \u0111i\u1EC3m cho "' + q + '". Th\u1EED t\xEAn kh\xF4ng d\u1EA5u, t\xEAn x\xE3/ph\u01B0\u1EDDng k\xE8m huy\u1EC7n/t\u1EC9nh, ho\u1EB7c t\xEAn ti\u1EBFng Anh (v\xED d\u1EE5: "Tan Lap, Dan Phuong" hay "Zermatt").';
  }
  function initSearch() {
    $("searchForm").onsubmit = async (e) => {
      e.preventDefault();
      const token = ++searchRequest;
      const q = $("search").value.trim();
      $("searchResults").textContent = "\u0110ang t\xECm trong 2 ngu\u1ED3n d\u1EEF li\u1EC7u \u0111\u1ECBa danh\u2026";
      try {
        const { items, errors } = await searchPlaces(q);
        if (token !== searchRequest) return;
        $("searchResults").innerHTML = "";
        if (!items.length) {
          $("searchResults").textContent = errors.length ? "C\u1EA3 hai ngu\u1ED3n \u0111\u1EC1u l\u1ED7i (" + errors.join("; ") + "). Ki\u1EC3m tra k\u1EBFt n\u1ED1i r\u1ED3i th\u1EED l\u1EA1i." : emptySearchHint(q);
          return;
        }
        const meta = document.createElement("p");
        meta.className = "small";
        meta.textContent = `T\xECm th\u1EA5y ${items.length} k\u1EBFt qu\u1EA3 cho "${q}" (Open-Meteo + OpenStreetMap).`;
        $("searchResults").append(meta);
        items.forEach((it) => {
          const b = document.createElement("button");
          b.type = "button";
          b.innerHTML = `${esc(it.name)} <span class="tiny">${esc(it.sub)} \xB7 ${esc(it.source)}</span>`;
          b.onclick = () => {
            place = { id: "geo-" + it.key, name: it.name, lat: it.lat, lon: it.lon, utcOffset: Math.round(it.lon / 15) };
            $("searchResults").innerHTML = "";
            loadForecast();
          };
          $("searchResults").append(b);
        });
      } catch (err) {
        $("searchResults").textContent = "Kh\xF4ng t\xECm \u0111\u01B0\u1EE3c \u0111\u1ECBa \u0111i\u1EC3m: " + err.message;
      }
    };
  }
  $("chartVariable").innerHTML = LIVE_VARS.map((v) => `<option value="${v}">${esc(report.variables[v].label)} \xB7 ${esc(report.variables[v].unit)}</option>`).join("");
  $("headModels").textContent = `${MODELS.length} H\u1EC6 TH\u1ED0NG \xB7 ${LIVE_VARS.length} BI\u1EBEN`;
  $("introNote").innerHTML = `M\u1ED7i gi\xE1 tr\u1ECB k\xE8m d\u1EA3i 10\u201390% v\xE0 x\xE1c su\u1EA5t v\u01B0\u1EE3t ng\u01B0\u1EE1ng.<br>T\u1EADp ki\u1EC3m tra: <strong>${fmt(report.headline.betterThanEqualWeight)}/${report.headline.evaluated}</strong> ph\xE9p ch\u1EA5m t\u1ED1t h\u01A1n trung b\xECnh \u0111\u1EC1u.`;
  var radarMap = null;
  var radarLayer = null;
  var alertLayer = null;
  var radarInitialized = false;
  var radarFrames = null;
  var radarTimer = 0;
  var radarFadeLayer = null;
  var radarPlaying = false;
  var disasterLoc = null;
  var disasterFollow = true;
  var DISASTER_PRESETS = [
    { id: "hanoi", name: "H\xE0 N\u1ED9i", lat: 21.0285, lon: 105.8542 },
    { id: "haiphong", name: "H\u1EA3i Ph\xF2ng", lat: 20.86, lon: 106.68 },
    { id: "danang", name: "\u0110\xE0 N\u1EB5ng", lat: 16.0544, lon: 108.2022 },
    { id: "nhatrang", name: "Nha Trang", lat: 12.2395, lon: 109.196 },
    { id: "hcm", name: "TP. H\u1ED3 Ch\xED Minh", lat: 10.8231, lon: 106.6297 },
    { id: "cantho", name: "C\u1EA7n Th\u01A1", lat: 10.0452, lon: 105.7469 },
    { id: "dalat", name: "\u0110\xE0 L\u1EA1t", lat: 11.9469, lon: 108.4583 },
    { id: "bangkok", name: "Bangkok", lat: 13.7563, lon: 100.5018 },
    { id: "manila", name: "Manila", lat: 14.5995, lon: 120.9842 },
    { id: "tokyo", name: "Tokyo", lat: 35.6762, lon: 139.6503 },
    { id: "jakarta", name: "Jakarta", lat: -6.2088, lon: 106.8456 }
  ];
  function syncDisasterToPlace() {
    if (disasterFollow || !disasterLoc) {
      disasterLoc = { name: place.name, lat: place.lat, lon: place.lon };
    }
    renderDisasterChips();
    applyDisasterLoc(false);
  }
  function renderDisasterChips() {
    const box = $("disasterChips");
    if (!box) return;
    box.innerHTML = `<button class="chip${disasterFollow ? " selected" : ""}" data-dloc="__forecast">\u{1F4CD} V\u1ECB tr\xED d\u1EF1 b\xE1o: ${esc(disasterFollow ? disasterLoc?.name || place.name : place.name)}</button>` + DISASTER_PRESETS.map((p) => `<button class="chip${!disasterFollow && disasterLoc?.name === p.name ? " selected" : ""}" data-dloc="${esc(p.id)}">${esc(p.name)}</button>`).join("");
    box.querySelectorAll("button").forEach((b) => {
      b.onclick = () => {
        if (b.dataset.dloc === "__forecast") {
          disasterFollow = true;
          disasterLoc = { name: place.name, lat: place.lat, lon: place.lon };
        } else {
          const p = DISASTER_PRESETS.find((x) => x.id === b.dataset.dloc);
          if (!p) return;
          disasterFollow = false;
          disasterLoc = { name: p.name, lat: p.lat, lon: p.lon };
        }
        renderDisasterChips();
        applyDisasterLoc(true);
      };
    });
  }
  function applyDisasterLoc(reloadAlerts) {
    const loc = disasterLoc || { name: place.name, lat: place.lat, lon: place.lon };
    const note = $("disasterPlaceNote");
    if (note) note.textContent = `Radar, li\xEAn k\u1EBFt b\xE3o/l\u1EE5t v\xE0 c\u1EA3nh b\xE1o d\u01B0\u1EDBi \u0111\xE2y t\xEDnh cho: ${loc.name} (${fmt(loc.lat, 2)}\xB0, ${fmt(loc.lon, 2)}\xB0).`;
    const wl = $("windyLink");
    if (wl) wl.href = `https://www.windy.com/${loc.lat.toFixed(3)}/${loc.lon.toFixed(3)}`;
    if (radarMap) {
      radarMap.setView([loc.lat, loc.lon], Math.max(radarMap.getZoom(), 5));
      drawDisasterPin();
    }
    if (reloadAlerts) loadAlerts();
  }
  function drawDisasterPin() {
    if (!radarMap || !disasterLoc) return;
    if (drawDisasterPin._pin) {
      try {
        radarMap.removeLayer(drawDisasterPin._pin);
      } catch (e) {
      }
    }
    drawDisasterPin._pin = L.marker([disasterLoc.lat, disasterLoc.lon], {
      title: disasterLoc.name
    }).addTo(radarMap).bindTooltip(esc(disasterLoc.name));
  }
  async function initRadar() {
    if (radarInitialized) return;
    radarInitialized = true;
    const cl = disasterLoc || { lat: place.lat, lon: place.lon };
    const center = [cl.lat, cl.lon];
    if (typeof L === "undefined") {
      $("radarMsg").textContent = "Kh\xF4ng t\u1EA3i \u0111\u01B0\u1EE3c th\u01B0 vi\u1EC7n b\u1EA3n \u0111\u1ED3 (leaflet). Ki\u1EC3m tra k\u1EBFt n\u1ED1i m\u1EA1ng.";
      return;
    }
    try {
      const res = await fetch("https://api.rainviewer.com/public/weather-maps.json", {
        signal: timeoutSignal(2e4)
      });
      if (!res.ok) throw new Error("rainviewer " + res.status);
      const data = await res.json();
      const frames = [...data.radar?.past || [], ...data.radar?.nowcast || []];
      if (!frames.length) throw new Error("no radar frames");
      radarMap = L.map("radarMap", {
        center,
        zoom: 6,
        minZoom: 2,
        maxZoom: 18,
        worldCopyJump: true,
        attributionControl: true
      });
      L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
        maxZoom: 19,
        attribution: "Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community"
      }).addTo(radarMap);
      radarFrames = { host: data.host, frames, index: frames.length - 1 };
      const latest = frames[frames.length - 1];
      const radarTileOpts = { tileSize: 512, zoomOffset: -1, maxNativeZoom: 7, maxZoom: 18, attribution: "RainViewer" };
      radarLayer = L.tileLayer(
        `${data.host}${latest.path}/512/{z}/{x}/{y}/2/1_1.png`,
        { ...radarTileOpts, opacity: RADAR_OPACITY }
      ).addTo(radarMap);
      radarFadeLayer = L.tileLayer(
        `${data.host}${latest.path}/512/{z}/{x}/{y}/2/1_1.png`,
        { ...radarTileOpts, opacity: 0 }
      ).addTo(radarMap);
      const fc = radarFadeLayer.getContainer && radarFadeLayer.getContainer();
      if (fc) {
        fc.style.transition = "none";
        fc.style.opacity = "0";
        fc.style.pointerEvents = "none";
        fc.style.zIndex = "4";
      }
      const bc = radarLayer.getContainer && radarLayer.getContainer();
      if (bc) {
        bc.style.zIndex = "3";
        bc.style.transition = "none";
      }
      alertLayer = L.layerGroup().addTo(radarMap);
      airLayer = L.layerGroup();
      drawDisasterPin();
      radarFrames.past = (data.radar.past || []).length;
      radarFrames.nowcast = (data.radar.nowcast || []).length;
      const spanH = ((latest.time - frames[0].time) / 3600).toFixed(1);
      $("radarMsg").textContent = "Radar hi\u1EC7n t\u1EA1i \xB7 khung " + new Date(latest.time * 1e3).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }) + " (ICT) \xB7 " + frames.length + " khung trong " + spanH + " gi\u1EDD" + (radarFrames.nowcast ? " (g\u1ED3m " + radarFrames.nowcast + " khung d\u1EF1 b\xE1o nowcast)" : " (kh\xF4ng c\xF3 khung d\u1EF1 b\xE1o)") + ".";
      initRadarControls();
      const al = $("airLegend");
      if (al) al.innerHTML = airGrid ? airMassLegendHtml() : "";
      const tg = $("airGridToggle");
      if (tg) {
        const on = radarMap && airLayer && radarMap.hasLayer(airLayer);
        tg.textContent = on ? "T\u1EAFt kh\u1ED1i kh\xED tr\xEAn b\u1EA3n \u0111\u1ED3" : "B\u1EADt kh\u1ED1i kh\xED tr\xEAn b\u1EA3n \u0111\u1ED3";
        if (on) {
          tg.classList.remove("secondary");
          tg.classList.add("primary");
        } else {
          tg.classList.remove("primary");
          tg.classList.add("secondary");
        }
      }
    } catch (e) {
      $("radarMsg").textContent = "Kh\xF4ng t\u1EA3i \u0111\u01B0\u1EE3c radar: " + e.message + ". T\u1EA3i l\u1EA1i khi c\xF3 m\u1EA1ng.";
    }
  }
  var RADAR_FADE_MS = 340;
  var RADAR_DWELL_MS = 210;
  var RADAR_TILE_WAIT = 320;
  var RADAR_OPACITY = 0.7;
  var sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  function radarTilesReady(layer, maxWait) {
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        layer.off("load", finish);
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(finish, maxWait);
      layer.on("load", finish);
    });
  }
  function radarUrl(k) {
    const f = radarFrames.frames[k];
    return `${radarFrames.host}${f.path}/512/{z}/{x}/{y}/2/1_1.png`;
  }
  function radarLabel(k) {
    const frames = radarFrames.frames;
    const t = new Date(frames[k].time * 1e3).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });
    return "Khung " + (k + 1) + "/" + frames.length + " \xB7 " + t + " (ICT)";
  }
  function radarMark(k) {
    const lab = $("radarFrameTime");
    if (lab) lab.textContent = radarLabel(k);
    const sl = $("radarFrameSlider");
    if (sl) sl.value = k;
  }
  async function radarShowFrame(i, fade) {
    if (!radarFrames || !radarLayer) return;
    const frames = radarFrames.frames;
    const k = Math.max(0, Math.min(frames.length - 1, i));
    radarFrames.index = k;
    radarMark(k);
    const top = radarFadeLayer && radarFadeLayer.getContainer ? radarFadeLayer.getContainer() : null;
    if (!fade || !top) {
      radarLayer.setUrl(radarUrl(k));
      if (top) {
        top.style.transition = "none";
        top.style.opacity = "0";
      }
      return;
    }
    radarFadeLayer.setUrl(radarUrl(k));
    await radarTilesReady(radarFadeLayer, RADAR_TILE_WAIT);
    if (radarFrames.index !== k) return;
    if (!radarPlaying) return;
    const base = radarLayer.getContainer();
    top.style.transition = "none";
    top.style.opacity = "0";
    if (base) {
      base.style.transition = "none";
      base.style.opacity = String(RADAR_OPACITY);
    }
    void top.offsetWidth;
    if (base) {
      base.style.transition = `opacity ${RADAR_FADE_MS}ms linear`;
      base.style.opacity = "0";
    }
    top.style.transition = `opacity ${RADAR_FADE_MS}ms linear`;
    top.style.opacity = String(RADAR_OPACITY);
    await sleep(RADAR_FADE_MS);
    radarLayer.setUrl(radarUrl(k));
    top.style.transition = "none";
    top.style.opacity = "0";
    if (base) {
      base.style.transition = "none";
      base.style.opacity = String(RADAR_OPACITY);
    }
  }
  function radarStop(toNow) {
    radarPlaying = false;
    if (radarTimer) {
      clearTimeout(radarTimer);
      radarTimer = 0;
    }
    const b = $('radarPlay');
    if (b) b.textContent = "\u25B6 Ph\xE1t radar";
    const top = radarFadeLayer && radarFadeLayer.getContainer ? radarFadeLayer.getContainer() : null;
    if (top) {
      top.style.transition = "none";
      top.style.opacity = "0";
    }
    const base = radarLayer && radarLayer.getContainer ? radarLayer.getContainer() : null;
    if (base) {
      base.style.transition = "none";
      base.style.opacity = String(RADAR_OPACITY);
    }
    if (toNow && radarFrames && radarFrames.frames.length > 1) {
      radarShowFrame(radarFrames.frames.length - 1, false);
    } else {
      radarMark(radarFrames ? radarFrames.index : 0);
    }
  }
  async function radarStep() {
    if (!radarPlaying || !radarFrames) return;
    const n = radarFrames.frames.length;
    await radarShowFrame((radarFrames.index + 1) % n, true);
    if (!radarPlaying) return;
    radarTimer = setTimeout(radarStep, RADAR_DWELL_MS);
  }
  function radarPlay(on) {
    if (on) {
      if (!radarFrames || radarFrames.frames.length < 2) return;
      radarPlaying = true;
      const b = $('radarPlay');
      if (b) b.textContent = "\u23F8 T\u1EA1m d\u1EEBng radar";
      radarStep();
    } else {
      radarStop(true);
    }
  }
  function initRadarControls() {
    const b = $('radarPlay');
    if (b) b.onclick = () => radarPlay(!radarPlaying);
    const s = $("radarFrameSlider");
    if (s) {
      s.oninput = () => {
        const k = +s.value;
        radarStop(false);
        radarShowFrame(k, false);
      };
    }
    if (radarFrames) {
      const s2 = $("radarFrameSlider");
      if (s2) s2.max = radarFrames.frames.length - 1;
      radarMark(radarFrames.index);
    }
  }
  var ANIM_HOURS = 36;
  var ANIM_CHUNK = 140;
  var ANIM_NEEDS = {
    wind: ["wind_speed_10m", "wind_direction_10m"],
    temp: ["temperature_2m"],
    cloud: ["cloud_cover"],
    rain: ["precipitation"],
    // Ba trường cho một chỉ số ghép. Cần đủ cả ba vì thiếu một thành phần thì
    // cách hiệu chuẩn khác nhau, và so sánh giữa các mức màu sẽ vô nghĩa.
    storm: ["cape", "lifted_index", "convective_inhibition"]
  };
  var ANIM_SCALES = {
    wind: {
      label: "Gi\xF3 10 m",
      unit: "km/h",
      kind: "wind",
      field: "wind_speed_10m",
      stops: [
        [0, "#2f6f9f"],
        [10, "#4fa3c7"],
        [20, "#57c0a8"],
        [32, "#8fd14f"],
        [45, "#f2c14e"],
        [60, "#f08a3c"],
        [80, "#e05252"],
        [110, "#c026d3"]
      ]
    },
    temp: {
      label: "Nhi\u1EC7t \u0111\u1ED9 2 m",
      unit: "\xB0C",
      kind: "scalar",
      field: "temperature_2m",
      stops: [
        [12, "#2b4a8b"],
        [18, "#3f8fc4"],
        [23, "#63c2a8"],
        [28, "#f2d24e"],
        [33, "#ef8a3c"],
        [38, "#d93838"],
        [42, "#a01f5a"]
      ]
    },
    cloud: {
      label: "Ph\u1EE7 m\xE2y",
      unit: "%",
      kind: "scalar",
      field: "cloud_cover",
      stops: [[0, "#101a2c"], [15, "#2c3f55"], [40, "#5b6f85"], [70, "#8d9bad"], [100, "#e8eef5"]]
    },
    rain: {
      label: "L\u01B0\u1EE3ng m\u01B0a",
      unit: "mm/gi\u1EDD",
      kind: "scalar",
      field: "precipitation",
      stops: [
        [0.02, "#1b3a6b"],
        [0.5, "#2f7fc1"],
        [2, "#43b06b"],
        [5, "#e8d24a"],
        [10, "#e0762f"],
        [20, "#d03434"],
        [40, "#b03ad0"]
      ]
    },
    storm: {
      label: "Nguy c\u01A1 b\xE3o t\u1ED1",
      unit: "\u0111i\u1EC3m 0\u20131",
      kind: "scalar",
      field: "storm_index",
      derived: true,
      stops: [
        [0.15, "#1d3b2f"],
        [0.35, "#3f7a44"],
        [0.5, "#c9c04a"],
        [0.65, "#ef9a35"],
        [0.8, "#e0503a"],
        [0.92, "#b02fb0"],
        [1, "#e8e0ff"]
      ]
    }
  };
  function hexToRgb(h) {
    const n = parseInt(h.slice(1), 16);
    return h.length > 7 ? [n >> 16 & 255, n >> 8 & 255, n & 255, n >>> 24 & 255] : [n >> 16 & 255, n >> 8 & 255, n & 255, 255];
  }
  function animColour(stops, v) {
    if (!E.finite(v)) return null;
    if (v <= stops[0][0]) return hexToRgb(stops[0][1]);
    const last = stops[stops.length - 1];
    if (v >= last[0]) return hexToRgb(last[1]);
    for (let i = 1; i < stops.length; i++) {
      if (v > stops[i][0]) continue;
      const [v0, c0] = stops[i - 1], [v1, c1] = stops[i];
      const f = (v - v0) / (v1 - v0);
      const a = hexToRgb(c0), b = hexToRgb(c1);
      return [
        Math.round(a[0] + (b[0] - a[0]) * f),
        Math.round(a[1] + (b[1] - a[1]) * f),
        Math.round(a[2] + (b[2] - a[2]) * f),
        Math.round(a[3] + (b[3] - a[3]) * f)
      ];
    }
    return hexToRgb(last[1]);
  }
  var anim = {
    on: false,
    playing: false,
    varKey: "wind",
    hour: 0,
    grid: null,
    cache: /* @__PURE__ */ new Map(),
    timer: 0,
    raf: 0,
    last: 0,
    particlesOn: true,
    contours: false,
    dragging: false
  };
  var ANIM_MARGIN = 1.25;
  var ANIM_TIERS = [
    { maxSpan: 1e9, step: 1, n: 15 },
    // nhìn cả khu vực
    { maxSpan: 14, step: 0.5, n: 15 },
    // vùng rộng, ô 0,5°
    { maxSpan: 7, step: 0.25, n: 15 },
    // vùng vừa, ô 0,25°
    { maxSpan: 3.5, step: 0.25, n: 13 }
    // phóng to, vùng nhỏ, ô vẫn 0,25°
  ];
  function animTierForView() {
    if (!radarMap) return ANIM_TIERS[2];
    const b = radarMap.getBounds();
    const span = Math.max(Math.abs(b.getEast() - b.getWest()), Math.abs(b.getNorth() - b.getSouth()));
    for (const t of ANIM_TIERS) if (span * ANIM_MARGIN <= t.maxSpan) return t;
    return ANIM_TIERS[ANIM_TIERS.length - 1];
  }
  function animCenterForView() {
    if (!radarMap) return { lat: place.lat, lon: place.lon };
    const c = radarMap.getCenter();
    return { lat: c.lat, lon: c.lng ?? c.lon };
  }
  function animGridCoversView(grid, grow) {
    if (!grid || !radarMap) return false;
    const g = grow == null ? 0.15 : grow;
    const b = radarMap.getBounds();
    const west = grid.lon0 - (grid.n - 1) * grid.step * g;
    const east = grid.lon0 + (grid.n - 1) * grid.step * (1 + g);
    const south = grid.lat0 - (grid.n - 1) * grid.step * g;
    const north = grid.lat0 + (grid.n - 1) * grid.step * (1 + g);
    return b.getWest() >= west && b.getEast() <= east && b.getSouth() >= south && b.getNorth() <= north;
  }
  var animCacheKey = (center, tier, fields) => center.lat.toFixed(2) + "," + center.lon.toFixed(2) + "," + tier.step.toFixed(3) + "," + fields.join("+");
  async function fetchAnimChunk(lats, lons, fields, attempt = 0) {
    const u = new URLSearchParams({
      latitude: lats.join(","),
      longitude: lons.join(","),
      hourly: fields.join(","),
      forecast_days: "2",
      wind_speed_unit: "kmh",
      timezone: "Asia/Ho_Chi_Minh"
    });
    try {
      const j = await api("https://api.open-meteo.com/v1/forecast", u);
      return Array.isArray(j) ? j : null;
    } catch (e) {
      if (/hourly api request limit|429/i.test(e.message)) {
        const err = new Error("\u0111\xE3 h\u1EBFt h\u1EA1n m\u1EE9c l\u01B0\u1EE3t g\u1ECDi c\u1EE7a Open-Meteo trong gi\u1EDD n\xE0y");
        err.quota = true;
        throw err;
      }
      if (attempt < 4 && /overload|503|502|timeout/i.test(e.message)) {
        await new Promise((r) => setTimeout(r, [1500, 4e3, 9e3, 16e3][attempt]));
        return fetchAnimChunk(lats, lons, fields, attempt + 1);
      }
      return null;
    }
  }
  async function fetchAnimGrid(varKey, tier, center, onProgress) {
    const fields = ANIM_NEEDS[varKey] || [ANIM_SCALES[varKey].field];
    const key = animCacheKey(center, tier, fields);
    if (anim.cache.has(key)) return anim.cache.get(key);
    const n = tier.n, step = tier.step;
    const lat0 = center.lat - (n - 1) * step / 2;
    const lon0 = center.lon - (n - 1) * step / 2;
    const lats = [], lons = [];
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        lats.push((lat0 + j * step).toFixed(4));
        lons.push((lon0 + i * step).toFixed(4));
      }
    }
    const total = Math.ceil(lats.length / ANIM_CHUNK);
    const pts = [];
    let done = 0;
    for (let s = 0; s < lats.length; s += ANIM_CHUNK) {
      const part = await fetchAnimChunk(lats.slice(s, s + ANIM_CHUNK), lons.slice(s, s + ANIM_CHUNK), fields);
      if (part) pts.push(...part);
      done++;
      if (onProgress) onProgress(done, total);
      if (s + ANIM_CHUNK < lats.length) await new Promise((r) => setTimeout(r, 600));
    }
    if (pts.length < n * n * 0.6) {
      throw new Error("ch\u1EC9 t\u1EA3i \u0111\u01B0\u1EE3c " + pts.length + "/" + n * n + " \u0111i\u1EC3m");
    }
    const hours = pts[0].hourly.time.slice(0, ANIM_HOURS);
    const grid = {
      lat0,
      lon0,
      n,
      step,
      hours,
      fields: {},
      varKey,
      missing: n * n - pts.length,
      km: Math.round(step * 111)
    };
    for (const f of fields) {
      const flat = new Float32Array(n * n * hours.length).fill(NaN);
      for (let idx = 0; idx < pts.length; idx++) {
        const row = idx / n | 0, col = idx % n;
        const arr = pts[idx].hourly[f];
        if (!arr || row >= n) continue;
        const base = (row * n + col) * hours.length;
        for (let h = 0; h < hours.length; h++) flat[base + h] = arr[h] == null ? NaN : arr[h];
      }
      grid.fields[f] = flat;
    }
    if (varKey === "storm" && grid.fields.cape) {
      const nh2 = hours.length;
      const idx = new Float32Array(n * n * nh2).fill(NaN);
      for (let i = 0; i < n * n * nh2; i++) {
        const r = E.lightningIndex({
          cape: grid.fields.cape[i],
          liftedIndex: grid.fields.lifted_index ? grid.fields.lifted_index[i] : null,
          convectiveInhibition: grid.fields.convective_inhibition ? grid.fields.convective_inhibition[i] : null
        });
        if (r) idx[i] = r.risk;
      }
      grid.fields.storm_index = idx;
    }
    anim.cache.set(key, grid);
    return grid;
  }
  async function fetchAnimGridWithFallback(varKey, tier, center, onProgress) {
    let i = ANIM_TIERS.indexOf(tier);
    if (i < 0) i = ANIM_TIERS.length - 1;
    const start = i;
    let lastErr = null;
    for (; i >= 0; i--) {
      try {
        const g = await fetchAnimGrid(varKey, ANIM_TIERS[i], center, onProgress);
        if (i < start) {
          g.fallbackFrom = ANIM_TIERS[start].step;
          g.fallbackTo = ANIM_TIERS[i].step;
        }
        return g;
      } catch (e) {
        lastErr = e;
        if (e.quota) throw e;
      }
    }
    throw lastErr || new Error("kh\xF4ng t\u1EA3i \u0111\u01B0\u1EE3c l\u01B0\u1EDBi n\xE0o");
  }
  function animSample(grid, field, fx, fy, hour) {
    const flat = grid.fields[field];
    if (!flat) return null;
    const n = grid.n, nh = grid.hours.length;
    const gx = Math.max(0, Math.min(1, fx)) * (n - 1);
    const gy = Math.max(0, Math.min(1, fy)) * (n - 1);
    const x0 = Math.floor(gx), y0 = Math.floor(gy);
    const x1 = Math.min(n - 1, x0 + 1), y1 = Math.min(n - 1, y0 + 1);
    const tx = gx - x0, ty = gy - y0;
    const at = (x, y) => flat[(y * n + x) * nh + hour];
    const v = [at(x0, y0), at(x1, y0), at(x0, y1), at(x1, y1)];
    if (!v.every(E.finite)) return null;
    return (v[0] * (1 - tx) + v[1] * tx) * (1 - ty) + (v[2] * (1 - tx) + v[3] * tx) * ty;
  }
  var animParticles = [];
  var ANIM_PARTICLE_BASE = 1100;
  function animVisibleFraction(grid) {
    if (!radarMap) return { x0: 0, y0: 0, x1: 1, y1: 1, area: 1 };
    const b = radarMap.getBounds();
    const span = (grid.n - 1) * grid.step;
    const fx0 = (b.getWest() - grid.lon0) / span, fx1 = (b.getEast() - grid.lon0) / span;
    const fy0 = (b.getSouth() - grid.lat0) / span, fy1 = (b.getNorth() - grid.lat0) / span;
    const x0 = Math.max(0, Math.min(1, fx0)), x1 = Math.max(0, Math.min(1, fx1));
    const y0 = Math.max(0, Math.min(1, fy0)), y1 = Math.max(0, Math.min(1, fy1));
    return { x0, y0, x1, y1, area: Math.max(0, (x1 - x0) * (y1 - y0)) };
  }
  function animSpawn(p, vis) {
    p.x = vis.x0 + Math.random() * (vis.x1 - vis.x0);
    p.y = vis.y0 + Math.random() * (vis.y1 - vis.y0);
    p.age = 20 + Math.random() * 110;
    p.fade = 0;
  }
  function animSeedParticles(grid) {
    if (!grid) return;
    const vis = animVisibleFraction(grid);
    const target = Math.max(120, Math.round(ANIM_PARTICLE_BASE * Math.min(1, vis.area * 1.6)));
    animParticles.length = 0;
    for (let i = 0; i < target; i++) {
      const p = { x: 0, y: 0, age: 0, fade: 0 };
      animSpawn(p, vis);
      animParticles.push(p);
    }
  }
  function animDrawField(grid, hour) {
    const spec = ANIM_SCALES[anim.varKey];
    if (!grid.fields[spec.field]) {
      const m = $("animMsg");
      if (m) m.textContent = "L\u01B0\u1EDBi hi\u1EC7n t\u1EA1i ch\u01B0a c\xF3 bi\u1EBFn " + spec.label.toLowerCase() + " \u2014 \u0111ang t\u1EA3i l\u1EA1i\u2026";
      animRefreshNow(true);
      return;
    }
    const n = grid.n, nh = grid.hours.length;
    const small = anim.fieldCanvas;
    if (!small || small.width !== n || small.height !== n) {
      small.width = n;
      small.height = n;
    }
    const ctx = small.getContext("2d");
    const img = ctx.createImageData(n, n);
    for (let row = 0; row < n; row++) {
      for (let col = 0; col < n; col++) {
        const v = grid.fields[spec.field][(row * n + col) * nh + hour];
        const c = animColour(spec.stops, v);
        const o = (row * n + col) * 4;
        if (!c) {
          img.data[o + 3] = 0;
          continue;
        }
        img.data[o] = c[0];
        img.data[o + 1] = c[1];
        img.data[o + 2] = c[2];
        img.data[o + 3] = c[3];
      }
    }
    ctx.putImageData(img, 0, 0);
    const nw = radarMap.latLngToContainerPoint([grid.lat0 + (n - 1) * grid.step, grid.lon0]);
    const se = radarMap.latLngToContainerPoint([grid.lat0, grid.lon0 + (n - 1) * grid.step]);
    if (!E.finite(nw.x) || !E.finite(nw.y) || !E.finite(se.x) || !E.finite(se.y)) {
      const m = $("animMsg");
      if (m) m.textContent = "Ch\u01B0a \u0111o \u0111\u01B0\u1EE3c khung b\u1EA3n \u0111\u1ED3 \u2014 h\xE3y ph\xF3ng to ho\u1EB7c k\xE9o b\u1EA3n \u0111\u1ED3 r\u1ED3i th\u1EED l\u1EA1i.";
      return;
    }
    const w = Math.max(1, Math.round(se.x - nw.x)), h = Math.max(1, Math.round(se.y - nw.y));
    const view = $("animCanvas");
    if (view.width !== w || view.height !== h) {
      view.width = w;
      view.height = h;
    }
    const vctx = view.getContext("2d");
    vctx.globalCompositeOperation = "source-over";
    vctx.clearRect(0, 0, w, h);
    vctx.imageSmoothingEnabled = true;
    vctx.imageSmoothingQuality = "high";
    vctx.drawImage(small, 0, 0, n, n, -1, -1, w + 2, h + 2);
    animDrawContours(ctx, small, grid, spec, hour);
    animPlaceCanvas();
  }
  function animDrawContours(ctx, small, grid, spec, hour) {
    if (anim.contours) return;
    if ((radarMap?.getZoom() || 0) < 5) return;
    const n = grid.n, nh = grid.hours.length;
    const at = (row, col) => {
      if (row < 0 || col < 0 || row >= n || col >= n) return null;
      const v = grid.fields[spec.field][(row * n + col) * nh + hour];
      return E.finite(v) ? v : null;
    };
    let lo = Infinity, hi = -Infinity;
    for (let row = 0; row < n; row++) {
      for (let col = 0; col < n; col++) {
        const v = at(row, col);
        if (v != null) {
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
      }
    }
    if (!(hi > lo)) return;
    const lv = [];
    for (let i = 1; i <= 6; i++) lv.push(lo + (hi - lo) * i / 7);
    ctx.clearRect(0, 0, small.width, small.height);
    ctx.strokeStyle = "rgba(255,255,255,0.55)";
    ctx.lineWidth = Math.max(0.1, 1.2 / n);
    ctx.beginPath();
    const edge = (va, vb, p0, p1, level, out) => {
      if (va == null || vb == null || va === vb) return;
      if (va < level === vb < level) return;
      const t = (level - va) / (vb - va);
      out.push([p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t]);
    };
    for (let row = 0; row < n - 1; row++) {
      for (let col = 0; col < n - 1; col++) {
        const a = at(row, col), b = at(row, col + 1), c = at(row + 1, col + 1), d = at(row + 1, col);
        if (a == null || b == null || c == null || d == null) continue;
        const x = col, y = row;
        for (const level of lv) {
          const pts = [];
          edge(a, b, [x, y], [x + 1, y], level, pts);
          edge(b, c, [x + 1, y], [x + 1, y + 1], level, pts);
          edge(c, d, [x + 1, y + 1], [x, y + 1], level, pts);
          edge(d, a, [x, y + 1], [x, y], level, pts);
          if (pts.length < 2) continue;
          let best = null, bestLen = Infinity;
          for (let i = 0; i < pts.length; i++) {
            for (let j = i + 1; j < pts.length; j++) {
              const dd = (pts[i][0] - pts[j][0]) ** 2 + (pts[i][1] - pts[j][1]) ** 2;
              if (dd < bestLen) {
                bestLen = dd;
                best = [pts[i], pts[j]];
              }
            }
          }
          if (!best || bestLen > 1.6) continue;
          ctx.moveTo(best[0][0], best[0][1]);
          ctx.lineTo(best[1][0], best[1][1]);
        }
      }
    }
    ctx.stroke();
  }
  function animParticlePoint(grid, p) {
    const n = grid.n;
    return radarMap.latLngToContainerPoint([
      grid.lat0 + p.y * (n - 1) * grid.step,
      grid.lon0 + p.x * (n - 1) * grid.step
    ]);
  }
  function animDrawParticles(grid, hour, dt) {
    if (!anim.particlesOn) return;
    const view = $("animCanvas");
    const pc = $("animParticles");
    if (!view.width) return;
    const pctx = pc.getContext("2d");
    if (pc.width !== view.width || pc.height !== view.height) {
      pc.width = view.width;
      pc.height = view.height;
    }
    pctx.globalCompositeOperation = "destination-out";
    pctx.fillStyle = "rgba(0,0,0,0.18)";
    pctx.fillRect(0, 0, pc.width, pc.height);
    pctx.globalCompositeOperation = "source-over";
    const vis = animVisibleFraction(grid);
    const step = Math.max(0.35, dt / 16);
    const stops = ANIM_SCALES.wind.stops;
    for (const p of animParticles) {
      const spd = animSample(grid, "wind_speed_10m", p.x, p.y, hour);
      const dir = animSample(grid, "wind_direction_10m", p.x, p.y, hour);
      p.age -= 1;
      if (p.age <= 0 || spd == null || dir == null || p.x < vis.x0 || p.x > vis.x1 || p.y < vis.y0 || p.y > vis.y1) {
        animSpawn(p, vis);
        continue;
      }
      p.fade = Math.min(1, p.fade + 0.06);
      const rad = dir * Math.PI / 180;
      const degPerHour = spd * (grid.step * 111 / (grid.n - 1)) / 3600;
      p.x -= Math.sin(rad) * degPerHour * step * 5;
      p.y -= Math.cos(rad) * degPerHour * step * 5;
      const pt = animParticlePoint(grid, p);
      const len = 1.5 + spd * 0.13;
      const c = animColour(stops, spd);
      const alpha = 0.3 + 0.55 * p.fade;
      pctx.strokeStyle = `rgba(${c[0]},${c[1]},${c[2]},${alpha.toFixed(3)})`;
      pctx.lineWidth = 1.1;
      pctx.beginPath();
      pctx.moveTo(pt.x, pt.y);
      pctx.lineTo(pt.x + Math.sin(rad) * len, pt.y - Math.cos(rad) * len);
      pctx.stroke();
    }
  }
  function animValueAt(containerPoint) {
    const g = anim.grid;
    if (!g) return null;
    const ll = radarMap.containerPointToLatLng(containerPoint);
    const span = (g.n - 1) * g.step;
    const fx = (ll.lng - g.lon0) / span;
    const fy = (ll.lat - g.lat0) / span;
    if (fx < 0 || fx > 1 || fy < 0 || fy > 1) return { outside: true, lat: ll.lat, lon: ll.lng };
    const spec = ANIM_SCALES[anim.varKey];
    const hour = anim.hour;
    const out = { outside: false, lat: ll.lat, lon: ll.lng, label: spec.label, unit: spec.unit };
    if (anim.varKey === "wind") {
      const s = animSample(g, "wind_speed_10m", fx, fy, hour);
      const d = animSample(g, "wind_direction_10m", fx, fy, hour);
      if (s == null || d == null) return null;
      out.value = `${E.round(s, 1)} km/h \xB7 h\u01B0\u1EDBng ${E.round(d, 0)}\xB0`;
      out.color = animColour(ANIM_SCALES.wind.stops, s);
    } else {
      if (!g.fields[spec.field]) return null;
      const v = animSample(g, spec.field, fx, fy, hour);
      if (v == null) return null;
      out.value = anim.varKey === "storm" ? `${E.round(v, 2)} (0\u20131) \u2014 m\u1EE9c ${esc((stormLevel(v, (stormReference() || {}).loc?.bands)?.name || "\u2014").toLowerCase())}` : `${E.round(v, 1)} ${spec.unit}`;
      out.color = animColour(spec.stops, v);
    }
    return out;
  }
  function animShowReadout(containerPoint) {
    const box = $("animReadout");
    if (!box) return;
    const r = animValueAt(containerPoint);
    if (!r) {
      box.hidden = true;
      return;
    }
    if (r.outside) {
      box.hidden = false;
      box.innerHTML = `<span class="tiny">Ngo\xE0i ph\u1EA1m vi l\u01B0\u1EDBi \u0111\xE3 t\u1EA3i (${E.round(r.lat, 2)}\xB0, ${E.round(r.lon, 2)}\xB0). K\xE9o b\u1EA3n \u0111\u1ED3 \u0111\u1EC3 l\u01B0\u1EDBi t\u1EA3i theo v\xF9ng \u0111ang xem.</span>`;
      return;
    }
    const [cr, cg, cb] = r.color;
    box.hidden = false;
    box.innerHTML = `<i style="background:rgb(${cr},${cg},${cb})"></i><strong>${esc(r.label)}:</strong> ${esc(r.value)}<span class="tiny"> @ ${E.round(r.lat, 2)}\xB0, ${E.round(r.lon, 2)}\xB0 \xB7 \xF4 l\u01B0\u1EDBi ${anim.grid.km} km</span>`;
  }
  function animTick(now) {
    if (!anim.on || !anim.grid) return;
    const dt = anim.last ? Math.min(90, now - anim.last) : 16;
    anim.last = now;
    if (anim.dirty || now - (anim.drawnAt || 0) > 300) {
      anim.dirty = false;
      anim.drawnAt = now;
      animDrawField(anim.grid, anim.hour);
      animUpdateTimeLabel();
    }
    animDrawParticles(anim.grid, anim.hour, dt);
    anim.raf = requestAnimationFrame(animTick);
  }
  function animUpdateTimeLabel() {
    const g = anim.grid;
    const el = $("animTime");
    if (el && g) {
      const d = /* @__PURE__ */ new Date(g.hours[anim.hour] + ":00+07:00");
      el.textContent = d.toLocaleString("vi-VN", {
        timeZone: "Asia/Ho_Chi_Minh",
        weekday: "short",
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit"
      });
    }
    const sl = $("animSlider");
    if (sl && +sl.value !== anim.hour) sl.value = anim.hour;
  }
  function animLegendHtml() {
    const spec = ANIM_SCALES[anim.varKey];
    const s = spec.stops;
    const bar = s.map((st, i) => `${st[1]} ${i / (s.length - 1) * 100}%`).join(", ");
    const ticks = s.map((st, i) => i % 2 === 0 || i === s.length - 1 ? `<span style="left:${i / (s.length - 1) * 100}%">${st[0]}</span>` : "").join("");
    const g = anim.grid;
    if (anim.varKey === "storm") {
      return '<strong>Nguy c\u01A1 b\xE3o t\u1ED1 (\u0111i\u1EC3m 0\u20131)</strong><span class="anim-ramp" style="background:linear-gradient(90deg,' + s.map((st, i) => `${st[1]} ${i / (s.length - 1) * 100}%`).join(", ") + ')"></span><span class="tiny">Gh\xE9p t\u1EEB CAPE, lifted index v\xE0 CIN c\u1EE7a m\xF4 h\xECnh \u2014 l\xE0 ch\u1EC9 s\u1ED1 n\u0103ng l\u01B0\u1EE3ng \u0111\u1ED1i l\u01B0u, KH\xD4NG ph\u1EA3i d\u1EF1 b\xE1o tia s\xE9t (kh\xF4ng c\xF3 ngu\u1ED3n m\u1EDF n\xE0o c\u1EA5p d\u1EEF li\u1EC7u s\xE9t \u1EDF Vi\u1EC7t Nam). M\u1EE9c \u0111\xE3 hi\u1EC7u chu\u1EA9n tr\xEAn 12 th\xE1ng v\xE0 ch\u1EA5m \u0111i\u1EC3m \u1EDF tab Ph\u01B0\u01A1ng ph\xE1p. ' + stormSkillSentence() + " D\xF9ng \u0111\u1EC3 bi\u1EBFt l\xFAc n\xE0o kh\xED quy\u1EC3n d\u1EC5 b\u1ED1c l\xEAn, KH\xD4NG d\xF9ng l\xE0m c\u1EA3nh b\xE1o.</span>";
    }
    return `<strong>${spec.label} (${spec.unit})</strong><span class="anim-ramp" style="background:linear-gradient(90deg,${bar})">${ticks}</span><span class="tiny">L\u01B0\u1EDBi ${g ? g.n + "\xD7" + g.n : "\u2014"} \u0111i\u1EC3m, m\u1ED7i \xF4 ${g ? g.km : "\u2014"} km${g && g.step <= 0.25 ? " \u2014 \u0111\xFAng \u0111\u1ED9 ph\xE2n gi\u1EA3i g\u1ED1c 0,25\xB0 c\u1EE7a m\xF4 h\xECnh" : " \u2014 \xF4 th\u01B0a h\u01A1n v\xEC \u0111ang nh\xECn v\xF9ng r\u1ED9ng"}. ` + (g && g.fallbackFrom ? `H\u1EA1n m\u1EE9c l\u01B0\u1EE3t g\u1ECDi bu\u1ED9c ph\u1EA3i d\xF9ng \xF4 th\u01B0a h\u01A1n m\u1EE9c mong mu\u1ED1n. ` : "") + `\u1EA2nh ph\u1EB3ng \u0111\u01B0\u1EE3c n\u1ED9i suy b\u1EB1ng tr\xECnh duy\u1EC7t cho m\u01B0\u1EE3t; n\xF3 kh\xF4ng th\xEAm th\xF4ng tin n\xE0o ngo\xE0i d\u1EEF li\u1EC7u g\u1ED1c. C\xF9ng d\u1EEF li\u1EC7u n\xE0y \u0111\xE3 \u0111\u01B0\u1EE3c hi\u1EC7u ch\u1EC9nh v\xE0 ki\u1EC3m th\u1EED \u1EDF tab Ph\u01B0\u01A1ng ph\xE1p.</span>`;
  }
  function animPlaceCanvas() {
    if (!anim.grid || !radarMap) return;
    const g = anim.grid;
    const nw = radarMap.latLngToContainerPoint([g.lat0 + (g.n - 1) * g.step, g.lon0]);
    for (const id of ["animCanvas", "animParticles"]) {
      const c = $(id);
      if (c) {
        c.style.left = nw.x + "px";
        c.style.top = nw.y + "px";
      }
    }
  }
  function animRefreshSoon() {
    if (!anim.on) return;
    if (anim.refreshTimer) clearTimeout(anim.refreshTimer);
    anim.refreshTimer = setTimeout(() => animRefreshNow(), 1200);
  }
  var animRefreshBusy = false;
  async function animRefreshNow(force) {
    if (!anim.on || animRefreshBusy) return;
    const tier = animTierForView();
    const center = animCenterForView();
    const cur = anim.grid;
    const needs = ANIM_NEEDS[anim.varKey] || [ANIM_SCALES[anim.varKey].field];
    const hasAll = cur && needs.every((f) => cur.fields[f]);
    if (!force && hasAll && animGridCoversView(cur)) return;
    animRefreshBusy = true;
    const msg = $("animMsg");
    if (msg) msg.textContent = "\u0110ang t\u1EA3i l\u01B0\u1EDBi cho v\xF9ng \u0111ang xem\u2026";
    try {
      const g = await fetchAnimGridWithFallback(anim.varKey, tier, center, (done, total) => {
        if (msg) msg.textContent = `\u0110ang t\u1EA3i l\u01B0\u1EDBi cho v\xF9ng \u0111ang xem\u2026 ${done}/${total} ph\u1EA7n`;
      });
      if (!anim.on) return;
      anim.grid = g;
      anim.dirty = true;
      const lg = $("animLegend");
      if (lg) lg.innerHTML = animLegendHtml();
      animSeedParticles(anim.grid);
      animPlaceCanvas();
      animDrawField(anim.grid, anim.hour);
      anim.drawnAt = performance.now();
      anim.dirty = false;
      if (msg) msg.textContent = "";
    } catch (e) {
      if (msg) msg.textContent = "Gi\u1EEF l\u01B0\u1EDBi c\u0169: " + e.message;
    } finally {
      animRefreshBusy = false;
    }
  }
  async function setAnimLayer(on) {
    const msg = $("animMsg");
    const btn = $('animToggle');
    if (!on) {
      anim.on = false;
      animPlay(false);
      if (anim.raf) cancelAnimationFrame(anim.raf);
      if (anim.refreshTimer) clearTimeout(anim.refreshTimer);
      anim.timer = anim.raf = anim.refreshTimer = 0;
      for (const id of ["animCanvas", "animParticles"]) {
        const c = $(id);
        if (c) c.style.display = "none";
      }
      if ($("animControls")) $("animControls").hidden = true;
      if (btn) {
        btn.textContent = "B\u1EADt b\u1EA3n \u0111\u1ED3 d\u1EF1 b\xE1o \u0111\u1ED9ng";
        btn.classList.add("primary");
        btn.classList.remove("secondary");
      }
      return;
    }
    if (!radarMap) {
      if (msg) msg.textContent = "H\xE3y m\u1EDF b\u1EA3n \u0111\u1ED3 radar tr\u01B0\u1EDBc khi b\u1EADt l\u1EDBp \u0111\u1ED9ng.";
      return;
    }
    const tier = animTierForView();
    if (msg) msg.textContent = `\u0110ang t\u1EA3i ${ANIM_SCALES[anim.varKey].label.toLowerCase()} tr\xEAn l\u01B0\u1EDBi ${tier.n * tier.n} \u0111i\u1EC3m, m\u1ED7i \xF4 ${Math.round(tier.step * 111)} km\u2026`;
    try {
      anim.grid = await fetchAnimGridWithFallback(anim.varKey, tier, animCenterForView(), (done, total) => {
        if (msg) msg.textContent = `\u0110ang t\u1EA3i l\u01B0\u1EDBi\u2026 ${done}/${total} ph\u1EA7n`;
      });
    } catch (e) {
      if (msg) {
        msg.textContent = e.quota ? "Open-Meteo \u0111\xE3 h\u1EBFt h\u1EA1n m\u1EE9c l\u01B0\u1EE3t g\u1ECDi trong gi\u1EDD n\xE0y. B\u1EA3n \u0111\u1ED3 \u0111\u1ED9ng s\u1EBD tr\u1EDF l\u1EA1i khi h\u1EA1n m\u1EE9c reset \u2014 ph\u1EA7n d\u1EF1 b\xE1o d\u1EA1ng b\u1EA3ng \u1EDF tab D\u1EF1 b\xE1o kh\xF4ng b\u1ECB \u1EA3nh h\u01B0\u1EDFng." : "Kh\xF4ng t\u1EA3i \u0111\u01B0\u1EE3c l\u01B0\u1EDBi d\u1EF1 b\xE1o: " + e.message;
      }
      return;
    }
    if (!anim.fieldCanvas) anim.fieldCanvas = document.createElement("canvas");
    const nowKey = new Date(Date.now() + 7 * 36e5).toISOString().slice(0, 13);
    const idx = anim.grid.hours.findIndex((h) => h.slice(0, 13) >= nowKey);
    anim.hour = idx >= 0 ? idx : 0;
    anim.on = true;
    anim.dirty = true;
    anim.particlesOn = anim.varKey === "wind";
    for (const id of ["animCanvas", "animParticles"]) {
      const c = $(id);
      if (c) c.style.display = "block";
    }
    $("animControls").hidden = false;
    if (btn) {
      btn.textContent = "T\u1EAFt b\u1EA3n \u0111\u1ED3 d\u1EF1 b\xE1o \u0111\u1ED9ng";
      btn.classList.remove("secondary");
      btn.classList.add("primary");
    }
    const sl = $("animSlider");
    if (sl) {
      sl.max = anim.grid.hours.length - 1;
      sl.value = anim.hour;
    }
    if ($("animLegend")) $("animLegend").innerHTML = animLegendHtml();
    const ptg = $("animParticlesToggle");
    if (ptg) ptg.checked = anim.particlesOn;
    animUpdateTimeLabel();
    if (msg) {
      msg.textContent = anim.grid.fallbackFrom ? `H\u1EA1n m\u1EE9c l\u01B0\u1EE3t g\u1ECDi n\xEAn \u0111\xE3 d\xF9ng \xF4 ${anim.grid.km} km thay v\xEC ${Math.round(anim.grid.fallbackFrom * 111)} km.` : "";
    }
    if (!anim.bound) {
      anim.bound = true;
      radarMap.on("move zoom resize", () => {
        anim.dirty = true;
        animPlaceCanvas();
        animRefreshSoon();
      });
      radarMap.on("click", (e) => animShowReadout(e.containerPoint));
      radarMap.on("mousemove", (e) => {
        if (anim.dragging) return;
        animShowReadout(e.containerPoint);
      });
      radarMap.on("dragstart", () => {
        anim.dragging = true;
      });
      radarMap.on("dragend", () => {
        anim.dragging = false;
      });
    }
    animSeedParticles(anim.grid);
    if (anim.raf) cancelAnimationFrame(anim.raf);
    anim.last = 0;
    animDrawField(anim.grid, anim.hour);
    for (let i = 0; i < 40; i++) animDrawParticles(anim.grid, anim.hour, 16);
    anim.raf = requestAnimationFrame(animTick);
  }
  function animPlay(on) {
    anim.playing = on;
    const b = $('animPlay');
    if (b) b.textContent = on ? "\u23F8 T\u1EA1m d\u1EEBng" : "\u25B6 Ph\xE1t";
    if (anim.timer) {
      clearInterval(anim.timer);
      anim.timer = 0;
    }
    if (!on || !anim.grid) return;
    anim.timer = setInterval(() => {
      anim.hour = (anim.hour + 1) % anim.grid.hours.length;
      anim.dirty = true;
      animUpdateTimeLabel();
    }, 700);
  }
  function animSetVar(key) {
    if (!ANIM_SCALES[key]) return;
    anim.varKey = key;
    anim.dirty = true;
    anim.particlesOn = key === "wind";
    const pc = $("animParticles");
    if (pc) pc.getContext("2d").clearRect(0, 0, pc.width, pc.height);
    const sel = $("animVar");
    if (sel) sel.value = key;
    if ($("animLegend")) $("animLegend").innerHTML = animLegendHtml();
    const lbl = $("animParticlesNote");
    if (lbl) lbl.hidden = key !== "wind";
    if (!anim.on) {
      setAnimLayer(true);
      return;
    }
    if (anim.grid) animDrawField(anim.grid, anim.hour);
    if (anim.particlesOn && anim.grid) {
      for (let i = 0; i < 40; i++) animDrawParticles(anim.grid, anim.hour, 16);
    }
    animPlaceCanvas();
  }
  function animToggleLayer(name, on) {
    if (name === "contours") {
      anim.contours = on;
      anim.dirty = true;
      if (!on) {
        const c = anim.fieldCanvas;
        if (c) c.getContext("2d").clearRect(0, 0, c.width, c.height);
        anim.dirty = true;
      }
    } else if (name === "particles") {
      anim.particlesOn = on && anim.varKey === "wind";
      if (!on) {
        const pc = $("animParticles");
        if (pc) pc.getContext("2d").clearRect(0, 0, pc.width, pc.height);
      }
    }
  }
  var ALERT_RANK = { Green: 1, Orange: 2, Red: 3 };
  async function loadTropicalCyclones() {
    const box = $("tcList");
    const meta = $("tcMeta");
    if (!box) return;
    box.innerHTML = '<p class="muted">\u0110ang t\u1EA3i v\u1ECB tr\xED xo\xE1y nhi\u1EC7t \u0111\u1EDBi\u2026</p>';
    const now = /* @__PURE__ */ new Date();
    const from = new Date(now.getTime() - 10 * 864e5).toISOString().slice(0, 10);
    const to = new Date(now.getTime() + 6 * 864e5).toISOString().slice(0, 10);
    try {
      const r = await fetch(`https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?fromDate=${from}&toDate=${to}`, { signal: timeoutSignal(3e4) });
      const j = await r.json();
      if (j.error) throw new Error(j.reason || "l\u1ED7i GDACS");
      const byStorm = /* @__PURE__ */ new Map();
      for (const f of j.features || []) {
        const p = f.properties || {};
        if (p.eventtype !== "TC") continue;
        const key = p.glide || p.eventname;
        if (!byStorm.has(key)) byStorm.set(key, { name: p.name || p.eventname, url: p.url, track: [] });
        const s = byStorm.get(key);
        if (p.alertlevel && (!s.alertRank || (ALERT_RANK[p.alertlevel] || 0) > (ALERT_RANK[s.alertRank] || 0))) s.alertRank = p.alertlevel;
        if (f.geometry && f.geometry.type === "Point") {
          s.track.push({ lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0], t: p.fromdate });
        }
      }
      const storms = [...byStorm.values()].map((s) => {
        s.track.sort((a, b) => String(a.t || "").localeCompare(String(b.t || "")));
        const last = s.track[s.track.length - 1];
        if (!last) return null;
        let approach = null;
        if (s.track.length >= 2) {
          const a = s.track[s.track.length - 2], b = last;
          approach = E.bearingDeg({ lat: a.lat, lon: a.lon }, b);
        }
        return {
          ...s,
          last,
          approach,
          km: E.round(E.distanceKm(place, last), 0),
          bearing: E.bearingDeg(place, last)
        };
      }).filter(Boolean).sort((a, b) => a.km - b.km);
      if (!storms.length) {
        box.innerHTML = '<p class="muted">Kh\xF4ng c\xF3 xo\xE1y nhi\u1EC7t \u0111\u1EDBi n\xE0o \u0111ang ho\u1EA1t \u0111\u1ED9ng trong c\u1EEDa s\u1ED5 10 ng\xE0y qua \u0111\u1EBFn 6 ng\xE0y t\u1EDBi theo GDACS.</p>';
        if (meta) meta.textContent = "0 c\u01A1n";
        return;
      }
      box.innerHTML = storms.map((s) => {
        const rank = ALERT_RANK[s.alertRank] === 3 ? "red" : ALERT_RANK[s.alertRank] === 2 ? "orange" : "yellow";
        return `<div class="alert-item ${rank}">
        <h4>${esc(s.name)}${s.alertRank ? ` <span class="warn-chip ${rank}">${esc(s.alertRank)}</span>` : ""}</h4>
        <p>T\xE2m t\u1EA1i ${fmt(Math.abs(s.last.lat), 2)}\xB0 ${s.last.lat >= 0 ? "B" : "N"} \xB7 ${fmt(Math.abs(s.last.lon), 2)}\xB0 ${s.last.lon >= 0 ? "\u0110" : "T"} \u2014 c\xE1ch \u0111\xE2y <strong>${fmt(s.km, 0)} km</strong> v\u1EC1 ph\xEDa ${compass(s.bearing)}.</p>
        ${s.approach != null ? `<p class="small">H\u01B0\u1EDBng ti\u1EBFn g\u1EA7n nh\u1EA5t theo c\xE1c v\u1ECB tr\xED GDACS: <strong>${compass(s.approach)}</strong> (${fmt(s.approach, 0)}\xB0). \u0110\xE2y l\xE0 h\u01B0\u1EDBng \u0111i qua c\xE1c \u0111i\u1EC3m quan s\xE1t g\u1EA7n nh\u1EA5t, kh\xF4ng ph\u1EA3i d\u1EF1 b\xE1o ch\xEDnh th\u1EE9c.</p>` : ""}
        <p class="meta">${s.last.t ? "C\u1EADp nh\u1EADt " + esc(String(s.last.t).slice(0, 16)).replace("T", " ") + " UTC \xB7 " : ""}<a href="${esc(s.url || "https://www.gdacs.org/")}" target="_blank" rel="noopener">GDACS</a> \xB7 <a href="https://www.jtwc.navy.mil/" target="_blank" rel="noopener">JTWC</a></p>
      </div>`;
      }).join("");
      if (meta) meta.textContent = storms.length + " c\u01A1n \xB7 g\u1EA7n nh\u1EA5t " + fmt(storms[0].km, 0) + " km";
    } catch (e) {
      box.innerHTML = `<p class="small">Kh\xF4ng l\u1EA5y \u0111\u01B0\u1EE3c d\u1EEF li\u1EC7u xo\xE1y nhi\u1EC7t \u0111\u1EDBi: ${esc(e.message)}</p>`;
      if (meta) meta.textContent = "l\u1ED7i";
    }
  }
  async function loadAlerts() {
    const loc = disasterLoc || { name: place.name, lat: place.lat, lon: place.lon };
    $("alertsList").innerHTML = '<p class="muted">\u0110ang l\u1EA5y d\u1EEF li\u1EC7u t\u1EEB USGS\u2026</p>';
    try {
      const r = await fetch("https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/significant_month.geojson", {
        signal: timeoutSignal(25e3)
      });
      const j = await r.json();
      const features = (j.features || []).map((f) => {
        const [lon, lat] = f.geometry?.coordinates || [null, null];
        return { f, km: E.finite(lat) && E.finite(lon) ? E.distanceKm(loc, { lat, lon }) : null, lat, lon };
      });
      $("alertsMeta").textContent = `${features.length} s\u1EF1 ki\u1EC7n \xB7 USGS \xB7 30 ng\xE0y \xB7 t\xEDnh t\u1EEB ${loc.name}`;
      if (alertLayer) alertLayer.clearLayers();
      if (!features.length) {
        $("alertsList").innerHTML = '<p class="muted">Kh\xF4ng c\xF3 s\u1EF1 ki\u1EC7n USGS trong 30 ng\xE0y.</p>';
        return;
      }
      const sevColor = (mag) => mag >= 6 ? "red" : mag >= 5 ? "orange" : mag >= 4.5 ? "yellow" : "green";
      const mapColor = { red: "#c0392b", orange: "#e67e22", yellow: "#f1c40f", green: "#27ae60" };
      const NEAR_KM = 1e3;
      const ranked = features.sort((a, b) => (a.km ?? 1e9) - (b.km ?? 1e9)).slice(0, 25);
      if (alertLayer && typeof L !== "undefined") {
        for (const { f, lat, lon } of ranked) {
          if (!E.finite(lat) || !E.finite(lon)) continue;
          const p = f.properties;
          L.circleMarker([lat, lon], {
            radius: Math.min(12, 4 + p.mag),
            color: mapColor[sevColor(p.mag)],
            weight: 2,
            fillOpacity: 0.55
          }).addTo(alertLayer).bindPopup(`<strong>M${p.mag.toFixed(1)} \xB7 ${esc(p.place)}</strong><br><a href="${p.url}" target="_blank" rel="noopener">chi ti\u1EBFt USGS</a>`);
        }
        drawDisasterPin();
      }
      $("alertsList").innerHTML = ranked.map(({ f, km }) => {
        const p = f.properties;
        const when = new Date(p.time).toLocaleString("vi-VN", { timeZone: "UTC" });
        const near = km !== null && km < NEAR_KM;
        return `<div class="alert-item ${sevColor(p.mag)}"><h4>${p.mag.toFixed(1)} \xB7 ${esc(p.place)}${near ? ' <span class="near-badge">G\u1EA6N V\u1ECA TR\xCD \u0110ANG XEM</span>' : ""}</h4><p>C\xE1ch ${esc(loc.name)} kho\u1EA3ng ${km !== null ? fmt(km, 0) + " km" : "kh\xF4ng r\xF5"} \xB7 ${when} UTC.</p><div class="meta">USGS \xB7 <a href="${p.url}" target="_blank" rel="noopener">chi ti\u1EBFt s\u1EF1 ki\u1EC7n</a></div></div>`;
      }).join("");
    } catch (e) {
      $("alertsList").innerHTML = `<p class="muted">Kh\xF4ng l\u1EA5y \u0111\u01B0\u1EE3c USGS: ${esc(e.message)}. Fox News / GDACS xem link b\xEAn ph\u1EA3i.</p>`;
      $("alertsMeta").textContent = "l\u1ED7i t\u1EA3i";
    }
  }
  function initDisasterTab() {
    renderDisasterChips();
    initDisasterSearch();
    initAnimControls();
    $("disasterRefreshRadar").onclick = () => {
      radarStop(false);
      if (radarMap) {
        try {
          radarMap.remove();
        } catch (e) {
        }
        radarMap = null;
      }
      radarLayer = null;
      radarFadeLayer = null;
      document.getElementById("radarMap").innerHTML = '<div id="radarMsg" class="notice">\u0110ang t\u1EA3i l\u1EA1i radar\u2026</div><canvas id="animCanvas" class="anim-canvas" aria-hidden="true" style="display:none"></canvas><canvas id="animParticles" class="anim-canvas" aria-hidden="true" style="display:none"></canvas>';
      radarInitialized = false;
      anim.grid = null;
      anim.cache.clear();
      const wantAnim = anim.on;
      anim.bound = false;
      initRadar();
      initAnimControls();
      if (wantAnim) initRadar().then(() => setAnimLayer(true));
    };
    $("disasterLoadAlerts").onclick = () => {
      loadAlerts();
      loadTropicalCyclones();
    };
    $("airGridToggle").onclick = () => {
      const on = radarMap && airLayer && radarMap.hasLayer(airLayer);
      if (on) {
        radarMap.removeLayer(airLayer);
        $("airGridToggle").textContent = "B\u1EADt kh\u1ED1i kh\xED tr\xEAn b\u1EA3n \u0111\u1ED3";
        $("airGridToggle").classList.remove("primary");
        $("airGridToggle").classList.add("secondary");
      } else {
        if (!airGrid) {
          $("airGridToggle").textContent = "\u0110ang t\u1EA3i\u2026";
          loadAirGrid();
        }
        if (airGrid && radarMap && airLayer) {
          airLayer.addTo(radarMap);
          $("airGridToggle").textContent = "T\u1EAFt kh\u1ED1i kh\xED tr\xEAn b\u1EA3n \u0111\u1ED3";
          $("airGridToggle").classList.remove("secondary");
          $("airGridToggle").classList.add("primary");
        }
      }
    };
  }
  function initAnimControls() {
    const t = $('animToggle');
    if (t) t.onclick = () => setAnimLayer(!anim.on);
    const p = $('animPlay');
    if (p) p.onclick = () => animPlay(!anim.playing);
    const v = $("animVar");
    if (v) v.onchange = () => animSetVar(v.value);
    const s = $("animSlider");
    if (s) {
      s.oninput = () => {
        anim.hour = +s.value;
        anim.dirty = true;
        animUpdateTimeLabel();
      };
      s.onchange = () => animPlay(false);
    }
    const c = $("animContours");
    if (c) c.onchange = () => animToggleLayer("contours", c.checked);
    const pt = $("animParticlesToggle");
    if (pt) pt.onchange = () => animToggleLayer("particles", pt.checked);
    const op = $("animOpacity");
    if (op) {
      const apply = () => {
        const v2 = +op.value / 100;
        const field = $("animCanvas"), part = $("animParticles");
        if (field) field.style.opacity = v2;
        if (part) part.style.opacity = Math.min(1, 0.35 + v2 * 0.72);
      };
      op.oninput = apply;
      apply();
    }
  }
  var disasterSearchRequest = 0;
  function initDisasterSearch() {
    $("disasterSearchForm").onsubmit = async (e) => {
      e.preventDefault();
      const token = ++disasterSearchRequest;
      const q = $("disasterSearch").value.trim();
      $("disasterSearchResults").textContent = "\u0110ang t\xECm trong 2 ngu\u1ED3n d\u1EEF li\u1EC7u \u0111\u1ECBa danh\u2026";
      try {
        const { items, errors } = await searchPlaces(q);
        if (token !== disasterSearchRequest) return;
        $("disasterSearchResults").innerHTML = "";
        if (!items.length) {
          $("disasterSearchResults").textContent = errors.length ? "C\u1EA3 hai ngu\u1ED3n \u0111\u1EC1u l\u1ED7i (" + errors.join("; ") + "). Ki\u1EC3m tra k\u1EBFt n\u1ED1i r\u1ED3i th\u1EED l\u1EA1i." : emptySearchHint(q);
          return;
        }
        const meta = document.createElement("p");
        meta.className = "small";
        meta.textContent = `T\xECm th\u1EA5y ${items.length} k\u1EBFt qu\u1EA3 cho "${q}" \u2014 ch\u1ECDn m\u1ED9t n\u01A1i \u0111\u1EC3 xem radar v\xE0 c\u1EA3nh b\xE1o.`;
        $("disasterSearchResults").append(meta);
        items.forEach((it) => {
          const b = document.createElement("button");
          b.type = "button";
          b.innerHTML = `${esc(it.name)} <span class="tiny">${esc(it.sub)} \xB7 ${esc(it.source)}</span>`;
          b.onclick = () => {
            disasterFollow = false;
            disasterLoc = { name: it.name, lat: it.lat, lon: it.lon };
            $("disasterSearchResults").innerHTML = "";
            renderDisasterChips();
            applyDisasterLoc(true);
          };
          $("disasterSearchResults").append(b);
        });
      } catch (err) {
        $("disasterSearchResults").textContent = "Kh\xF4ng t\xECm \u0111\u01B0\u1EE3c \u0111\u1ECBa \u0111i\u1EC3m: " + err.message;
      }
    };
  }
  function wireTabs() {
    document.querySelectorAll(".tab").forEach((b) => {
      b.onclick = () => {
        document.querySelectorAll(".tab").forEach((x) => x.classList.toggle("active", x === b));
        document.querySelectorAll(".view").forEach((x) => {
          x.hidden = x.id !== b.dataset.view;
        });
        if (b.dataset.view === "disaster") {
          initRadar();
          setTimeout(() => {
            if (radarMap) radarMap.invalidateSize();
          }, 120);
        }
        if (b.dataset.view === "disaster" && !$("tcMeta").textContent.match(/\d/)) loadTropicalCyclones();
        if (b.dataset.view === "news") {
          renderNchmf();
          renderIntlNews();
        }
      };
    });
  }
  function wireForecastControls() {
    const refreshBtn = $("refresh");
    if (refreshBtn) refreshBtn.onclick = () => loadForecast();
    const exportBtn = $("exportForecast");
    if (exportBtn) exportBtn.onclick = exportForecast;
    const chartVar = $("chartVariable");
    if (chartVar) chartVar.onchange = () => renderChart();
    const hor = $("horizon");
    if (hor) hor.onchange = () => renderChart();
    const bands = $("showBands");
    if (bands) bands.onchange = () => renderChart();
    const reloadNewsBtn = $("btnReloadNews");
    if (reloadNewsBtn) reloadNewsBtn.onclick = () => fetchLatestNchmf();
  }
  if (typeof window !== "undefined") {
    window.fetchLatestNchmf = fetchLatestNchmf;
    window.renderNchmf = renderNchmf;
    window.filterNews = renderIntlNews;
    window.loadDisasterData = () => {
      loadAlerts();
      loadTropicalCyclones();
    };
    window.syncDisasterToPlace = syncDisasterToPlace;
  }
  async function initApp() {
    if (!report.locations || !report.locations[0]?.tests?.length) {
      try {
        const r = await fetch("./benchmark.json", { cache: "no-cache" });
        if (r.ok) {
          const j = await r.json();
          if (j && j.variables && j.locations) {
            report = j;
            if (!restoreSavedPlace() && report.locations[0]) {
              place = { ...report.locations[0] };
            }
            if ($("chartVariable")) {
              $("chartVariable").innerHTML = LIVE_VARS.map((v) => `<option value="${v}">${esc(report.variables[v].label)} \xB7 ${esc(report.variables[v].unit)}</option>`).join("");
            }
            if ($("headModels")) {
              $("headModels").textContent = `${MODELS.length} H\u1EC6 TH\u1ED0NG \xB7 ${LIVE_VARS.length} BI\u1EBEN`;
            }
            if ($("introNote") && report.headline) {
              $("introNote").innerHTML = `M\u1ED7i gi\xE1 tr\u1ECB k\xE8m d\u1EA3i 10\u201390% v\xE0 x\xE1c su\u1EA5t v\u01B0\u1EE3t ng\u01B0\u1EE1ng.<br>T\u1EADp ki\u1EC3m tra: <strong>${fmt(report.headline.betterThanEqualWeight)}/${report.headline.evaluated}</strong> ph\xE9p ch\u1EA5m t\u1ED1t h\u01A1n trung b\xECnh \u0111\u1EC1u.`;
            }
          }
        }
      } catch (_e) {
      }
    }
    wireTabs();
    wireForecastControls();
    initDisasterTab();
    initNewsTab();
    initSelects();
    initSearch();
    initGeo();
    quickRender();
    renderNchmf();
    renderIntlNews();
    renderProtocol();
    renderTest();
    loadForecast();
    setTimeout(fetchLatestNchmf, 1200);
    if (!restoreSavedPlace()) {
      setTimeout(() => useDeviceLocation(true), 800);
    }
  }
  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => {
        void initApp();
      });
    } else {
      void initApp();
    }
  }
  return __toCommonJS(app_exports);
})();
//# sourceMappingURL=app.js.map
