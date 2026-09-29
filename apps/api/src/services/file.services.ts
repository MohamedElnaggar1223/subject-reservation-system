/**
 * File Service (F0a: one upload path for every feature)
 *
 * Every file is uploaded for a purpose (UPLOAD_PURPOSES in
 * @repo/validations): its types and size, who may upload it, whether it
 * concerns a student (and so a family), and who may read it back. The bytes
 * go to R2 in production and to a local directory in development and tests
 * (LOCAL_UPLOAD_DIR); production without R2 refuses uploads.
 *
 * Reads are decided per file:
 * - 'owner'  the account that uploaded it;
 * - 'family' the student it concerns and their approved linked parents;
 * - a role   any account with that role;
 * - a personal document (the original upload route) attached as evidence to
 *   a payment or a remark is read by finance and admin too, so finance can
 *   check an InstaPay screenshot or a signed consent (SECURITY_AUDIT.md O-5).
 * A file the caller may not read answers as not found, never as forbidden,
 * so its existence is not told.
 *
 * Evidence is never deleted while attached (RF-13, migration 0027).
 */

import { db, file, fileVariant, eq, and, count } from '@repo/db'
import { randomUUID } from 'crypto'
import { createStorageClient, type StorageClient } from '@repo/storage'
import {
  UPLOAD_PURPOSES, ROLES, hasRole,
  type UploadPurpose, type ReadRule, type Role,
} from '@repo/validations'
import { env } from '../env.js'
import { logAction, type AuditContext } from './audit.services'

const storage: StorageClient | null = createStorageClient({
  r2: {
    accountId: env.R2_ACCOUNT_ID,
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    bucketName: env.R2_BUCKET_NAME,
  },
  localDir: env.LOCAL_UPLOAD_DIR,
  allowLocal: env.NODE_ENV !== 'production',
})

if (!storage) {
  console.warn('[files] R2 is not configured in production: uploads will be refused until it is')
}

function store(): StorageClient {
  if (!storage) throw new FileError('File storage is not configured — ask the administrator to set up R2', 503)
  return storage
}

export class FileError extends Error {
  constructor(message: string, public readonly status: 400 | 403 | 404 | 409 | 503 = 400) {
    super(message)
  }
}

export type Viewer = { id: string; role: string | null | undefined }

// ─── Upload ──────────────────────────────────────────────────────────────────

async function isLinkedParent(parentId: string, studentId: string): Promise<boolean> {
  const link = await db.query.parentStudentLink.findFirst({
    where: (l, { eq: eqOp, and: andOp }) => andOp(eqOp(l.parentId, parentId), eqOp(l.studentId, studentId), eqOp(l.status, 'approved')),
    columns: { id: true },
  })
  return !!link
}

/**
 * Upload a file for a purpose. Refused (403) to a role the purpose does not
 * name; a purpose that concerns a student needs one the uploader may act
 * for: a student only themself, a parent only a linked child, staff any
 * student.
 */
export async function uploadForPurpose(
  uploaded: File,
  purpose: UploadPurpose,
  studentId: string | undefined,
  viewer: Viewer,
  ctx?: AuditContext,
) {
  const def = UPLOAD_PURPOSES[purpose]
  if (!hasRole(viewer.role, ...(def.uploadRoles as readonly Role[]))) {
    throw new FileError(`Your account cannot upload a ${def.label.toLowerCase()}`, 403)
  }
  if (def.concernsStudent === 'required') {
    if (!studentId) throw new FileError(`Say which student the ${def.label.toLowerCase()} is for`)
    const student = await db.query.user.findFirst({ where: (u, { eq: eqOp }) => eqOp(u.id, studentId), columns: { role: true } })
    if (!student || student.role !== 'student') throw new FileError('Student not found', 404)
    if (viewer.role === ROLES.STUDENT && studentId !== viewer.id) throw new FileError('You can upload only for yourself', 403)
    if (viewer.role === ROLES.PARENT && !(await isLinkedParent(viewer.id, studentId))) throw new FileError('You are not linked to this student', 403)
  } else if (studentId) {
    throw new FileError(`A ${def.label.toLowerCase()} does not belong to a student`)
  }

  const result = await store().uploadFile(uploaded, {
    userId: viewer.id,
    fileType: purpose === 'avatar' ? 'avatar' : 'document',
    folder: purpose,
    allowedMimeTypes: def.mimeTypes,
    maxBytes: def.maxBytes,
    generateThumbnails: 'thumbnails' in def && def.thumbnails === true,
  })

  const fileId = randomUUID()
  await db.transaction(async (tx) => {
    await tx.insert(file).values({
      id: fileId,
      name: uploaded.name.slice(0, 200),
      mimeType: result.mimeType,
      size: result.size.toString(),
      storageKey: result.key,
      fileType: purpose === 'avatar' ? 'avatar' : 'document',
      purpose,
      userId: viewer.id,
      studentId: studentId ?? null,
    })
    if (result.variants) {
      await tx.insert(fileVariant).values(result.variants.map((v) => ({
        id: randomUUID(), fileId, variant: v.variant, storageKey: v.key,
        width: v.width.toString(), height: v.height.toString(), size: v.size.toString(),
      })))
    }
    await logAction(viewer.id, 'FILE_UPLOADED', 'file', fileId, null,
      { purpose, studentId: studentId ?? null, name: uploaded.name, size: result.size, mimeType: result.mimeType }, ctx, tx)
  })
  return (await getReadableFile(fileId, viewer))!
}

