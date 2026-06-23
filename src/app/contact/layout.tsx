import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Contact Us — Pahadi Roots',
  description: 'Get in touch with the Pahadi Roots team. We\'re here to help with orders, product questions, and anything else.',
  openGraph: {
    title: 'Contact Us — Pahadi Roots',
    description: 'Reach out to the Pahadi Roots team — we\'d love to hear from you.',
    url: 'https://pahadiroots.com/contact',
    siteName: 'Pahadi Roots',
    type: 'website',
  },
  twitter: {
    card: 'summary',
    title: 'Contact Us — Pahadi Roots',
    description: 'Reach out to the Pahadi Roots team — we\'d love to hear from you.',
  },
}

export default function ContactLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
