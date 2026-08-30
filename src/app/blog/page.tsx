import type { Metadata } from 'next'
import Link from 'next/link'
import Image from 'next/image'
import { supabase } from '@/lib/supabase'
import { getSiteSettings } from '@/lib/getSiteSettings'
import { notFound } from 'next/navigation'
import { formatDate } from '@/lib/utils'

const BASE = process.env.NEXT_PUBLIC_SITE_URL || 'https://pahadiroots.com'

export const metadata: Metadata = {
  title:       'Blog — HimVeda by Pahadi Roots',
  description: 'Stories from the mountains — health benefits, recipes, buying guides, and honest sourcing notes on Himalayan honey, ghee, shilajit, saffron, and more.',
  alternates:  { canonical: `${BASE}/blog` },
  openGraph: {
    type: 'website',
    title: 'Blog — HimVeda by Pahadi Roots',
    description: 'Health benefits, recipes, and buying guides for authentic Himalayan natural products.',
    url: `${BASE}/blog`,
  },
}

export const revalidate = 3600

interface PostCard {
  id: string
  title: string
  slug: string
  excerpt: string | null
  cover_image: string | null
  published_at: string | null
  category: string | null
  reading_time_minutes: number | null
}

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
      .select('id, title, slug, excerpt, cover_image, published_at, category, reading_time_minutes')
      .eq('is_published', true)
      .order('published_at', { ascending: false })
      .limit(30)
    if (category) query = query.eq('category', category)
    const { data } = await query
    posts = data

    // Category pills — pulled from all published posts, not just the
    // filtered set, so switching filters doesn't hide the other options.
    const { data: allCats } = await supabase
      .from('blog_posts')
      .select('category')
      .eq('is_published', true)
      .not('category', 'is', null)
    categories = Array.from(new Set((allCats || []).map(c => c.category).filter(Boolean))) as string[]
  } catch { posts = null }

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
      <div className="text-center mb-10">
        <h1 className="text-3xl font-bold text-stone-900 mb-2">Stories from the Mountains</h1>
        <p className="text-stone-500 text-sm max-w-md mx-auto">Health benefits, recipes, and buying guides — straight from the source.</p>
      </div>

      {categories.length > 0 && (
        <div className="flex flex-wrap justify-center gap-2 mb-8">
          <Link
            href="/blog"
            className={`text-xs font-semibold rounded-full px-4 py-1.5 border transition-colors ${!category ? 'bg-forest-700 text-white border-forest-700' : 'bg-white text-stone-500 border-stone-200 hover:border-forest-300'}`}
          >
            All
          </Link>
          {categories.map(c => (
            <Link
              key={c}
              href={`/blog?category=${encodeURIComponent(c)}`}
              className={`text-xs font-semibold rounded-full px-4 py-1.5 border capitalize transition-colors ${category === c ? 'bg-forest-700 text-white border-forest-700' : 'bg-white text-stone-500 border-stone-200 hover:border-forest-300'}`}
            >
              {c.replace(/-/g, ' ')}
            </Link>
          ))}
        </div>
      )}

      {!posts || posts.length === 0 ? (
        <div className="text-center py-20">
          <div className="text-4xl mb-4">✍️</div>
          <h2 className="text-lg font-semibold text-stone-700 mb-2">Stories coming soon</h2>
          <p className="text-stone-400 text-sm">We&apos;re writing about the mountains. Check back soon!</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {posts.map(post => (
            <Link
              key={post.id}
              href={`/blog/${post.slug}`}
              className="group flex flex-col bg-white border border-stone-100 rounded-2xl overflow-hidden hover:shadow-lg transition-all"
            >
              <div className="relative aspect-[16/9] bg-stone-50">
                {post.cover_image ? (
                  <Image src={post.cover_image} alt={post.title} fill sizes="(max-width: 640px) 100vw, 33vw" className="object-cover group-hover:scale-105 transition-transform duration-300" />
                ) : (
                  <div className="absolute inset-0 bg-gradient-to-br from-forest-100 to-earth-100 flex items-center justify-center text-4xl">🏔️</div>
                )}
              </div>
              <div className="p-4 flex flex-col flex-1">
                <div className="flex items-center gap-2 text-xs text-stone-400 mb-1">
                  <span>{post.published_at ? formatDate(post.published_at) : ''}</span>
                  {post.reading_time_minutes && (
                    <>
                      <span aria-hidden>·</span>
                      <span>{post.reading_time_minutes} min read</span>
                    </>
                  )}
                </div>
                <h2 className="text-sm font-bold text-stone-900 mb-2 line-clamp-2 group-hover:text-forest-700 transition-colors">{post.title}</h2>
                {post.excerpt && <p className="text-xs text-stone-500 line-clamp-2 leading-relaxed flex-1">{post.excerpt}</p>}
                <span className="mt-3 text-xs font-semibold text-forest-700 group-hover:text-forest-900">Read more →</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
