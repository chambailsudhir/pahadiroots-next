import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { sanitizeHtml } from '@/lib/server/sanitize'
import { toCardProductData } from '@/lib/normalizeProduct'
import { getNormalizedProducts } from '@/lib/storeData'
import { truncate } from '@/lib/utils'
import BlogArticle from '@/components/blog/BlogArticle'
import { addHeadingIds } from '@/lib/blogToc'
import type { Product } from '@/types'

export const revalidate = 86400

const BASE = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.pahadiroots.com'

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
  // BUG FIX: fell back to `[]` (no image at all) when a post has neither
  // og_image nor cover_image set — same class of bug as page.tsx/collections/
  // products, causing a broken WhatsApp/Facebook share preview for any post
  // without a photo. Falls back to the real logo instead.
  const image = post.og_image || post.cover_image || '/og-default.jpg'
  const ogImages = [{ url: image, width: 1200, height: 630, alt: post.title }]

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
      images: [image],
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

  // BUG FIX (Oct 2026 audit follow-up): this used to query `products` with the
  // anon client and PRODUCT_SELECT, which (1) selected `cost_price` — a margin
  // figure storeData deliberately strips — and handed it to the client-side
  // ProductCard, so it was serialized into the page payload; (2) had no
  // status='active' filter, so a draft/archived product linked from a post
  // still rendered; and (3) skipped product_images, so the card image could
  // differ from Browse. It now picks from the same server-normalized,
  // active-only catalogue every listing page uses (cost_price already null).
  let relatedProducts: Product[] = []
  if (productIds.length) {
    try {
      const wanted = new Set(productIds.map(String))
      const all = await getNormalizedProducts()
      relatedProducts = all
        .filter(p => wanted.has(String(p.id)))
        .map(toCardProductData)
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

  const { html: bodyHtml, toc } = addHeadingIds(post.content ? sanitizeHtml(post.content) : '')

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: escapeJsonLd(blogPostingLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: escapeJsonLd(breadcrumbLd) }} />
      {faqLd && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: escapeJsonLd(faqLd) }} />}
      <BlogArticle
        post={post}
        html={bodyHtml}
        toc={toc}
        coverImage={coverImage}
        canonicalUrl={canonicalUrl}
        relatedProducts={relatedProducts}
        moreStories={moreStories}
      />
    </>
  )
}

export async function generateStaticParams() {
  let data = null
  try { const r = await supabase.from('blog_posts').select('slug').eq('is_published', true); data = r.data } catch (e) { console.error('[blog generateStaticParams] fetch failed:', e) }
  return (data || []).map(p => ({ slug: p.slug }))
}
