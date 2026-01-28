/**
 * File Upload Validation Schemas
 *
 * Validates file upload requests for different use cases.
 * Uses Zod v4 native file() support for File objects.
 *
 * Pattern: Follows todo.validations.ts structure
 * - Separate schemas for different operations
 * - Only export INPUT types (never response types)
 * - Let Hono RPC infer response types automatically
 *
 * CRITICAL: Do NOT create manual response types.
 * The file/variant data types are automatically inferred from API responses.
 */

import { z } from 'zod'

/**
 * File Upload Base Schema
 *
 * Zod v4 has native z.instanceof(File) support for File objects from multipart/form-data.
 */
const fileBase = z
  .instanceof(File)
  .refine((file) => file.size > 0, 'File cannot be empty')

/**
 * AVATAR UPLOAD SCHEMA
 *
 * Validates avatar image uploads (5MB limit, images only).
 * Backend will generate thumbnails automatically.
 */
export const UploadAvatar = z.object({
  file: fileBase
    .refine(
      (file) => file.size <= 5 * 1024 * 1024,
      'Avatar must be 5MB or less'
    )
    .refine(
      (file) => file.type.startsWith('image/'),
      'Avatar must be an image'
    ),
})

/**
 * DOCUMENT UPLOAD SCHEMA
 *
 * Validates document uploads (10MB limit, specific types).
 * Allowed: PDF, DOCX, XLSX, TXT, CSV
 */
export const UploadDocument = z.object({
  file: fileBase
    .refine(
      (file) => file.size <= 10 * 1024 * 1024,
      'Document must be 10MB or less'
    )
    .refine(
      (file) => {
        const allowedTypes = [
          'application/pdf',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'text/plain',
          'text/csv',
        ]
        return allowedTypes.includes(file.type)
      },
      'Document must be PDF, DOCX, XLSX, TXT, or CSV'
    ),
})

/**
 * GENERAL FILE UPLOAD SCHEMA
 *
 * Validates general file uploads (50MB limit).
 * More permissive for various file types.
 */
export const UploadFile = z.object({
  file: fileBase
    .refine(
      (file) => file.size <= 50 * 1024 * 1024,
      'File must be 50MB or less'
    ),
})

/**
 * FILE ID SCHEMA
 *
 * Validates file ID in URL parameters.
 */
export const FileId = z.object({
  id: z.string().uuid('Invalid file ID'),
})

/**
 * LIST FILES QUERY SCHEMA
 *
 * Validates query parameters for file listing with pagination.
 */
export const ListFilesQuery = z.object({
  fileType: z.enum(['avatar', 'document', 'general']).optional(),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(20),
})

/**
 * Type Exports - INPUT TYPES ONLY
 *
 * CRITICAL: Never export response types - let Hono RPC infer them.
 *
 * These types are ONLY for:
 * - Form validation (zValidator)
 * - React Hook Form (zodResolver)
 * - Function parameters
 *
 * Response types come from RPC automatic inference.
 */
export type UploadAvatarType = z.infer<typeof UploadAvatar>
export type UploadDocumentType = z.infer<typeof UploadDocument>
export type UploadFileType = z.infer<typeof UploadFile>
export type FileIdType = z.infer<typeof FileId>
export type ListFilesQueryType = z.infer<typeof ListFilesQuery>

/**
 * DO NOT EXPORT RESPONSE TYPES
 *
 * Examples of what NOT to do:
 * ❌ export type File = { id: string, ... }
 * ❌ export type FileVariant = { ... }
 *
 * Response types are automatically inferred from the API by Hono RPC.
 * If you need the type, extract it from the inferred data:
 *
 * type FileResponse = Awaited<ReturnType<typeof apiResponse<typeof api.v1.files.$get>>>
 *
 * But in practice, you rarely need this - just let TypeScript infer.
 */
