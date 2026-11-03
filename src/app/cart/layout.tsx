import type { Metadata } from 'next'
import { getSiteSettings } from '@/lib/getSiteSettings'
import { CART_SETTING_KEYS } from '@/lib/cartSettingKeys'
import { CartSettingsSeed } from '@/components/cart/CartSettingsSeed'

/**
 * Cart route metadata — explicitly noindex (cart is not a public landing page)
 * and sets a canonical tag so crawlers have an authoritative URL if they do land here.
 */
export const metadata: Metadata = {
  // layout.tsx appends ` | ${siteName}` via title.template, so page titles must NOT repeat the brand
  // (it rendered "… | HimVeda by Pahadi Roots | HimVeda by Pahadi Roots"). openGraph/twitter titles are not templated and keep it.
  title: 'Your Cart',
  description: 'Review your HimVeda by Pahadi Roots order before checkout.',
  robots: {
    index: false,
    follow: false,
  },
  alternates: {
    canonical: '/cart',
  },
  openGraph: {
    title: 'Your Cart | HimVeda by Pahadi Roots',
    description: 'Review your HimVeda by Pahadi Roots order before checkout.',
    // BUG FIX: no `images` here — this page's own openGraph object
    // replaces the layout's entirely, so this route had no og:image.
    images: [{ url: '/og-default.jpg', width: 1200, height: 630, alt: 'Your Cart | HimVeda by Pahadi Roots' }],
  },
}

export default async function CartLayout({ children }: { children: React.ReactNode }) {
  // Pre-load the cart's settings on the server (cached 5 min by getSiteSettings) so the order summary paints with the page.
  let seed: Record<string, string> | null = null
  try {
    const all = (await getSiteSettings()) as unknown as Record<string, string>
    seed = {}
    for (const k of CART_SETTING_KEYS) if (all[k] != null) seed[k] = String(all[k])
  } catch { seed = null }   // fall back to the browser fetch
  return seed ? <CartSettingsSeed settings={seed}>{children}</CartSettingsSeed> : children
}
