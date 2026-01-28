/**
 * File Upload API Routes
 *
 * EXAMPLE: Demonstrates file upload patterns with:
 * - Multipart form data handling
 * - File validation with Zod
 * - Image processing (avatars with thumbnails)
 * - Ownership verification
 * - Pagination for file lists
 * - Role-based access control
 *
 * Route Structure:
 * - POST /files/avatar     - Upload avatar with thumbnails
 * - POST /files/document   - Upload document (PDF, DOCX, etc.)
 * - POST /files            - Upload general file
 * - GET /files             - List user's files (paginated)
 * - GET /files/:id         - Get specific file
 * - DELETE /files/:id      - Delete file (admin or owner)
 *
 * Pattern: Follows todo.routes.ts structure exactly
 */

import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import {
  UploadAvatar,
  UploadDocument,
  UploadFile,
  FileId,
  ListFilesQuery,
  ROLES,
} from '@repo/validations'
import { success, error } from '../lib/response.js'
import { requireAuth } from '../middleware/access-control.middleware.js'
import type { HonoEnv } from '../lib/types.js'
import * as fileService from '../services/file.services.js'

/**
 * Initialize route with typed environment
 *
 * HonoEnv provides type-safe access to:
 * - c.get('user')     - Current authenticated user
 * - c.get('session')  - Current session
 * - c.get('requestId') - Request tracking ID
 */
export const files = new Hono<HonoEnv>()
  /**
   * Middleware: Require authentication for all routes
   *
   * This runs before any route handler.
   * If not authenticated, returns 401 Unauthorized.
   */
  .use('*', requireAuth())

  /**
   * UPLOAD AVATAR
   * POST /files/avatar
   * Form data: { file: File }
   *
   * Uploads user avatar with automatic:
   * - Image validation (type, size)
   * - Thumbnail generation (150x150, 600x600, 1200x1200)
   * - Old avatar deletion
   * - WebP conversion for optimal size
   *
   * Demonstrates:
   * - zValidator('form') for multipart data
   * - Service layer integration
   * - Error handling with try-catch
   */
  .post('/avatar',
    zValidator('form', UploadAvatar),
    async (c) => {
      const user = c.get('user')!
      const { file } = c.req.valid('form')

      try {
        const uploaded = await fileService.updateUserAvatar(file, user.id)
        return success(c, uploaded, 201)
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Upload failed'
        return error(c, message, 400)
      }
    }
  )

  /**
   * UPLOAD DOCUMENT
   * POST /files/document
   * Form data: { file: File }
   *
   * Uploads a document (PDF, DOCX, XLSX, TXT, CSV).
   * No image processing - stored as-is.
   *
   * Demonstrates:
   * - Different validation schema for different file types
   * - Simple file upload without variants
   */
  .post('/document',
    zValidator('form', UploadDocument),
    async (c) => {
      const user = c.get('user')!
      const { file } = c.req.valid('form')

      try {
        const uploaded = await fileService.uploadFile(file, 'document', user.id)
        return success(c, uploaded, 201)
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Upload failed'
        return error(c, message, 400)
      }
    }
  )

  /**
   * UPLOAD GENERAL FILE
   * POST /files
   * Form data: { file: File }
   *
   * Uploads any allowed file type (50MB limit).
   * More permissive validation.
   */
  .post('/',
    zValidator('form', UploadFile),
    async (c) => {
      const user = c.get('user')!
      const { file } = c.req.valid('form')

      try {
        const uploaded = await fileService.uploadFile(file, 'general', user.id)
        return success(c, uploaded, 201)
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Upload failed'
        return error(c, message, 400)
      }
    }
  )

  /**
   * LIST FILES
   * GET /files
   * Query: { fileType?: 'avatar' | 'document' | 'general', page?: number, pageSize?: number }
   *
   * Lists user's files with optional filtering and pagination.
   *
   * Demonstrates:
   * - Query parameter validation
   * - Pagination pattern
   * - Optional filtering
   */
  .get('/',
    zValidator('query', ListFilesQuery),
    async (c) => {
      const user = c.get('user')!
      const query = c.req.valid('query')

      const result = await fileService.getUserFiles(user.id, {
        fileType: query.fileType,
        page: query.page,
        pageSize: query.pageSize,
      })

      return success(c, result)
    }
  )

  /**
   * GET FILE BY ID
   * GET /files/:id
   * Params: { id: string (UUID) }
   *
   * Returns file metadata with variants (if image).
   * NOTE: Does NOT include URLs - use /files/:id/download to get signed URL
   *
   * Demonstrates:
   * - URL parameter validation
   * - Ownership check
   * - 404 handling
   */
  .get('/:id',
    zValidator('param', FileId),
    async (c) => {
      const user = c.get('user')!
      const { id } = c.req.valid('param')

      const fileRecord = await fileService.getUserFile(id, user.id)

      if (!fileRecord) {
        return error(c, 'File not found', 404)
      }

      return success(c, fileRecord)
    }
  )

  /**
   * DOWNLOAD FILE (Get Signed URL)
   * GET /files/:id/download
   * Params: { id: string (UUID) }
   *
   * Returns file metadata with temporary signed URLs.
   * URLs expire in 1 hour for security.
   *
   * Demonstrates:
   * - Signed URL generation for secure file access
   * - Private bucket pattern
   * - Temporary access links
   *
   * IMPORTANT: This is the PRIMARY way to access files
   * The bucket is PRIVATE - files cannot be accessed directly
   */
  .get('/:id/download',
    zValidator('param', FileId),
    async (c) => {
      const user = c.get('user')!
      const { id } = c.req.valid('param')

      // Get file with signed URLs
      const fileWithUrls = await fileService.getUserFileWithSignedUrls(id, user.id)

      if (!fileWithUrls) {
        return error(c, 'File not found', 404)
      }

      return success(c, fileWithUrls)
    }
  )

  /**
   * DELETE FILE
   * DELETE /files/:id
   * Params: { id: string }
   *
   * Deletes file from R2 and database.
   * Only owner or admin can delete.
   *
   * Demonstrates:
   * - Role-based access control
   * - Ownership verification
   * - Resource cleanup (R2 + database)
   */
  .delete('/:id',
    zValidator('param', FileId),
    async (c) => {
      const user = c.get('user')!
      const { id } = c.req.valid('param')

      // Check ownership (unless admin)
      if (user.role !== ROLES.ADMIN) {
        const isOwner = await fileService.isFileOwner(id, user.id)
        if (!isOwner) {
          return error(c, 'File not found or access denied', 404)
        }
      }

      try {
        await fileService.deleteFile(id, user.id)
        return success(c, { deleted: true })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Delete failed'
        return error(c, message, 400)
      }
    }
  )

/**
 * Export type for RPC client
 *
 * This enables type-safe API calls from web and mobile:
 *
 * const files = await apiResponse(api.v1.files.$get())
 * // Type automatically inferred: FileWithVariants[]
 *
 * const uploaded = await apiResponse(
 *   api.v1.files.avatar.$post({ form: formData })
 * )
 * // Type: FileWithVariants
 *
 * CRITICAL: Do NOT manually type the responses.
 * Let Hono RPC infer them automatically.
 */
export type FilesApi = typeof files
