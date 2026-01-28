import { hc } from 'hono/client'
import type { AppType } from '@repo/api'
import { env } from '../env'

// Client-side API client (for use in 'use client' components)
export const api = hc<AppType>(env.apiUrl, {
    init: {
        credentials: "include", // Required for sending cookies cross-origin
    }
})