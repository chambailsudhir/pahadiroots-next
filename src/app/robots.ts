import { MetadataRoute } from 'next'

// SEO FIX: /account and /cart were disallowed here AND carried their own
// noindex meta tag (see account/layout.tsx, cart/layout.tsx) — a known
// anti-pattern per Google's own robots.txt documentation. A disallowed
// page can never be crawled, so Googlebot can never read its noindex
// instruction; if the URL is ever linked externally (a shared cart link,
// a stray backlink), Google can still list the bare URL in results with
// "No information is available for this page" instead of correctly
// omitting it. noindex is the right tool here — it works whether or not
// the page is linked from elsewhere — so removed from disallow and left
// to do its job. /checkout, /order-success, /maintenance, and /api/ have
// no noindex meta of their own and no realistic path to being externally
// linked, so disallow alone remains the right (and simpler, crawl-budget-
// saving) tool for those.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow:     '/',
        // Nov 2026 verification: '/maintenance' was disallowed while the store-closed gate 307'd every page there, so
        // crawlers saw each URL redirect into a blocked one. The gate now answers 503 + Retry-After in place (proxy.ts) and
        // /maintenance carries its own noindex, so it no longer needs (and must not have) a disallow.
        disallow:  ['/api/', '/checkout', '/order-success'],
      },
    ],
    sitemap: `${process.env.NEXT_PUBLIC_SITE_URL || 'https://www.pahadiroots.com'}/sitemap.xml`,
  }
}
