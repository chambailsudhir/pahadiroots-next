import type { Metadata } from 'next'

// Account pages must never be indexed — they render to a login wall
// but the URL would appear in sitemaps/crawl without this guard.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
}

export default function AccountLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
