/** @type {import('next').NextConfig} */
const nextConfig = {
    typedRoutes: true,
    images: {
        remotePatterns: [
            {
                protocol: 'https',
                hostname: 'turborepo-hono-nextjs-expo.337f1d741ad301928e112ddcb2f3c5f6.r2.cloudflarestorage.com'
            }
        ]
    },
    // Security audit RF-21: no page may be framed by another site (the desk
    // takes money with one click, which a framing page could trick an officer
    // into), browsers must not sniff content types, and other origins get only
    // the origin in the referrer. Nothing in the app frames its own pages.
    async headers() {
        return [
            {
                source: '/:path*',
                headers: [
                    { key: 'X-Frame-Options', value: 'DENY' },
                    { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
                    { key: 'X-Content-Type-Options', value: 'nosniff' },
                    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
                    { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
                ],
            },
        ];
    },
    // async rewrites() {
    //     return {
    //         beforeFiles: [
    //             {
    //                 source: '/api/:path*',
    //                 destination: 'https://turborepo-hono-nextjs-expo.onrender.com/api/:path*',
    //             },
    //             {
    //                 source: '/v1/:path*',
    //                 destination: 'https://turborepo-hono-nextjs-expo.onrender.com/v1/:path*',
    //             },
    //         ]
    //     }
    // },
};

export default nextConfig;
