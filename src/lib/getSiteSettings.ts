import { supabase, getServiceClient } from './supabase'
import type { SiteSettings } from '@/types'

// Default fallback values — site works even if settings are missing
const DEFAULTS: Partial<SiteSettings> = {
  // Store — real keys confirmed in your site_settings
  store_open:              'true',
  maintenance_message:     "We'll be back soon! 🌿",
  // Announcement bar
  ann_hide:                'false',
  ann_text:                '',
  // Ticker — real keys confirmed
  ticker_hide:             'false',
  ticker_1_text:           '🎁 Use code WELCOME50 · ₹50 off your first order',
  ticker_2_text:           '🚚 Free shipping · On orders above ₹799 — Pan India',
  ticker_3_text:           '🌿 100% Natural · No preservatives, no additives',
  ticker_4_text:           '🏔️ Direct from mountain farmers',
  ticker_5_text:           '⭐ Rated 4.9/5 · Happy customers across India',
  ticker_1_hide:           'false',
  ticker_2_hide:           'false',
  ticker_3_hide:           'false',
  ticker_4_hide:           'false',
  ticker_5_hide:           'false',
  // Shipping — real keys confirmed (currently 0 in your DB)
  free_shipping_min:       '0',
  flat_shipping_charge:    '0',
  // Contact — real keys confirmed
  whatsapp_number:         '919899984895',
  contact_phone:           '+919899984895',
  contact_address:         'Village Sakoh, PO Sakoh, Distt Kangra, Himachal Pradesh 176082',
  // New section toggle keys (added by migration)
  show_trust_bar:          'true',
  show_best_sellers:       'true',
  show_new_arrivals:       'true',
  show_state_stories:      'true',
  show_reviews_section:    'true',
  show_newsletter_bar:     'true',
  show_blog_section:       'false',
  show_wishlist:           'true',
  show_reviews_on_pdp:     'true',
  show_related_products:   'true',
  show_track_order_page:   'true',
  show_blog:               'false',
  catalogue_visible:       'true',
  prepaid_discount_pct:    '5',
  cod_enabled:             'false',   // currently false in your DB
  cod_max_value:           '3000',
  cod_max_active_orders:   '3',
  featured_collection_slug: '',
  // Real keys for reviews/new arrivals toggles
  reviews_enabled:         'true',
  new_arrivals_enabled:    'true',
}

// In-memory cache for server-side (Next.js ISR revalidation handles the rest)
let _cache: { data: SiteSettings; ts: number } | null = null
const CACHE_TTL = 5 * 60 * 1000 // 5 minutes

export async function getSiteSettings(): Promise<SiteSettings> {
  // Return cache if fresh
  if (_cache && Date.now() - _cache.ts < CACHE_TTL) {
    return _cache.data
  }

  try {
    // Use service client server-side to bypass RLS on site_settings
    const client = (() => { try { return getServiceClient() } catch { return supabase } })()

    // BUG FIX: the Supabase JS SDK does not support AbortSignal or built-in
    // timeouts.  Without a timeout, a slow or unresponsive Supabase instance
    // hangs this call indefinitely — blocking any route that calls getSiteSettings()
    // (orders, payments) until Vercel's hard 15-second limit fires and kills the
    // entire request.  getSiteSettings is in the critical path of order creation.
    //
    // Fix: race the SDK call against an 8-second timeout Promise.  On timeout we
    // throw so the catch block returns DEFAULTS — the site continues to function
    // with sensible fallback values rather than hanging and returning a 500 to
    // the customer mid-checkout.  8 s matches the AbortSignal.timeout used by
    // every other Supabase fetch in the codebase (sbAdmin in serverUtils.ts,
    // sbGet in orderService.ts).
    const timeoutMs = 8_000
    const queryPromise = client.from('site_settings').select('key, value')
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`getSiteSettings timed out after ${timeoutMs}ms`)), timeoutMs)
    )

    const { data, error } = await Promise.race([queryPromise, timeoutPromise])

    if (error) throw error

    const fromDB = Object.fromEntries(
      (data || []).map((r: { key: string; value: string }) => [r.key, r.value])
    )

    // Merge: defaults first, then DB values override
    const settings = { ...DEFAULTS, ...fromDB } as SiteSettings

    _cache = { data: settings, ts: Date.now() }
    return settings
  } catch (err) {
    console.error('[getSiteSettings] Failed to fetch, using defaults:', err)
    return DEFAULTS as SiteSettings
  }
}

// Helper: parse a boolean setting (handles 'true', 'false', missing)
export function isEnabled(value: string | undefined, defaultValue = true): boolean {
  if (value === undefined) return defaultValue
  return value !== 'false'
}

// Helper: parse a number setting
export function asNumber(value: string | undefined, defaultValue: number): number {
  if (!value) return defaultValue
  const n = parseFloat(value)
  return isNaN(n) ? defaultValue : n
}

