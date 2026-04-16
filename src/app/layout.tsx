import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import './globals.css'
import { getSiteSettings } from '@/lib/getSiteSettings'
import Header from '@/components/layout/Header'
import Footer from '@/components/layout/Footer'
import { Providers } from './providers'
import CartDrawer from '@/components/cart/CartDrawer'
import SearchOverlay from '@/components/search/SearchOverlay'

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] })
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] })

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || 'https://pahadiroots.com'),
  title: {
    default: 'Pahadi Roots — Natural Himalayan Products',
    template: '%s | Pahadi Roots',
  },
  description:
    'Pure, natural products sourced directly from Himalayan mountain farming communities. Honey, spices, grains, and more — delivered across India.',
  keywords: ['himalayan products', 'natural honey', 'pahadi', 'mountain foods', 'organic', 'India'],
  openGraph: {
    type:        'website',
    locale:      'en_IN',
    url:         'https://pahadiroots.com',
    siteName:    'Pahadi Roots',
    images: [{
      url:    '/og-default.jpg',
      width:  1200,
      height: 630,
      alt:    'Pahadi Roots — Natural Himalayan Products',
    }],
  },
  twitter: {
    card:        'summary_large_image',
    title:       'Pahadi Roots — Natural Himalayan Products',
    description: 'Pure products from mountain farming communities.',
  },
  robots: {
    index:             true,
    follow:            true,
    googleBot: { index: true, follow: true },
  },
}

// Revalidate layout data every 5 minutes (picks up setting changes)
export const revalidate = 300

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const settings = await getSiteSettings()

  return (
    <html lang="en-IN" suppressHydrationWarning>
      <head>
        {/* Preconnect to Supabase Storage for faster image loads */}
        <link
          rel="preconnect"
          href="https://ulyrhnpoiypuvaurlqqi.supabase.co"
          crossOrigin="anonymous"
        />
        {/* Organization JSON-LD */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@type':    'Organization',
              name:       'Pahadi Roots',
              url:        'https://pahadiroots.com',
              logo:       'https://pahadiroots.com/logo.png',
              contactPoint: {
                '@type':             'ContactPoint',
                telephone:           settings.contact_phone || '',
                contactType:         'customer service',
                availableLanguage:   ['English', 'Hindi'],
              },
              sameAs: [
                settings.instagram_url,
                settings.facebook_url,
                settings.youtube_url,
              ].filter(Boolean),
            }),
          }}
        />
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased bg-white`}>
        <Providers>
          <Header settings={settings} />
          <main className="min-h-screen">
            {children}
          </main>
          <Footer settings={settings} />
          {/* Global overlays — rendered once at root */}
          <CartDrawer settings={settings} />
          <SearchOverlay />
        </Providers>
      </body>
    </html>
  )
}
