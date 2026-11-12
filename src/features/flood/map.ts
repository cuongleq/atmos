/**
 * ATMOS Feature: Flood Map Visualization
 * Leaflet-based map components for flood risk, river gauges, and GloFAS data
 */

import L from 'leaflet';
import { 
  RiverSeries, 
  FloodForecast, 
  FloodForecastPoint,
  FloodRiskLevel,
  FloodForecastConfig,
  DEFAULT_FLOOD_CONFIG,
  FLOOD_RISK_LEVELS,
  getCategoryColor,
  getCategoryLabel,
} from '../flood/index.js';

/** Create flood risk map layer */
export function createFloodRiskLayer(
  map: L.Map,
  rivers: RiverSeries[],
  config: FloodForecastConfig = DEFAULT_FLOOD_CONFIG
): L.LayerGroup {
  const group = L.layerGroup();
  
  // Add river track layers
  for (const river of rivers) {
    const track = createRiverTrackLayer(river);
    track.addTo(group);
  }
  
  // Add river gauge markers
  const gauges = getRiverGauges(rivers);
  for (const gauge of gauges) {
    const marker = createGaugeMarker(gauge);
    marker.addTo(group);
  }
  
  // Add flood risk zones
  const riskZones = createRiskZones(rivers);
  riskZones.addTo(group);
  
  return group;
}

/** Create river track layer with uncertainty cone */
function createRiverTrackLayer(river: RiverSeries): L.LayerGroup {
  const group = L.layerGroup();
  const riskLevel = assessFloodRisk(river).riskLevel;
  const color = getRiskColor(riskLevel);
  
  // Past track (historical)
  if (river.history.length > 1) {
    const pastLatLngs = river.history.slice(-30).map((_, i) => [
      river.cell.lat + (Math.random() - 0.5) * 0.01, // Simulated - would use actual historical positions
      river.cell.lon + (Math.random() - 0.5) * 0.01
    ]);
    // In reality, would use actual historical positions from GloFAS
    
    const pastPolyline = L.polyline([], {
      color: color,
      weight: 2,
      opacity: 0.6,
      dashArray: '5, 5',
      lineCap: 'round',
      lineJoin: 'round',
    }).addTo(group);
  }
  
  // Forecast track
  if (river.forecast.length > 1) {
    const forecastLatLngs = river.forecast.slice(0, 7).map((_, i) => [
      river.cell.lat + (Math.random() - 0.5) * 0.01,
      river.cell.lon + (Math.random() - 0.5) * 0.01
    ]);
    
    const forecastPolyline = L.polyline([], {
      color: color,
      weight: 3,
      opacity: 0.9,
      lineCap: 'round',
      lineJoin: 'round',
    }).addTo(group);
    
    // Add forecast points
    for (let i = 0; i < Math.min(7, river.forecast.length); i++) {
      const q = river.forecast[i];
      if (finite(q)) {
        const riskLevel = assessRisk(q).riskLevel;
        const color = getRiskColor(riskLevel);
        L.circleMarker([river.cell.lat, river.cell.lon], {
          radius: 6 + assessRisk(river.forecast[i]).riskLevel * 2,
          fillColor: color,
          color: '#fff',
          weight: 2,
          opacity: 1,
          fillOpacity: 0.9,
        }).addTo(group).bindPopup(`
          <strong>Dự báo ${i * 12}h</strong><br>
          Lưu lượng: ${q.toFixed(1)} m³/s<br>
          Rủi ro: ${getRiskLabel(riskLevel)}
        `);
      }
    }
    }
  
  // Uncertainty cone (simplified)
  const cones = createUncertaintyCones(river);
  for (const cone of cones) {
    const conePolygon = L.polygon(cone.polygon.map(p => [p.lat, p.lon]), {
      color: color,
      weight: 1,
      opacity: 0.4,
      fillColor: color,
      fillOpacity: 0.1,
      dashArray: '8, 4',
    }).addTo(group);
    
    const forecastTime = new Date(cone.time).toLocaleString('vi-VN');
    conePolygon.bindTooltip(
      `Vùng không chắc chắn (${forecastTime})<br>Bán kính: ${cone.radius.toFixed(0)} km`,
      { permanent: false, direction: 'center' }
    );
  }
  
  // Current position marker
  const currentCategory = assessRisk(river.qMedianToday ?? river.qToday ?? 0).riskLevel;
  const marker = L.circleMarker([river.cell.lat, river.cell.lon], {
    radius: 10 + assessRisk(river.qMedianToday ?? river.qToday ?? 0).riskLevel * 3,
    fillColor: getRiskColor(riskLevel),
    color: '#fff',
    weight: 3,
    opacity: 1,
    fillOpacity: 0.95,
  }).addTo(group);
  
  marker.bindPopup(`
    <div style="min-width: 200px;">
      <h4 style="margin: 0 0 8px; color: ${getRiskColor(riskLevel)};">
        🌊 ${river.name || 'River'}
      </h4>
      <div style="font-size: 13px; line-height: 1.6;">
        <strong>Vị trí:</strong> ${river.cell.lat.toFixed(2)}°N, ${river.cell.lon.toFixed(2)}°E<br>
        <strong>Cập nhật:</strong> ${new Date().toLocaleString('vi-VN')}<br>
        <strong>Lưu lượng:</strong> ${finite(river.qMedianToday) ? river.qMedianToday!.toFixed(1) : '—'} kt (${finite(river.qMedianToday) ? (river.qMedianToday! * 1.852).toFixed(0) : '—'} km/h)<br>
        <strong>Cấp độ:</strong> ${getRiskLabel(assessRisk(river.qMedianToday ?? river.qToday ?? 0).riskLevel)}<br>
        <strong>Áp suất:</strong> ${finite(river.levels?.now?.q) ? river.levels!.now!.q.toFixed(1) : '—'} hPa<br>
        <strong>Bán kính gió max:</strong> ${river.series[0]?.radiusMaxWind || '—'} nm
      </div>
    </div>
  `, { maxWidth: 280 });
  
  return group;
}

