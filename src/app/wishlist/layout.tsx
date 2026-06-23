import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Your Wishlist — Pahadi Roots',
  description: 'View and manage your saved Pahadi Roots products. Add items to cart whenever you\'re ready.',
  robots: { index: false, follow: false }, // personal page — no indexing
  openGraph: {
    title: 'Your Wishlist — Pahadi Roots',
    description: 'Your saved Himalayan natural products from Pahadi Roots.',
    url: 'https://pahadiroots.com/wishlist',
    siteName: 'Pahadi Roots',
    type: 'website',
  },
}

export default function WishlistLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
