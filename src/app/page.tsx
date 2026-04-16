import type { Metadata } from 'next'
import { getSiteSettings, isEnabled } from '@/lib/getSiteSettings'
import { supabase } from '@/lib/supabase'
import HeroBanner from '@/components/homepage/HeroBanner'
import TrustBar from '@/components/homepage/TrustBar'
import BestSellers from '@/components/homepage/BestSellers'
import CategoryTiles from '@/components/homepage/CategoryTiles'
import NewArrivals from '@/components/homepage/NewArrivals'
import StateStories from '@/components/homepage/StateStories'
import ReviewsPreview from '@/components/homepage/ReviewsPreview'
import NewsletterBar from '@/components/homepage/NewsletterBar'
import FeaturedBanner from '@/components/homepage/FeaturedBanner'

export const metadata: Metadata = {
  title: 'Pahadi Roots — Natural Himalayan Products',
  description:
    'Pure, natural products sourced directly from Himalayan mountain farming communities. Honey, spices, grains, and more — delivered across India.',
}

export const revalidate = 300  // 5 minutes

export default async function HomePage() {
  const [settings, heroImages, categories, states] = await Promise.all([
    getSiteSettings(),
    fetchHeroImages(),
    fetchCategories(),
    fetchStates(),
  ])

  // Feature flag checks
  const showTrustBar     = isEnabled(settings.show_trust_bar)
  const showBestSellers  = isEnabled(settings.show_best_sellers)
  const showNewArrivals  = isEnabled(settings.show_new_arrivals)
  const showStateStories = isEnabled(settings.show_state_stories)
  const showReviews      = isEnabled(settings.show_reviews_section)
  const showNewsletter   = isEnabled(settings.show_newsletter_bar)
  const featuredSlug     = settings.featured_collection_slug?.trim()

  return (
    <>
      {/* Hero banner */}
      <HeroBanner images={heroImages} settings={settings} />

      {/* Trust badges */}
      {showTrustBar && <TrustBar settings={settings} />}

      {/* Best Sellers */}
      {showBestSellers && <BestSellers />}

      {/* Category tiles */}
      <CategoryTiles categories={categories} />

      {/* New Arrivals */}
      {showNewArrivals && <NewArrivals />}

      {/* Featured collection banner */}
      {featuredSlug && <FeaturedBanner slug={featuredSlug} />}

      {/* Shop by Region */}
      {showStateStories && <StateStories states={states} />}

      {/* Customer Reviews */}
      {showReviews && <ReviewsPreview />}

      {/* Newsletter */}
      {showNewsletter && <NewsletterBar />}
    </>
  )
}

// ─── Data fetchers ────────────────────────────────────────────────────────────

async function fetchHeroImages() {
  try {
    const { data } = await supabase
      .from('state_images')
      .select('url, alt_text')
      .order('created_at', { ascending: false })
      .limit(5)
    return data || []
  } catch { return [] }
}

async function fetchCategories() {
  try {
    const { data } = await supabase
      .from('categories')
      .select('id, name, slug, description, image_url, is_active')
      .eq('is_active', true)
      .order('name')
    return data || []
  } catch { return [] }
}

async function fetchStates() {
  try {
    const { data } = await supabase
      .from('states')
      .select('id, name, slug, description, image_url')
      .order('name')
      .limit(12)
    return data || []
  } catch { return [] }
}
