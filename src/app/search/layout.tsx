import type { Metadata } from 'next'

// SEO FIX: this route reads real query strings directly (?q=...) with no
// noindex directive — unlike /cart and /wishlist, which correctly noindex
// their personal/transient pages. Every distinct search query a visitor
// types could otherwise get indexed as its own thin-content URL, a classic
// large-scale duplicate/thin-content problem for sites with real search
// volume. The canonical search UI itself is still useful and linkable, so
// it's follow:true — just not eligible to rank on its own.
export const metadata: Metadata = {
  title: 'Search Products — HimVeda by Pahadi Roots',
  description: 'Search our full range of Himalayan natural products — spices, herbs, honey, teas, and more from the mountains of India.',
  robots: { index: false, follow: true },
  alternates: { canonical: '/search' },
  openGraph: {
    title: 'Search Products — HimVeda by Pahadi Roots',
    description: 'Find authentic Himalayan natural products from HimVeda by Pahadi Roots.',
    url: 'https://www.pahadiroots.com/search',
    siteName: 'HimVeda by Pahadi Roots',
    type: 'website',
    // BUG FIX: no `images` here — this page's own openGraph object
    // replaces the layout's entirely, so this route had no og:image.
    images: [{ url: '/logo.png', width: 1200, height: 630, alt: 'Search Products — HimVeda by Pahadi Roots' }],
  },
  twitter: {
    card: 'summary',
    title: 'Search Products — HimVeda by Pahadi Roots',
    description: 'Find authentic Himalayan natural products from HimVeda by Pahadi Roots.',
  },
}

export default function SearchLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