/** Create river gauge markers from OSM data */
function getRiverGauges(rivers: RiverSeries[]): Array<{ id: string; name: string; lat: number; lon: number; river: string }> {
  // In reality, would fetch from OSM Overpass API
  // For now, return simulated gauges near river cells
  const gauges: Array<{ id: string; name: string; lat: number; lon: number; river: string }> = [];
  
  for (const river of rivers) {
    if (river.isLargest) {
      gauges.push({
        id: `gauge-${river.cell.lat.toFixed(3)}-${river.cell.lon.toFixed(3)}`,
        name: `Trạm ${river.name}`,
        lat: river.cell.lat + (Math.random() - 0.5) * 0.1,
        lon: river.cell.lon + (Math.random() - 0.5) * 0.1,
        river: river.name,
      });
    }
  }
  
  return gauges;
}

/** Create gauge marker */
function createGaugeMarker(gauge: { id: string; name: string; lat: number; lon: number; river: string }): L.Marker {
  const marker = L.marker([gauge.lat, gauge.lon], {
    icon: L.divIcon({
      className: 'gauge-marker',
      html: `<div style="background: #2196f3; color: white; padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; white-space: nowrap;">${gauge.name}</div>`,
      iconSize: [80, 24],
      iconAnchor: [40, 12],
    }),
    title: `${gauge.river} - ${gauge.name}`,
  });
  
  marker.bindPopup(`
    <div style="min-width: 200px;">
      <h4 style="margin: 0 0 8px; color: #1976d2;">📍 ${gauge.name}</h4>
      <div style="font-size: 13px; line-height: 1.6;">
        <strong>Sông:</strong> ${gauge.river}<br>
        <strong>Vị trí:</strong> ${gauge.lat.toFixed(4)}°N, ${gauge.lon.toFixed(4)}°E
      </div>
    </div>
  `, { maxWidth: 250 });
  
  return marker;
}

