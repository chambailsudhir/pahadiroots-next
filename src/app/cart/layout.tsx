import type { Metadata } from 'next'

/**
 * Cart route metadata — explicitly noindex (cart is not a public landing page)
 * and sets a canonical tag so crawlers have an authoritative URL if they do land here.
 */
export const metadata: Metadata = {
  // layout.tsx appends ` | ${siteName}` via title.template, so page titles must NOT repeat the brand
  // (it rendered "… | HimVeda by Pahadi Roots | HimVeda by Pahadi Roots"). openGraph/twitter titles are not templated and keep it.
  title: 'Your Cart',
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
    // BUG FIX: no `images` here — this page's own openGraph object
    // replaces the layout's entirely, so this route had no og:image.
    images: [{ url: '/og-default.jpg', width: 1200, height: 630, alt: 'Your Cart | HimVeda by Pahadi Roots' }],
  },
}

export default function CartLayout({ children }: { children: React.ReactNode }) {
  return children
}
