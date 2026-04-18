import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { getSiteSettings } from '@/lib/getSiteSettings'
import ProductCard from '@/components/product/ProductCard'
import type { Product, Category } from '@/types'
import Image from 'next/image'
import Link from 'next/link'

export const revalidate = 7200 // 2hr ISR

interface Props {
  params:       { slug: string }
  searchParams: { sort?: string; page?: string; instock?: string }
}

const PAGE_SIZE = 24

const SORT_OPTIONS = [
  { value: 'newest',     label: 'Newest' },
  { value: 'price_asc',  label: 'Price ↑' },
  { value: 'price_desc', label: 'Price ↓' },
  { value: 'popular',    label: 'Best Sellers' },
]

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const cat = await fetchCategory(params.slug)
  if (!cat) return { title: 'Collection Not Found' }
  return {
    title:       `${cat.name} — Himalayan ${cat.name}`,
    description: cat.description || `Shop premium natural ${cat.name} sourced directly from the Himalayas.`,
    openGraph: {
      title:  `${cat.name} | Pahadi Roots`,
      images: cat.image_url ? [{ url: cat.image_url }] : [],
    },
  }
}

export default async function CollectionPage({ params, searchParams }: Props) {
  const [cat, settings] = await Promise.all([
    fetchCategory(params.slug),
    getSiteSettings(),
  ])

  if (!cat) notFound()
  if (settings.catalogue_visible === 'false') {
    return <div className="min-h-[60vh] flex items-center justify-center"><p className="text-stone-400">Catalogue coming soon.</p></div>
  }

  const sort    = searchParams.sort    || 'newest'
  const page    = Math.max(1, parseInt(searchParams.page || '1'))
  const instock = searchParams.instock === 'true'
  const offset  = (page - 1) * PAGE_SIZE

  let query = supabase
    .from('products')
    .select(`
      id, name, slug, emoji, price, mrp, selling, available_stock, gst_rate,
      image_url, unit_label, badges_bestseller, badges_new, badges_organic,
      category_id, is_deleted, status,
      categories:categories(id, name, slug),
      product_variants(id, price, mrp, size, available_stock, is_active)
    `, { count: 'exact' })
    .eq('category_id', cat.id)
    .eq('is_deleted', false)
    .eq('status', 'active')
    .range(offset, offset + PAGE_SIZE - 1)

  if (instock) query = query.gt('available_stock', 0)

  switch (sort) {
    case 'price_asc':  query = query.order('price', { ascending: true });   break
    case 'price_desc': query = query.order('price', { ascending: false });  break
    case 'popular':    query = query.eq('badges_bestseller', true);         break
    default:           query = query.order('created_at', { ascending: false })
  }

  const { data, count } = await query
  const products   = (data as unknown as Product[]) || []
  const totalPages = Math.ceil((count || 0) / PAGE_SIZE)

  // Build breadcrumb JSON-LD
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type':    'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home',     item: 'https://pahadiroots.com' },
      { '@type': 'ListItem', position: 2, name: cat.name,   item: `https://pahadiroots.com/collections/${cat.slug}` },
    ],
  }

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      {/* Category hero */}
      <div className="relative h-48 sm:h-64 bg-forest-900 overflow-hidden">
        {cat.image_url && (
          <Image src={cat.image_url} alt={cat.name} fill sizes="100vw" className="object-cover opacity-40" />
        )}
        <div className="absolute inset-0 flex flex-col justify-center px-6 sm:px-12 lg:px-20">
          <div className="flex items-center gap-2 text-xs text-forest-300 mb-2">
            <Link href="/" className="hover:text-white transition-colors">Home</Link>
            <span>/</span>
            <Link href="/products" className="hover:text-white transition-colors">Products</Link>
            <span>/</span>
            <span className="text-white">{cat.name}</span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold text-white mb-2">{cat.name}</h1>
          {cat.description && (
            <p className="text-forest-200 text-sm max-w-xl line-clamp-2">{cat.description}</p>
          )}
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

        {/* Sort + filter bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
          <p className="text-sm text-stone-500">
            {count || 0} products
          </p>
          <div className="flex items-center gap-2 flex-wrap">
            {/* In-stock toggle */}
            <a
              href={`/collections/${cat.slug}?sort=${sort}&instock=${instock ? 'false' : 'true'}`}
              className={`text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors ${
                instock ? 'bg-forest-700 text-white border-forest-700' : 'border-stone-200 text-stone-600 hover:border-forest-400'
              }`}
            >
              In Stock Only
            </a>
            {/* Sort pills */}
            {SORT_OPTIONS.map(opt => (
              <a
                key={opt.value}
                href={`/collections/${cat.slug}?sort=${opt.value}${instock ? '&instock=true' : ''}`}
                className={`text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors ${
                  sort === opt.value
                    ? 'bg-stone-800 text-white border-stone-800'
                    : 'border-stone-200 text-stone-600 hover:border-stone-400'
                }`}
              >
                {opt.label}
              </a>
            ))}
          </div>
        </div>

        {/* Grid */}
        {products.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="text-5xl mb-4">🔍</div>
            <h3 className="text-lg font-semibold text-stone-700 mb-2">No products found</h3>
            <a href={`/collections/${cat.slug}`} className="text-forest-700 text-sm font-semibold hover:underline mt-2">
              Clear filters
            </a>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-5">
              {products.map((p, i) => (
                <ProductCard key={p.id} product={p} priority={i < 4} />
              ))}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex justify-center gap-1 mt-10">
                {Array.from({ length: totalPages }, (_, i) => i + 1).map(pg => (
                  <a
                    key={pg}
                    href={`/collections/${cat.slug}?sort=${sort}${instock ? '&instock=true' : ''}&page=${pg}`}
                    className={`w-9 h-9 flex items-center justify-center rounded-lg text-sm font-medium transition-colors ${
                      pg === page ? 'bg-forest-700 text-white' : 'text-stone-600 hover:bg-stone-100'
                    }`}
                  >
                    {pg}
                  </a>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </>
  )
}

async function fetchCategory(slug: string): Promise<Category | null> {
  try {
    const { data, error } = await supabase
      .from('categories')
      .select('id, name, slug, description, image_url, is_active')
      .eq('slug', slug)
      .eq('is_active', true)
      .single()
    return error ? null : data
  } catch { return null }
}

export async function generateStaticParams() {
  let data = null
  try { const r = await supabase.from('categories').select('slug').eq('is_active', true); data = r.data } catch {}
  return (data || []).map((c: any) => ({ slug: c.slug }))
}
