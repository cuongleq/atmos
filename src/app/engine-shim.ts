// Engine shim - provides E namespace from global AtmosEngine
// This replaces the import of '../../engine/index.js' in the standalone build

const E: any = (typeof window !== 'undefined' && (window as any).AtmosEngine)
  ? ((window as any).AtmosEngine.E || (window as any).AtmosEngine)
  : {};

export { E };
