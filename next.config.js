/** @type {import('next').NextConfig} */
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
      // Only allow our own domain + the exact Vercel preview URL injected per-deployment.
      // *.vercel.app was removed — it allowed ANY attacker-controlled Vercel project to
      // invoke server actions cross-origin (CRITICAL security issue).
      // VERCEL_URL is set automatically by Vercel (e.g. "pahadiroots-abc123.vercel.app")
      // and is available at build time. Localhost is kept for local dev only.
      allowedOrigins: [
        'pahadiroots.com',
        'www.pahadiroots.com',
        'localhost:3000',
        ...(process.env.VERCEL_URL ? [process.env.VERCEL_URL] : []),
      ],
    },
  },
  // Vercel function timeout
  serverRuntimeConfig: {
    functionTimeout: 15,
  },
  async headers() {
    return [
      {
        // Apply to every route
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options',        value: 'DENY' },
          { key: 'X-Content-Type-Options',  value: 'nosniff' },
          { key: 'Referrer-Policy',         value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy',      value: 'camera=(), microphone=(), geolocation=()' },
          {
            key:   'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
          {
            key: 'Content-Security-Policy',
            // Tightened CSP — adjust script/style sources if you load third-party bundles
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://checkout.razorpay.com",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob: https://ulyrhnpoiypuvaurlqqi.supabase.co",
              "font-src 'self'",
              "connect-src 'self' https://*.supabase.co https://api.razorpay.com",
              "frame-src https://api.razorpay.com",
              "object-src 'none'",
              "base-uri 'self'",
              "form-action 'self'",
            ].join('; '),
          },
        ],
      },
    ]
  },
};

module.exports = nextConfig;
