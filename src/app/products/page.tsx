import type { Metadata } from 'next'
import { supabase } from '@/lib/supabase'
import { getSiteSettings } from '@/lib/getSiteSettings'
import ProductCard from '@/components/product/ProductCard'
import type { Product } from '@/types'

export const metadata: Metadata = {
  title: 'All Products — Natural Himalayan Foods',
  description: 'Browse our complete range of natural Himalayan products — honey, spices, grains, oils and more.',
}

export const revalidate = 300

const PAGE_SIZE = 24

const SORT_OPTIONS = [
  { value: 'newest',     label: 'Newest First' },
  { value: 'price_asc',  label: 'Price: Low to High' },
  { value: 'price_desc', label: 'Price: High to Low' },
  { value: 'popular',    label: 'Best Sellers' },
]

interface SearchParams { sort?: string; category?: string; page?: string; instock?: string }

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const settings = await getSiteSettings()
  if (settings.catalogue_visible === 'false') {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="text-center">
          <div className="text-4xl mb-4">🌿</div>
          <h1 className="text-xl font-bold text-stone-800 mb-2">Catalogue Coming Soon</h1>
          <p className="text-stone-500">We're adding new products. Check back soon!</p>
        </div>
      </div>
    )
  }

  const sort     = searchParams.sort || 'newest'
  const catSlug  = searchParams.category || ''
  const page     = Math.max(1, parseInt(searchParams.page || '1'))
  const instock  = searchParams.instock === 'true'
  const offset   = (page - 1) * PAGE_SIZE

  // Build query
  let query = supabase
    .from('products')
    .select(`
      id, name, slug, emoji, price, mrp, selling, available_stock, gst_rate,
      image_url, unit_label, badges_bestseller, badges_new, badges_organic,
      category_id, is_deleted, status,
      categories:categories(id, name, slug),
      product_variants(id, price, mrp, size, available_stock, is_active)
    `, { count: 'exact' })
    .eq('is_deleted', false)
    .eq('status', 'active')
    .range(offset, offset + PAGE_SIZE - 1)

  if (instock)  query = query.gt('available_stock', 0)
  if (catSlug) {
    const { data: cat } = await supabase.from('categories').select('id').eq('slug', catSlug).single()
    if (cat) query = query.eq('category_id', cat.id)
  }

  // Sort
  switch (sort) {
    case 'price_asc':  query = query.order('price', { ascending: true });  break
    case 'price_desc': query = query.order('price', { ascending: false }); break
    case 'popular':    query = query.eq('badges_bestseller', true).order('name'); break
    default:           query = query.order('created_at', { ascending: false })
  }

  const { data, count } = await query
  const products  = (data as Product[]) || []
  const totalPages = Math.ceil((count || 0) / PAGE_SIZE)

  // Fetch categories for filter
  const { data: categories } = await supabase
    .from('categories')
    .select('id, name, slug')
    .eq('is_active', true)
    .order('name')

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

      {/* Header */}
      <div className="mb-7">
        <h1 className="text-2xl sm:text-3xl font-bold text-stone-900 mb-1">
          All Products
        </h1>
        <p className="text-sm text-stone-500">
          {count || 0} natural Himalayan products
        </p>
      </div>

      <div className="flex flex-col lg:flex-row gap-6">

        {/* Sidebar filters */}
        <aside className="lg:w-52 shrink-0">
          <div className="bg-stone-50 rounded-2xl p-4 space-y-5">

            <div>
              <div className="text-xs font-bold uppercase tracking-widest text-stone-500 mb-2">Sort By</div>
              <div className="space-y-1">
                {SORT_OPTIONS.map(opt => (
                  <a
                    key={opt.value}
                    href={`/products?sort=${opt.value}${catSlug ? `&category=${catSlug}` : ''}${instock ? '&instock=true' : ''}`}
                    className={`block text-sm px-3 py-1.5 rounded-lg transition-colors ${
                      sort === opt.value
                        ? 'bg-forest-700 text-white font-semibold'
                        : 'text-stone-600 hover:bg-stone-200'
                    }`}
                  >
                    {opt.label}
                  </a>
                ))}
              </div>
            </div>

            <div>
              <div className="text-xs font-bold uppercase tracking-widest text-stone-500 mb-2">Category</div>
              <div className="space-y-1">
                <a
                  href={`/products?sort=${sort}${instock ? '&instock=true' : ''}`}
                  className={`block text-sm px-3 py-1.5 rounded-lg transition-colors ${
                    !catSlug ? 'bg-forest-700 text-white font-semibold' : 'text-stone-600 hover:bg-stone-200'
                  }`}
                >
                  All
                </a>
                {(categories || []).map(cat => (
                  <a
                    key={cat.id}
                    href={`/products?sort=${sort}&category=${cat.slug}${instock ? '&instock=true' : ''}`}
                    className={`block text-sm px-3 py-1.5 rounded-lg transition-colors ${
                      catSlug === cat.slug
                        ? 'bg-forest-700 text-white font-semibold'
                        : 'text-stone-600 hover:bg-stone-200'
                    }`}
                  >
                    {cat.name}
                  </a>
                ))}
              </div>
            </div>

            <div>
              <div className="text-xs font-bold uppercase tracking-widest text-stone-500 mb-2">Availability</div>
              <a
                href={`/products?sort=${sort}${catSlug ? `&category=${catSlug}` : ''}&instock=${instock ? 'false' : 'true'}`}
                className={`flex items-center gap-2 text-sm px-3 py-1.5 rounded-lg transition-colors ${
                  instock ? 'bg-forest-700 text-white font-semibold' : 'text-stone-600 hover:bg-stone-200'
                }`}
              >
                <span className={`w-4 h-4 border-2 rounded flex items-center justify-center ${instock ? 'border-white' : 'border-stone-400'}`}>
                  {instock && <svg className="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 12 12"><path d="M10 3L5 8.5 2 5.5"/></svg>}
                </span>
                In Stock Only
              </a>
            </div>

          </div>
        </aside>

        {/* Product grid */}
        <div className="flex-1">
          {products.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="text-5xl mb-4">🔍</div>
              <h3 className="text-lg font-semibold text-stone-700 mb-2">No products found</h3>
              <p className="text-stone-400 text-sm">Try changing your filters</p>
              <a href="/products" className="mt-4 text-forest-700 text-sm font-semibold hover:underline">
                Clear all filters
              </a>
            </div>
          ) : (
            <>
              <div className="text-xs text-stone-400 mb-4">
                Showing {offset + 1}–{Math.min(offset + PAGE_SIZE, count || 0)} of {count || 0} products
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4 sm:gap-5">
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
                      href={`/products?sort=${sort}${catSlug ? `&category=${catSlug}` : ''}${instock ? '&instock=true' : ''}&page=${pg}`}
                      className={`w-9 h-9 flex items-center justify-center rounded-lg text-sm font-medium transition-colors ${
                        pg === page
                          ? 'bg-forest-700 text-white'
                          : 'text-stone-600 hover:bg-stone-100'
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
      </div>
    </div>
  )
}