/** Create flood risk zones */
function createRiskZones(rivers: RiverSeries[]): L.LayerGroup {
  const group = L.layerGroup();
  
  for (const river of rivers) {
    const riskLevel = assessFloodRisk(river).riskLevel;
    if (riskLevel === 'low') continue;
    
    const color = getRiskColor(riskLevel);
    const radius = getRiskRadius(riskLevel);
    
    const circle = L.circle([river.cell.lat, river.cell.lon], {
      radius: radius * 1000, // Convert km to meters
      color: color,
      weight: 1,
      opacity: 0.5,
      fillColor: color,
      fillOpacity: 0.15,
      dashArray: '10, 10',
    });
    
    circle.bindTooltip(
      `${river.name}: ${getRiskLabel(assessRisk(river.qMedianToday ?? river.qToday ?? 0).riskLevel)}<br>Bán kính ảnh hưởng: ${getRiskRadius(riskLevel)} km`,
      { permanent: false, direction: 'center' }
    );
    
    group.addLayer(circle);
  }
  
  return group;
}

/** Assess flood risk for a river */
function assessRisk(q: number): { riskLevel: FloodRiskLevel } {
  if (!finite(q)) return { riskLevel: 'low' };
  
  // Simplified risk assessment based on discharge
  // In reality, would use riverRisk with historical context
  const riskLevel = q > 5000 ? 'severe' : q > 2000 ? 'high' : q > 1000 ? 'moderate' : 'low';
  return { riskLevel };
}

function assessFloodRisk(river: any): { riskLevel: FloodRiskLevel } {
  const q = river.qMedianToday ?? river.qToday ?? 0;
  return assessRisk(q);
}

function finite(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function assessRisk(q: number): { riskLevel: FloodRiskLevel } {
  if (!finite(q)) return { riskLevel: 'low' };
  
  if (q > 5000) return { riskLevel: 'severe' };
  if (q > 2000) return { riskLevel: 'high' };
  if (q > 1000) return { riskLevel: 'moderate' };
  return { riskLevel: 'low' };
}

function finite(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** Get risk color */
function getRiskColor(level: FloodRiskLevel): string {
  const colors = {
    low: '#3fae5a',
    moderate: '#f5e663',
    high: '#e34a3a',
    severe: '#b04ae3',
  };
  return colors[level] || colors.low;
}

/** Get risk label */
function getRiskLabel(level: FloodRiskLevel): string {
  const labels = {
    low: 'Thấp',
    moderate: 'Trung bình',
    high: 'Cao',
    severe: 'Rất cao',
  };
  return labels[level] || labels.low;
}

/** Get risk radius in km */
function getRiskRadius(level: FloodRiskLevel): number {
  const radii = {
    low: 10,
    moderate: 25,
    high: 50,
    severe: 100,
  };
  return radii[level] || radii.low;
}

/** Create flood forecast popup */
export function createFloodForecastPopup(river: any, forecast: any[]): string {
  let html = `<div style="min-width: 250px;"><h4 style="margin: 0 0 8px;">🌊 ${river.name}</h4>`;
  
  for (const point of forecast.slice(0, 7)) {
    const time = new Date(point.time).toLocaleString('vi-VN');
    const qStr = finite(point.q) ? point.q!.toFixed(1) : '—';
    const levelStr = point.level ? ` (${point.level.label})` : '';
    const riskLabels = { low: 'Thấp', moderate: 'Trung bình', high: 'Cao', severe: 'Rất cao' };
    const riskStr = riskLabels[point.risk];
    
    html += `<div style="padding: 4px 0; border-bottom: 1px solid #eee;">${time}: ${qStr} m³/s${levelStr} - Rủi ro: ${riskStr}</div>`;
  }
  
  html += '</div>';
  return html;
}

// Re-export types
export * from '../flood/index.js';