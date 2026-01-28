// lib/hono-server.ts
import { hc } from 'hono/client'
import type { AppType } from '@repo/api'
import { cookies } from 'next/headers'
import { cache } from 'react'
import { env } from '../env'

export const getServerApi = cache(async () => {
  const cookieStore = await cookies()

  console.log("Environment: ", env.nodeEnv)

  const cookieName = env.nodeEnv === 'production' ? '__Secure-better-auth.session_token' : 'better-auth.session_token'
  
  // Filter and get only Better Auth session cookie
  const authCookie = cookieStore.get(cookieName)
  
  const cookieHeader = authCookie 
    ? `${cookieName}=${authCookie.value}`
    : ''

  console.log('🍪 Server API - Auth cookie present:', !!authCookie)

  return hc<AppType>(env.apiUrl, {
    headers: {
      cookie: cookieHeader,
    },
  })
})