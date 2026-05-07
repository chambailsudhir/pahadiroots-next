import type { Metadata } from 'next'
import { Inter, Playfair_Display, Lato, DM_Sans } from 'next/font/google'
import './globals.css'
import { getSiteSettings } from '@/lib/getSiteSettings'
import { supabase } from '@/lib/supabase'
import Header from '@/components/layout/Header'
import Footer from '@/components/layout/Footer'
import MobileMenu from '@/components/layout/MobileMenu'
import ClientOnly from '@/components/ClientOnly'
import { Providers } from './providers'
import CartDrawer from '@/components/cart/CartDrawer'
import SearchOverlay from '@/components/search/SearchOverlay'
import AuthModal from '@/components/auth/AuthModal'
import GoogleAuthHandler from '@/components/auth/GoogleAuthHandler'

const inter = Inter({ variable: '--font-geist-sans', subsets: ['latin'] })
const playfair = Playfair_Display({
  variable: '--font-playfair',
  subsets: ['latin'],
  weight: ['400', '600', '700', '900'],
  style: ['normal', 'italic'],
})
const lato = Lato({
  variable: '--font-lato',
  subsets: ['latin'],
  weight: ['300', '400', '700', '900'],
})

const dmSans = DM_Sans({
  variable: '--font-dm-sans',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
})

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
  const [settings, catsResult, statesResult] = await Promise.all([
    getSiteSettings(),
    supabase.from('categories').select('id,name,slug,is_active,image_url,description').eq('is_active', true).order('sort_order'),
    supabase.from('states').select('id,name,is_active').eq('is_active', true).order('name'),
  ])
  const categories = (catsResult.data || []) as any[]
  const states     = (statesResult.data || []).map((s: any) => ({
    ...s,
    slug: s.id,  // In admin, the id IS the slug
  })) as any[]

  return (
    <html lang="en-IN" suppressHydrationWarning>
      <head>
        <meta name="theme-color" content="#1a3a1e" />
        <meta name="pahadiroots-fix" content="hydration-2026-05-07-v2" />
        {/* Preconnect to Supabase Storage for faster image loads */}
        <link
          rel="preconnect"
          href="https://ulyrhnpoiypuvaurlqqi.supabase.co"
          crossOrigin="anonymous"
        />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
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
      <body className={`${inter.variable} ${playfair.variable} ${lato.variable} ${dmSans.variable}`} style={{ fontFamily: 'var(--font-lato, Lato, sans-serif)', background: '#fff', color: '#1a1a1a' }}>
        <Providers>
          <ClientOnly>
            <Header settings={settings} categories={categories} states={states} />
          </ClientOnly>
          <main className="min-h-screen">
            {children}
          </main>
          <Footer settings={settings} />
          {/* Global overlays — rendered once at root */}
          <CartDrawer settings={settings} />
          <SearchOverlay />
          <MobileMenu settings={settings} categories={categories} states={states} />
          <AuthModal />
          <GoogleAuthHandler />
        </Providers>
      </body>
    </html>
  )
}
