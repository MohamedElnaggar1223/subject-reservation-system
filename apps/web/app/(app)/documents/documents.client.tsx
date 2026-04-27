/**
 * Documents Client Component
 *
 * EXAMPLE: This demonstrates complete file management with:
 * 1. File upload (avatar, document, general)
 * 2. File listing with pagination
 * 3. File filtering by type
 * 4. Image variant display (thumbnails for avatars)
 * 5. File deletion with confirmation
 * 6. Optimistic UI updates
 * 7. Error handling
 *
 * Patterns Demonstrated:
 * - Type-safe API calls with Hono RPC (NO manual types!)
 * - FormData handling for multipart uploads
 * - Pagination with page state
 * - Filtering with query params
 * - Optimistic updates for instant feedback
 * - Automatic refetching after mutations
 */

'use client'

/**
 * IMPORTANT: RPC Type Inference
 *
 * Notice we DON'T import file response types - Hono RPC infers automatically!
 * The response types from all API endpoints are automatically inferred.
 *
 * This is the correct pattern for Hono RPC:
 * - Import INPUT types only (none needed here - using FormData)
 * - Let RPC infer OUTPUT types automatically
 * - Never manually type API responses
 */
import { useState, useRef } from 'react'
import { useSuspenseQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '~/lib/hono'
import { apiResponse } from '@repo/validations'
import Image from 'next/image'

export default function DocumentsClient(): React.JSX.Element {
  const queryClient = useQueryClient()

  // Pagination & filtering state
  const [page, setPage] = useState(1)
  const [pageSize] = useState(20)
  const [fileTypeFilter, setFileTypeFilter] = useState<'avatar' | 'document' | 'general' | 'all'>('all')

  // Upload state
  const [uploadType, setUploadType] = useState<'avatar' | 'document' | 'general'>('document')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  /**
   * QUERY: Fetch Files
   *
   * useSuspenseQuery automatically:
   * - Uses server-prefetched data (instant load on first render)
   * - Refetches when page or filter changes
   * - Type-safe with inferred return type
   *
   * Note: Query key includes pagination/filter params for proper caching
   */
  const { data: filesResponse } = useSuspenseQuery({
    queryKey: ['files', { page, pageSize, fileType: fileTypeFilter === 'all' ? undefined : fileTypeFilter }],
    queryFn: async () => {
      const query: Record<string, string> = {
        page: page.toString(),
        pageSize: pageSize.toString(),
      }

      if (fileTypeFilter !== 'all') {
        query.fileType = fileTypeFilter
      }

      return apiResponse(api.v1.files.$get({ query }))
    },
  })

  /**
   * MUTATION: Upload File
   *
   * Demonstrates:
   * - Different endpoints for different file types
   * - FormData creation for multipart upload
   * - Type-safe mutation with RPC inference
   * - Automatic cache invalidation
   * - NO explicit type annotations - RPC infers everything!
   */
  const uploadMutation = useMutation({
    mutationFn: async ({ file, type }: { file: File; type: 'avatar' | 'document' | 'general' }) => {
      const formData = { file }

      // Use different endpoint based on type
      if (type === 'avatar') {
        return apiResponse(api.v1.files.avatar.$post({ form: formData }))
      } else if (type === 'document') {
        return apiResponse(api.v1.files.document.$post({ form: formData }))
      } else {
        return apiResponse(api.v1.files.$post({ form: formData }))
      }
    },
    onSuccess: () => {
      // Clear upload state
      setSelectedFile(null)
      setPreviewUrl(null)
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }

      // Invalidate files query to refetch
      queryClient.invalidateQueries({ queryKey: ['files'] })

      alert('File uploaded successfully!')
    },
    onError: (error) => {
      console.error('Failed to upload file:', error)
      alert('Failed to upload file. Please try again.')
    },
  })

  /**
   * MUTATION: Delete File
   *
   * Demonstrates:
   * - Optimistic deletion (instant UI feedback)
   * - Rollback on error
   * - Confirmation dialog
   * - NO explicit typing - RPC inference works perfectly
   */
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiResponse(api.v1.files[':id'].$delete({ param: { id } }))
    },
    // Optimistic update
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: ['files'] })

      // ✅ No explicit type - inferred from query
      const previousFiles = queryClient.getQueryData(['files', { page, pageSize, fileType: fileTypeFilter === 'all' ? undefined : fileTypeFilter }])

      // Optimistically remove from UI
      // ✅ No explicit type - inferred from query
      queryClient.setQueryData(
        ['files', { page, pageSize, fileType: fileTypeFilter === 'all' ? undefined : fileTypeFilter }],
        (old: typeof filesResponse) => {
          if (!old) return old
          return {
            ...old,
            data: old.data.filter((file) => file.id !== id),
            pagination: {
              ...old.pagination,
              total: old.pagination.total - 1,
            },
          }
        }
      )

      return { previousFiles }
    },
    onError: (error, variables, context) => {
      // Rollback on error
      if (context?.previousFiles) {
        queryClient.setQueryData(
          ['files', { page, pageSize, fileType: fileTypeFilter === 'all' ? undefined : fileTypeFilter }],
          context.previousFiles
        )
      }
      console.error('Failed to delete file:', error)
      alert('Failed to delete file. Please try again.')
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['files'] })
    },
  })

  /**
   * Handle file selection
   */
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]

    if (!file) {
      setSelectedFile(null)
      setPreviewUrl(null)
      return
    }

    // Client-side validation
    if (uploadType === 'avatar' && !file.type.startsWith('image/')) {
      alert('Avatar must be an image')
      e.target.value = ''
      return
    }

    if (uploadType === 'avatar' && file.size > 5 * 1024 * 1024) {
      alert('Avatar must be 5MB or less')
      e.target.value = ''
      return
    }

    if (uploadType === 'document' && file.size > 10 * 1024 * 1024) {
      alert('Document must be 10MB or less')
      e.target.value = ''
      return
    }

    if (uploadType === 'general' && file.size > 50 * 1024 * 1024) {
      alert('File must be 50MB or less')
      e.target.value = ''
      return
    }

    // Create preview for images
    if (file.type.startsWith('image/')) {
      const reader = new FileReader()
      reader.onloadend = () => {
        setPreviewUrl(reader.result as string)
      }
      reader.readAsDataURL(file)
    } else {
      setPreviewUrl(null)
    }

    setSelectedFile(file)
  }

  /**
   * Handle upload
   */
  const handleUpload = () => {
    if (!selectedFile) return
    uploadMutation.mutate({ file: selectedFile, type: uploadType })
  }

  /**
   * Handle delete
   */
  const handleDelete = (id: string, fileName: string) => {
    if (confirm(`Are you sure you want to delete "${fileName}"?`)) {
      deleteMutation.mutate(id)
    }
  }

  /**
   * Format file size
   */
  const formatFileSize = (bytes: string): string => {
    const size = parseInt(bytes)
    if (size < 1024) return `${size} B`
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
    return `${(size / (1024 * 1024)).toFixed(1)} MB`
  }

  /**
   * Get file type badge color
   */
  const getFileTypeBadgeColor = (type: string): string => {
    switch (type) {
      case 'avatar':
        return 'bg-purple-100 text-purple-800'
      case 'document':
        return 'bg-blue-100 text-blue-800'
      case 'general':
        return 'bg-gray-100 text-gray-800'
      default:
        return 'bg-gray-100 text-gray-800'
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 to-pink-100 p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <header className="mb-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-2">File Management</h1>
          <p className="text-gray-600">Upload and manage your files</p>
        </header>

        {/* Upload Section */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4">Upload File</h2>

          {/* Upload Type Selector */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              File Type
            </label>
            <select
              value={uploadType}
              onChange={(e) => setUploadType(e.target.value as 'avatar' | 'document' | 'general')}
              disabled={uploadMutation.isPending}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="avatar">Avatar (Images, max 5MB)</option>
              <option value="document">Document (PDF, DOCX, XLSX, max 10MB)</option>
              <option value="general">General File (max 50MB)</option>
            </select>
          </div>

          {/* Preview */}
          {previewUrl && (
            <div className="mb-4">
              <p className="text-sm font-medium text-gray-700 mb-2">Preview</p>
              <div className="relative w-32 h-32 border-2 border-gray-300 rounded-lg overflow-hidden">
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
          <div className="mb-4">
            <input
              ref={fileInputRef}
              type="file"
              accept={uploadType === 'avatar' ? 'image/*' : uploadType === 'document' ? '.pdf,.docx,.xlsx,.txt,.csv' : '*'}
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
          </div>

          {/* Upload Button */}
          {selectedFile && (
            <button
              onClick={handleUpload}
              disabled={uploadMutation.isPending}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors font-medium"
            >
              {uploadMutation.isPending ? 'Uploading...' : `Upload ${selectedFile.name}`}
            </button>
          )}

          {uploadMutation.isPending && (
            <div className="mt-3 flex items-center gap-2 text-sm text-blue-600">
              <div className="animate-spin rounded-full h-4 w-4 border-2 border-blue-600 border-t-transparent"></div>
              <span>Uploading...</span>
            </div>
          )}
        </div>

        {/* Filter & Files List */}
        <div className="bg-white rounded-lg shadow-md p-6">
          {/* Filter */}
          <div className="mb-6 flex items-center gap-4">
            <label className="text-sm font-medium text-gray-700">
              Filter by type:
            </label>
            <select
              value={fileTypeFilter}
              onChange={(e) => {
                setFileTypeFilter(e.target.value as "all" | "avatar" | "document" | "general")
                setPage(1) // Reset to first page when filtering
              }}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">All Files</option>
              <option value="avatar">Avatars</option>
              <option value="document">Documents</option>
              <option value="general">General</option>
            </select>

            <div className="ml-auto text-sm text-gray-600">
              Total: {filesResponse.pagination.total} files
            </div>
          </div>

          {/* Files Grid */}
          {filesResponse.data.length === 0 ? (
            <p className="text-gray-500 text-center py-8">
              No files yet. Upload one above!
            </p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filesResponse.data.map((file) => (
                <div
                  key={file.id}
                  className="border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow"
                >
                  {/* Image Preview (if avatar with variants) */}
                  {file.fileType === 'avatar' && file.variants && file.variants.length > 0 && (
                    <div className="mb-3">
                      <div className="relative w-full h-48 bg-gray-100 rounded-lg overflow-hidden">
                        <Image
                          src={file.variants.find(v => v.variant === 'thumbnail')?.url || file.url}
                          alt={file.name}
                          fill
                          className="object-cover"
                        />
                      </div>
                      {/* Variant Links */}
                      <div className="mt-2 flex gap-2 text-xs">
                        {file.variants.map((variant) => (
                          <a
                            key={variant.id}
                            href={variant.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 hover:text-blue-800 underline"
                          >
                            {variant.variant} ({variant.width}x{variant.height})
                          </a>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* File Info */}
                  <div className="space-y-2">
                    <div className="flex items-start justify-between">
                      <h3 className="font-medium text-gray-900 break-all">
                        {file.name}
                      </h3>
                      <span className={`px-2 py-1 rounded text-xs font-medium ${getFileTypeBadgeColor(file.fileType)}`}>
                        {file.fileType}
                      </span>
                    </div>

                    <div className="text-sm text-gray-600 space-y-1">
                      <p>Type: {file.mimeType}</p>
                      <p>Size: {formatFileSize(file.size)}</p>
                      <p>Uploaded: {new Date(file.createdAt).toLocaleDateString()}</p>
                    </div>

                    {/* Actions */}
                    <div className="flex gap-2 pt-2">
                      <a
                        href={file.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:text-blue-800 text-sm font-medium"
                      >
                        View
                      </a>
                      <button
                        onClick={() => handleDelete(file.id, file.name)}
                        className="text-red-600 hover:text-red-800 text-sm font-medium"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Pagination */}
          {filesResponse.pagination.totalPages > 1 && (
            <div className="mt-6 flex items-center justify-center gap-2">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Previous
              </button>

              <span className="text-sm text-gray-600">
                Page {page} of {filesResponse.pagination.totalPages}
              </span>

              <button
                onClick={() => setPage(p => Math.min(filesResponse.pagination.totalPages, p + 1))}
                disabled={page === filesResponse.pagination.totalPages}
                className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Next
              </button>
            </div>
          )}
        </div>

        {/* Pattern Reference */}
        <div className="mt-8 bg-purple-50 rounded-lg p-6 border border-purple-200">
          <h3 className="text-lg font-semibold text-purple-900 mb-2">
            ✨ Patterns Demonstrated
          </h3>
          <ul className="space-y-1 text-sm text-purple-800">
            <li>✓ Server-side rendering with data pre-fetching</li>
            <li>✓ Type-safe file uploads with Hono RPC (no manual types!)</li>
            <li>✓ FormData handling for multipart uploads</li>
            <li>✓ Image variant display (thumbnail, medium, large)</li>
            <li>✓ Pagination with query params</li>
            <li>✓ Filtering by file type</li>
            <li>✓ Optimistic UI updates with automatic rollback</li>
            <li>✓ File deletion with confirmation</li>
          </ul>
        </div>
      </div>
    </div>
  )
}
