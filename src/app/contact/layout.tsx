import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Contact Us — HimVeda by Pahadi Roots',
  description: 'Get in touch with the HimVeda by Pahadi Roots team. We\'re here to help with orders, product questions, and anything else.',
  openGraph: {
    title: 'Contact Us — HimVeda by Pahadi Roots',
    description: 'Reach out to the HimVeda by Pahadi Roots team — we\'d love to hear from you.',
    url: 'https://pahadiroots.com/contact',
    siteName: 'HimVeda by Pahadi Roots',
    type: 'website',
  },
  twitter: {
    card: 'summary',
    title: 'Contact Us — HimVeda by Pahadi Roots',
    description: 'Reach out to the HimVeda by Pahadi Roots team — we\'d love to hear from you.',
  },
}

export default function ContactLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
