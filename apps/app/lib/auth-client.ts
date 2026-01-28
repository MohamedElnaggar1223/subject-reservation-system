import { createAuthClient } from "better-auth/react";
import { expoClient } from "@better-auth/expo/client";
import * as SecureStore from "expo-secure-store";
import { env } from "../env";

export const authClient = createAuthClient({
    baseURL: env.apiUrl, // Base URL of your Better Auth backend.
    plugins: [
        expoClient({
            scheme: "myapp",
            storagePrefix: "myapp",
            storage: SecureStore,
            disableCache: true,
        })
    ]
});