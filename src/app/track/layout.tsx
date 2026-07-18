import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Track Your Order — HimVeda by Pahadi Roots',
  description: 'Track the status and delivery progress of your HimVeda by Pahadi Roots order in real time.',
  openGraph: {
    title: 'Track Your Order — HimVeda by Pahadi Roots',
    description: 'Check your HimVeda by Pahadi Roots order status and delivery updates.',
    url: 'https://pahadiroots.com/track',
    siteName: 'HimVeda by Pahadi Roots',
    type: 'website',
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
