import type { Metadata } from 'next'

/**
 * Cart route metadata — explicitly noindex (cart is not a public landing page)
 * and sets a canonical tag so crawlers have an authoritative URL if they do land here.
 */
export const metadata: Metadata = {
  title: 'Your Cart | HimVeda by Pahadi Roots',
  description: 'Review your HimVeda by Pahadi Roots order before checkout.',
  robots: {
    index: false,
    follow: false,
  },
  alternates: {
    canonical: '/cart',
  },
  openGraph: {
    title: 'Your Cart | HimVeda by Pahadi Roots',
    description: 'Review your HimVeda by Pahadi Roots order before checkout.',
  },
}

export default function CartLayout({ children }: { children: React.ReactNode }) {
  return children
}
