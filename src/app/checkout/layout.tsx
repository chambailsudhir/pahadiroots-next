import type { Metadata } from 'next'
import type { ReactNode } from 'react'

// F-14 (Oct 2026 audit): same as /order-success — robots.txt alone does not stop indexing.
export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
}

export default function CheckoutLayout({ children }: { children: ReactNode }) {
  return children
}
