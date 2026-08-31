import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import Image from 'next/image'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { sanitizeHtml } from '@/lib/server/sanitize'
import { PRODUCT_SELECT, normalizeProducts } from '@/lib/normalizeProduct'
import { formatDate, truncate } from '@/lib/utils'
import ProductCard from '@/components/product/ProductCard'
import { ContourLines } from '@/components/brand/BrandMotifs'
import type { Product } from '@/types'

export const revalidate = 86400

const BASE = process.env.NEXT_PUBLIC_SITE_URL || 'https://pahadiroots.com'

interface BlogPostRow {
  id: string
  title: string
  slug: string
  content: string | null
  cover_image: string | null
  og_image: string | null
  published_at: string | null
  updated_at: string | null
  excerpt: string | null
  meta_title: string | null
  meta_description: string | null
  focus_keyword: string | null
  keywords: string[] | null
  canonical_url: string | null
  category: string | null
  tags: string[] | null
  author: string | null
  reading_time_minutes: number | null
  faq: { question: string; answer: string }[] | null
  related_product_id: number | null
  related_product_ids: number[] | null
}

interface Props { params: Promise<{ slug: string }> }

const POST_SELECT = 'id, title, slug, content, cover_image, og_image, published_at, updated_at, excerpt, meta_title, meta_description, focus_keyword, keywords, canonical_url, category, tags, author, reading_time_minutes, faq, related_product_id, related_product_ids'

