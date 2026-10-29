import type { Metadata } from 'next'
import { supabase } from '@/lib/supabase'
import { getSiteSettings } from '@/lib/getSiteSettings'
import { notFound } from 'next/navigation'
import BlogListing, { type PostCard } from '@/components/blog/BlogListing'

const BASE = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.pahadiroots.com'

// BUG FIX: openGraph here had no `images` field. A page's own `openGraph`
// object replaces the layout's entirely (Next.js does not deep-merge it),
// so this page had zero og:image — sharing a blog listing link in
// WhatsApp/Facebook fell back to the site favicon instead of a real image.
// Same fix applied across every route below with its own openGraph block.
export const metadata: Metadata = {
  title:       'Blog — HimVeda by Pahadi Roots',
  description: 'Stories from the mountains — health benefits, recipes, buying guides, and honest sourcing notes on Himalayan honey, ghee, shilajit, saffron, and more.',
  alternates:  { canonical: `${BASE}/blog` },
  openGraph: {
    type: 'website',
    title: 'Blog — HimVeda by Pahadi Roots',
    description: 'Health benefits, recipes, and buying guides for authentic Himalayan natural products.',
    url: `${BASE}/blog`,
    images: [{ url: '/logo.png', width: 1200, height: 630, alt: 'Blog — HimVeda by Pahadi Roots' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Blog — HimVeda by Pahadi Roots',
    description: 'Health benefits, recipes, and buying guides for authentic Himalayan natural products.',
    images: ['/logo.png'],
  },
}

export const revalidate = 3600

export default async function BlogPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string }>
}) {
  const settings = await getSiteSettings()
  if (settings.show_blog === 'false') notFound()

  const { category } = await searchParams

  let posts: PostCard[] | null = null
  let categories: string[] = []
  try {
    let query = supabase
      .from('blog_posts')
      .select('id, title, slug, excerpt, cover_image, published_at, category, reading_time_minutes, author')
      .eq('is_published', true)
      .order('published_at', { ascending: false })
      .limit(30)
    if (category) query = query.eq('category', category)
    const { data } = await query
    posts = data

    const { data: allCats } = await supabase
      .from('blog_posts')
      .select('category')
      .eq('is_published', true)
      .not('category', 'is', null)
    categories = Array.from(new Set((allCats || []).map(c => c.category).filter(Boolean))) as string[]
  } catch { posts = null }

  return <BlogListing posts={posts} categories={categories} category={category} />
}
