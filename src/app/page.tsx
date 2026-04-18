import type { Metadata } from 'next'
import { getSiteSettings, isEnabled } from '@/lib/getSiteSettings'
import { supabase } from '@/lib/supabase'
import HeroBanner from '@/components/homepage/HeroBanner'
import TrustBar from '@/components/homepage/TrustBar'
import CategoryTiles from '@/components/homepage/CategoryTiles'
import BestSellers from '@/components/homepage/BestSellers'
import StateStories from '@/components/homepage/StateStories'
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

      {/* 4. Bestsellers — "Our Finest Offerings" */}
      {showBestSellers && <BestSellers />}

      {/* 5. New Arrivals */}
      {showNewArrivals && <NewArrivals />}

      {/* 6. Featured collection banner (if set in admin) */}
      {featuredSlug && <FeaturedBanner slug={featuredSlug} />}

      {/* 7. Explore by Region — "Discover the Himalayas" */}
      {showStateStories && <StateStories states={states} />}

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

async function fetchStates() {
  try {
    const { data } = await supabase
      .from('states')
      .select('id, name, slug, description, image_url, region')
      .order('name')
      .limit(12)
    return data || []
  } catch { return [] }
}
