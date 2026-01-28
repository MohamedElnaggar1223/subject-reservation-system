/**
 * Storage Constants
 *
 * Configuration for file upload limits and allowed types.
 *
 * Pattern: Similar to ROLES constants in @repo/validations/src/roles.ts
 */

export const MIME_TYPES = {
  // Images
  JPEG: 'image/jpeg',
  PNG: 'image/png',
  WEBP: 'image/webp',
  GIF: 'image/gif',

  // Documents
  PDF: 'application/pdf',
  DOCX: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  XLSX: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  TXT: 'text/plain',
  CSV: 'text/csv',
} as const

export const ALLOWED_MIME_TYPES = {
  avatar: [
    MIME_TYPES.JPEG,
    MIME_TYPES.PNG,
    MIME_TYPES.WEBP,
  ],
  document: [
    MIME_TYPES.PDF,
    MIME_TYPES.DOCX,
    MIME_TYPES.XLSX,
    MIME_TYPES.TXT,
    MIME_TYPES.CSV,
  ],
  general: [
    ...Object.values(MIME_TYPES),
  ],
} as const

export const MAX_FILE_SIZE = {
  avatar: 5 * 1024 * 1024,      // 5MB
  document: 10 * 1024 * 1024,   // 10MB
  general: 50 * 1024 * 1024,    // 50MB
} as const

export const IMAGE_VARIANTS = {
  thumbnail: { width: 150, height: 150 },
  medium: { width: 600, height: 600 },
  large: { width: 1200, height: 1200 },
} as const