async function fetchPost(slug: string): Promise<BlogPostRow | null> {
  try {
    const { data } = await supabase
      .from('blog_posts')
      .select(POST_SELECT)
      .eq('slug', slug)
      .eq('is_published', true)
      .single()
    return data as BlogPostRow | null
  } catch (e) {
    console.error('[blog fetchPost] fetch failed:', e)
    return null
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const post = await fetchPost(slug)
  if (!post) return { title: 'Article Not Found' }

  const title = post.meta_title || post.title
  const rawDesc = post.meta_description || post.excerpt || ''
  const description = truncate(rawDesc.replace(/<[^>]+>/g, ''), 155)
  const canonicalUrl = post.canonical_url || `${BASE}/blog/${post.slug}`
  const image = post.og_image || post.cover_image
  const ogImages = image ? [{ url: image, width: 1200, height: 630, alt: post.title }] : []

  return {
    title,
    description,
    keywords: post.keywords && post.keywords.length ? post.keywords.join(', ') : undefined,
    alternates: { canonical: canonicalUrl },
    openGraph: {
      type: 'article',
      title: post.title,
      description,
      url: canonicalUrl,
      images: ogImages,
      publishedTime: post.published_at || undefined,
      modifiedTime: post.updated_at || undefined,
      tags: post.tags || undefined,
    },
    twitter: {
      card: 'summary_large_image',
      title: post.title,
      description,
      images: image ? [image] : undefined,
    },
  }
}

export default async function BlogArticlePage({ params }: Props) {
  const { slug } = await params
  const post = await fetchPost(slug)
  if (!post) notFound()

  const productIds = Array.from(new Set([
    ...(post.related_product_ids || []),
    ...(post.related_product_id ? [post.related_product_id] : []),
  ])).slice(0, 3)

  let relatedProducts: Product[] = []
  if (productIds.length) {
    try {
      const { data } = await supabase
        .from('products')
        .select(PRODUCT_SELECT)
        .in('id', productIds)
        .eq('is_deleted', false)
      if (data) relatedProducts = normalizeProducts(data as any)
    } catch (e) {
      console.error('[blog related products] fetch failed:', e)
    }
  }

  // "More Stories" strip — up to 3 other published posts, most recent
  // first, excluding this one. Gives every article an exit into more
  // content instead of a dead end at the bottom of the page.
  let moreStories: { title: string; slug: string; cover_image: string | null; reading_time_minutes: number | null }[] = []
  try {
    const { data } = await supabase
      .from('blog_posts')
      .select('title, slug, cover_image, reading_time_minutes')
      .eq('is_published', true)
      .neq('id', post.id)
      .order('published_at', { ascending: false })
      .limit(3)
    moreStories = data || []
  } catch (e) {
    console.error('[blog more stories] fetch failed:', e)
  }

  const canonicalUrl = post.canonical_url || `${BASE}/blog/${post.slug}`
  const coverImage = post.cover_image || post.og_image
  const authorName = post.author || 'HimVeda Team'
  const authorInitial = authorName.trim()[0]?.toUpperCase() || 'H'

  const escapeJsonLd = (obj: unknown) =>
    JSON.stringify(obj).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')

  const blogPostingLd: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: post.title,
    description: post.meta_description || post.excerpt || undefined,
    image: coverImage ? [coverImage] : undefined,
    datePublished: post.published_at || undefined,
    dateModified: post.updated_at || post.published_at || undefined,
    author: { '@type': 'Organization', name: authorName },
    publisher: {
      '@type': 'Organization',
      name: 'HimVeda by Pahadi Roots',
      logo: { '@type': 'ImageObject', url: `${BASE}/logo.png` },
    },
    mainEntityOfPage: { '@type': 'WebPage', '@id': canonicalUrl },
    keywords: post.keywords && post.keywords.length ? post.keywords.join(', ') : undefined,
  }

  const breadcrumbLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: `${BASE}/` },
      { '@type': 'ListItem', position: 2, name: 'Blog', item: `${BASE}/blog` },
      { '@type': 'ListItem', position: 3, name: post.title },
    ],
  }

  const faqLd = post.faq && post.faq.length >= 2
    ? {
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: post.faq.map(f => ({
          '@type': 'Question',
          name: f.question,
          acceptedAnswer: { '@type': 'Answer', text: f.answer },
        })),
      }
    : null

  const shareText = encodeURIComponent(post.title)
  const shareUrl = encodeURIComponent(canonicalUrl)

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: escapeJsonLd(blogPostingLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: escapeJsonLd(breadcrumbLd) }} />
      {faqLd && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: escapeJsonLd(faqLd) }} />}

      <article className="bp-wrap">
        {/* ── Masthead ── */}
        <header className="bp-head">
          <div className="bp-breadcrumb">
            <Link href="/">Home</Link><span>/</span><Link href="/blog">Blog</Link>
          </div>
          {post.category && <div className="bp-eyebrow">{post.category.replace(/-/g, ' ')}</div>}
          <h1>{post.title}</h1>
          {post.excerpt && <p className="bp-excerpt">{post.excerpt}</p>}
          <div className="bp-byline">
            <div className="bp-avatar">{authorInitial}</div>
            <div>
              <div className="bp-byline-name">{authorName}</div>
              <div className="bp-byline-meta">
                {post.published_at && formatDate(post.published_at)}
                {post.reading_time_minutes && <> · {post.reading_time_minutes} min read</>}
              </div>
            </div>
          </div>
        </header>

        {/* ── Cover image ── */}
        {coverImage && (
          <div className="bp-cover">
            <Image src={coverImage} alt={post.title} fill sizes="(max-width: 860px) 100vw, 860px" className="object-cover" priority />
          </div>
        )}

        <div className="bp-layout">
          {/* ── Share rail ── */}
          <div className="bp-share">
            <span className="bp-share-label">Share</span>
            <a href={`https://wa.me/?text=${shareText}%20${shareUrl}`} target="_blank" rel="noopener noreferrer" aria-label="Share on WhatsApp" className="bp-share-btn">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347M12.05 21.785h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26C2.167 6.443 6.601 2.01 12.053 2.01c2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884" /></svg>
            </a>
            <a href={`https://twitter.com/intent/tweet?text=${shareText}&url=${shareUrl}`} target="_blank" rel="noopener noreferrer" aria-label="Share on X" className="bp-share-btn">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M18.9 2H22l-7.6 8.7L23.3 22H16.7l-5.2-6.8L5.5 22H2.4l8.2-9.3L1.7 2h6.8l4.7 6.3L18.9 2zm-1.2 18h1.7L7.4 4H5.6l12.1 16z"/></svg>
            </a>
            <a href={`mailto:?subject=${shareText}&body=${shareUrl}`} aria-label="Share by email" className="bp-share-btn">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M4 4h16v16H4z" opacity="0"/><path d="M22 6l-10 7L2 6"/><rect x="2" y="4" width="20" height="16" rx="2"/></svg>
            </a>
          </div>

          {/* ── Content ── */}
          <div className="bp-content">
            {post.content && (
              <div className="bp-prose" dangerouslySetInnerHTML={{ __html: sanitizeHtml(post.content) }} />
            )}

            {post.tags && post.tags.length > 0 && (
              <div className="bp-tags">
                {post.tags.map(tag => <span key={tag} className="bp-tag">#{tag}</span>)}
              </div>
            )}

            {/* ── FAQ ── */}
            {post.faq && post.faq.length > 0 && (
              <section className="bp-faq">
                <h2>Frequently Asked Questions</h2>
                <div className="bp-faq-list">
                  {post.faq.map((f, i) => (
                    <div key={i} className="bp-faq-card">
                      <h3>{f.question}</h3>
                      <p>{f.answer}</p>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* ── Related products ── */}
            {relatedProducts.length > 0 && (
              <section className="bp-products">
                <h2>{relatedProducts.length > 1 ? 'Featured in this story' : 'Featured Product'}</h2>
                <div className={relatedProducts.length > 1 ? 'bp-products-grid' : 'bp-products-single'}>
                  {relatedProducts.map(p => <ProductCard key={p.id} product={p} />)}
                </div>
              </section>
            )}
          </div>
        </div>

        {/* ── More stories ── */}
        {moreStories.length > 0 && (
          <section className="bp-more">
            <ContourLines className="bp-more-contours" />
            <div className="bp-more-inner">
              <h2>More Stories</h2>
              <div className="bp-more-grid">
                {moreStories.map(s => (
                  <Link key={s.slug} href={`/blog/${s.slug}`} className="bp-more-card">
                    <div className="bp-more-img">
                      {s.cover_image ? (
                        <Image src={s.cover_image} alt={s.title} fill sizes="280px" className="object-cover" />
                      ) : (
                        <div className="bp-more-fallback">🏔️</div>
                      )}
                    </div>
                    <div className="bp-more-title">{s.title}</div>
                    {s.reading_time_minutes && <div className="bp-more-meta">{s.reading_time_minutes} min read</div>}
                  </Link>
                ))}
              </div>
              <Link href="/blog" className="bp-more-all">Browse all stories →</Link>
            </div>
          </section>
        )}
      </article>
    </>
  )
}

export async function generateStaticParams() {
  let data = null
  try { const r = await supabase.from('blog_posts').select('slug').eq('is_published', true); data = r.data } catch (e) { console.error('[blog generateStaticParams] fetch failed:', e) }
  return (data || []).map(p => ({ slug: p.slug }))
}
