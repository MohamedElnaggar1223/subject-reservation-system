/**
 * Cloudflare R2 Client
 *
 * S3-compatible storage client for Cloudflare R2: the production store
 * (F0a uploads). The upload logic is shared with the local store
 * (storage-client.ts); this class only moves bytes.
 */

import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import type { R2Config } from './types.js'
import { StorageClient, LocalStorageClient } from './storage-client.js'

export class R2StorageClient extends StorageClient {
  readonly driver = 'r2' as const
  private client: S3Client
  private config: R2Config

  constructor(config: R2Config) {
    super()
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

  protected async putObject(key: string, buffer: Buffer, contentType: string): Promise<void> {
    await this.client.send(new PutObjectCommand({
      Bucket: this.config.bucketName,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    }))
  }

  async getObject(key: string): Promise<Buffer> {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.config.bucketName, Key: key }))
    const bytes = await res.Body?.transformToByteArray()
    if (!bytes) throw new Error('File not found in storage')
    return Buffer.from(bytes)
  }

  async deleteFile(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.config.bucketName, Key: key }))
  }

  /**
   * A signed URL for private access, expiring after `expiresIn` seconds
   * (default one hour).
   */
  async getSignedUrl(key: string, expiresIn: number = 3600): Promise<string> {
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.config.bucketName, Key: key }), { expiresIn })
  }
}

export function createR2Client(config: R2Config): R2StorageClient {
  return new R2StorageClient(config)
}

/**
 * The store for this environment: R2 when all four R2 values are set;
 * otherwise a local directory, unless `allowLocal` is false (production),
 * in which case there is no store and uploads are refused.
 */
export function createStorageClient(opts: { r2: Partial<R2Config>; localDir: string; allowLocal: boolean }): StorageClient | null {
  const { accountId, accessKeyId, secretAccessKey, bucketName } = opts.r2
  if (accountId && accessKeyId && secretAccessKey && bucketName) {
    return new R2StorageClient({ accountId, accessKeyId, secretAccessKey, bucketName })
  }
  return opts.allowLocal ? new LocalStorageClient(opts.localDir) : null
}
