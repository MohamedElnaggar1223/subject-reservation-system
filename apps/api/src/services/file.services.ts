/**
 * File Service Layer
 *
 * Handles business logic for file uploads and management.
 * Coordinates between storage (R2) and database.
 *
 * Pattern: Follows todo.services.ts structure
 * - Import everything from @repo/db (NEVER from drizzle-orm directly)
 * - Pure business logic (no HTTP concerns)
 * - Return data or throw errors
 * - Service functions are simple, focused operations
 */

/**
 * CRITICAL: Import everything from @repo/db
 *
 * Never import from 'drizzle-orm' directly in services.
 * All drizzle operators are re-exported from @repo/db.
 */
import { db, file, fileVariant, eq, and, desc, count } from '@repo/db'
import { randomUUID } from 'crypto'
import { createR2Client } from '@repo/storage'
import { env } from '../env.js'
import type { FileType } from '@repo/storage'

/**
 * Initialize R2 client
 *
 * Pattern: Similar to database client initialization
 * Singleton instance created from environment configuration
 *
 * IMPORTANT: Bucket is PRIVATE - files accessed via signed URLs only
 */
const r2Client = createR2Client({
  accountId: env.R2_ACCOUNT_ID,
  accessKeyId: env.R2_ACCESS_KEY_ID,
  secretAccessKey: env.R2_SECRET_ACCESS_KEY,
  bucketName: env.R2_BUCKET_NAME,
})

/**
 * Upload file to R2 and save metadata to database
 *
 * Steps:
 * 1. Upload to R2 (with optional image processing)
 * 2. Save file record to database
 * 3. If image with variants, save variant records
 * 4. Return complete file info with relations
 *
 * @param uploadedFile - File object from multipart form data
 * @param fileType - Type of file (avatar, document, general)
 * @param userId - Owner's user ID
 * @returns File record with variants (if applicable)
 */
export async function uploadFile(
  uploadedFile: File,
  fileType: FileType,
  userId: string
) {
  // Upload to R2
  const uploadResult = await r2Client.uploadFile(uploadedFile, {
    bucket: env.R2_BUCKET_NAME,
    userId,
    fileType,
    generateThumbnails: fileType === 'avatar', // Auto-generate for avatars
  })

  // Save file record (no URL - will generate signed URLs on-demand)
  const fileId = randomUUID()
  const now = new Date()

  const [fileRecord] = await db
    .insert(file)
    .values({
      id: fileId,
      name: uploadedFile.name,
      mimeType: uploadResult.mimeType,
      size: uploadResult.size.toString(),
      storageKey: uploadResult.key,
      // No url field - files accessed via signed URLs only
      fileType,
      userId,
      createdAt: now,
      updatedAt: now,
    })
    .returning()

  // Save variants if present (for images)
  if (uploadResult.variants) {
    const variantRecords = uploadResult.variants.map(v => ({
      id: randomUUID(),
      fileId,
      variant: v.variant,
      storageKey: v.key,
      // No url field - will generate signed URLs on-demand
      width: v.width.toString(),
      height: v.height.toString(),
      size: v.size.toString(),
      createdAt: now,
    }))

    await db.insert(fileVariant).values(variantRecords)
  }

  // Return file with variants
  return getUserFile(fileId, userId)
}

/**
 * Get file by ID with ownership check
 *
 * @param fileId - The file's ID
 * @param userId - The user's ID
 * @returns File object with variants or undefined if not found
 *
 * Pattern: User-scoped query with relations
 */
export async function getUserFile(fileId: string, userId: string) {
  return db.query.file.findFirst({
    where: (files, { and, eq }) => and(
      eq(files.id, fileId),
      eq(files.userId, userId)
    ),
    with: {
      variants: true,
    },
  })
}

/**
 * List user's files with optional filtering and pagination
 *
 * @param userId - The user's ID
 * @param options - Filter and pagination options
 * @returns Paginated file list
 *
 * Pattern: User-scoped query with filtering and pagination
 */
export async function getUserFiles(
  userId: string,
  options: {
    fileType?: FileType
    page: number
    pageSize: number
  }
) {
  const offset = (options.page - 1) * options.pageSize

  // Build where clause
  const conditions = [eq(file.userId, userId)]
  if (options.fileType) {
    conditions.push(eq(file.fileType, options.fileType))
  }

  // Get files
  const files = await db.query.file.findMany({
    where: (files, { and }) => and(...conditions),
    with: {
      variants: true,
    },
    orderBy: (files, { desc }) => [desc(files.createdAt)],
    limit: options.pageSize,
    offset,
  })

  // Get total count
  const [countResult] = await db
    .select({ count: count() })
    .from(file)
    .where(and(...conditions))

  if (!countResult) throw new Error("No files returned from the database") 

  const total = Number(countResult.count)
  const totalPages = Math.ceil(total / options.pageSize)

  // Generate signed URLs for all files and their variants
  const filesWithUrls = await Promise.all(
    files.map(async (file) => {
      const url = await getFileSignedUrl(file.storageKey)

      // Generate signed URLs for variants (if present)
      let variantsWithUrls = file.variants.map(v => ({...v, url: ''}))
      if (file.variants && file.variants.length > 0) {
        variantsWithUrls = await Promise.all(
          file.variants.map(async (variant) => ({
            ...variant,
            url: await getFileSignedUrl(variant.storageKey),
          }))
        )
      }

      return {
        ...file,
        url,
        variants: variantsWithUrls,
      }
    })
  )

  return {
    data: filesWithUrls,
    pagination: {
      page: options.page,
      pageSize: options.pageSize,
      total,
      totalPages,
    },
  }
}

