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
              // SEO/ANALYTICS FIX (critical, found via cross-referencing this CSP against
              // the GA4/GTM script wiring added to layout.tsx for site_settings.google_tag_id):
              // that feature was completely dead on arrival. www.googletagmanager.com was not
              // in script-src, so the moment an admin sets google_tag_id (the #1 pre-launch
              // action item — currently empty in production), the browser would silently
              // block the gtm.js / gtag/js script tag with zero visible error to the site
              // owner. You'd set the ID, see nothing wrong in the UI, and get permanently
              // empty analytics with no way to tell why. Added here so the feature that was
              // already built actually works the moment it's turned on.
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://checkout.razorpay.com https://cdn.razorpay.com https://www.googletagmanager.com",
              "style-src 'self' 'unsafe-inline'",
              // SEO/ANALYTICS FIX: GA4's gtag.js sends hit data as tracking-pixel-style
              // GET requests in some fallback paths (e.g. when sendBeacon is unavailable),
              // and GTM can inject image-based pixels for certain tag types — both need
              // an img-src allowance, or those hits are silently dropped too.
              "img-src 'self' data: blob: https://ulyrhnpoiypuvaurlqqi.supabase.co https://www.googletagmanager.com https://www.google-analytics.com",
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
              // SEO/ANALYTICS FIX: this is the half of the GA4/GTM fix that actually matters
              // most — connect-src is what gates the real hit-sending requests (GA4's
              // /g/collect beacon, GTM's own config fetch). Without these, the script would
              // have loaded fine (once script-src above is fixed) but every single pageview/
              // event hit would still have been silently blocked, which is the failure mode
              // that's hardest to notice: no console error pattern a non-developer would
              // recognize as "analytics is broken," GA4 Realtime just stays empty forever.
              "connect-src 'self' https://*.supabase.co https://api.razorpay.com https://lumberjack.razorpay.com https://api.postalpincode.in https://www.googletagmanager.com https://www.google-analytics.com https://*.google-analytics.com https://*.analytics.google.com",
              // SEO/ANALYTICS FIX: GTM's <noscript> fallback (rendered in layout.tsx
              // immediately inside <body> for users with JS disabled or blocked) is an
              // <iframe src="https://www.googletagmanager.com/ns.html?...">, which needs
              // its own frame-src allowance — this was blocked too, silently.
              "frame-src https://api.razorpay.com https://www.googletagmanager.com",
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
