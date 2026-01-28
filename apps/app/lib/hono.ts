// apps/app/lib/hono.ts
import { hc } from 'hono/client'
import type { AppType } from '@repo/api'
import { authClient } from './auth-client'
import { env } from '../env'

// Custom fetch that adds cookies to every request
const authFetch: typeof fetch = async (input, init) => {
  const cookies = authClient.getCookie() // Fresh cookies every time
  
  const headers = new Headers(init?.headers)
  if (cookies) {
    headers.set('Cookie', cookies)
  }
  
  return fetch(input, {
    ...init,
    headers,
    credentials: 'omit', // Don't let browser interfere with our manual cookies
  })
}

// Create Hono client with custom fetch
export const api = hc<AppType>(env.apiUrl, {
  fetch: authFetch,
})