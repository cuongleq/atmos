// Engine shim - provides E namespace from global AtmosEngine
// This replaces the import of '../../engine/index.js' in the standalone build

const E = (typeof window !== 'undefined' && window.AtmosEngine) 
  ? window.AtmosEngine.E 
  : {};

export { E };