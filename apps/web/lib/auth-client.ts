import { nextCookies } from 'better-auth/next-js'
import { createAuthClient } from "better-auth/react"
import { env } from "../env"

export const authClient = createAuthClient({
    baseURL: env.apiUrl,
    fetchOptions: {
        credentials: "include",
        mode: 'cors'
    },
    plugins: [nextCookies()]
})