/** The original document route: a personal document of the uploader's own. */
export async function uploadFile(uploaded: File, _fileType: 'document', userId: string, role?: string | null) {
  return uploadForPurpose(uploaded, 'document', undefined, { id: userId, role: role ?? ROLES.STUDENT })
}

/**
 * Replace the uploader's avatar: the old one goes, the new one comes, one at
 * a time per account.
 */
export async function updateUserAvatar(uploaded: File, viewer: Viewer) {
  const existing = await db.query.file.findFirst({
    where: (f, { and: andOp, eq: eqOp }) => andOp(eqOp(f.userId, viewer.id), eqOp(f.purpose, 'avatar')),
    columns: { id: true },
  })
  if (existing) await deleteFile(existing.id, viewer.id)
  return uploadForPurpose(uploaded, 'avatar', undefined, viewer)
}

// ─── Read ────────────────────────────────────────────────────────────────────

async function attachedAsEvidence(fileId: string): Promise<boolean> {
  const [p, r] = await Promise.all([
    db.query.payment.findFirst({ where: (x, { eq: eqOp }) => eqOp(x.verificationFileId, fileId), columns: { id: true } }),
    db.query.remarkRequest.findFirst({ where: (x, { eq: eqOp }) => eqOp(x.consentFileId, fileId), columns: { id: true } }),
  ])
  return !!p || !!r
}

/** May this account read this file? (Its purpose's rule; see the header.) */
export async function mayRead(
  f: { userId: string; purpose: string; studentId: string | null; id: string },
  viewer: Viewer,
): Promise<boolean> {
  if (f.userId === viewer.id) return true
  const def = UPLOAD_PURPOSES[f.purpose as UploadPurpose]
  if (!def) return false
  const rules = def.read as readonly ReadRule[]
  if (rules.some((r) => r !== 'owner' && r !== 'family' && r === viewer.role)) return true
  if (rules.includes('family') && f.studentId) {
    if (viewer.role === ROLES.STUDENT && viewer.id === f.studentId) return true
    if (viewer.role === ROLES.PARENT && (await isLinkedParent(viewer.id, f.studentId))) return true
  }
  if (f.purpose === 'document' && hasRole(viewer.role, ROLES.FINANCE_OFFICER, ROLES.FINANCE_ADMIN, ROLES.ADMIN)) {
    return attachedAsEvidence(f.id)
  }
  return false
}

/** A file with its variants, if this account may read it; otherwise undefined. */
export async function getReadableFile(fileId: string, viewer: Viewer) {
  const f = await db.query.file.findFirst({
    where: (x, { eq: eqOp }) => eqOp(x.id, fileId),
    with: { variants: true },
  })
  if (!f || !(await mayRead(f, viewer))) return undefined
  return f
}

/**
 * The bytes of a file (or one of its image variants) for a reader: the one
 * read path every feature's screens use (GET /v1/files/:id/content).
 */
export async function getFileContent(fileId: string, viewer: Viewer, variant?: string) {
  const f = await getReadableFile(fileId, viewer)
  if (!f) throw new FileError('File not found', 404)
  const v = variant ? f.variants.find((x) => x.variant === variant) : undefined
  if (variant && !v) throw new FileError('File not found', 404)
  const body = await store().getObject(v ? v.storageKey : f.storageKey)
  return { body, mimeType: v ? 'image/webp' : f.mimeType, name: f.name }
}

