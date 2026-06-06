import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Track Your Order — Pahadi Roots',
  description: 'Track the status and delivery progress of your Pahadi Roots order in real time.',
  openGraph: {
    title: 'Track Your Order — Pahadi Roots',
    description: 'Check your Pahadi Roots order status and delivery updates.',
    url: 'https://pahadiroots.com/track',
    siteName: 'Pahadi Roots',
    type: 'website',
  },
  twitter: {
    card: 'summary',
    title: 'Track Your Order — Pahadi Roots',
    description: 'Check your Pahadi Roots order status and delivery updates.',
  },
}

export default function TrackLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
