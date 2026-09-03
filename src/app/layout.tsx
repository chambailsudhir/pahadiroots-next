import type { Metadata } from 'next'
import { Playfair_Display, Lato } from 'next/font/google'
import './globals.css'
import { getSiteSettings } from '@/lib/getSiteSettings'
import { sanitizeHtml } from '@/lib/server/sanitize'
import { supabase } from '@/lib/supabase'
import Header from '@/components/layout/Header'
import Footer from '@/components/layout/Footer'
import MobileMenu from '@/components/layout/MobileMenu'
import { Providers } from './providers'
import SkipLink from '@/components/ui/SkipLink'
import ScrollRestorationFix from '@/components/ui/ScrollRestorationFix'
import CartDrawer from '@/components/cart/CartDrawer'
import SearchOverlay from '@/components/search/SearchOverlay'
import AuthModal from '@/components/auth/AuthModal'
import GoogleAuthHandler from '@/components/auth/GoogleAuthHandler'
import ProfilePrefetcher from '@/components/ProfilePrefetcher'

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

// BUG FIX (confirmed against a live admin-panel screenshot): this was a
// static `export const metadata` object — meaning the entire admin
// "SEO" tab (meta_title, meta_description, meta_keywords, og_image) had
// ZERO effect on the live site, no matter what an admin typed there.
// The admin panel's own SEO tab even displays "Google crawler: Also
// update index.html for permanent ranking ✅" as if this were already
// wired — it wasn't. Converting to generateMetadata() so these fields
// actually reach the page. Fallbacks below match the previous hardcoded
// values exactly, so nothing changes for a site with these fields left
// blank; a site that already has them configured (this one does) will
// now finally show that real, already-written SEO copy.
export async function generateMetadata(): Promise<Metadata> {
  const settings = await getSiteSettings()
  const siteName = settings.site_name || 'HimVeda by Pahadi Roots'
  const title = settings.meta_title || `${siteName} — Natural Himalayan Products`
  const description = settings.meta_description ||
    'Pure, natural products sourced directly from Himalayan mountain farming communities. Honey, spices, grains, and more — delivered across India.'
  const keywords = settings.meta_keywords
    ? settings.meta_keywords.split(',').map(k => k.trim()).filter(Boolean)
    : ['himalayan products', 'natural honey', 'pahadi', 'mountain foods', 'natural', 'India']
  // BUG FIX: fell back to '/og-default.jpg', which does not exist
  // anywhere in public/ (confirmed) — every social share preview
  // (WhatsApp, Facebook, etc.) has been showing a broken image this
  // whole time whenever og_image isn't set, which per the admin
  // screenshot, it currently isn't. logo.png is a real, existing asset
  // used as a stopgap — it's nearly square rather than the ideal
  // 1200x630 banner ratio, so a purpose-built OG image (or setting the
  // admin's OG Share Image field) would still look better.
  const ogImage = settings.og_image || '/logo.png'

  return {
    metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || 'https://pahadiroots.com'),
    title: {
      default: title,
      template: `%s | ${siteName}`,
    },
    description,
    keywords,
    openGraph: {
      type:        'website',
      locale:      'en_IN',
      url:         'https://pahadiroots.com',
      siteName,
      images: [{
        url:    ogImage,
        width:  1200,
        height: 630,
        alt:    title,
      }],
    },
    twitter: {
      card:        'summary_large_image',
      title,
      description,
    },
    robots: {
      index:             true,
      follow:            true,
      googleBot: { index: true, follow: true },
    },
    // SEO FIX: no GSC/Bing verification wired in previously — without it,
    // there's no way to submit the sitemap for priority crawling or see
    // indexing/Core Web Vitals data from day one. Renders nothing until an
    // admin sets google_site_verification in Settings > SEO.
    ...(settings.google_site_verification
      ? { verification: { google: settings.google_site_verification } }
      : {}),
  }
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
  // BUG FIX (found via manual audit): AnnouncementBar renders ann_text via
  // dangerouslySetInnerHTML with zero sanitization. ann_text is admin-only
  // editable (lower risk than customer/public-facing content) but this
  // closes the gap for defense-in-depth, matching every other DB-sourced
  // HTML render in the codebase (blog content, PDP AI fields).
  if (settings.ann_text) settings.ann_text = sanitizeHtml(settings.ann_text)
  const categories = (catsResult.data || []) as any[]
  const states     = (statesResult.data || []).map((s: any) => ({
    ...s,
    slug: s.id,  // In admin, the id IS the slug
  })) as any[]

  return (
    <html lang="en-IN" suppressHydrationWarning>
      <head>
        <meta name="theme-color" content="#1a3a1e" />
        <meta name="pahadiroots-fix" content="hydration-2026-05-07-v6" />
        {/* Preconnect to Supabase Storage for faster image loads */}
        <link
          rel="preconnect"
          href="https://ulyrhnpoiypuvaurlqqi.supabase.co"
          crossOrigin="anonymous"
        />
        {/* BUG FIX: removed preconnect hints to fonts.googleapis.com /
            fonts.gstatic.com — the site no longer makes any request to
            either domain (next/font self-hosts Playfair Display + Lato at
            build time; see globals.css for the matching fix). Preconnecting
            to a domain the page never actually requests wastes a DNS/TLS
            handshake for nothing. */}
        {/* Organization JSON-LD */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@type':    'Organization',
              name:       'HimVeda by Pahadi Roots',
              url:        'https://pahadiroots.com',
              logo:       'https://pahadiroots.com/logo.png',
              contactPoint: {
                '@type':             'ContactPoint',
                telephone:           settings.contact_phone || '',
                contactType:         'customer service',
                availableLanguage:   ['English', 'Hindi'],
              },
              sameAs: [
                // BUG FIX: same class of bug as Footer.tsx — this read
                // instagram_url/facebook_url/youtube_url, keys with no
                // admin-panel equivalent. Real keys are social_instagram
                // etc. This structured data feeds Google's Knowledge
                // Graph social-profile associations, so it silently never
                // worked either.
                settings.social_instagram,
                settings.social_facebook,
                settings.social_youtube,
                settings.social_twitter,
                settings.social_pinterest,
              ].filter(Boolean),
            }),
          }}
        />
        {/* SEO FIX (WebSite + SearchAction): Organization schema was already
            wired in, but there was no WebSite type with a SearchAction —
            that's specifically what makes Google eligible to show a
            sitelinks search box directly in brand-name search results
            (e.g. searching "HimVeda"), a feature large e-commerce brands
            commonly have. Points at the existing /search page's ?q= param. */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@type':    'WebSite',
              name:       'HimVeda by Pahadi Roots',
              url:        'https://pahadiroots.com',
              potentialAction: {
                '@type':    'SearchAction',
                target: {
                  '@type':       'EntryPoint',
                  urlTemplate:   'https://pahadiroots.com/search?q={search_term_string}',
                },
                'query-input': 'required name=search_term_string',
              },
            }),
          }}
        />
        {/* BUG FIX (confirmed against a live admin-panel screenshot):
            the SEO tab's own UI claims "Google Tag ID: GA4 loads
            automatically ✅" — nothing anywhere in this codebase ever
            read google_tag_id or loaded any analytics script. Supports
            either a GA4 measurement ID (G-XXXXXXXXXX) or a GTM container
            ID (GTM-XXXXXX), matching the admin field's own placeholder
            text ("G-XXXXXX or GTM-XXXXXX"). Renders nothing at all when
            unset, so this is a no-op until an admin actually sets it.
            Note: ESLint suggests @next/third-parties/google's
            GoogleTagManager component instead of raw scripts here — not
            adopted since it's a new dependency for a non-blocking lint
            suggestion; this is GTM's own documented integration method. */}
        {settings.google_tag_id?.startsWith('GTM-') && (
          <script
            dangerouslySetInnerHTML={{
              __html: `(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${settings.google_tag_id}');`,
            }}
          />
        )}
        {settings.google_tag_id && !settings.google_tag_id.startsWith('GTM-') && (
          <>
            <script async src={`https://www.googletagmanager.com/gtag/js?id=${settings.google_tag_id}`} />
            <script
              dangerouslySetInnerHTML={{
                __html: `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${settings.google_tag_id}');`,
              }}
            />
          </>
        )}
      </head>
      <body className={`${playfair.variable} ${lato.variable}`} style={{ fontFamily: 'var(--font-lato, Lato, sans-serif)', background: '#fff', color: '#1a1a1a' }}>
        {/* GTM requires a <noscript> iframe fallback immediately inside <body> */}
        {settings.google_tag_id?.startsWith('GTM-') && (
          <noscript>
            <iframe
              src={`https://www.googletagmanager.com/ns.html?id=${settings.google_tag_id}`}
              height="0" width="0" style={{ display: 'none', visibility: 'hidden' }}
              title="Google Tag Manager"
            />
          </noscript>
        )}
        {/* Skip-to-content: visible on focus for keyboard / screen-reader users */}
        <SkipLink />
        <ScrollRestorationFix />
        <Providers>
          <Header settings={settings} categories={categories} states={states} />
          <main id="main-content" className="min-h-screen">
            {children}
          </main>
          <Footer settings={settings} />
          <CartDrawer settings={settings} />
          <SearchOverlay />
          <MobileMenu settings={settings} categories={categories} states={states} />
          <AuthModal />
          <GoogleAuthHandler />
          <ProfilePrefetcher />
        </Providers>
      </body>
    </html>
  )
}
