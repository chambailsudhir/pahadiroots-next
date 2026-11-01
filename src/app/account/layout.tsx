import type { Metadata } from 'next'

// Account pages must never be indexed — they render to a login wall
// but the URL would appear in sitemaps/crawl without this guard.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
}

// Rendered per request so the proxy's per-request CSP nonce (src/lib/strictCsp.ts) can be stamped on the page's scripts — a
// statically built page has no nonce and would have its own scripts blocked by the strict policy.
export const dynamic = 'force-dynamic'

export default function AccountLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
