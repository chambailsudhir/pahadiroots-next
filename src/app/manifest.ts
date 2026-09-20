import type { MetadataRoute } from 'next'
import { getSiteSettings } from '@/lib/getSiteSettings'

// SEO/PWA FIX: no manifest.json existed anywhere in the app — no "Add to
// Home Screen" install prompt on mobile, and a slightly weaker mobile
// trust/polish signal than what large e-commerce sites ship. Uses the same
// admin-editable site_name settings key the rest of the metadata already
// reads (see generateMetadata in layout.tsx), so this stays in sync with a
// rebrand automatically instead of hardcoding the name a second place.
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const settings = await getSiteSettings()
  const siteName = settings.site_name || 'HimVeda by Pahadi Roots'

  return {
    name: siteName,
    short_name: 'HimVeda',
    description: 'Pure, natural Himalayan products — honey, spices, grains and more, delivered across India.',
    start_url: '/',
    display: 'standalone',
    background_color: '#f9f4ec',
    theme_color: '#1a3a1e',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  }
}
