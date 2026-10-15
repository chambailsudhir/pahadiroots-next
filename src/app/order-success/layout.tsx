import type { Metadata } from 'next'
import type { ReactNode } from 'react'

// F-14 (Oct 2026 audit): robots.txt only DISALLOWS this route, and a disallowed URL can still be
// indexed from external links (with no snippet). An explicit noindex meta is the actual instruction.
// The page is per-customer and private; it must never appear in search results.
export const metadata: Metadata = {
  title:  'Order status',
  robots: { index: false, follow: false, nocache: true },
}

export default function OrderSuccessLayout({ children }: { children: ReactNode }) {
  return children
}
