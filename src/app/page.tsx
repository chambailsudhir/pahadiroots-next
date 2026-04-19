import type { Metadata } from 'next'
import { getSiteSettings, isEnabled } from '@/lib/getSiteSettings'
import { supabase } from '@/lib/supabase'
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
  title: '5 Pahadi Roots — Pure Himalayan Natural Products',
  description: 'Shop authentic Himalayan natural products — wild honey, A2 ghee, Kashmiri saffron, Ladakhi shilajit & more. Sourced directly from mountain farmers. Free shipping above ₹799.',
}

export const revalidate = 300

export default async function HomePage() {
  const settings = await getSiteSettings()
  const [heroImages, categories, states] = await Promise.all([
    fetchHeroImages(settings),
    fetchCategories(),
    fetchStates(),
  ])

  const showTrustBar     = isEnabled(settings.show_trust_bar)
  const showBestSellers  = isEnabled(settings.show_best_sellers)
  const showNewArrivals  = isEnabled(settings.show_new_arrivals)
  const showStateStories = isEnabled(settings.show_state_stories)
  const showReviews      = isEnabled(settings.show_reviews_section)
  const showNewsletter   = isEnabled(settings.show_newsletter_bar)
  const featuredSlug     = settings.featured_collection_slug?.trim()

  return (
    <>
      {/* 1. Hero slider */}
      <HeroBanner images={heroImages} settings={settings} />

      {/* 2. Trust bar */}
      {showTrustBar && <TrustBar settings={settings} />}

      {/* 3. Browse Collections — "What the Mountains Offer" */}
      <CategoryTiles categories={categories} />

      {/* 4. Bestsellers — "Our Finest Offerings" with filters + sort */}
      <BestSellers />

      {/* 5. New Arrivals */}
      {showNewArrivals && <NewArrivals />}

      {/* 6. Featured collection banner (if set in admin) */}
      {featuredSlug && <FeaturedBanner slug={featuredSlug} />}

      {/* 7. Explore by Region — "Discover the Himalayas" — always show if states exist */}
      {states.length > 0 && <ExploreByRegion states={states} />}

      {/* 8. Why 5 Pahadi Roots — "Our Promise" */}
      <WhySection />

      {/* 9. Reviews — "What Our Community Says" */}
      {showReviews && <ReviewsPreview />}

      {/* 10. Newsletter */}
      {showNewsletter && <NewsletterBar />}
    </>
  )
}

async function fetchHeroImages(settings: any) {
  const slides: any[] = []
  for (let i = 1; i <= 5; i++) {
    const img = settings[`hero_slide_${i}_img`]
    if (img) {
      slides.push({
        url:      img,
        alt_text: settings[`hero_slide_${i}_title`] || 'Pahadi Roots',
        title:    settings[`hero_slide_${i}_title`] || '',
        subtitle: settings[`hero_slide_${i}_sub`]   || '',
      })
    }
  }
  if (slides.length === 0 && settings.hero_bg_image) {
    slides.push({ url: settings.hero_bg_image, alt_text: 'Pahadi Roots', title: '', subtitle: '' })
  }
  return slides
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

async function fetchStates(): Promise<RichState[]> {
  // DB-verified schema (confirmed from Supabase table editor screenshot):
  // states: id(text), created_at, name(text), description(text), image_path(text), is_active(bool), updated_at
  // state_images: state_id, image_url, sort_order
  // products.state_id references states.id
  try {
    const { data: statesData, error } = await supabase
      .from('states')
      .select('id, name, description, image_path, is_active')
      .eq('is_active', true)
      .order('name')
      .limit(15)

    if (error || !statesData?.length) {
      console.error('fetchStates: states query error', error)
      return []
    }

    const stateIds = statesData.map(s => s.id)

    // Fetch per-state gallery images (state_images table)
    const { data: stateImagesData } = await supabase
      .from('state_images')
      .select('state_id, image_url, sort_order')
      .in('state_id', stateIds)
      .order('sort_order')

    // Fetch products belonging to these states
    const { data: productsData } = await supabase
      .from('products')
      .select(`
        id, name, slug, emoji, price, mrp, available_stock, gst_rate,
        image_url, unit_label, badges_bestseller, badges_new, badges_organic,
        category_id, state_id, is_deleted, status,
        categories:categories(id, name, slug),
        product_variants(id, price, mrp, size, available_stock, is_active)
      `)
      .eq('is_deleted', false)
      .eq('status', 'active')
      .in('state_id', stateIds)
      .limit(60)

    const products = (productsData ?? []) as unknown as (Product & { state_id: string })[]
    const stateImages = (stateImagesData ?? []) as { state_id: string; image_url: string; sort_order: number }[]

    return statesData.map(s => {
      // Get first gallery image, fall back to image_path on states row
      const galleryImages = stateImages.filter(img => String(img.state_id) === String(s.id))
      const primaryImage = galleryImages[0]?.image_url ?? s.image_path ?? null

      return {
        id: s.id,
        name: s.name,
        slug: s.id,              // id IS the slug (e.g. "hp", "uk", "jk")
        description: s.description ?? null,
        image_url: primaryImage, // first gallery image or image_path fallback
        region: null,
        products: products.filter(p => String(p.state_id) === String(s.id)).slice(0, 4),
      }
    }) as unknown as RichState[]
  } catch (e) {
    console.error('fetchStates error:', e)
    return []
  }
}
