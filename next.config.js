/** @type {import('next').NextConfig} */
const { buildCsp, STATIC_CSP_HEADER_SOURCE } = require('./src/lib/csp')

const nextConfig = {
  // Hardening (audit HOME-027): don't advertise the framework in an `X-Powered-By: Next.js` response header.
  poweredByHeader: false,
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
    // PERF: every <Image> prints one srcset URL per size in these lists (default 16 sizes). The homepage has ~57 images,
    // which made the HTML ~75 KB bigger than it needs to be — and the browser can't ask for the hero image until it
    // has the whole document. Fewer, well-spaced steps (still covering 1x-3x phones, laptops and 4K) keep every image
    // sharp while sending far less markup.
    deviceSizes: [640, 828, 1200, 1920],
    imageSizes: [128, 256, 384],
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
    // BUG FIX (Issue C2, Oct 2026 audit): Next 16 defaults images.qualities to
    // [75] and the image loader snaps any other `quality` prop to the nearest
    // allowed value. FeaturedBanner (70) and ExploreByRegion (90) were
    // therefore silently rendered at 75. List every quality the app actually
    // requests so those props take effect. Keep this in sync with `quality=`
    // usages under src/ — an unlisted value is snapped, not honoured.
    qualities: [60, 70, 75, 90],
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
  // /about was renamed to /our-stories. Permanent (301) redirect keeps old
  // bookmarks, Google results, and any slide CTA saved in the admin as "/about" working.
  async redirects() {
    return [
      { source: '/about', destination: '/our-stories', permanent: true },
      // Common guess for the tracking page (audit: /track-order returned a 404).
      { source: '/track-order', destination: '/track', permanent: true },
      // Old/typed spelling of the Sea Buckthorn product URL (the canonical slug is hyphenated).
      { source: '/products/seabuckthorn', destination: '/products/sea-buckthorn', permanent: true },
    ]
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
          // BUG FIX (voice input silently blocked on every device): this was
          // `microphone=()`, which disables getUserMedia() site-wide via the
          // Permissions-Policy header — before the browser even shows an
          // "Allow microphone?" prompt. That's why the Pahadi_AI widget's
          // voice button failed identically on every browser/OS with no
          // permission dialog ever appearing: it wasn't a user denial, the
          // page itself was forbidden from asking. `microphone=(self)` scopes
          // access to this origin only (still blocked for any iframed
          // third-party content) — just enough for the widget's own
          // MediaRecorder-based voice input (see public/js/ai-assistant.js
          // and src/app/api/transcribe/route.ts) to work at all.
          // Isolates our windows from pages that open us, while still allowing the payment and sign-in popups
          // (Razorpay, Google) that checkout needs — same-origin-allow-popups, not the stricter same-origin.
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin-allow-popups' },
          { key: 'Permissions-Policy',      value: 'camera=(), microphone=(self), geolocation=()' },
          {
            key:   'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
        ],
      },
      // /checkout and /account get their Content-Security-Policy from src/proxy.ts instead: a strict, nonce-based policy (no
      // 'unsafe-inline' scripts) built per request. /checkout keeps 'unsafe-eval' there because Razorpay's checkout.js needs it.
      {
        // Everything else — including the homepage — has no 'unsafe-eval'. (Any path that does not start with /checkout or
        // /account, which the proxy covers.) Rules never overlap, so exactly one CSP header is sent per response.
        source: STATIC_CSP_HEADER_SOURCE,
        headers: [{ key: 'Content-Security-Policy', value: buildCsp({ allowEval: false }) }],
      },
    ]
  },
};

module.exports = nextConfig;
