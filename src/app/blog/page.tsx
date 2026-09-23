import type { Metadata } from 'next'
import Link from 'next/link'
import Image from 'next/image'
import { supabase } from '@/lib/supabase'
import { getSiteSettings } from '@/lib/getSiteSettings'
import { notFound } from 'next/navigation'
import { formatDate } from '@/lib/utils'
import { ContourLines, MountainMark } from '@/components/brand/BrandMotifs'

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

interface PostCard {
  id: string
  title: string
  slug: string
  excerpt: string | null
  cover_image: string | null
  published_at: string | null
  category: string | null
  reading_time_minutes: number | null
  author: string | null
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

  // The most recent post (only when browsing "All", not a filtered
  // category — a featured slot inside a filtered view would misrepresent
  // what the filter actually returned) gets the large hero treatment;
  // everything else goes in the grid below.
  const featured = !category && posts && posts.length > 0 ? posts[0] : null
  const rest = featured ? posts!.slice(1) : (posts || [])

  return (
    <div>
      {/* ── Hero ── */}
      <div className="bl-hero">
        <ContourLines className="bl-hero-contours" />
        <div className="bl-hero-inner">
          <div className="bl-eyebrow">
            <MountainMark /> From the Source
          </div>
          <h1>Stories from the <em>Mountains</em></h1>
          <p className="bl-hero-sub">Health benefits, recipes, and buying guides — written by the people who source it.</p>
        </div>
      </div>

      <div className="bl-body">
        {/* ── Category pills ── */}
        {categories.length > 0 && (
          <div className="bl-pills">
            <Link href="/blog" className={`bl-pill${!category ? ' active' : ''}`}>All Stories</Link>
            {categories.map(c => (
              <Link key={c} href={`/blog?category=${encodeURIComponent(c)}`} className={`bl-pill${category === c ? ' active' : ''}`}>
                {c.replace(/-/g, ' ')}
              </Link>
            ))}
          </div>
        )}

        {!posts || posts.length === 0 ? (
          <div className="bl-empty">
            <div className="bl-empty-icon">🖋️</div>
            <h2>Stories coming soon</h2>
            <p>We&apos;re writing about the mountains. Check back soon.</p>
          </div>
        ) : (
          <>
            {/* ── Featured post ── */}
            {featured && (
              <Link href={`/blog/${featured.slug}`} className="bl-featured">
                <div className="bl-featured-img">
                  {featured.cover_image ? (
                    <Image src={featured.cover_image} alt={featured.title} fill sizes="(max-width: 900px) 100vw, 1100px" className="object-cover" priority />
                  ) : (
                    <div className="bl-featured-fallback"><ContourLines className="bl-fallback-contours" /><MountainMark /></div>
                  )}
                </div>
                <div className="bl-featured-copy">
                  <div className="bl-featured-eyebrow">
                    Latest Story
                    {featured.category && <><span aria-hidden>·</span>{featured.category.replace(/-/g, ' ')}</>}
                  </div>
                  <h2>{featured.title}</h2>
                  {featured.excerpt && <p>{featured.excerpt}</p>}
                  <div className="bl-featured-meta">
                    {featured.published_at && <span>{formatDate(featured.published_at)}</span>}
                    {featured.reading_time_minutes && <><span aria-hidden>·</span><span>{featured.reading_time_minutes} min read</span></>}
                  </div>
                </div>
              </Link>
            )}

            {/* ── Grid ── */}
            {rest.length > 0 && (
              <div className="bl-grid">
                {rest.map(post => (
                  <Link key={post.id} href={`/blog/${post.slug}`} className="bl-card">
                    <div className="bl-card-img">
                      {post.cover_image ? (
                        <Image src={post.cover_image} alt={post.title} fill sizes="(max-width: 640px) 100vw, 33vw" className="object-cover" />
                      ) : (
                        <div className="bl-card-fallback"><ContourLines className="bl-fallback-contours" /><MountainMark /></div>
                      )}
                    </div>
                    <div className="bl-card-body">
                      <div className="bl-card-meta">
                        {post.published_at && <span>{formatDate(post.published_at)}</span>}
                        {post.reading_time_minutes && <><span aria-hidden>·</span><span>{post.reading_time_minutes} min</span></>}
                      </div>
                      <h3>{post.title}</h3>
                      {post.excerpt && <p>{post.excerpt}</p>}
                      <span className="bl-card-cta">Read the story →</span>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
