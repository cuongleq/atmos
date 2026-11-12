/**
 * ATMOS Feature: Cyclone API Integration
 * Fetches and manages cyclone data from JTWC and GDACS
 */

import { 
  JtwcCyclone, 
  fetchActiveCyclones, 
  fetchCycloneById,
  getCycloneTrackData,
  CycloneTrackData,
  getCyclonesAffectingRegion,
} from '../cyclone/index.js';

type EventCallback = (data: unknown) => void;

/** Cyclone data manager */
export class CycloneManager {
  private cyclones: JtwcCyclone[] = [];
  private selectedCyclone: JtwcCyclone | null = null;
  private trackData: CycloneTrackData | null = null;
  private listeners: Map<string, EventCallback[]> = new Map();
  private refreshInterval: ReturnType<typeof setInterval> | null = null;
  
  /** Event emitter methods */
  on(event: string, callback: EventCallback): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)!.push(callback);
  }
  
  off(event: string, callback: EventCallback): void {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      const idx = callbacks.indexOf(callback);
      if (idx >= 0) {
        callbacks.splice(idx, 1);
      }
    }
  }
  
  private emit(event: string, data: unknown): void {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      callbacks.forEach((cb) => cb(data));
    }
  }
  
  /** Get all cyclones */
  getCyclones(): JtwcCyclone[] {
    return this.cyclones;
  }
  
  /** Get selected cyclone */
  getSelectedCyclone(): JtwcCyclone | null {
    return this.selectedCyclone;
  }
  
  /** Get track data for selected cyclone */
  getTrackData(): CycloneTrackData | null {
    return this.trackData;
  }
  
  /** Fetch and update all active cyclones */
  async refresh(): Promise<void> {
    try {
      this.emit('loading', true);
      const cyclones = await fetchActiveCyclones();
      this.cyclones = cyclones;
      this.emit('cyclones-updated', cyclones);
      this.emit('loading', false);
    } catch (error) {
      this.emit('error', error);
      this.emit('loading', false);
    }
  }
  
  /** Select a cyclone by ID */
  async selectCyclone(id: string): Promise<void> {
    // Check if already loaded
    let cyclone = this.cyclones.find(c => c.id === id);
    
    if (!cyclone) {
      // Try to fetch from API
      cyclone = await fetchCycloneById(id);
      if (!cyclone) {
        throw new Error(`Cyclone ${id} not found`);
      }
      
      // Add to list if not present
      if (!this.cyclones.find(c => c.id === id)) {
        this.cyclones.push(cyclone);
      }
    }
    
    this.selectedCyclone = cyclone;
    this.trackData = getCycloneTrackData(cyclone);
    this.emit('cyclone-selected', { cyclone, trackData: this.trackData });
  }
  
  /** Get cyclones affecting a specific location */
  getCyclonesNear(lat: number, lon: number, maxDistanceKm = 500): JtwcCyclone[] {
    return getCyclonesAffectingRegion(this.cyclones, lat, lon, maxDistanceKm);
  }
  
  /** Get track data for current selection */
  getTrackData(): CycloneTrackData | null {
    return this.trackData;
  }
  
  /** Get selected cyclone */
  getSelectedCyclone(): JtwcCyclone | null {
    return this.selectedCyclone;
  }
  
  /** Get all cyclones */
  getCyclones(): JtwcCyclone[] {
    return this.cyclones;
  }
  
  /** Start auto-refresh interval */
  startAutoRefresh(intervalMinutes = 30): void {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
    }
    this.refreshInterval = setInterval(() => this.refresh(), intervalMinutes * 60 * 1000);
  }
  
  /** Stop auto-refresh */
  stopAutoRefresh(): void {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
  }
  
  /** Get cyclones sorted by proximity to a point */
  getCyclonesByProximity(lat: number, lon: number): JtwcCyclone[] {
    return [...this.cyclones].sort((a, b) => {
      const distA = this.getMinDistance(a, lat, lon);
      const distB = this.getMinDistance(b, lat, lon);
      return distA - distB;
    });
  }
  
  /** Get minimum distance from cyclone to point */
  private getMinDistance(cyclone: JtwcCyclone, lat: number, lon: number): number {
    let minDist = Infinity;
    for (const pos of cyclone.positions) {
      const d = this.haversine(lat, lon, pos.lat, pos.lon);
      if (d < minDist) {
        minDist = d;
      }
    }
    for (const f of cyclone.forecast) {
      const d = this.haversine(lat, lon, f.lat, f.lon);
      if (d < minDist) {
        minDist = d;
      }
    }
    return minDist;
  }
  
  /** Haversine distance */
  private haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) ** 2 + 
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
      Math.sin(dLon/2) ** 2;
    return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  }
  
  /** Cleanup */
  destroy(): void {
    this.stopAutoRefresh();
    this.listeners.clear();
    this.cyclones = [];
    this.selectedCyclone = null;
    this.trackData = null;
  }
  
  /** Start auto-refresh interval */
  startAutoRefresh(intervalMinutes = 30): void {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
    }
    this.refreshInterval = setInterval(() => this.refresh(), intervalMinutes * 60 * 1000);
  }
  
  /** Stop auto-refresh */
  stopAutoRefresh(): void {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
  }
}

