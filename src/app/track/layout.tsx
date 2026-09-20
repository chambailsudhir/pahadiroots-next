import type { Metadata } from 'next'

// SEO FIX: consistency with /cart, /wishlist, /account, /search — order
// tracking has no search intent and shouldn't compete for rankings, even
// though (unlike /search) it doesn't read a query param directly today.
export const metadata: Metadata = {
  title: 'Track Your Order — HimVeda by Pahadi Roots',
  description: 'Track the status and delivery progress of your HimVeda by Pahadi Roots order in real time.',
  robots: { index: false, follow: true },
  openGraph: {
    title: 'Track Your Order — HimVeda by Pahadi Roots',
    description: 'Check your HimVeda by Pahadi Roots order status and delivery updates.',
    url: 'https://pahadiroots.com/track',
    siteName: 'HimVeda by Pahadi Roots',
    type: 'website',
    // BUG FIX: no `images` here — this page's own openGraph object
    // replaces the layout's entirely, so this route had no og:image.
    images: [{ url: '/logo.png', width: 1200, height: 630, alt: 'Track Your Order — HimVeda by Pahadi Roots' }],
  },
  twitter: {
    card: 'summary',
    title: 'Track Your Order — HimVeda by Pahadi Roots',
    description: 'Check your HimVeda by Pahadi Roots order status and delivery updates.',
  },
}

export default function TrackLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
