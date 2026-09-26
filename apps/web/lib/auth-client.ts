import { createAuthClient } from "better-auth/react"
import { env } from "../env"

// No nextCookies() here: that is a server-side plugin for better-auth running
// inside a Next.js server. This is the browser client talking to the Hono API
// over CORS; the session cookie is set by the API's Set-Cookie header. The same
// misuse was removed from the API itself (RH-01).
export const authClient = createAuthClient({
    baseURL: env.apiUrl,
    fetchOptions: {
        credentials: "include",
        mode: 'cors'
    },
})