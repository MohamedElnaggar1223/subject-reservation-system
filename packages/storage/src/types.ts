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
  bucket: string
  userId: string
  fileType: FileType
  generateThumbnails?: boolean  // Only for images
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