/** Singleton instance */
export const cycloneManager = new CycloneManager();

/** Initialize cyclone feature */
export async function initCycloneFeature(): Promise<void> {
  // Initial load
  await cycloneManager.refresh();
  
  // Start auto-refresh every 30 minutes
  cycloneManager.startAutoRefresh(30);
  
  console.log('[Cyclone] Feature initialized');
}

/** Get cyclone display data for UI */
export function getCycloneDisplayData(cyclone: JtwcCyclone): {
  id: string;
  name: string;
  category: number;
  categoryLabel: string;
  categoryColor: string;
  intensity: number;
  intensityKmh: number;
  pressure: number;
  movement: { speed: number; direction: number } | null;
  lastUpdate: string;
  nextAdvisory: string;
} {
  const pos = cyclone.positions[0];
  const category = getCategory(pos?.maxWind || 0);
  
  // Calculate movement from last two positions
  let movement = null;
  if (cyclone.positions.length >= 2) {
    const p1 = cyclone.positions[0];
    const p2 = cyclone.positions[1];
    const timeDiff = (new Date(p1.timestamp).getTime() - new Date(p2.timestamp).getTime()) / 3600000; // hours
    if (timeDiff > 0) {
      const dist = haversine(p1.lat, p1.lon, p2.lat, p2.lon);
      const bearing = calculateBearing(p1.lat, p1.lon, p2.lat, p2.lon);
      movement = { speed: dist / timeDiff, direction: bearing };
    }
  }
  
  return {
    id: cyclone.id,
    name: cyclone.name,
    category,
    categoryLabel: getCategoryLabel(category),
    categoryColor: getCategoryColor(category),
    intensity: pos?.maxWind || 0,
    intensityKmh: Math.round((pos?.maxWind || 0) * 1.852),
    pressure: pos?.minPressure || 0,
    movement,
    lastUpdate: cyclone.metadata.issuedAt,
    nextAdvisory: cyclone.metadata.nextAdvisoryAt,
  };
}

/** Haversine distance */
function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) ** 2 + 
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
    Math.sin(dLon/2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

/** Calculate bearing between two points */
function calculateBearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const lat1Rad = lat1 * Math.PI / 180;
  const lat2Rad = lat2 * Math.PI / 180;
  const y = Math.sin(dLon) * Math.cos(lat2Rad);
  const x = Math.cos(lat1Rad) * Math.sin(lat2Rad) - 
    Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLon);
  const bearing = Math.atan2(y, x) * 180 / Math.PI;
  return (bearing + 360) % 360;
}

// Re-export types and functions from cyclone module
export { 
  JtwcCyclone, 
  JtwcPosition, 
  JtwcForecast, 
  JtwcMetadata,
  CycloneTrackData,
  UncertaintyCone,
  ConePoint,
  BASINS,
  CATEGORY_COLORS,
  CATEGORY_LABELS,
  JTWC_API,
  getCategory,
  getCategoryLabel,
  getCategoryColor,
  getConeRadius,
  generateConePolygon,
  generateUncertaintyCones,
  parseJtwcResponse,
  fetchActiveCyclones,
  fetchCycloneById,
  getCycloneTrackData,
  distance,
  isInCone,
  getCyclonesAffectingRegion,
  formatAdvisoryTime,
  formatWindSpeed,
  getCycloneIcon,
} from '../cyclone/index.js';