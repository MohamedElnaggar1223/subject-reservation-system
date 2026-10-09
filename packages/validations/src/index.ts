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
 */
export * from './file/file.validations'
export * from './file/upload-purposes'

/**
 * IGCSE System Validations
 */
export * from './link/link.validations'
export * from './user/user.validations'
export * from './subject/subject.validations'
export * from './session/session.validations'
export * from './session/offer.validations'
export * from './registration/registration.validations'
export * from './registration/line.validations'
export * from './registration/reservation.validations'
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
export * from './exception/policies'
export * from './charge/charge.validations'
export * from './remark/remark.validations'
export * from './desk/desk.validations'
export * from './message/message.validations'

/**
 * F0a — core foundation: the academic year and grade rules, the academic
 * structure, the student record, and the settings store.
 */
export * from './academic/academic-year'
export * from './academic/eligibility'
export * from './academic/structure.validations'
export * from './student/student.validations'
export * from './settings/settings'
/**
 * F0b — the exam catalogue, board series and course enrolment.
 */
export * from './catalogue/catalogue.validations'
export * from './catalogue/level-code'
export * from './catalogue/board-series.validations'
export * from './enrolment/enrolment.validations'
/**
 * F4 — exam-entry management: candidates, entries, entry lists, the exam
 * timetable and exam days, results and certificates.
 */
export * from './exams/exam-entry.validations'
/**
 * F7 — the day-one import.
 */
export * from './import/import.validations'
export * from './import/import-types'
