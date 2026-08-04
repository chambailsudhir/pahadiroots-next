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
    // BUG FIX (images loading slow — audit follow-up): this key was never
    // set, so it defaulted to Next's 60s `minimumCacheTTL`. Product photos
    // in Supabase Storage are edited/replaced rarely, but every optimized
    // variant (each unique width x quality x format the app requests) was
    // being evicted from Vercel's image cache after just 60 seconds and
    // re-fetched + re-transformed from the Supabase origin on the next
    // request — full re-optimization work repeating constantly instead of
    // being served from cache. Raised to 7 days; anyone who replaces a
    // product photo via the admin panel and needs it to show immediately
    // can still force a fresh copy by uploading under a new filename (the
    // storefront already reads whatever URL is in `product_images`).
    minimumCacheTTL: 60 * 60 * 24 * 7,
    // BUG FIX (images loading slow — audit follow-up round 3): confirmed via
    // Network panel that the remaining slow request (2.84s) is a genuine
    // Vercel Image Optimization cache MISS — a first-ever request for that
    // exact url+width+format combination, which has to be fetched from
    // Supabase and transformed before it's cached. Vercel's own docs
    // (vercel.com/docs/image-optimization/managing-image-optimization-costs)
    // list configuring multiple `formats` as a direct cause of *more*
    // cold-miss transforms to reduce, since avif and webp are each their own
    // separate cache entry — every distinct format has to be cold-transformed
    // once independently. Dropping back to AVIF only (kept over WebP since
    // it compresses smaller and has ~95%+ browser support); Next.js
    // automatically falls back to serving the original format for the
    // remaining few browsers that accept neither.
    formats: ['image/avif'],
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
              // BUG FIX (found via browser console CSP errors): Razorpay's checkout SDK
              // dynamically loads a risk-detection script from cdn.razorpay.com as part of
              // its own fraud-prevention flow — a legitimate, first-party Razorpay domain,
              // distinct from checkout.razorpay.com (the main SDK). It was being silently
              // blocked, which could affect Razorpay's fraud scoring for COD/online orders.
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://checkout.razorpay.com https://cdn.razorpay.com",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob: https://ulyrhnpoiypuvaurlqqi.supabase.co",
              // BUG FIX (found via browser CSP block on the Hero Banner's
              // Background Video): media-src has no fallback of its own —
              // when unset, browsers fall back to default-src 'self', which
              // silently blocks a <video src="https://...supabase.co/...mp4">
              // from loading at all. img-src and connect-src already allow
              // the Supabase storage domain; media-src needs the same, or
              // any admin-uploaded hero video (or future audio/video content)
              // just renders its poster frame with no console error a typical
              // user would ever see — it looks identical to "no video set."
              "media-src 'self' https://ulyrhnpoiypuvaurlqqi.supabase.co",
              "font-src 'self'",
              // BUG FIX (found via browser console CSP errors): Razorpay's checkout SDK
              // also calls lumberjack.razorpay.com for its own internal analytics/fraud
              // telemetry (separate from api.razorpay.com) — was being silently blocked.
              "connect-src 'self' https://*.supabase.co https://api.razorpay.com https://lumberjack.razorpay.com https://api.postalpincode.in",
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
