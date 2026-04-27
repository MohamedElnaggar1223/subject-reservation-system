/**
 * Documents Page - Server Component
 *
 * EXAMPLE: Demonstrates the complete SSR + CSR pattern for file management:
 * 1. Server-side authentication check
 * 2. Server-side data pre-fetching (files list)
 * 3. TanStack Query dehydration for instant page loads
 * 4. Hydration boundary for client components
 *
 * Flow:
 * 1. Server checks authentication (redirect if needed)
 * 2. Server pre-fetches files from API
 * 3. Data is dehydrated into HTML
 * 4. Client component hydrates with pre-loaded data
 * 5. Client can upload/delete files without page reload
 *
 * This pattern provides:
 * - Fast initial page load (SSR)
 * - SEO-friendly content
 * - Smooth client-side interactions
 * - Automatic loading states
 */

import { dehydrate, HydrationBoundary } from "@tanstack/react-query"
import { getQueryClient } from "~/lib/query-client"
import { getServerApi } from "~/lib/hono-server"
import { requireAuth } from "~/lib/auth/session"
import { apiResponse } from "@repo/validations"
import DocumentsClient from "./documents.client"

export default async function DocumentsPage(): Promise<React.JSX.Element> {
  /**
   * Step 1: Require Authentication
   *
   * Redirects to /sign-in if not authenticated.
   * This runs on the server before rendering.
   */
  await requireAuth()

  /**
   * Step 2: Initialize Query Client
   *
   * Creates a new query client for this request.
   * Each server request gets its own client (no shared state).
   */
  const queryClient = getQueryClient()

  /**
   * Step 3: Get Server API Client
   *
   * Creates an API client with server-side cookies.
   * This allows the server to make authenticated API calls.
   */
  const api = await getServerApi()

  /**
   * Step 4: Pre-fetch Data
   *
   * Fetches files on the server before rendering.
   * - Uses same query key as client component
   * - Data is cached in query client
   * - Client component will use this cached data instantly
   *
   * Query params:
   * - page: 1 (first page)
   * - pageSize: 20 (20 items per page)
   * - fileType: optional filter (not set initially)
   */
  await queryClient.prefetchQuery({
    queryKey: ['files', { page: 1, pageSize: 20 }],
    queryFn: async () =>
      apiResponse(
        api.v1.files.$get({
          query: {
            page: '1',
            pageSize: '20',
          }
        })
      ),
  })

  /**
   * Step 5: Dehydrate and Render
   *
   * - dehydrate() extracts cached data from query client
   * - HydrationBoundary passes data to client components
   * - Client component hydrates instantly with server data
   */
  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <DocumentsClient />
    </HydrationBoundary>
  )
}
