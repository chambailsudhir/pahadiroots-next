import type { Metadata } from 'next'
import { getSiteSettings, isEnabled } from '@/lib/getSiteSettings'
import { supabase } from '@/lib/supabase'
import { normalizeProducts, applyProductImages } from '@/lib/normalizeProduct'
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

export const revalidate = 60

export default async function HomePage() {
  const settings = await getSiteSettings()

  // ── Fetch everything from store-data API (uses SERVICE KEY — bypasses RLS)
  // This is exactly how old pahadiroots.com api/store-data.js works
  const storeData = await fetchStoreData()

  const categories = buildCategories(storeData.categories, storeData.settings)
  const heroImages = fetchHeroImages(settings)
  const states     = buildStates(storeData)

  const showTrustBar     = isEnabled(settings.show_trust_bar)
  const showNewArrivals  = isEnabled(settings.show_new_arrivals)
  const showReviews      = isEnabled(settings.show_reviews_section)
  const showNewsletter   = isEnabled(settings.show_newsletter_bar)
  const featuredSlug     = settings.featured_collection_slug?.trim()

  return (
    <>
      <HeroBanner images={heroImages} settings={settings} />
      {showTrustBar && <TrustBar settings={settings} />}
      <CategoryTiles categories={categories} />
      <BestSellers />
      {showNewArrivals && <NewArrivals />}
      {featuredSlug && <FeaturedBanner slug={featuredSlug} />}
      {states.length > 0 && <ExploreByRegion states={states} />}
      <WhySection />
      {showReviews && <ReviewsPreview />}
      {showNewsletter && <NewsletterBar />}
    </>
  )
}

// ── Fetch from our store-data API route (SERVICE KEY, bypasses RLS) ──────────
async function fetchStoreData() {
  try {
    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : 'http://localhost:3000'
    const res = await fetch(`${baseUrl}/api/v1/store-data`, {
      next: { revalidate: 60 },
    })
    if (!res.ok) throw new Error(`store-data: ${res.status}`)
    return await res.json()
  } catch (e) {
    console.error('fetchStoreData error:', e)
    return { products: [], product_images: [], product_variants: [], categories: [], settings: {}, states: [], state_images: [] }
  }
}

// ── Hero images from site_settings ───────────────────────────────────────────
function fetchHeroImages(settings: any) {
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

// ── Categories with images from site_settings (coll_img_{slug}) ──────────────
// Old site main.js imgFor() function: tries coll_img_{slug}, coll_img_{name},
// coll_img_{name.toLowerCase()}, coll_img_{id}, then falls back to cat.image_url
function buildCategories(cats: any[], settings: Record<string, string>) {
  if (!cats?.length) return []
  return cats
    .filter(c => settings[`coll_hidden_${c.slug || c.id}`] !== 'true')
    .sort((a, b) => (a.sort_order ?? 99) - (b.sort_order ?? 99) || a.name.localeCompare(b.name))
    .map(c => {
      const keysToTry = [
        c.slug,
        c.name,
        (c.name || '').toLowerCase(),
        String(c.id),
      ].filter(Boolean)
      let imgUrl = c.image_url || null
      for (const k of keysToTry) {
        const v = (settings[`coll_img_${k}`] || '').trim()
        if (v) { imgUrl = v; break }
      }
      return { ...c, image_url: imgUrl }
    })
}

// ── States with products (images applied from product_images) ─────────────────
function buildStates(storeData: any): RichState[] {
  const { states = [], state_images = [], products = [], product_images = [] } = storeData
  if (!states?.length) return []

  // Apply product_images exactly as old site does
  const productsWithImages = applyProductImages(products, product_images)
  const normalized = normalizeProducts(productsWithImages) as (Product & { state_id: string })[]

  return states.map((s: any) => {
    const imgs = (state_images as any[])
      .filter(i => String(i.state_id) === String(s.id))
      .sort((a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    const primaryImg = imgs[0]?.image_url ?? s.image_path ?? null
    const stateProds = normalized.filter(p => String(p.state_id) === String(s.id)).slice(0, 4)
    return {
      id:          s.id,
      name:        s.name,
      slug:        s.id,
      description: s.description ?? null,
      image_url:   primaryImg,
      region:      null,
      products:    stateProds,
    }
  }) as unknown as RichState[]
}
