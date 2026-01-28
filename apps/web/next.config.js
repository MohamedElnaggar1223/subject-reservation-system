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
    }
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
