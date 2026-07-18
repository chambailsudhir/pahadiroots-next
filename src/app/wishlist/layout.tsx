import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Your Wishlist — HimVeda by Pahadi Roots',
  description: 'View and manage your saved HimVeda by Pahadi Roots products. Add items to cart whenever you\'re ready.',
  robots: { index: false, follow: false }, // personal page — no indexing
  openGraph: {
    title: 'Your Wishlist — HimVeda by Pahadi Roots',
    description: 'Your saved Himalayan natural products from HimVeda by Pahadi Roots.',
    url: 'https://pahadiroots.com/wishlist',
    siteName: 'HimVeda by Pahadi Roots',
    type: 'website',
  },
}

export default function WishlistLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
