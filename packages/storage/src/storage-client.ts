/**
 * Storage clients (FEATURES_PLAN.md F0a, "Uploads").
 *
 * One interface, two stores: Cloudflare R2 in production, a directory on the
 * API's disk in development and tests. The upload logic — validation by the
 * file's magic bytes against the caller's limits, image variants for
 * avatars, safe keys — is shared; a store only puts, gets and deletes bytes.
 */

import { promises as fs } from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import type { FileType, UploadOptions, UploadResult, VariantInfo } from './types.js'
import { validateFile, isImage } from './file-validator.js'
import { generateImageVariants } from './image-processor.js'

const MIME_TO_EXT: Record<string, string> = {
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

export abstract class StorageClient {
  abstract readonly driver: 'r2' | 'local'

  /** Write bytes under a key. */
  protected abstract putObject(key: string, buffer: Buffer, contentType: string): Promise<void>

  /** Read the bytes under a key. */
  abstract getObject(key: string): Promise<Buffer>

  /** Delete the bytes under a key (no error if already gone). */
  abstract deleteFile(key: string): Promise<void>

  /** A time-limited URL for the key, where the store has one (R2); null otherwise. */
  abstract getSignedUrl(key: string, expiresIn?: number): Promise<string | null>

  async deleteFileWithVariants(keys: string[]): Promise<void> {
    await Promise.all(keys.map((key) => this.deleteFile(key)))
  }

  /**
   * Validate and store a file: size and type are checked against the
   * caller's limits (a purpose's), the type by the file's own bytes.
   */
  async uploadFile(file: File, options: UploadOptions): Promise<UploadResult> {
    const buffer = await file.arrayBuffer()
    const validation = await validateFile(buffer, file.type, options.fileType, {
      allowedMimeTypes: options.allowedMimeTypes,
      maxBytes: options.maxBytes,
    })
    if (!validation.valid) throw new Error(validation.error)
    const mimeType = validation.detectedMimeType!

    const folder = safeSegment(options.folder ?? options.fileType)
    const baseKey = `${folder}/${safeSegment(options.userId)}/${randomUUID()}`

    if (isImage(mimeType) && options.generateThumbnails) {
      const variants = await generateImageVariants(Buffer.from(buffer), mimeType)
      const infos: VariantInfo[] = []
      for (const v of variants) {
        const key = `${baseKey}-${v.variant}.webp`
        await this.putObject(key, v.buffer, 'image/webp')
        infos.push({ variant: v.variant, key, width: v.width, height: v.height, size: v.size })
      }
      const original = infos.find((v) => v.variant === 'original')!
      return { key: original.key, size: original.size, mimeType: 'image/webp', variants: infos }
    }

    const key = `${baseKey}.${extensionFor(file.name, mimeType)}`
    await this.putObject(key, Buffer.from(buffer), mimeType)
    return { key, size: buffer.byteLength, mimeType }
  }
}

/** A key segment made only of safe characters. */
function safeSegment(s: string): string {
  return s.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80) || '_'
}

/** The file's own extension when it is a plain one, else the type's. */
function extensionFor(filename: string, mimeType: string): string {
  const m = /\.([A-Za-z0-9]{1,8})$/.exec(filename)
  return (m?.[1] ?? MIME_TO_EXT[mimeType] ?? 'bin').toLowerCase()
}

/**
 * Files on the API's own disk, under one directory. For development and the
 * test suite; production uses R2 (the API refuses uploads in production
 * without it).
 */
export class LocalStorageClient extends StorageClient {
  readonly driver = 'local' as const
  private readonly root: string

  constructor(rootDir: string) {
    super()
    this.root = path.resolve(rootDir)
  }

  private pathOf(key: string): string {
    const full = path.resolve(this.root, key)
    if (!full.startsWith(this.root + path.sep)) throw new Error('Invalid storage key')
    return full
  }

  protected async putObject(key: string, buffer: Buffer): Promise<void> {
    const full = this.pathOf(key)
    await fs.mkdir(path.dirname(full), { recursive: true })
    await fs.writeFile(full, buffer)
  }

  async getObject(key: string): Promise<Buffer> {
    return fs.readFile(this.pathOf(key))
  }

  async deleteFile(key: string): Promise<void> {
    await fs.rm(this.pathOf(key), { force: true })
  }

  async getSignedUrl(): Promise<string | null> {
    return null
  }
}

export type { FileType }
