/**
 * ATMOS Feature: Cyclone Map Visualization
 * Leaflet-based map components for cyclone tracks and uncertainty cones
 */

import L from 'leaflet';
import { 
  JtwcCyclone,
  getCategoryColor,
  getCategoryLabel,
  getCategory,
  getCycloneIcon,
} from '../cyclone/index.js';

/** Create cyclone track layer */
export function createCycloneTrackLayer(trackData: any): L.LayerGroup {
  const group = L.layerGroup();
  const { pastTrack, forecastTrack, cones, currentPosition, currentIntensity, currentCategory } = trackData;
  
  // Past track (solid line)
  if (pastTrack.length > 1) {
    const pastLatLngs = pastTrack.map((p: any) => [p.lat, p.lon]);
    const pastPolyline = L.polyline(pastLatLngs, {
      color: getCategoryColor(trackData.cyclone.category),
      weight: 3,
      opacity: 0.8,
      dashArray: '5, 5',
      lineCap: 'round',
      lineJoin: 'round',
    }).addTo(group);
    
    pastPolyline.bindTooltip(`Quá khứ: ${trackData.cyclone.name}`, { permanent: false, direction: 'center' });
  }
  
  // Forecast track (solid line with arrows)
  if (forecastTrack.length > 1) {
    const forecastLatLngs = forecastTrack.map((p: any) => [p.lat, p.lon]);
    const forecastPolyline = L.polyline(forecastLatLngs, {
      color: getCategoryColor(trackData.cyclone.category),
      weight: 3,
      opacity: 1,
      lineCap: 'round',
      lineJoin: 'round',
    }).addTo(group);
    
    forecastPolyline.bindTooltip(`Dự báo: ${trackData.cyclone.name}`, { permanent: false, direction: 'center' });
    
    // Add arrow markers along forecast track
    for (let i = 0; i < forecastTrack.length; i += 2) {
      const point = forecastTrack[i];
      const intensity = getCategory(point.intensity);
      L.circleMarker([point.lat, point.lon], {
        radius: 6 + intensity * 2,
        fillColor: getCategoryColor(intensity),
        color: '#fff',
        weight: 2,
        opacity: 1,
        fillOpacity: 0.9,
      }).addTo(group).bindPopup(`
        <strong>${trackData.cyclone.name}</strong><br>
        Thời gian: ${new Date(point.time).toLocaleString('vi-VN')}<br>
        Vị trí: ${point.lat.toFixed(2)}°N, ${point.lon.toFixed(2)}°E<br>
        Gió tối đa: ${point.intensity} kt (${(point.intensity * 1.852).toFixed(0)} km/h)<br>
        Cấp độ: ${getCategoryLabel(getCategory(point.intensity))}
      `);
    }
  }
  
  // Uncertainty cones
  for (const cone of cones) {
    const coneColor = getCategoryColor(trackData.cyclone.category);
    const conePolygon = L.polygon(cone.polygon.map((p: any) => [p.lat, p.lon]), {
      color: coneColor,
      weight: 1,
      opacity: 0.4,
      fillColor: coneColor,
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
  if (currentPosition.lat && currentPosition.lon) {
    const _currentCategory = getCategory(currentIntensity);
    const marker = L.circleMarker([currentPosition.lat, currentPosition.lon], {
      radius: 12 + currentCategory * 3,
      fillColor: getCategoryColor(_currentCategory),
      color: '#fff',
      weight: 3,
      opacity: 1,
      fillOpacity: 0.95,
    }).addTo(group);
    
    marker.bindPopup(`
      <div style="min-width: 200px;">
        <h4 style="margin: 0 0 8px; color: ${getCategoryColor(_currentCategory)};">
          ${getCycloneIcon(currentCategory)} ${trackData.cyclone.name}
        </h4>
        <div style="font-size: 13px; line-height: 1.6;">
          <strong>Vị trí:</strong> ${currentPosition.lat.toFixed(2)}°N, ${currentPosition.lon.toFixed(2)}°E<br>
          <strong>Cập nhật:</strong> ${new Date(currentPosition.time).toLocaleString('vi-VN')}<br>
          <strong>Gió tối đa:</strong> ${currentIntensity} kt (${(currentIntensity * 1.852).toFixed(0)} km/h)<br>
          <strong>Cấp độ:</strong> ${getCategoryLabel(_currentCategory)}<br>
          <strong>Áp suất trung tâm:</strong> ${trackData.cyclone.positions[0]?.minPressure || 'N/A'} hPa<br>
          <strong>Bán kính gió max:</strong> ${trackData.cyclone.positions[0]?.radiusMaxWind || 'N/A'} nm
        </div>
      </div>
    `, { maxWidth: 280 });
  }
  
  return group;
}

/** Create cyclone summary panel for sidebar */
export function createCycloneSummaryPanel(cyclone: JtwcCyclone): HTMLElement {
  const container = document.createElement('div');
  container.className = 'cyclone-summary-panel';
  container.style.cssText = 'font-family: inherit; font-size: 13px;';
  
  const category = getCategory(cyclone.positions[0]?.maxWind || 0);
  const categoryColor = getCategoryColor(category);
  
  container.innerHTML = `
    <div style="border-left: 4px solid ${categoryColor}; padding-left: 12px; margin-bottom: 16px;">
      <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
        <span style="font-size: 24px;">${getCycloneIcon(category)}</span>
        <div>
          <strong style="font-size: 16px;">${cyclone.name}</strong>
          <span style="background: ${categoryColor}; color: #fff; padding: 2px 8px; border-radius: 4px; font-size: 11px; margin-left: 8px;">
            ${getCategoryLabel(category)}
          </span>
        </div>
      </div>
      <div style="font-size: 12px; color: #666;">
        Mã bão: ${cyclone.id} | Lệ phái: ${cyclone.basin} | Số: ${cyclone.number}/${cyclone.year}
      </div>
    </div>
    
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 16px;">
      <div style="background: #f8f9fa; padding: 8px; border-radius: 4px;">
        <div style="font-size: 11px; color: #666;">Gió tối đa</div>
        <div style="font-weight: 600;">${cyclone.positions[0]?.maxWind || 'N/A'} kt</div>
        <div style="font-size: 11px; color: #888;">(${((cyclone.positions[0]?.maxWind || 0) * 1.852).toFixed(0)} km/h)</div>
      </div>
      <div style="background: #f8f9fa; padding: 8px; border-radius: 4px;">
        <div style="font-size: 11px; color: #666;">Áp suất trung tâm</div>
        <div style="font-weight: 600;">${cyclone.positions[0]?.minPressure || 'N/A'} hPa</div>
      </div>
      <div style="background: #f8f9fa; padding: 8px; border-radius: 4px;">
        <div style="font-size: 11px; color: #666;">Bán kính gió max</div>
        <div style="font-weight: 600;">${cyclone.positions[0]?.radiusMaxWind || 'N/A'} nm</div>
      </div>
      <div style="background: #f8f9fa; padding: 8px; border-radius: 4px;">
        <div style="font-size: 11px; color: #666;">Bán kính gió 34kt</div>
        <div style="font-weight: 600;">${cyclone.positions[0]?.radius34kt || 'N/A'} nm</div>
      </div>
    </div>
    
    <div style="margin-bottom: 12px;">
      <strong>Dự báo đường đi:</strong>
      <div style="font-size: 12px; color: #666; margin-top: 4px;">
        ${cyclone.forecast.length} điểm dự báo (${cyclone.forecast.length * 12}h tới)
      </div>
    </div>
    
    <div style="border-top: 1px solid #eee; padding-top: 12px;">
      <strong>Thông tin bản tin:</strong>
      <div style="font-size: 12px; color: #666; margin-top: 4px;">
        Bản tin số: ${cyclone.metadata.advisoryNumber}<br>
        Phát hành: ${new Date(cyclone.metadata.issuedAt).toLocaleString('vi-VN')}<br>
        Bản tin tiếp: ${new Date(cyclone.metadata.nextAdvisoryAt).toLocaleString('vi-VN')}
      </div>
    </div>
    
    <div style="margin-top: 16px; padding: 8px; background: #fff3cd; border: 1px solid #ffeeba; border-radius: 4px; font-size: 12px;">
      ⚠️ <strong>Lưu ý:</strong> Đường đi và cường độ bão có độ không chắc chắn. 
      Vùng nón không chắc chắn thể hiện khu vực có thể bị ảnh hưởng. 
      Luôn theo dõi bản tin chính thức từ <a href="https://www.jtwc.navy.mil/" target="_blank" style="color: #856404;">JTWC</a> và 
      <a href="https://nchmf.gov.vn/" target="_blank" style="color: #856404;">NCHMF</a>.
    </div>
  `;
  
  return container;
}

/** Create legend for cyclone map */
export function createCycloneLegend(_map: L.Map): L.Control {
  const legend = L.control({ position: 'bottomright' });
  
  legend.onAdd = () => {
    const div = L.DomUtil.create('div', 'cyclone-legend');
    div.style.cssText = 'background: white; padding: 12px; border-radius: 4px; box-shadow: 0 2px 6px rgba(0,0,0,0.15); font-size: 12px; min-width: 180px;';
    
    let html = '<strong style="display: block; margin-bottom: 8px; border-bottom: 1px solid #eee; padding-bottom: 8px;">🌀 Chú thích Bão</strong>';
    
    // Category legend
    html += '<div style="margin-bottom: 12px;"><strong>Cấp độ (Saffir-Simpson):</strong><div style="margin-top: 4px;">';
    for (let i = 0; i <= 6; i++) {
      const color = getCategoryColor(i);
      html += `
        <div style="display: flex; align-items: center; gap: 8px; margin: 3px 0;">
          <span style="width: 16px; height: 16px; background: ${color}; border-radius: 3px; border: 1px solid #ddd;"></span>
          <span style="font-size: 11px;">${getCategoryLabel(i)}</span>
        </div>
      `;
    }
    html += '</div>';
    
    // Symbols
    html += '<div style="border-top: 1px solid #eee; padding-top: 8px; margin-top: 8px;">';
    html += '<strong>Ký hiệu:</strong><div style="margin-top: 4px; font-size: 11px;">';
    html += '<div>🔴 Vị trí hiện tại (tròn đặc)</div>';
    html += '<div>━━━ Quá khứ (đứt đoạn)</div>';
    html += '<div>━━━ Dự báo (liền mực)</div>';
    html += '<div>░░░ Vùng không chắc chắn (nón)</div>';
    html += '</div></div>';
    
    // Disclaimer
    html += '<div style="margin-top: 12px; padding: 8px; background: #fff3cd; border-radius: 3px; font-size: 10px; color: #856404;">';
    html += '⚠️ Dữ liệu từ JTWC. Nón không chắc chắn dựa trên sai số lịch sử. Luôn tham khảo NCHMF/JTWC chính thức.';
    html += '</div>';
    
    div.innerHTML = html;
    return div;
  };
  
  return legend;
}

/** Add cyclone controls to map */
export function addCycloneControls(map: L.Map, cyclones: JtwcCyclone[]): L.Control {
  const control = L.control({ position: 'topleft' });
  
  control.onAdd = () => {
    const div = L.DomUtil.create('div', 'cyclone-controls');
    div.style.cssText = 'background: white; padding: 12px; border-radius: 4px; box-shadow: 0 2px 6px rgba(0,0,0,0.15); min-width: 200px;';
    
    let html = '<strong style="display: block; margin-bottom: 8px;">🌀 Theo dõi Bão</strong>';
    html += '<select id="cyclone-select" style="width: 100%; padding: 6px; border: 1px solid #ddd; border-radius: 3px; margin-bottom: 8px;">';
    html += '<option value="">-- Chọn bão --</option>';
    for (const cyclone of cyclones) {
      const cat = getCategory(cyclone.positions[0]?.maxWind || 0);
      html += `<option value="${cyclone.id}" style="color: ${getCategoryColor(cat)};">${cyclone.name} (${getCategoryLabel(cat)})</option>`;
    }
    html += '</select>';
    
    html += '<div style="display: flex; gap: 4px;">';
    html += '<button id="btn-show-cones" class="btn-sm" style="flex: 1; padding: 6px; background: #e8f5e9; border: 1px solid #4caf50; border-radius: 3px; cursor: pointer;">🎯 Hiện nón KC</button>';
    html += '<button id="btn-center-cyclone" class="btn-sm" style="flex: 1; padding: 6px; background: #e3f2fd; border: 1px solid #2196f3; border-radius: 3px; cursor: pointer;">🎯 Trung tâm</button>';
    html += '</div>';
    
    div.innerHTML = html;
    
    // Prevent map click events from propagating
    L.DomEvent.disableClickPropagation(div);
    L.DomEvent.disableScrollPropagation(div);
    
    return div;
  };
  
  return control;
}