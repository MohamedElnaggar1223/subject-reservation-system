/**
 * Storage Package Types
 *
 * Defines all TypeScript interfaces for file upload operations.
 *
 * Pattern: Follows the type definition pattern from @repo/validations/src/roles.ts
 */

export type FileType = 'avatar' | 'document' | 'general'

export type ImageVariant = 'original' | 'thumbnail' | 'medium' | 'large'

export interface UploadOptions {
  userId: string
  fileType: FileType
  generateThumbnails?: boolean  // Only for images
  /** The purpose's own limits (F0a); default: the file type's. */
  allowedMimeTypes?: readonly string[]
  maxBytes?: number
  /** The top-level folder of the key (the upload purpose); default: fileType. */
  folder?: string
}

export interface UploadResult {
  key: string              // R2 object key (use getSignedUrl() to access)
  size: number             // File size in bytes
  mimeType: string         // Detected MIME type
  variants?: VariantInfo[] // For images with thumbnails
}

export interface VariantInfo {
  variant: ImageVariant
  key: string              // R2 object key (use getSignedUrl() to access)
  width: number
  height: number
  size: number
}

export interface R2Config {
  accountId: string
  accessKeyId: string
  secretAccessKey: string
  bucketName: string
  // No publicUrl - bucket should be private, use signed URLs instead
}

export interface FileValidationResult {
  valid: boolean
  error?: string
  detectedMimeType?: string
}
