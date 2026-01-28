/**
 * Cloudflare R2 Client
 *
 * S3-compatible storage client for Cloudflare R2.
 * Handles upload, download, delete operations with image processing support.
 *
 * Pattern: Similar to db client in @repo/db/src/db.ts - singleton pattern for client
 */

import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { randomUUID } from 'crypto'
import type { R2Config, UploadOptions, UploadResult, VariantInfo } from './types.js'
import { validateFile, isImage } from './file-validator.js'
import { generateImageVariants } from './image-processor.js'

export class R2StorageClient {
  private client: S3Client
  private config: R2Config

  constructor(config: R2Config) {
    this.config = config
    this.client = new S3Client({
      region: 'auto',
      endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    })
  }

  /**
   * Upload a file to R2 with optional image processing
   *
   * Steps:
   * 1. Validate file (size, MIME type)
   * 2. Generate unique key
   * 3. If image and thumbnails requested, generate variants
   * 4. Upload all files to R2
   * 5. Return URLs and metadata
   *
   * @param file - File object from form data
   * @param options - Upload configuration
   * @returns Upload result with URLs and metadata
   */
  async uploadFile(
    file: File,
    options: UploadOptions
  ): Promise<UploadResult> {
    // Read file buffer
    const buffer = await file.arrayBuffer()

    // Validate file
    const validation = await validateFile(buffer, file.type, options.fileType)
    if (!validation.valid) {
      throw new Error(validation.error)
    }

    const mimeType = validation.detectedMimeType!

    // Generate unique key
    const fileId = randomUUID()
    const extension = this.getExtension(file.name, mimeType)
    const baseKey = `${options.fileType}/${options.userId}/${fileId}`

    // Check if image and should generate thumbnails
    if (isImage(mimeType) && options.generateThumbnails) {
      return this.uploadImageWithVariants(
        Buffer.from(buffer),
        mimeType,
        baseKey,
        extension
      )
    }

    // Regular file upload
    const key = `${baseKey}.${extension}`
    await this.putObject(key, Buffer.from(buffer), mimeType)

    return {
      key,
      size: buffer.byteLength,
      mimeType,
    }
  }

  /**
   * Upload image with multiple variants (original + thumbnails)
   *
   * @param buffer - Image buffer
   * @param mimeType - Original MIME type
   * @param baseKey - Base key without extension
   * @param originalExtension - Original file extension
   * @returns Upload result with variant information
   */
  private async uploadImageWithVariants(
    buffer: Buffer,
    mimeType: string,
    baseKey: string,
    originalExtension: string
  ): Promise<UploadResult> {
    const variants = await generateImageVariants(buffer, mimeType)
    const variantInfos: VariantInfo[] = []

    // Upload each variant
    for (const variant of variants) {
      const key = `${baseKey}-${variant.variant}.webp`
      await this.putObject(key, variant.buffer, 'image/webp')

      variantInfos.push({
        variant: variant.variant,
        key,
        width: variant.width,
        height: variant.height,
        size: variant.size,
      })
    }

    // Return original variant as main result
    const original = variantInfos.find(v => v.variant === 'original')!

    return {
      key: original.key,
      size: original.size,
      mimeType: 'image/webp',
      variants: variantInfos,
    }
  }

  /**
   * Upload buffer to R2
   *
   * @param key - R2 object key
   * @param buffer - File buffer
   * @param contentType - MIME type
   */
  private async putObject(
    key: string,
    buffer: Buffer,
    contentType: string
  ): Promise<void> {
    const command = new PutObjectCommand({
      Bucket: this.config.bucketName,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    })

    await this.client.send(command)
  }

  /**
   * Delete file from R2
   *
   * @param key - R2 object key
   */
  async deleteFile(key: string): Promise<void> {
    const command = new DeleteObjectCommand({
      Bucket: this.config.bucketName,
      Key: key,
    })

    await this.client.send(command)
  }

  /**
   * Delete all variants of a file
   *
   * Used when deleting images with thumbnails.
   *
   * @param keys - Array of R2 object keys
   */
  async deleteFileWithVariants(keys: string[]): Promise<void> {
    await Promise.all(
      keys.map(key => this.deleteFile(key))
    )
  }

  /**
   * Generate signed URL for private file access
   *
   * Used to provide temporary access to files stored in private bucket.
   * URLs expire after the specified time (default: 1 hour).
   *
   * @param key - R2 object key
   * @param expiresIn - Expiration time in seconds (default: 3600 = 1 hour)
   * @returns Signed URL that expires after expiresIn seconds
   */
  async getSignedUrl(key: string, expiresIn: number = 3600): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.config.bucketName,
      Key: key,
    })

    return getSignedUrl(this.client, command, { expiresIn })
  }

  /**
   * Extract file extension from filename or MIME type
   *
   * @param filename - Original filename
   * @param mimeType - Detected MIME type
   * @returns File extension without dot
   */
  private getExtension(filename: string, mimeType: string): string {
    // Try to get from filename
    const match = filename.match(/\.([^.]+)$/)
    if (match) return match[1]

    // Fallback to MIME type mapping
    const mimeToExt: Record<string, string> = {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
      'image/gif': 'gif',
      'application/pdf': 'pdf',
      'text/plain': 'txt',
      'text/csv': 'csv',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
    }

    return mimeToExt[mimeType] || 'bin'
  }
}

/**
 * Create R2 client instance from environment config
 *
 * Pattern: Factory function similar to getQueryClient in @repo/query
 *
 * @param config - R2 configuration
 * @returns Initialized R2 client
 */
export function createR2Client(config: R2Config): R2StorageClient {
  return new R2StorageClient(config)
}
