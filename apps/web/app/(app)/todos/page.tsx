/**
 * Todos Page - Server Component
 *
 * EXAMPLE: This demonstrates the complete SSR + CSR pattern with:
 * 1. Server-side authentication check
 * 2. Server-side data pre-fetching
 * 3. TanStack Query dehydration for instant page loads
 * 4. Hydration boundary for client components
 *
 * Flow:
 * 1. Server checks authentication (redirect if needed)
 * 2. Server pre-fetches todos from API
 * 3. Data is dehydrated into HTML
 * 4. Client component hydrates with pre-loaded data
 * 5. Client can mutate data without page reload
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
import TodosClient from "./todos.client"

export default async function TodosPage(): Promise<React.JSX.Element> {
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
   * Fetches todos on the server before rendering.
   * - Uses same query key as client component
   * - Data is cached in query client
   * - Client component will use this cached data instantly
   *
   * Note: We use void to fire-and-forget (don't await)
   * This allows parallel rendering while data loads.
   */
  await queryClient.prefetchQuery({
    queryKey: ['todos'],
    queryFn: async () => apiResponse(api.v1.todos.$get()),
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
      <TodosClient />
    </HydrationBoundary>
  )
}
