// Content-Security-Policy builder — shared by next.config.js (static header) and src/proxy.ts (per-request nonce policy).
// CommonJS on purpose: next.config.js cannot import TypeScript.
// BUG FIX (audit C-12): 'unsafe-eval' used to be sent on EVERY route, but it is only needed by Razorpay's checkout.js
// (it uses Function/eval internally), which is loaded on /checkout only (src/app/checkout/CheckoutClient.tsx). The
// homepage and every other page are now served without it; /checkout keeps it so payments cannot break.
// 'unsafe-inline' is unchanged on purpose (see the note near the end of the list).
// Routes served with the per-request nonce policy by src/proxy.ts. A nonce policy is ONLY safe on a route that is rendered
// per request (force-dynamic, or it awaits searchParams): a prerendered / ISR page carries no nonce on Next's inline
// bootstrap scripts, so the browser blocks them and the page never hydrates (no filters, no Add to Cart).
// BUG FIX (Nov 2026 verification): #146 made /products, /collections/<slug>, /new-arrivals, /blog and /lab-reports ISR
// while they were still listed here — on production every one of them logged 4–12 blocked inline scripts and did not
// hydrate. They are back on the static policy; only /checkout, /account and the region pages (which still await
// searchParams) keep the nonce policy. strictCsp.test.ts pins this list against the routes' `revalidate` exports.
const STRICT_CSP_PATH_SOURCE = '^/(?:(?:checkout|account)(?:/|$)|regions/[^/]+/?$)'
const STRICT_CSP_PATH = new RegExp(STRICT_CSP_PATH_SOURCE)
// next.config.js `source` for the static header: everything the proxy does NOT cover, so exactly one CSP header is sent.
const STATIC_CSP_HEADER_SOURCE = '/((?!(?:checkout|account)(?:/|$)|regions/[^/]+/?$).*)'

// Cloudflare Turnstile (chat CAPTCHA) is optional: hosts are added only when a site key is configured.
const TURNSTILE_HOST = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ? ' https://challenges.cloudflare.com' : ''

function buildCsp(opts) {
  const { allowEval = false, nonce = null, scriptHashes = [] } = opts || {}
  // Strict mode (checkout / account): inline scripts must carry the per-request nonce or match a known hash — 'unsafe-inline'
  // is dropped. Same-origin script FILES stay allowed via 'self' and the payment/analytics hosts via the allow-list below.
  const strict = !!nonce
  const scriptSrc = `script-src 'self' ${strict ? `'nonce-${nonce}' ${scriptHashes.map(h => `'sha256-${h}'`).join(' ')} ` : "'unsafe-inline' "}${allowEval ? "'unsafe-eval' " : ''}https://checkout.razorpay.com https://cdn.razorpay.com https://www.googletagmanager.com${TURNSTILE_HOST}`.replace(/\s+/g, ' ')
  return [
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
                scriptSrc,
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
                "connect-src 'self' https://ulyrhnpoiypuvaurlqqi.supabase.co wss://ulyrhnpoiypuvaurlqqi.supabase.co https://api.razorpay.com https://lumberjack.razorpay.com https://www.googletagmanager.com https://www.google-analytics.com https://*.google-analytics.com https://*.analytics.google.com",
                // SEO/ANALYTICS FIX: GTM's <noscript> fallback (rendered in layout.tsx
                // immediately inside <body> for users with JS disabled or blocked) is an
                // <iframe src="https://www.googletagmanager.com/ns.html?...">, which needs
                // its own frame-src allowance — this was blocked too, silently.
                `frame-src https://api.razorpay.com https://www.googletagmanager.com${TURNSTILE_HOST}`,
                "object-src 'none'",
                "base-uri 'self'",
                "form-action 'self'",
                // F-12 (Oct 2026 audit): modern equivalents of X-Frame-Options and HSTS, so the policy
                // itself forbids framing and mixed content.
                //
                // NOT changed, deliberately: 'unsafe-inline' / 'unsafe-eval' in script-src.
                //  • 'unsafe-eval' is required by Razorpay checkout.js.
                //  • Replacing 'unsafe-inline' needs per-request nonces; Next then renders EVERY page
                //    dynamically (no static/ISR caching), a large performance and cost regression for a
                //    catalogue site. Revisit if the payment page ever moves to Razorpay's hosted flow.
                "frame-ancestors 'none'",
                "upgrade-insecure-requests",
  ].join('; ')
}


module.exports = { buildCsp, STRICT_CSP_PATH, STRICT_CSP_PATH_SOURCE, STATIC_CSP_HEADER_SOURCE }