/**
 * Delete file from R2 and database
 *
 * Handles cleanup of variants if present.
 * Cascade delete in schema automatically removes variant records.
 *
 * @param fileId - The file's ID
 * @param userId - The user's ID (for ownership verification)
 *
 * Pattern: Delete from storage first, then database
 * If storage deletion fails, database rollback happens automatically
 */
export async function deleteFile(fileId: string, userId: string) {
  // Get file with variants
  const fileRecord = await getUserFile(fileId, userId)

  if (!fileRecord) {
    throw new Error('File not found')
  }

  // Delete from R2
  if (fileRecord.variants && fileRecord.variants.length > 0) {
    // Delete all variants
    const keys = fileRecord.variants.map(v => v.storageKey)
    await r2Client.deleteFileWithVariants(keys)
  } else {
    // Delete single file
    await r2Client.deleteFile(fileRecord.storageKey)
  }

  // Delete from database (cascade will handle variants)
  await db.delete(file).where(eq(file.id, fileId))
}

/**
 * Generate signed URL for file access
 *
 * Creates temporary URL that expires in 1 hour.
 * Used for secure access to files in private bucket.
 *
 * @param storageKey - The R2 storage key
 * @param expiresIn - Expiration time in seconds (default: 3600 = 1 hour)
 * @returns Signed URL
 *
 * Pattern: Wrapper around R2 client's getSignedUrl
 */
export async function getFileSignedUrl(storageKey: string, expiresIn: number = 3600): Promise<string> {
  return r2Client.getSignedUrl(storageKey, expiresIn)
}

/**
 * Get file with signed URLs
 *
 * Retrieves file metadata and generates signed URLs for the file and all its variants.
 *
 * @param fileId - The file's ID
 * @param userId - The user's ID
 * @param expiresIn - Expiration time for URLs in seconds
 * @returns File with signed URLs, or undefined if not found
 */
export async function getUserFileWithSignedUrls(
  fileId: string,
  userId: string,
  expiresIn: number = 3600
) {
  const fileRecord = await getUserFile(fileId, userId)

  if (!fileRecord) {
    return undefined
  }

  // Generate signed URL for main file
  const url = await getFileSignedUrl(fileRecord.storageKey, expiresIn)

  // Generate signed URLs for variants (if present)
  let variantsWithUrls
  if (fileRecord.variants && fileRecord.variants.length > 0) {
    variantsWithUrls = await Promise.all(
      fileRecord.variants.map(async (variant) => ({
        ...variant,
        url: await getFileSignedUrl(variant.storageKey, expiresIn),
      }))
    )
  }

  return {
    ...fileRecord,
    url,
    variants: variantsWithUrls || fileRecord.variants,
  }
}

/**
 * Check if user owns a file
 *
 * @param fileId - The file's ID
 * @param userId - The user's ID
 * @returns true if user owns the file
 *
 * Pattern: Ownership verification (used before update/delete)
 */
export async function isFileOwner(fileId: string, userId: string): Promise<boolean> {
  const fileRecord = await db.query.file.findFirst({
    where: (files, { and, eq }) => and(
      eq(files.id, fileId),
      eq(files.userId, userId)
    ),
  })

  return !!fileRecord
}

/**
 * Update user's avatar
 *
 * Deletes old avatar if present, uploads new one.
 * Ensures user only has one avatar at a time.
 *
 * @param uploadedFile - New avatar file
 * @param userId - The user's ID
 * @returns Uploaded avatar file record
 *
 * Pattern: Delete-then-create for single-file scenarios
 */
export async function updateUserAvatar(
  uploadedFile: File,
  userId: string
) {
  // Delete existing avatar if present
  const existingAvatar = await db.query.file.findFirst({
    where: (files, { and, eq }) => and(
      eq(files.userId, userId),
      eq(files.fileType, 'avatar')
    ),
    with: {
      variants: true,
    },
  })

  if (existingAvatar) {
    await deleteFile(existingAvatar.id, userId)
  }

  // Upload new avatar
  return uploadFile(uploadedFile, 'avatar', userId)
}
