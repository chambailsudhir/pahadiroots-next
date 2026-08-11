import { supabase, getServiceClient } from './supabase'
import type { SiteSettings } from '@/types'
import { logger } from '@/lib/logger'

// Default fallback values — site works even if settings are missing
const DEFAULTS: Partial<SiteSettings> = {
  // Store — real keys confirmed in your site_settings
  store_open:              'true',
  maintenance_message:     "We'll be back soon! 🌿",
  // Announcement bar
  ann_hide:                'false',
  ann_text:                '',
  ann_bg_color:            '#1a3a1e',
  ann_text_color:          '#d4af37',
  // Ticker — real keys confirmed
  ticker_hide:             'false',
  ticker_1_text:           '🎁 Use code WELCOME50 · ₹50 off your first order',
  ticker_2_text:           '🚚 Free shipping · On orders above ₹500 — Pan India',
  ticker_3_text:           '🌿 100% Natural · No preservatives, no additives',
  ticker_4_text:           '🏔️ Direct from mountain farmers',
  ticker_5_text:           '⭐ Rated 4.9/5 · Happy customers across India',
  ticker_1_hide:           'false',
  ticker_2_hide:           'false',
  ticker_3_hide:           'false',
  ticker_4_hide:           'false',
  ticker_5_hide:           'false',
  ticker_bg_color:         '#c8920a',
  ticker_text_color:       '#1a1a1a',
  // Shipping — real keys confirmed (currently 0 in your DB)
  free_shipping_min:       '0',
  flat_shipping_charge:    '0',
  // Contact — real keys confirmed
  whatsapp_number:         '919899984895',
  contact_phone:           '+919899984895',
  contact_address:         'Village Sakoh, PO Sakoh, Distt Kangra, Himachal Pradesh 176082',
  // New section toggle keys (added by migration)
  show_trust_bar:          'true',
  trust_bg_color:          '#1a3a1e',
  trust_text_color:        '#ffffff',
  show_best_sellers:       'true',
  show_new_arrivals:       'true',
  show_state_stories:      'true',
  show_reviews_section:    'true',
  // Now unused on the main site — NewsletterBar.tsx (the only reader)
  // was deleted as a confirmed duplicate of Footer.tsx's own newsletter
  // form. Left here rather than removed since the admin panel may still
  // have a toggle referencing this key.
  show_newsletter_bar:     'true',
  show_blog_section:       'false',
  show_wishlist:           'true',
  show_reviews_on_pdp:     'true',
  show_related_products:   'true',
  show_track_order_page:   'true',
  show_blog:               'false',
  catalogue_visible:       'true',
  prepaid_discount_pct:    '5',
  cod_surcharge_amount:    '0',
  cod_enabled:             'false',   // currently false in your DB
  cod_max_value:           '3000',
  cod_max_active_orders:   '3',
  featured_collection_slug: '',
  // Real keys for reviews/new arrivals toggles
  reviews_enabled:         'true',
  new_arrivals_enabled:    'true',

  // Hero Stats Bar — BUG FIX: these keys didn't exist anywhere on the main
  // site before (confirmed via grep). The admin panel's "Hero Stats Bar"
  // section (pahadi-admin src/app/admin/settings/page.jsx) has managed
  // these all along, under these exact key names, with these exact
  // defaults — but HeroBanner.tsx had its own, completely disconnected
  // hardcoded stats array, so nothing an admin ever set here reached the
  // live site. Defaults below intentionally match the admin panel's
  // defaults exactly.
  // CORRECTED: confirmed via a live screenshot of the admin panel that
  // the real current value is '100', not '500' as I'd assumed from the
  // admin code's own fallback default. The DB row exists, so this
  // constant only matters if that row is ever deleted — but keeping it
  // accurate avoids confusing whoever reads this next.
  stat_farmer_families:            '100',
  stat_himalayan_states:           '10',
  stat_happy_customers:            '10000',
  stat_avg_dispatch:               '48',
  stat_farmer_label:               'Farmer Families',
  stat_states_label:               'Himalayan States',
  stat_customers_label:            'Happy Customers',
  stat_dispatch_label:             'Avg Dispatch',
  stat_hide_stat_farmer_families:  'false',
  stat_hide_stat_himalayan_states: 'false',
  stat_hide_stat_happy_customers:  'false',
  stat_hide_stat_avg_dispatch:     'false',
  stat_bg_color:                   'rgba(5,20,8,.97)',
  stat_number_color:               '#e8b84b',

  // Social links — BUG FIX: main site previously read instagram_url/
  // facebook_url/youtube_url (no admin-panel equivalent exists under
  // those names). The admin panel's real keys are social_instagram/
  // social_facebook/social_youtube/social_twitter/social_pinterest.
  social_instagram:        '',
  social_facebook:         '',
  social_youtube:          '',
  social_twitter:          '',
  social_pinterest:        '',

  // SEO — BUG FIX: layout.tsx's metadata export was static, so none of
  // these ever reached the page regardless of what an admin configured
  // (confirmed via a live admin-panel screenshot showing real,
  // already-written SEO copy that had never taken effect).
  meta_title:              '',
  meta_description:        '',
  meta_keywords:           '',
  og_image:                '',

  // Analytics — BUG FIX: admin panel's SEO tab claims "Google Tag ID:
  // GA4 loads automatically" — it didn't; no script ever read this
  // setting anywhere on the main site.
  google_tag_id:           '',

  // Email — BUG FIX: admin panel's Email tab claims "Email Footer Text:
  // Appears at bottom of every outgoing email" — confirmed via grep
  // that lib/server/email.ts never referenced this setting at all.
  email_footer_text:       '',

  // About page — admin panel's /admin/team route ("About Page" in the
  // sidebar) manages all of this under these exact keys (its "Page
  // Content" tab), but src/app/about/page.tsx never actually read any
  // of them — every string on the live /about page was hardcoded in
  // this repo instead. Defaults below intentionally match the admin
  // panel's own fallback copy exactly, so an unconfigured store still
  // reads fine and a configured store's real copy takes over cleanly.
  about_page_enabled:      'true',
  about_hero_eyebrow:      'Est. in the Himalayas',
  about_hero_title_1:      'How HimVeda Started',
  about_hero_title_2:      'A Trip Back Home',
  about_hero_subtitle:     'We started HimVeda by Pahadi Roots because people deserved to know where their food comes from — and the farmers deserved more than what middlemen ever paid them.',
  about_story_eyebrow:     'How It Started',
  about_story_heading:     'A trip to the hills, and a question we couldn\u2019t shake',
  about_story_p1:          'This started with a trip to the hills — buying honey straight from a farmer who\u2019d walked down with it that morning. It tasted like nothing we\u2019d had before. Back in the city, the "raw Himalayan honey" on shelves tasted nothing like it, and cost less than what that farmer was paid for the real thing.',
  about_story_p2:          'That gap between what farmers make and what we\u2019re sold — that\u2019s the whole reason HimVeda exists. Everything we list, we\u2019ve either sourced ourselves or vetted with the people who grow, press, or harvest it.',
  about_story_p3:          'We\u2019re not a big company pretending to be small. We\u2019re still figuring a lot of this out — but every product on this site is one we\u2019d hand to our own family without a second thought.',
  about_quote_text:        'If it doesn\u2019t taste like what we had in the hills, it doesn\u2019t go on the site.',
  about_quote_attribution: 'The Founding Team',
  about_value_1_icon: 'handshake', about_value_1_title: 'Direct from Farmers',  about_value_1_body: 'We buy from the farmer, not a trader three hands removed from the farm.',                                              about_value_1_hide: 'false',
  about_value_2_icon: 'leaf',      about_value_2_title: '100% Natural',         about_value_2_body: 'Nothing added to extend shelf life or fake a colour. If it needs a preservative, we don\u2019t stock it.',                    about_value_2_hide: 'false',
  about_value_3_icon: 'scale',     about_value_3_title: 'Fair Pricing',         about_value_3_body: 'We agree on a price with the farmer before the season starts, not after we\u2019ve seen the market rate.',                    about_value_3_hide: 'false',
  about_value_4_icon: 'peak',      about_value_4_title: 'Mountain to Doorstep', about_value_4_body: 'Fewer hands between the farm and your door means less markup and a fresher product.',                                     about_value_4_hide: 'false',
  about_value_5_icon: 'package',   about_value_5_title: 'Thoughtful Packaging', about_value_5_body: 'We pack to protect the product, not to look bigger on a shelf.',                                                          about_value_5_hide: 'false',
  about_value_6_icon: 'heart',     about_value_6_title: 'Community First',      about_value_6_body: 'A fair order today is what keeps a farming family doing this next season too.',                                          about_value_6_hide: 'false',
  about_cta_heading:       'Ready to Taste the Mountains?',
  about_cta_subtext:       'Every product has a story. Explore our full range of natural Himalayan products.',
  // Farmer connection video — optional; section is hidden until an admin
  // uploads a clip or pastes a YouTube/Vimeo link (about_video_url).
  about_video_url:         '',
  about_video_poster:      '',
  about_video_heading:     'Meet the Farmers',
  about_video_caption:     'A short look at the families behind every harvest.',
  about_video_hide:        'false',
}

