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
import NewsletterBar from '@/components/homepage/NewsletterBar'
import NewArrivals from '@/components/homepage/NewArrivals'
import FeaturedBanner from '@/components/homepage/FeaturedBanner'

export const metadata: Metadata = {
  title: 'HimVeda by Pahadi Roots — Pure Himalayan Natural Products',
  description: 'Shop authentic Himalayan natural products — wild honey, A2 ghee, Kashmiri saffron, Ladakhi shilajit & more. Sourced directly from mountain farmers. Free shipping above ₹799.',
}

export const revalidate = 60

export default async function HomePage() {
  const [settings, storeData] = await Promise.all([
    getSiteSettings(),
    getStoreData(),
  ])

  const categories = buildCategories(storeData)
  const heroImages = buildHeroImages(settings)
  const states     = await buildStates(storeData)

  const showTrustBar    = isEnabled(settings.show_trust_bar)
  const showNewArrivals = isEnabled(settings.show_new_arrivals)
  const showReviews     = isEnabled(settings.show_reviews_section)
  const showNewsletter  = isEnabled(settings.show_newsletter_bar)
  const featuredSlug    = settings.featured_collection_slug?.trim()

  return (
    <>
      <HeroBanner images={heroImages} settings={settings} />
      {showTrustBar && <TrustBar settings={settings} />}
      {/* Browse Collections — "What the Mountains Offer" */}
      <CategoryTiles categories={categories} />
      <BestSellers />
      {states.length > 0 && <ExploreByRegion states={states} />}
      {showNewArrivals && <NewArrivals />}
      {featuredSlug && <FeaturedBanner slug={featuredSlug} />}
      <WhySection settings={settings} />
      {showReviews && <ReviewsPreview />}
      {showNewsletter && <NewsletterBar />}
    </>
  )
}

function buildHeroImages(settings: any) {
  const slides: any[] = []
  for (let i = 1; i <= 5; i++) {
    const img = settings[`hero_slide_${i}_img`]
    if (img) slides.push({
      url:      img,
      alt_text: settings[`hero_slide_${i}_title`] || 'HimVeda by Pahadi Roots',
      title:    settings[`hero_slide_${i}_title`] || '',
      subtitle: settings[`hero_slide_${i}_sub`]   || '',
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
