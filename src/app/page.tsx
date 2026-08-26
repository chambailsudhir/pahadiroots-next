import type { Metadata } from 'next'
import { getSiteSettings, isEnabled } from '@/lib/getSiteSettings'
import { getStoreData, buildCategories, getNormalizedProducts } from '@/lib/storeData'
import { toCardProductData } from '@/lib/normalizeProduct'
import HeroBanner from '@/components/homepage/HeroBanner'
import TrustBar from '@/components/homepage/TrustBar'
import CategoryTiles from '@/components/homepage/CategoryTiles'
import BestSellers from '@/components/homepage/BestSellers'
import ExploreByRegion from '@/components/homepage/ExploreByRegion'
import type { RichState } from '@/components/homepage/ExploreByRegion'
import type { Product } from '@/types'
import WhySection from '@/components/homepage/WhySection'
import ReviewsPreview from '@/components/homepage/ReviewsPreview'
import NewArrivals from '@/components/homepage/NewArrivals'
import FeaturedBanner from '@/components/homepage/FeaturedBanner'

// BUG FIX (found while removing the duplicate NewsletterBar section):
// this was a static `export const metadata` object. Next.js merges page
// metadata OVER layout metadata for matching fields — so this static
// object was silently overriding the generateMetadata() fix just added
// to layout.tsx, specifically on the homepage, which is the single most
// SEO-important page on the site. Every other route without its own
// static metadata export was already correctly picking up the admin's
// real meta_title/meta_description; the homepage alone was still stuck
// on hardcoded text no matter what an admin configured.
export async function generateMetadata(): Promise<Metadata> {
  const settings = await getSiteSettings()
  const siteName = settings.site_name || 'HimVeda by Pahadi Roots'
  return {
    title: settings.meta_title || `${siteName} — Pure Himalayan Natural Products`,
    description: settings.meta_description ||
      'Shop authentic Himalayan natural products — wild honey, A2 ghee, Kashmiri saffron, Ladakhi shilajit & more. Sourced directly from mountain farmers.',
  }
}

// BUG FIX (Aug 26 2026 — "sometimes Bestsellers doesn't show, then clicking
// View All Products and coming back to Home fixes it" — traced this exactly,
// line by line, instead of guessing again):
//
// There are TWO separate caching layers stacked on top of each other here,
// and they were compounding:
//   Layer A — lib/storeData.ts wraps getStoreData() in `unstable_cache` with
//             its own independent 60s TTL (Next's Data Cache). This layer
//             is fine and already self-heals: if a fetch fails, it throws,
//             and a thrown/rejected result is never cached — the very next
//             call gets a fresh attempt.
//   Layer B — THIS page had its own `export const revalidate = 60` (Next's
//             Full Route Cache / ISR) on top of Layer A.
//
// The failure sequence: if one of the six Supabase queries inside
// storeData.ts has a transient blip badly enough that both retries fail,
// BestSellers.tsx's try/catch (a deliberate fail-safe, so one broken
// section can't 500 the whole homepage) catches it and returns `null` —
// which is a perfectly successful render, just missing that section. From
// Layer B's point of view, the WHOLE PAGE rendered fine — no error was
// thrown at the page level — so Next.js takes that Bestsellers-less HTML
// and freezes it as the page's cached output for the next 60 seconds. Even
// though Layer A's data can (and usually does) recover within seconds, the
// degraded HTML stays locked in until Layer B's own 60s window separately
// expires. That's the exact mechanism behind "it comes back eventually" —
// clicking to /products and back isn't what fixes it; enough time passing
// for Layer B's independent window to lapse is what fixes it, and it just
// looks connected to the click because that's when the next visit happens
// to land after that window closed.
//
// Fix: drop the page-level ISR entirely and rely solely on Layer A (which
// already has its own TTL, single-flight, and now-correct retry/error
// surfacing — see storeData.ts). `force-dynamic` means this page's HTML is
// no longer independently frozen — every request re-renders using
// whatever storeData.ts's own 60s data cache currently holds, so a
// self-healed fetch shows up on the very next request instead of waiting
// out a second, redundant cache window. The underlying product/category
// data is still cached for 60s either way (that cost doesn't change) —
// this only removes the *extra*, redundant page-level freeze on top of it.
export const dynamic = 'force-dynamic'

