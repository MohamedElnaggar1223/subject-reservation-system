/**
 * Storage Package Exports
 *
 * Barrel export pattern - everything consumers need.
 *
 * Pattern: Follows @repo/db/src/index.ts and @repo/validations/src/index.ts
 * Single public API surface, hiding implementation details.
 */

// Main client
export * from './r2-client.js'

// Utilities
export * from './file-validator.js'
export * from './image-processor.js'

// Types and constants
export * from './types.js'
export * from './constants.js'
