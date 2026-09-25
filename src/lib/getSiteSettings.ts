// Server-only: this file imports revalidateTag/unstable_cache from
// next/cache. If a client component ever imports from this file again
// (directly, or transitively), this line makes the build fail immediately
// with "This module cannot be imported from a Client Component" instead of
// Turbopack's harder-to-trace "Pages Router" error (see MobileMenu.tsx /
// Header.tsx — they import isEnabled from siteSettingsHelpers.ts instead,
// specifically to avoid pulling this file into the client bundle).
import 'server-only'
import { supabase, getServiceClient } from './supabase'
import type { SiteSettings } from '@/types'
import { logger } from '@/lib/logger'
import { unstable_cache, revalidateTag } from 'next/cache'

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
  // MINOR CONSISTENCY FIX (sync audit): this key is genuinely read on the
  // homepage (isEnabled(settings.show_category_tiles) in page.tsx) and the
  // admin panel has a working toggle for it ("Browse Collections" in
  // Homepage Sections) -- it was just missing from this fallback object,
  // unlike every sibling show_* key. Not a live bug: isEnabled()'s own
  // default parameter already treats undefined as true (shown), which
  // happens to match the intended default -- but leaving it out here means
  // the one path where getSiteSettings() falls back to DEFAULTS wholesale
  // (a Supabase read failure) is only "correct by coincidence" rather than
  // by explicit default, same as every other section toggle here.
  show_category_tiles:     'true',
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
  // Master on/off for the "Lab Tested & Verified" certificate card on the
  // PDP (CertificatesTab in pahadi-admin). Off hides it everywhere even if
  // individual products have an active certificate linked — a quick kill
  // switch without touching every certificate's own is_active flag.
  show_certificates:       'true',
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

  // SEO FIX: Google Search Console verification — needed pre-launch to
  // submit the sitemap for priority crawling and get indexing/Core Web
  // Vitals visibility from day one, instead of waiting for organic
  // discovery. Empty by default (no-op) until an admin pastes the
  // verification code GSC gives them under Settings > Ownership
  // verification > HTML tag method (just the content= value, not the
  // full <meta> tag).
  google_site_verification: '',

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

const CACHE_TTL_SECONDS = 5 * 60 // 5 minutes — now only a safety-net TTL (see below)
const SITE_SETTINGS_TAG = 'site-settings'

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
// caller awaits that SAME promise instead of starting a new request. Kept
// even after moving to unstable_cache below, since that's a distributed
// cache — several instances can still all miss it simultaneously on a
// genuinely cold key, and this only protects the (cheap, in-process) case
// of concurrent callers on the SAME instance.
let _inFlight: Promise<SiteSettings> | null = null

async function fetchSiteSettingsFromDB(): Promise<SiteSettings> {
  // Use service client server-side to bypass RLS on site_settings
  const client = (() => { try { return getServiceClient() } catch { return supabase } })()

  // BUG FIX: the Supabase JS SDK does not support AbortSignal or built-in
  // timeouts.  Without a timeout, a slow or unresponsive Supabase instance
  // hangs this call indefinitely — blocking any route that calls getSiteSettings()
  // (orders, payments) until Vercel's hard 15-second limit fires and kills the
  // entire request.  getSiteSettings is in the critical path of order creation.
  //
  // Fix: race the SDK call against an 8-second timeout Promise.  On timeout we
  // throw so the caller falls back to DEFAULTS — the site continues to function
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
  return { ...DEFAULTS, ...fromDB } as SiteSettings
}

// BUG FIX (cross-instance staleness — "hero banner change takes minutes to
// show up"): the cache here used to be a plain module-level variable
// (`let _cache`), which lives in the memory of ONE serverless function
// instance only. Vercel routinely keeps several instances of the same
// function warm concurrently, so clearSiteSettingsCache() — called from
// /api/v1/revalidate right after an admin save — only ever cleared the
// _cache belonging to whichever single instance happened to handle that
// revalidate request. Every OTHER warm instance kept serving its own
// stale in-memory copy for up to the full 5-minute TTL regardless, which
// is exactly why a Hero Banner (or any settings) change could take up to
// ~5 minutes to appear depending on which instance served a given visitor
// — even though the revalidate call itself succeeded every time.
//
// Fix: use Next's built-in Data Cache (unstable_cache), tagged
// 'site-settings', instead of a local variable. Unlike a module-level
// variable, this cache is shared across every instance of the deployment,
// so revalidateTag('site-settings') — now called from
// clearSiteSettingsCache() below — invalidates it everywhere at once
// instead of in just one instance. The 5-minute `revalidate` below is only
// a safety-net TTL for the case an admin save's revalidate call never
// fires at all (e.g. REVALIDATE_SECRET misconfigured); the tag is what
// actually makes a save go live within seconds, matching what the admin
// UI already promises.
const getCachedSiteSettings = unstable_cache(
  async () => {
    if (_inFlight) return _inFlight
    _inFlight = fetchSiteSettingsFromDB().finally(() => { _inFlight = null })
    return _inFlight
  },
  ['site-settings-v1'],
  { tags: [SITE_SETTINGS_TAG], revalidate: CACHE_TTL_SECONDS }
)

export async function getSiteSettings(): Promise<SiteSettings> {
  try {
    // A thrown/rejected call is never cached by unstable_cache (same
    // self-healing behavior already relied on for getStoreData() in
    // storeData.ts) — so a transient Supabase blip here doesn't get
    // locked in as "the" cached value for the next 5 minutes.
    return await getCachedSiteSettings()
  } catch (err) {
    logger.error('getSiteSettings: failed to fetch, using defaults', { action: 'getSiteSettings.fetch', error: err instanceof Error ? err.message : String(err) })
    return DEFAULTS as SiteSettings
  }
}

// Exported so /api/v1/revalidate can invalidate this the moment an admin
// saves a setting (site_settings covers Ann Bar, Ticker, Trust Bar, Hero
// Banners/Stats, Store Status, and everything else in the table), the same
// way getStoreData(true) already does for product data. Backed by
// revalidateTag now (see the long comment on getCachedSiteSettings above)
// so this invalidates the cache for every instance of the deployment, not
// just whichever one happens to handle the revalidate request.
export function clearSiteSettingsCache(): void {
  // Next 16's revalidateTag requires a second "profile" argument saying how
  // aggressively to treat the tag as stale. { expire: 0 } means "treat as
  // expired immediately" — the on-demand-invalidation behavior this
  // function has always been meant to provide, independent of whatever TTL
  // the underlying unstable_cache call above was given.
  revalidateTag(SITE_SETTINGS_TAG, { expire: 0 })
}

// isEnabled/asNumber moved to siteSettingsHelpers.ts (client-safe, no
// next/cache import) — re-exported here so every existing server-side
// importer of getSiteSettings.ts keeps working without changes.
export { isEnabled, asNumber } from './siteSettingsHelpers'