// In-memory cache for server-side (Next.js ISR revalidation handles the rest)
let _cache: { data: SiteSettings; ts: number } | null = null
const CACHE_TTL = 5 * 60 * 1000 // 5 minutes

// BUG FIX (found via production log storm — Vercel logs showed dozens of
// concurrent "getSiteSettings timed out" errors across /regions/* pages
// firing within the same few seconds): this was previously documented as
// "BUG 27" — a stampede race where every concurrent cold-cache call
// independently fires its own Supabase request instead of sharing one.
// The old comment called this "acceptable" assuming at most ~2 concurrent
// callers (two overlapping cold starts); in practice, a burst of many pages
// rendering at once (mass ISR regeneration after a deploy, or a crawler
// hitting many pages within seconds) can mean dozens of concurrent callers
// on the same warm lambda instance, each opening its own request and each
// racing its own 8s timeout — compounding load on Supabase at exactly the
// moment it's already under pressure, and cascading into timeouts on
// unrelated routes that share the same connection pool.
// Fix: single-flight — while a fetch is already in progress, every other
// caller awaits that SAME promise instead of starting a new request.
let _inFlight: Promise<SiteSettings> | null = null

export async function getSiteSettings(): Promise<SiteSettings> {
  // Return cache if fresh
  if (_cache && Date.now() - _cache.ts < CACHE_TTL) {
    return _cache.data
  }

  if (_inFlight) return _inFlight

  _inFlight = (async () => {
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
      logger.error('getSiteSettings: failed to fetch, using defaults', { action: 'getSiteSettings.fetch', error: err instanceof Error ? err.message : String(err) })
      return DEFAULTS as SiteSettings
    } finally {
      _inFlight = null
    }
  })()

  return _inFlight
}

// BUG FIX: site_settings (Ann Bar, Ticker, Trust Bar, Hero Stats, Store
// Status) had no way to be invalidated on demand. getSiteSettings() held its
// own 5-minute in-process cache on top of layout.tsx's 300s ISR revalidate
// and page.tsx's 60s ISR revalidate — stacked, that's up to ~10 minutes of
// staleness in the worst case, even though the admin panel's Settings page
// tells the store owner "Changes go live instantly." Exported so
// /api/v1/revalidate can clear this the moment an admin saves a setting,
// the same way getStoreData(true) already does for product data.
export function clearSiteSettingsCache(): void {
  _cache = null
  _inFlight = null
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

