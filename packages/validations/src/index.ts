/**
 * Shared Validation Schemas & Utilities
 *
 * All Zod schemas are defined here for type-safe validation across:
 * - API route handlers
 * - Web client forms
 * - Mobile app forms
 *
 * Single source of truth for all types.
 */

export * from './roles'
export * from './common.validations'
export * from './api-response'

/**
 * Domain-Specific Validations
 *
 * EXAMPLE: Todo validations (demonstrates the pattern)
 * Add your own feature validations below.
 */
export * from './todo/todo.validations'
export * from './file/file.validations'