export default async function HomePage() {
  const [settings, storeData] = await Promise.all([
    getSiteSettings(),
    getStoreData(),
  ])

  const categories = buildCategories(storeData)
  const heroImages = buildHeroImages(settings)
  const states     = await buildStates(storeData)

  const showTrustBar    = isEnabled(settings.show_trust_bar)
  const showBestSellers = isEnabled(settings.show_best_sellers)
  const showNewArrivals = isEnabled(settings.show_new_arrivals)
  const showReviews     = isEnabled(settings.show_reviews_section)
  const featuredSlug    = settings.featured_collection_slug?.trim()

  return (
    <>
      <HeroBanner images={heroImages} settings={settings} />
      {showTrustBar && <TrustBar settings={settings} />}
      {/* Browse Collections — "What the Mountains Offer" */}
      <CategoryTiles categories={categories} />
      {showBestSellers && <BestSellers />}
      {states.length > 0 && <ExploreByRegion states={states} />}
      {showNewArrivals && <NewArrivals />}
      {featuredSlug && <FeaturedBanner slug={featuredSlug} />}
      <WhySection settings={settings} />
      {showReviews && <ReviewsPreview />}
    </>
  )
}

function buildHeroImages(settings: any) {
  const slides: any[] = []
  for (let i = 1; i <= 5; i++) {
    const img   = settings[`hero_slide_${i}_img`]
    const video = settings[`hero_slide_${i}_video`]
    // BUG FIX: this only ever read _img/_title/_sub, so every other field
    // the admin's Hero Banners page (SlideEditor) actually saves —
    // eyebrow(+colour), title_colour, sub_colour, video, coupon
    // label/offer/code, and the two CTA button text/link pairs — was
    // silently dropped before it ever reached HeroBanner.tsx. It also
    // only activated a slide when an image was set, so a slide using
    // just a background video (which the admin explicitly supports —
    // its own "active" indicator checks `img || video`) would never
    // show up on the storefront at all.
    if (img || video) slides.push({
      url:            img   || '',
      video:          video || '',
      alt_text:       settings[`hero_slide_${i}_title`] || 'HimVeda by Pahadi Roots',
      title:          settings[`hero_slide_${i}_title`]          || '',
      title_colour:   settings[`hero_slide_${i}_title_colour`]   || '',
      subtitle:       settings[`hero_slide_${i}_sub`]             || '',
      sub_colour:     settings[`hero_slide_${i}_sub_colour`]      || '',
      eyebrow:        settings[`hero_slide_${i}_eyebrow`]         || '',
      eyebrow_colour: settings[`hero_slide_${i}_eyebrow_colour`]  || '',
      coupon_label:   settings[`hero_slide_${i}_coupon_label`]    || '',
      coupon_offer:   settings[`hero_slide_${i}_coupon_offer`]    || '',
      coupon_code:    settings[`hero_slide_${i}_coupon_code`]     || '',
      cta_text:       settings[`hero_slide_${i}_cta_text`]        || '',
      cta_link:       settings[`hero_slide_${i}_cta_link`]        || '',
      cta2_text:      settings[`hero_slide_${i}_cta2_text`]       || '',
      cta2_link:      settings[`hero_slide_${i}_cta2_link`]       || '',
    })
  }
  if (!slides.length && settings.hero_bg_image)
    slides.push({ url: settings.hero_bg_image, alt_text: 'HimVeda by Pahadi Roots', title: '', subtitle: '' })
  return slides
}

// Exported (not just used internally) so it can be unit-tested directly —
// see src/__tests__/homepageBuildStates.test.ts — without needing to render
// the entire HomePage tree (hero images, trust bar, reviews section, etc.).
export async function buildStates(storeData: Awaited<ReturnType<typeof getStoreData>>): Promise<RichState[]> {
  const { states, state_images } = storeData
  if (!states?.length) return []

  // BUG FIX (perf): previously ran its own full-catalog
  // getProductsWithImages()+normalizeProducts() pass. Now shares the same
  // cached result used by /regions and /regions/[slug] (see
  // getNormalizedProducts() in storeData.ts) instead of recomputing it.
  const normalized = await getNormalizedProducts() as (Product & { state_id: string })[]

  return states.map((s: any) => {
    const imgs = (state_images as any[])
      .filter(i => String(i.state_id) === String(s.id))
      .sort((a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    return {
      id:          s.id,
      name:        s.name,
      slug:        s.id,
      description: s.description ?? null,
      image_url:   imgs[0]?.image_url ?? s.image_path ?? null,
      region:      null,
      // BUG FIX: state_id comparison previously had no case-normalization
      // (same pattern found in /regions/page.tsx and /regions/[slug]/page.tsx)
      // — could silently disagree with the counts shown on those pages if
      // casing ever differs between products.state_id and states.id.
      // BUG FIX: previously passed raw normalized() products straight into
      // ProductCard (a Client Component), shipping every AI-generated
      // content field (long/short description, AI health-benefits text,
      // tags, etc.) into the RSC payload for products that never render
      // them. toCardProductData() strips those before the client boundary,
      // matching the fix already applied on /regions/[slug].
      products:    normalized
        .filter(p => String(p.state_id).toLowerCase() === String(s.id).toLowerCase())
        .slice(0, 4)
        .map(toCardProductData),
    }
  }) as unknown as RichState[]
}
