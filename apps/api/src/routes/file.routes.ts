/**
 * File routes — one upload path for every feature (FEATURES_PLAN.md F0a).
 *
 * - POST /files/upload          - Upload for a purpose: form { file, purpose, studentId? }.
 *                                 The purpose (UPLOAD_PURPOSES in @repo/validations)
 *                                 decides the types, the size, who may upload and
 *                                 who may read it.
 * - GET  /files/:id/content     - The file's bytes (?variant=thumbnail for an image),
 *                                 for anyone the purpose lets read it
 * - GET  /files/:id             - Its metadata, same rule
 * - GET  /files/:id/download    - Its metadata with URLs (signed on R2; the content
 *                                 path on the local store), same rule
 * - GET  /files                 - The caller's own files
 * - POST /files/avatar          - The caller's profile photo (purpose avatar)
 * - POST /files/document        - A personal document (purpose document)
 * - DELETE /files/:id           - Delete (owner or admin); never evidence
 *
 * A file the caller may not read answers 404, so its existence is not told.
 * A file attached to a payment or remark must be the attaching parent's own
 * evidence for that student (isAttachableEvidence, RF-13).
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
import { z } from 'zod'
import { success, error, clientMessage } from '../lib/response.js'
import { requireAuth } from '../middleware/access-control.middleware.js'
import type { HonoEnv } from '../lib/types.js'
import * as fileService from '../services/file.services.js'
import { extractAuditContext } from '../services/audit.services.js'

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
        const uploaded = await fileService.updateUserAvatar(file, { id: user.id, role: user.role })
        return success(c, uploaded, 201)
      } catch (err) {
        const message = clientMessage(err, 'Upload failed')
        return error(c, message, err instanceof fileService.FileError ? err.status : 400)
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
        const uploaded = await fileService.uploadFile(file, 'document', user.id, user.role)
        return success(c, uploaded, 201)
      } catch (err) {
        const message = clientMessage(err, 'Upload failed')
        return error(c, message, err instanceof fileService.FileError ? err.status : 400)
      }
    }
  )

  /**
   * UPLOAD FOR A PURPOSE (F0a)
   * POST /files/upload
   * Form data: { file, purpose, studentId? }
   */
  .post('/upload',
    zValidator('form', UploadFile),
    async (c) => {
      const user = c.get('user')!
      const { file, purpose, studentId } = c.req.valid('form')
      try {
        const uploaded = await fileService.uploadForPurpose(file, purpose, studentId, { id: user.id, role: user.role }, extractAuditContext(c))
        return success(c, uploaded, 201)
      } catch (err) {
        const message = clientMessage(err, 'Upload failed')
        return error(c, message, err instanceof fileService.FileError ? err.status : 400)
      }
    }
  )

  /**
   * A FILE'S BYTES (F0a)
   * GET /files/:id/content?variant=
   */
  .get('/:id/content',
    zValidator('param', FileId),
    zValidator('query', z.object({ variant: z.enum(['original', 'thumbnail', 'medium', 'large']).optional() })),
    async (c) => {
      const user = c.get('user')!
      const { id } = c.req.valid('param')
      const { variant } = c.req.valid('query')
      try {
        const content = await fileService.getFileContent(id, { id: user.id, role: user.role }, variant)
        return c.body(new Uint8Array(content.body), 200, {
          'Content-Type': content.mimeType,
          'Content-Disposition': `inline; filename="${content.name.replace(/[^\w.\- ]/g, '_')}"`,
          'Cache-Control': 'private, no-store',
          // Served from the API's origin: never run as a page.
          'Content-Security-Policy': "default-src 'none'; sandbox",
          'X-Content-Type-Options': 'nosniff',
        })
      } catch (err) {
        const message = clientMessage(err, 'File not found')
        return error(c, message, err instanceof fileService.FileError ? err.status : 404)
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

      const fileRecord = await fileService.getReadableFile(id, { id: user.id, role: user.role })

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

      // Get file with URLs (signed on R2; the content path on the local store)
      const fileWithUrls = await fileService.getReadableFileWithUrls(id, { id: user.id, role: user.role })

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
        const message = clientMessage(err, 'Delete failed')
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
