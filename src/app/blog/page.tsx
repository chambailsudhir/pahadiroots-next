import type { Metadata } from 'next'
import { supabase } from '@/lib/supabase'
import { getSiteSettings } from '@/lib/getSiteSettings'
import { notFound } from 'next/navigation'
import type { PostCard } from '@/components/blog/BlogListing'
import BlogListingClient from '@/components/blog/BlogListingClient'
import { BLOG_LISTING_LIMIT } from '@/lib/listingLimits'

const BASE = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.pahadiroots.com'

// BUG FIX: openGraph here had no `images` field. A page's own `openGraph`
// object replaces the layout's entirely (Next.js does not deep-merge it),
// so this page had zero og:image — sharing a blog listing link in
// WhatsApp/Facebook fell back to the site favicon instead of a real image.
// Same fix applied across every route below with its own openGraph block.
export const metadata: Metadata = {
  title:       'Blog',
  description: 'Stories from the mountains — health benefits, recipes, buying guides, and honest sourcing notes on Himalayan honey, ghee, shilajit, saffron, and more.',
  alternates:  { canonical: `${BASE}/blog` },
  openGraph: {
    type: 'website',
    title: 'Blog — HimVeda by Pahadi Roots',
    description: 'Health benefits, recipes, and buying guides for authentic Himalayan natural products.',
    url: `${BASE}/blog`,
    images: [{ url: '/og-default.jpg', width: 1200, height: 630, alt: 'Blog — HimVeda by Pahadi Roots' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Blog — HimVeda by Pahadi Roots',
    description: 'Health benefits, recipes, and buying guides for authentic Himalayan natural products.',
    images: ['/og-default.jpg'],
  },
}

export const revalidate = 3600

// PERF FIX (F-3): this page awaited `searchParams` for the `?category=` chip,
// which made the route dynamic on every request — `revalidate` above did
// nothing and every visit ran both Supabase queries. The Server Component now
// loads the newest posts once (ISR) and BlogListingClient applies the category
// in the browser. Enough rows are loaded that a category view still shows up
// to BLOG_LISTING_LIMIT of ITS newest posts, as the per-category query did.
const POSTS_TO_LOAD = BLOG_LISTING_LIMIT * 4

export default async function BlogPage() {
  const settings = await getSiteSettings()
  if (settings.show_blog === 'false') notFound()

  let posts: PostCard[] | null = null
  let categories: string[] = []
  try {
    const { data } = await supabase
      .from('blog_posts')
      .select('id, title, slug, excerpt, cover_image, published_at, category, reading_time_minutes, author')
      .eq('is_published', true)
      .order('published_at', { ascending: false })
      .limit(POSTS_TO_LOAD)
    posts = data

    const { data: allCats } = await supabase
      .from('blog_posts')
      .select('category')
      .eq('is_published', true)
      .not('category', 'is', null)
    categories = Array.from(new Set((allCats || []).map(c => c.category).filter(Boolean))) as string[]
  } catch { posts = null }

  return <BlogListingClient posts={posts} categories={categories} />
}
