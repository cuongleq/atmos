/**
 * Browser entry point for the ATMOS Engine.
 * Re-exports all engine modules and assigns to globalThis.AtmosEngine.
 */

import * as Engine from './index.js';

// Assign all exports to globalThis.AtmosEngine for backward compatibility
if (typeof globalThis !== 'undefined') {
  globalThis.AtmosEngine = Engine;
}

// Also export for module systems
export * from './index.js';
export default Engine;