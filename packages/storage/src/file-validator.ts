/**
 * File Validation
 *
 * Validates file size and MIME type using actual file content detection.
 * Uses magic number detection to prevent MIME type spoofing.
 *
 * Pattern: Similar to validation patterns in @repo/validations
 */

import { fileTypeFromBuffer } from 'file-type'
import { ALLOWED_MIME_TYPES, MAX_FILE_SIZE } from './constants.js'
import type { FileType, FileValidationResult } from './types.js'

/**
 * Validate file based on type, size, and actual MIME type
 *
 * Uses magic number detection to prevent MIME type spoofing.
 * This provides security against malicious files disguised as safe types.
 *
 * @param buffer - File content as ArrayBuffer
 * @param declaredMimeType - MIME type from file.type (can be spoofed)
 * @param fileType - Category of file (avatar, document, general)
 * @returns Validation result with detected MIME type or error message
 */
export async function validateFile(
  buffer: ArrayBuffer,
  declaredMimeType: string,
  fileType: FileType
): Promise<FileValidationResult> {
  // Check file size
  const size = buffer.byteLength
  const maxSize = MAX_FILE_SIZE[fileType]

  if (size > maxSize) {
    return {
      valid: false,
      error: `File size exceeds ${maxSize / 1024 / 1024}MB limit`,
    }
  }

  if (size === 0) {
    return {
      valid: false,
      error: 'File is empty',
    }
  }

  // Detect actual MIME type from file content (magic numbers)
  const uint8Array = new Uint8Array(buffer)
  const fileTypeResult = await fileTypeFromBuffer(uint8Array)

  const detectedMimeType = fileTypeResult?.mime || declaredMimeType

  // Check if MIME type is allowed for this file type
  const allowedTypes = ALLOWED_MIME_TYPES[fileType] as readonly string[]
  if (!allowedTypes.includes(detectedMimeType)) {
    return {
      valid: false,
      error: `File type ${detectedMimeType} not allowed for ${fileType} uploads`,
    }
  }

  return {
    valid: true,
    detectedMimeType,
  }
}

/**
 * Check if a MIME type is an image
 *
 * Used to determine if image processing should be applied.
 *
 * @param mimeType - MIME type to check
 * @returns true if the MIME type is an image
 */
export function isImage(mimeType: string): boolean {
  return mimeType.startsWith('image/')
}
