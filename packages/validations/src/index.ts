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

/**
 * IGCSE System Validations
 */
export * from './link/link.validations'
export * from './user/user.validations'
export * from './subject/subject.validations'
export * from './session/session.validations'
export * from './registration/registration.validations'
export * from './payment/payment.validations'
export * from './escrow/escrow.validations'
export * from './swap/swap.validations'
export * from './notification/notification.validations'
export * from './audit/audit.validations'
export * from './report/report.validations'
export * from './teacher/teacher.validations'
export * from './school-fee/school-fee.validations'
export * from './receipt/receipt.validations'
export * from './exception/exception.validations'
export * from './remark/remark.validations'
export * from './desk/desk.validations'