/**
 * Storage Package Exports
 *
 * Barrel export pattern - everything consumers need.
 *
 * Pattern: Follows @repo/db/src/index.ts and @repo/validations/src/index.ts
 * Single public API surface, hiding implementation details.
 */

// Main clients: R2 in production, a local directory in development (F0a)
export * from './storage-client.js'
export * from './r2-client.js'

// Utilities
export * from './file-validator.js'
export * from './image-processor.js'

// Types and constants
export * from './types.js'
export * from './constants.js'
