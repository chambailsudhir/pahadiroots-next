import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import Image from 'next/image'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { PRODUCT_SELECT, normalizeProducts } from '@/lib/normalizeProduct'
import { formatDate } from '@/lib/utils'
import ProductCard from '@/components/product/ProductCard'
import type { Product } from '@/types'

export const revalidate = 86400

interface Props { params: { slug: string } }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  let post = null
  try { const { data } = await supabase.from('blog_posts').select('title, excerpt').eq('slug', params.slug).single(); post = data } catch {}
  if (!post) return { title: 'Article Not Found' }
  return { title: post.title, description: post.excerpt || '' }
}

export default async function BlogArticlePage({ params }: Props) {
  let post = null
  try {
    const { data } = await supabase
      .from('blog_posts')
      .select('id, title, slug, content, cover_image, published_at, excerpt, related_product_id')
      .eq('slug', params.slug)
      .eq('is_published', true)
      .single()
    post = data
  } catch { post = null }

  if (!post) notFound()

  // Related product
  let relatedProduct: Product | null = null
  if (post.related_product_id) {
    try {
      const { data } = await supabase
        .from('products')
        .select(`id, name, slug, emoji, price, mrp, available_stock, gst_rate, image_url, unit_label, badges, category_id, is_deleted, status, categories:categories(id,name,slug), product_variants(id,price,mrp,variant_value,available_stock,is_active)`)
        .eq('id', post.related_product_id)
        .single()
      relatedProduct = data as Product | null
    } catch { relatedProduct = null }
  }

  return (
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
        {post.published_at && (
          <p className="text-xs text-stone-400 mb-3">{formatDate(post.published_at)}</p>
        )}
        <h1 className="text-2xl sm:text-3xl font-bold text-stone-900 mb-4 leading-tight">{post.title}</h1>
        {post.excerpt && <p className="text-stone-500 leading-relaxed">{post.excerpt}</p>}
      </header>

      {/* Cover image */}
      {post.cover_image && (
        <div className="relative aspect-[16/9] rounded-2xl overflow-hidden mb-8">
          <Image src={post.cover_image} alt={post.title} fill sizes="(max-width: 768px) 100vw, 768px" className="object-cover" priority />
        </div>
      )}

      {/* Content */}
      {post.content && (
        <div
          className="prose prose-stone prose-sm max-w-none text-stone-700 leading-relaxed mb-10"
          dangerouslySetInnerHTML={{ __html: post.content }}
        />
      )}

      {/* Related product */}
      {relatedProduct && (
        <div className="border-t border-stone-100 pt-8">
          <h2 className="text-base font-bold text-stone-900 mb-4">Featured Product</h2>
          <div className="max-w-xs">
            <ProductCard product={relatedProduct} />
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
  )
}

export async function generateStaticParams() {
  let data = null
  try { const r = await supabase.from('blog_posts').select('slug').eq('is_published', true); data = r.data } catch {}
  return (data || []).map(p => ({ slug: p.slug }))
}