/** The API path that serves a file's bytes (the local store has no signed URLs). */
function contentPath(fileId: string, variant?: string) {
  return `/v1/files/${fileId}/content${variant ? `?variant=${variant}` : ''}`
}

async function urlFor(fileId: string, storageKey: string, variant?: string, expiresIn = 3600) {
  return (await store().getSignedUrl(storageKey, expiresIn)) ?? contentPath(fileId, variant)
}

/** A readable file with URLs for it and its variants (signed on R2, the content path locally). */
export async function getReadableFileWithUrls(fileId: string, viewer: Viewer, expiresIn = 3600) {
  const f = await getReadableFile(fileId, viewer)
  if (!f) return undefined
  return {
    ...f,
    url: await urlFor(f.id, f.storageKey, undefined, expiresIn),
    variants: await Promise.all(f.variants.map(async (v) => ({ ...v, url: await urlFor(f.id, v.storageKey, v.variant, expiresIn) }))),
  }
}

/** The caller's own files (paginated), with URLs. */
export async function getUserFiles(
  userId: string,
  options: { fileType?: 'avatar' | 'document' | 'general'; page: number; pageSize: number },
) {
  const offset = (options.page - 1) * options.pageSize
  const conditions = [eq(file.userId, userId)]
  if (options.fileType) conditions.push(eq(file.fileType, options.fileType))

  const files = await db.query.file.findMany({
    where: and(...conditions),
    with: { variants: true },
    orderBy: (f, { desc }) => [desc(f.createdAt)],
    limit: options.pageSize,
    offset,
  })
  const [countResult] = await db.select({ count: count() }).from(file).where(and(...conditions))
  const total = Number(countResult?.count ?? 0)

  const data = await Promise.all(files.map(async (f) => ({
    ...f,
    url: await urlFor(f.id, f.storageKey),
    variants: await Promise.all(f.variants.map(async (v) => ({ ...v, url: await urlFor(f.id, v.storageKey, v.variant) }))),
  })))
  return { data, pagination: { page: options.page, pageSize: options.pageSize, total, totalPages: Math.ceil(total / options.pageSize) } }
}

// ─── Delete ──────────────────────────────────────────────────────────────────

/**
 * Delete a file (its owner; the route lets an admin delete any). A file
 * attached to a payment or a remark is evidence and is never deleted
 * (RF-13; the foreign keys refuse it too).
 */
export async function deleteFile(fileId: string, _actorId: string) {
  const f = await db.query.file.findFirst({ where: (x, { eq: eqOp }) => eqOp(x.id, fileId), with: { variants: true } })
  if (!f) throw new Error('File not found')
  if (await attachedAsEvidence(fileId)) {
    throw new Error('This file is attached to a payment or a remark request and cannot be deleted')
  }
  const keys = f.variants.length ? f.variants.map((v) => v.storageKey) : [f.storageKey]
  if (storage) await storage.deleteFileWithVariants(keys).catch((err) => console.error('[files] storage delete failed:', err))
  await db.delete(file).where(eq(file.id, fileId))
}

export async function isFileOwner(fileId: string, userId: string): Promise<boolean> {
  const f = await db.query.file.findFirst({
    where: (x, { and: andOp, eq: eqOp }) => andOp(eqOp(x.id, fileId), eqOp(x.userId, userId)),
    columns: { id: true },
  })
  return !!f
}

/**
 * Whether a file can be attached as evidence by this parent (RF-13, F0a):
 * one they uploaded, for an evidence purpose (the screenshot or consent
 * purpose, or a personal document from the original route), and — when it
 * concerns a student — for this student. Avatars never: replacing an avatar
 * deletes the old one.
 */
export async function isAttachableEvidence(
  fileId: string,
  userId: string,
  purposes: readonly UploadPurpose[],
  studentId: string,
): Promise<boolean> {
  const f = await db.query.file.findFirst({
    where: (x, { and: andOp, eq: eqOp }) => andOp(eqOp(x.id, fileId), eqOp(x.userId, userId)),
    columns: { purpose: true, studentId: true, fileType: true },
  })
  // Both the purpose and the storage type: a row written without a purpose
  // reads as 'document' by the column's default, but an avatar never is one.
  if (!f || f.fileType !== 'document' || !(purposes as readonly string[]).includes(f.purpose)) return false
  return f.studentId === null || f.studentId === studentId
}
