/** @type {import('next').NextConfig} */
// Build: 2026-05-07 08:51 — cache bust
const nextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'ulyrhnpoiypuvaurlqqi.supabase.co',
        pathname: '/storage/v1/object/public/**',
      },
    ],
  },
  experimental: {
    // Enable server actions
    serverActions: {
      allowedOrigins: ['pahadiroots.com', 'localhost:3000'],
    },
  },
  // Vercel function timeout
  serverRuntimeConfig: {
    functionTimeout: 15,
  },
};

module.exports = nextConfig;
