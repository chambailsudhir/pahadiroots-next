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
  // BUG FIX (Next.js 16 migration): `serverRuntimeConfig` is a Pages Router-only
  // API (next.config.js + getConfig()) that was never actually read anywhere in
  // this App Router codebase (confirmed: zero usages of getConfig() in src/).
  // It was dead, non-functional config even under Next 14 — Next 16's stricter
  // config validation now rejects it outright with:
  //   "Unrecognized key(s) in object: 'serverRuntimeConfig'"
  // Function timeout for Vercel is configured per-route instead via vercel.json
  // { "functions": { "src/app/api/v1/orders/route.ts": { "maxDuration": 15 } } }
  // — already set up that way for the order/payment/webhook routes.
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
              // 'unsafe-eval' is required by Razorpay checkout.js (uses Function/eval internally).
              // Cannot be removed without breaking payments. See next.config.js comment.
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://checkout.razorpay.com",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob: https://ulyrhnpoiypuvaurlqqi.supabase.co",
              "font-src 'self'",
              "connect-src 'self' https://*.supabase.co https://api.razorpay.com https://api.postalpincode.in",
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
