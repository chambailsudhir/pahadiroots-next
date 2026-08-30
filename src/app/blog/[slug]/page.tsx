import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import Image from 'next/image'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { sanitizeHtml } from '@/lib/server/sanitize'
import { PRODUCT_SELECT, normalizeProducts } from '@/lib/normalizeProduct'
import { formatDate, truncate } from '@/lib/utils'
import ProductCard from '@/components/product/ProductCard'
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

// BUG FIX (Next.js 15+/16 migration): `params` is now a Promise.
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

  // Related products — supports the new multi-product array while staying
  // backward compatible with the original single related_product_id column.
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

  const canonicalUrl = post.canonical_url || `${BASE}/blog/${post.slug}`
  const coverImage = post.cover_image || post.og_image

  // ── JSON-LD: BlogPosting ─────────────────────────────────────────────────
  // Same XSS-safe escaping pattern used on the PDP's Product JSON-LD:
  // JSON.stringify does not escape < / > / & so a title containing
  // "</script>" could break out of the script tag — escape to \uXXXX
  // sequences, which are valid JSON and safe inside <script>.
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
    author: { '@type': 'Organization', name: post.author || 'HimVeda Team' },
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

  // FAQPage schema is a genuine rich-result eligibility win in Google Search
  // when the on-page FAQ block matches what's marked up here — only emit it
  // when real Q&A content exists.
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

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: escapeJsonLd(blogPostingLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: escapeJsonLd(breadcrumbLd) }} />
      {faqLd && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: escapeJsonLd(faqLd) }} />}

      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        {/* Breadcrumb */}
        <div className="flex items-center gap-1 text-xs text-stone-400 mb-6">
          <Link href="/" className="hover:text-forest-700">Home</Link>
          <span>/</span>
          <Link href="/blog" className="hover:text-forest-700">Blog</Link>
          <span>/</span>
          <span className="text-stone-600 line-clamp-1">{post.title}</span>
        </div>

        {/* Header */}
        <header className="mb-8">
          <div className="flex items-center gap-3 text-xs text-stone-400 mb-3">
            {post.published_at && <span>{formatDate(post.published_at)}</span>}
            {post.reading_time_minutes && (
              <>
                <span aria-hidden>·</span>
                <span>{post.reading_time_minutes} min read</span>
              </>
            )}
            {post.category && (
              <>
                <span aria-hidden>·</span>
                <span className="uppercase tracking-wide text-forest-700 font-semibold">{post.category.replace(/-/g, ' ')}</span>
              </>
            )}
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-stone-900 mb-4 leading-tight">{post.title}</h1>
          {post.excerpt && <p className="text-stone-500 leading-relaxed">{post.excerpt}</p>}
        </header>

        {/* Cover image */}
        {coverImage && (
          <div className="relative aspect-[16/9] rounded-2xl overflow-hidden mb-8">
            <Image src={coverImage} alt={post.title} fill sizes="(max-width: 768px) 100vw, 768px" className="object-cover" priority />
          </div>
        )}

        {/* Content */}
        {/* BUG FIX (found via manual audit): post.content was rendered raw via
            dangerouslySetInnerHTML with zero sanitization — a real stored-XSS
            risk if blog content is ever compromised or a rich-text editor
            allows raw HTML through. Sanitized with the same server-safe
            utility already used for the PDP's AI content fields. */}
        {post.content && (
          <div
            className="prose prose-stone prose-sm max-w-none text-stone-700 leading-relaxed mb-10"
            dangerouslySetInnerHTML={{ __html: sanitizeHtml(post.content) }}
          />
        )}

        {/* Tags */}
        {post.tags && post.tags.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-10">
            {post.tags.map(tag => (
              <span key={tag} className="text-xs bg-stone-50 border border-stone-100 text-stone-500 rounded-full px-3 py-1">#{tag}</span>
            ))}
          </div>
        )}

        {/* FAQ (mirrors the FAQPage JSON-LD above — kept visually in sync) */}
        {post.faq && post.faq.length > 0 && (
          <div className="border-t border-stone-100 pt-8 mb-10">
            <h2 className="text-base font-bold text-stone-900 mb-4">Frequently Asked Questions</h2>
            <div className="space-y-4">
              {post.faq.map((f, i) => (
                <div key={i}>
                  <h3 className="text-sm font-semibold text-stone-800 mb-1">{f.question}</h3>
                  <p className="text-sm text-stone-500 leading-relaxed">{f.answer}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Related products */}
        {relatedProducts.length > 0 && (
          <div className="border-t border-stone-100 pt-8">
            <h2 className="text-base font-bold text-stone-900 mb-4">
              {relatedProducts.length > 1 ? 'Featured Products' : 'Featured Product'}
            </h2>
            <div className={relatedProducts.length > 1 ? 'grid grid-cols-2 sm:grid-cols-3 gap-4' : 'max-w-xs'}>
              {relatedProducts.map(p => <ProductCard key={p.id} product={p} />)}
            </div>
          </div>
        )}

        {/* Back */}
        <div className="border-t border-stone-100 pt-6 mt-8">
          <Link href="/blog" className="text-sm text-forest-700 font-semibold hover:underline">
            ← Back to Blog
          </Link>
        </div>
      </div>
    </>
  )
}

export async function generateStaticParams() {
  let data = null
  try { const r = await supabase.from('blog_posts').select('slug').eq('is_published', true); data = r.data } catch (e) { console.error('[blog generateStaticParams] fetch failed:', e) }
  return (data || []).map(p => ({ slug: p.slug }))
}
