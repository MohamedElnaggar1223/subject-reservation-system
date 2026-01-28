/**
 * Image Processing
 *
 * Uses Sharp library for efficient image resizing and optimization.
 * Generates multiple variants (original + thumbnails) and converts to WebP.
 *
 * Pattern: Follows service layer pattern - pure functions that process data
 */

import sharp from 'sharp'
import { IMAGE_VARIANTS } from './constants.js'
import type { ImageVariant } from './types.js'

export interface ProcessedImage {
  variant: ImageVariant
  buffer: Buffer
  width: number
  height: number
  size: number
  format: string
}

/**
 * Generate image variants (original + thumbnails)
 *
 * Creates optimized versions of the image at different sizes:
 * - Original: Optimized but same dimensions
 * - Thumbnail: 150x150 (for avatars, lists)
 * - Medium: 600x600 (for previews)
 * - Large: 1200x1200 (for full view)
 *
 * All variants are converted to WebP for optimal file size.
 * Maintains aspect ratio and doesn't upscale small images.
 *
 * @param originalBuffer - Original image buffer
 * @param mimeType - Original MIME type (unused, always converts to WebP)
 * @returns Array of processed images with metadata
 */
export async function generateImageVariants(
  originalBuffer: Buffer,
  mimeType: string
): Promise<ProcessedImage[]> {
  const results: ProcessedImage[] = []

  // Original image (optimized but same dimensions)
  const originalImage = sharp(originalBuffer)
  const originalMetadata = await originalImage.metadata()

  const optimizedOriginal = await originalImage
    .webp({ quality: 90 })
    .toBuffer()

  results.push({
    variant: 'original',
    buffer: optimizedOriginal,
    width: originalMetadata.width!,
    height: originalMetadata.height!,
    size: optimizedOriginal.byteLength,
    format: 'webp',
  })

  // Generate variants (thumbnail, medium, large)
  for (const [variant, dimensions] of Object.entries(IMAGE_VARIANTS)) {
    const resized = await sharp(originalBuffer)
      .resize(dimensions.width, dimensions.height, {
        fit: 'inside',      // Maintain aspect ratio
        withoutEnlargement: true,  // Don't upscale small images
      })
      .webp({ quality: 85 })
      .toBuffer()

    const metadata = await sharp(resized).metadata()

    results.push({
      variant: variant as ImageVariant,
      buffer: resized,
      width: metadata.width!,
      height: metadata.height!,
      size: resized.byteLength,
      format: 'webp',
    })
  }

  return results
}
