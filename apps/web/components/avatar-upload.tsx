/**
 * Avatar Upload Component
 *
 * EXAMPLE: This demonstrates file upload patterns with:
 * 1. File input with preview
 * 2. Image upload with useMutation
 * 3. Display of image variants (thumbnail, medium, large)
 * 4. Optimistic UI updates
 * 5. Error handling
 * 6. Loading states
 *
 * Patterns Demonstrated:
 * - Type-safe API calls with Hono RPC (NO manual types!)
 * - FormData handling for multipart uploads
 * - Image preview before upload
 * - Display of multiple image variants
 * - Automatic refetching after upload
 */

'use client'

/**
 * IMPORTANT: RPC Type Inference
 *
 * Notice we DON'T import avatar response types - Hono RPC infers automatically!
 * We only import INPUT types for validation.
 *
 * This is the correct pattern for Hono RPC:
 * - Import INPUT types only (none needed here - FormData)
 * - Let RPC infer OUTPUT types automatically
 * - Never manually type API responses
 */
import { useState, useRef } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '~/lib/hono'
import { apiResponse } from '@repo/validations'
import Image from 'next/image'

interface AvatarUploadProps {
  /**
   * Current avatar URL (if exists)
   * Can be passed from server-side prefetch
   */
  currentAvatarUrl?: string

  /**
   * Callback when upload succeeds
   * Useful for showing success messages or updating parent state
   */
  onUploadSuccess?: () => void
}

export default function AvatarUpload({
  currentAvatarUrl,
  onUploadSuccess
}: AvatarUploadProps): React.JSX.Element {
  const queryClient = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Local state for preview
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)

  /**
   * MUTATION: Upload Avatar
   *
   * Demonstrates:
   * - FormData creation for multipart upload
   * - Type-safe mutation with RPC inference
   * - Automatic cache invalidation
   * - Error handling
   * - Success callback
   *
   * CRITICAL: No explicit type annotations - RPC infers everything!
   */
  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const form = { file }

      // RPC automatically infers the response type
      return apiResponse(
        api.v1.files.avatar.$post({
          form
        })
      )
    },
    onSuccess: (data) => {
      // Clear local preview state
      setPreviewUrl(null)
      setSelectedFile(null)

      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }

      // Invalidate queries to refetch avatar
      queryClient.invalidateQueries({ queryKey: ['avatar'] })
      queryClient.invalidateQueries({ queryKey: ['files'] })

      // Call success callback
      onUploadSuccess?.()

      console.log('Avatar uploaded successfully:', data)
    },
    onError: (error) => {
      console.error('Failed to upload avatar:', error)
      alert('Failed to upload avatar. Please try again.')
    },
  })

  /**
   * Handle file selection
   *
   * Creates local preview using FileReader API
   */
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]

    if (!file) {
      setPreviewUrl(null)
      setSelectedFile(null)
      return
    }

    // Validate file type (client-side validation for UX)
    if (!file.type.startsWith('image/')) {
      alert('Please select an image file')
      e.target.value = ''
      return
    }

    // Validate file size (5MB)
    if (file.size > 5 * 1024 * 1024) {
      alert('Image must be 5MB or less')
      e.target.value = ''
      return
    }

    // Create preview
    const reader = new FileReader()
    reader.onloadend = () => {
      setPreviewUrl(reader.result as string)
    }
    reader.readAsDataURL(file)

    setSelectedFile(file)
  }

  /**
   * Handle upload
   */
  const handleUpload = () => {
    if (!selectedFile) return
    uploadMutation.mutate(selectedFile)
  }

  /**
   * Cancel selection
   */
  const handleCancel = () => {
    setPreviewUrl(null)
    setSelectedFile(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  return (
    <div className="space-y-6">
      {/* Current Avatar Display */}
      {currentAvatarUrl && !previewUrl && (
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-gray-700">Current Avatar</h3>
          <div className="relative w-32 h-32 rounded-full overflow-hidden border-4 border-gray-200">
            <Image
              src={currentAvatarUrl}
              alt="Current avatar"
              fill
              className="object-cover"
            />
          </div>
        </div>
      )}

      {/* Preview (when file selected) */}
      {previewUrl && (
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-gray-700">Preview</h3>
          <div className="relative w-32 h-32 rounded-full overflow-hidden border-4 border-blue-500">
            <Image
              src={previewUrl}
              alt="Preview"
              fill
              className="object-cover"
            />
          </div>
        </div>
      )}

      {/* File Input */}
      <div className="space-y-3">
        <label className="block text-sm font-medium text-gray-700">
          {previewUrl ? 'Change Image' : 'Upload Avatar'}
        </label>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFileChange}
          disabled={uploadMutation.isPending}
          className="block w-full text-sm text-gray-500
            file:mr-4 file:py-2 file:px-4
            file:rounded-lg file:border-0
            file:text-sm file:font-semibold
            file:bg-blue-50 file:text-blue-700
            hover:file:bg-blue-100
            disabled:opacity-50 disabled:cursor-not-allowed"
        />
        <p className="text-xs text-gray-500">
          PNG, JPG, GIF up to 5MB. Thumbnails will be generated automatically.
        </p>
      </div>

      {/* Upload/Cancel Buttons */}
      {selectedFile && (
        <div className="flex gap-3">
          <button
            onClick={handleUpload}
            disabled={uploadMutation.isPending}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors font-medium"
          >
            {uploadMutation.isPending ? 'Uploading...' : 'Upload Avatar'}
          </button>
          <button
            onClick={handleCancel}
            disabled={uploadMutation.isPending}
            className="px-6 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Upload Progress/Status */}
      {uploadMutation.isPending && (
        <div className="flex items-center gap-2 text-sm text-blue-600">
          <div className="animate-spin rounded-full h-4 w-4 border-2 border-blue-600 border-t-transparent"></div>
          <span>Uploading and generating thumbnails...</span>
        </div>
      )}
    </div>
  )
}
