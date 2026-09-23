import type { Metadata } from 'next'
import { Playfair_Display, Lato } from 'next/font/google'
import './globals.css'
import { getSiteSettings } from '@/lib/getSiteSettings'
import { sanitizeHtml } from '@/lib/server/sanitize'
import { supabase } from '@/lib/supabase'
import Header from '@/components/layout/Header'
import Footer from '@/components/layout/Footer'
import MobileMenu from '@/components/layout/MobileMenu'
import MobileBottomNav from '@/components/layout/MobileBottomNav'
import Script from 'next/script'
import { Providers } from './providers'
import SkipLink from '@/components/ui/SkipLink'
import ScrollRestorationFix from '@/components/ui/ScrollRestorationFix'
import CartDrawer from '@/components/cart/CartDrawer'
import SearchOverlay from '@/components/search/SearchOverlay'
import AuthModal from '@/components/auth/AuthModal'
import GoogleAuthHandler from '@/components/auth/GoogleAuthHandler'
import ProfilePrefetcher from '@/components/ProfilePrefetcher'

// SEO FIX: matches the same env-var-with-fallback pattern already used in
// sitemap.ts and robots.ts, so the Organization/WebSite JSON-LD below (and
// generateMetadata()'s metadataBase) all agree on one source of truth for
// the canonical site origin instead of three independently hardcoded copies.
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.pahadiroots.com'

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
    metadataBase: new URL(SITE_URL),
    title: {
      default: title,
      template: `%s | ${siteName}`,
    },
    description,
    keywords,
    openGraph: {
      type:        'website',
      locale:      'en_IN',
      url:         SITE_URL,
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
        {/* Organization JSON-LD
            SEO FIX (consistency/staleness): name/url/logo were hardcoded to
            'HimVeda by Pahadi Roots' / pahadiroots.com — the exact same
            string generateMetadata() above already sources from
            settings.site_name with a matching fallback. Hardcoding it a
            second time here meant this block would silently go stale the
            day an admin renames the site in Settings, while every <title>
            and OG tag on the site updated instantly. Now single-sourced
            from the same settings field, same fallback, so it can't drift. */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@type':    'Organization',
              name:       settings.site_name || 'HimVeda by Pahadi Roots',
              // ENTITY-DISAMBIGUATION FIX: there is at least one large, well-
              // covered, unrelated brand with a near-identical name in the
              // exact same category (Himalayan-origin natural/wellness
              // products), which has caused AI answer engines to attribute
              // that brand's products to us. alternateName + description +
              // disambiguatingDescription + a real registered address are
              // exactly the schema.org signals search/LLM entity resolution
              // uses to tell two similarly-named organizations apart —
              // sourced from settings with the same fallback pattern as the
              // rest of this file, so it stays in sync if the brand name or
              // address ever changes in Settings.
              alternateName: 'HimVeda',
              description: settings.meta_description ||
                'Pahadi Roots (HimVeda) sources honey, spices, grains, and other natural staples directly from Himalayan mountain farming communities and delivers them across India.',
              disambiguatingDescription:
                'Pahadi Roots, also known as HimVeda, is an independent Himalayan food and grocery brand. It is not affiliated with, and has no business relationship to, any other company using a similar "Pahadi"-prefixed name in the beauty, skincare, or wellness category.',
              url:        SITE_URL,
              logo:       `${SITE_URL}/logo.png`,
              // Real registered address (Kangra, Himachal Pradesh) — a
              // distinct, verifiable physical location is one of the
              // strongest disambiguation signals for Google's Knowledge
              // Graph and for LLMs doing entity resolution between two
              // similarly-named brands.
              ...(settings.contact_address ? {
                address: {
                  '@type':          'PostalAddress',
                  streetAddress:    settings.contact_address,
                  addressCountry:   'IN',
                },
                foundingLocation: {
                  '@type': 'Place',
                  address: { '@type': 'PostalAddress', streetAddress: settings.contact_address, addressCountry: 'IN' },
                },
              } : {}),
              // SEO FIX: an empty telephone string in ContactPoint is a
              // known Google Rich Results / schema.org validator warning
              // ("telephone: value is not a valid phone number") — omit the
              // whole contactPoint when there's no real number rather than
              // emit a guaranteed-invalid empty one.
              ...(settings.contact_phone ? {
                contactPoint: {
                  '@type':             'ContactPoint',
                  telephone:           settings.contact_phone,
                  contactType:         'customer service',
                  availableLanguage:   ['English', 'Hindi'],
                },
              } : {}),
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
            commonly have. Points at the existing /search page's ?q= param.
            SEO FIX (consistency): name/url now sourced from settings.site_name
            / SITE_URL for the same reason as the Organization block above. */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@type':    'WebSite',
              name:       settings.site_name || 'HimVeda by Pahadi Roots',
              url:        SITE_URL,
              potentialAction: {
                '@type':    'SearchAction',
                target: {
                  '@type':       'EntryPoint',
                  urlTemplate:   `${SITE_URL}/search?q={search_term_string}`,
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
        {/* Sentinel for MobileBottomNav's scroll-to-top button — observed
            via IntersectionObserver instead of a scroll listener so the
            button's show/hide never runs on the scroll thread. Sits at
            the true top of the page regardless of header height. */}
        <div id="mbn-scroll-sentinel" aria-hidden="true" style={{ position: 'absolute', top: 0, left: 0, width: 1, height: 1 }} />
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
          <MobileBottomNav settings={settings} />
          <AuthModal />
          <GoogleAuthHandler />
          <ProfilePrefetcher />
        </Providers>
        {/* Pahadi_AI — ported verbatim from the old site (public/js/ai-assistant.js).
            Self-contained IIFE: injects its own <style>, builds its own DOM
            (chat fab + panel + WhatsApp button), and talks to /api/chat
            (Gemini primary, Claude fallback — see src/app/api/chat/route.ts).
            Reads --g/--g2/--gd/--gd2 theme vars from globals.css, which already
            match the old site 1:1, so no visual changes were needed. */}
        <Script
          src="/js/ai-assistant.js"
          data-name="Pahadi_AI"
          data-tagline="Himalayan Shopping Guide · Online"
          data-whatsapp="919899984895"
          strategy="afterInteractive"
        />
      </body>
    </html>
  )
}
