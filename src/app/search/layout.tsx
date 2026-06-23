import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Search Products — Pahadi Roots',
  description: 'Search our full range of Himalayan natural products — spices, herbs, honey, teas, and more from the mountains of India.',
  openGraph: {
    title: 'Search Products — Pahadi Roots',
    description: 'Find authentic Himalayan natural products from Pahadi Roots.',
    url: 'https://pahadiroots.com/search',
    siteName: 'Pahadi Roots',
    type: 'website',
  },
  twitter: {
    card: 'summary',
    title: 'Search Products — Pahadi Roots',
    description: 'Find authentic Himalayan natural products from Pahadi Roots.',
  },
}

export default function SearchLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
