import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Search Products — HimVeda by Pahadi Roots',
  description: 'Search our full range of Himalayan natural products — spices, herbs, honey, teas, and more from the mountains of India.',
  openGraph: {
    title: 'Search Products — HimVeda by Pahadi Roots',
    description: 'Find authentic Himalayan natural products from HimVeda by Pahadi Roots.',
    url: 'https://pahadiroots.com/search',
    siteName: 'HimVeda by Pahadi Roots',
    type: 'website',
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
