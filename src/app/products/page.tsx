import type { Metadata } from 'next'
import { supabase } from '@/lib/supabase'
import { getSiteSettings } from '@/lib/getSiteSettings'
import ProductCard from '@/components/product/ProductCard'
import { PRODUCT_SELECT, normalizeProducts } from '@/lib/normalizeProduct'
import Link from 'next/link'
import type { Product } from '@/types'

export const metadata: Metadata = {
  title: 'All Products — Natural Himalayan Foods | Pahadi Roots',
  description: 'Browse our complete range of natural Himalayan products — honey, spices, grains, oils and more. Sourced directly from 200+ mountain families.',
}

export const revalidate = 300

const PAGE_SIZE = 24

const SORT_OPTIONS = [
  { value: 'newest',     label: 'Newest First',         icon: '🆕' },
  { value: 'price_asc',  label: 'Price: Low to High',   icon: '↑' },
  { value: 'price_desc', label: 'Price: High to Low',   icon: '↓' },
  { value: 'popular',    label: 'Best Sellers',          icon: '⭐' },
]

interface SearchParams { sort?: string; category?: string; page?: string; instock?: string }

export default async function ProductsPage({ searchParams }: { searchParams: SearchParams }) {
  const settings = await getSiteSettings()
  if (settings.catalogue_visible === 'false') {
    return (
      <div style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f9f4ec' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>🌿</div>
          <h1 style={{ fontSize: '20px', fontWeight: 700, color: '#1a3a1e', marginBottom: '8px' }}>Catalogue Coming Soon</h1>
          <p style={{ color: '#7a7a7a' }}>We're adding new products. Check back soon!</p>
        </div>
      </div>
    )
  }

  const sort     = searchParams.sort || 'newest'
  const catSlug  = searchParams.category || ''
  const page     = Math.max(1, parseInt(searchParams.page || '1'))
  const instock  = searchParams.instock === 'true'
  const offset   = (page - 1) * PAGE_SIZE

  // Fetch categories for filter bar
  let categories: { id: number; name: string; slug: string }[] = []
  try {
    const { data } = await supabase
      .from('categories')
      .select('id, name, slug')
      .eq('is_active', true)
      .order('name')
    categories = data || []
  } catch { categories = [] }

  // Build product query
  let query = supabase
    .from('products')
    .select(PRODUCT_SELECT, { count: 'exact' })
    .eq('is_deleted', false)
    .eq('status', 'active')
    .range(offset, offset + PAGE_SIZE - 1)

  if (instock) query = query.gt('available_stock', 0)
  if (catSlug) {
    const cat = categories.find(c => c.slug === catSlug)
    if (cat) query = query.eq('category_id', cat.id)
  }

  switch (sort) {
    case 'price_asc':  query = query.order('price', { ascending: true });  break
    case 'price_desc': query = query.order('price', { ascending: false }); break
    case 'popular':    query = query.order('name'); break
    default:           query = query.order('created_at', { ascending: false })
  }

  const { data, count } = await query
  let products = normalizeProducts(data ?? [])
  if (sort === 'popular') {
    const bs = products.filter(p => p.badges_bestseller)
    if (bs.length > 0) products = bs
  }
  const totalPages = Math.ceil((count || 0) / PAGE_SIZE)
  const activeCat = categories.find(c => c.slug === catSlug)

  function url(overrides: Record<string, string | undefined>) {
    const params = new URLSearchParams()
    const vals = { sort, category: catSlug || undefined, instock: instock ? 'true' : undefined, page: '1', ...overrides }
    Object.entries(vals).forEach(([k, v]) => { if (v) params.set(k, v) })
    return `/products?${params.toString()}`
  }

  return (
    <div style={{ background: '#f9f4ec', minHeight: '100vh' }}>

      {/* Hero */}
      <div style={{
        background: 'linear-gradient(135deg,#1a3a1e 0%,#2d5a35 60%,#3a7042 100%)',
        padding: '40px 40px 36px', position: 'relative', overflow: 'hidden',
      }}>
        <div style={{ position: 'absolute', inset: 0, opacity: 0.04, backgroundImage: 'radial-gradient(circle at 20% 50%,#fff 1px,transparent 1px)', backgroundSize: '30px 30px' }} />
        <div style={{ maxWidth: '1200px', margin: '0 auto', position: 'relative' }}>
          {/* Breadcrumb */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: 'rgba(255,255,255,.6)', marginBottom: '16px' }}>
            <Link href="/" style={{ color: 'rgba(255,255,255,.6)', textDecoration: 'none' }}>Home</Link>
            <span>/</span>
            {activeCat ? (
              <>
                <Link href="/products" style={{ color: 'rgba(255,255,255,.6)', textDecoration: 'none' }}>Products</Link>
                <span>/</span>
                <span style={{ color: '#fff' }}>{activeCat.name}</span>
              </>
            ) : (
              <span style={{ color: '#fff' }}>All Products</span>
            )}
          </div>
          <h1 style={{
            fontFamily: '"Playfair Display",serif',
            fontSize: 'clamp(26px,4vw,44px)', fontWeight: 700, color: '#fff',
            margin: '0 0 8px', fontStyle: 'italic',
          }}>
            {activeCat ? activeCat.name : 'All Products'}
          </h1>
          <p style={{ color: 'rgba(255,255,255,.75)', fontSize: '14px', margin: 0 }}>
            {count || 0} natural Himalayan products{activeCat ? ` in ${activeCat.name}` : ''} • Sourced from 200+ mountain families
          </p>
        </div>
      </div>

      <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '24px 20px 60px', display: 'flex', gap: '28px', alignItems: 'flex-start' }}>

        {/* Sidebar */}
        <aside style={{
          width: '220px', flexShrink: 0, background: '#fff',
          borderRadius: '20px', padding: '20px', position: 'sticky',
          top: '80px', boxShadow: '0 2px 16px rgba(0,0,0,.06)',
          border: '1px solid rgba(0,0,0,.06)',
        }}>

          {/* Categories */}
          <div style={{ marginBottom: '24px' }}>
            <div style={{ fontSize: '10px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '2px', color: '#a07830', marginBottom: '10px' }}>
              Collections
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
              <Link href={url({ category: undefined })} style={{
                display: 'block', fontSize: '13px', padding: '7px 10px',
                borderRadius: '10px', textDecoration: 'none', fontWeight: !catSlug ? 700 : 500,
                background: !catSlug ? '#1a3a1e' : 'transparent',
                color: !catSlug ? '#fff' : '#444',
                transition: 'all .15s',
              }}>🌿 All Products</Link>
              {categories.map(cat => (
                <Link key={cat.id} href={url({ category: cat.slug })} style={{
                  display: 'block', fontSize: '13px', padding: '7px 10px',
                  borderRadius: '10px', textDecoration: 'none', fontWeight: catSlug === cat.slug ? 700 : 500,
                  background: catSlug === cat.slug ? '#1a3a1e' : 'transparent',
                  color: catSlug === cat.slug ? '#fff' : '#444',
                  transition: 'all .15s',
                }}>{cat.name}</Link>
              ))}
            </div>
          </div>

          {/* Sort */}
          <div style={{ marginBottom: '24px' }}>
            <div style={{ fontSize: '10px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '2px', color: '#a07830', marginBottom: '10px' }}>
              Sort By
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
              {SORT_OPTIONS.map(opt => (
                <Link key={opt.value} href={url({ sort: opt.value })} style={{
                  display: 'flex', alignItems: 'center', gap: '8px',
                  fontSize: '13px', padding: '7px 10px', borderRadius: '10px',
                  textDecoration: 'none', fontWeight: sort === opt.value ? 700 : 500,
                  background: sort === opt.value ? '#f0f7f1' : 'transparent',
                  color: sort === opt.value ? '#1a3a1e' : '#444',
                  transition: 'all .15s',
                }}>
                  <span>{opt.icon}</span> {opt.label}
                </Link>
              ))}
            </div>
          </div>

          {/* Stock */}
          <div>
            <div style={{ fontSize: '10px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '2px', color: '#a07830', marginBottom: '10px' }}>
              Availability
            </div>
            <Link href={url({ instock: instock ? 'false' : 'true' })} style={{
              display: 'flex', alignItems: 'center', gap: '10px',
              fontSize: '13px', padding: '7px 10px', borderRadius: '10px',
              textDecoration: 'none', fontWeight: 500,
              background: instock ? '#1a3a1e' : 'transparent', color: instock ? '#fff' : '#444',
              transition: 'all .15s',
            }}>
              <span style={{
                width: '16px', height: '16px', border: `2px solid ${instock ? '#fff' : '#999'}`,
                borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0,
              }}>
                {instock && <span style={{ color: '#fff', fontSize: '10px', lineHeight: 1 }}>✓</span>}
              </span>
              In Stock Only
            </Link>
          </div>
        </aside>

        {/* Product grid */}
        <div style={{ flex: 1, minWidth: 0 }}>

          {/* Active filters strip */}
          {(catSlug || instock || sort !== 'newest') && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '16px', alignItems: 'center' }}>
              <span style={{ fontSize: '12px', color: '#7a7a7a', fontWeight: 600 }}>Filters:</span>
              {activeCat && (
                <Link href={url({ category: undefined })} style={{
                  display: 'inline-flex', alignItems: 'center', gap: '4px',
                  background: '#1a3a1e', color: '#fff', borderRadius: '20px',
                  padding: '4px 12px', fontSize: '12px', fontWeight: 700, textDecoration: 'none',
                }}>{activeCat.name} ×</Link>
              )}
              {instock && (
                <Link href={url({ instock: 'false' })} style={{
                  display: 'inline-flex', alignItems: 'center', gap: '4px',
                  background: '#1a3a1e', color: '#fff', borderRadius: '20px',
                  padding: '4px 12px', fontSize: '12px', fontWeight: 700, textDecoration: 'none',
                }}>In Stock ×</Link>
              )}
              {sort !== 'newest' && (
                <Link href={url({ sort: 'newest' })} style={{
                  display: 'inline-flex', alignItems: 'center', gap: '4px',
                  background: '#c8920a', color: '#fff', borderRadius: '20px',
                  padding: '4px 12px', fontSize: '12px', fontWeight: 700, textDecoration: 'none',
                }}>{SORT_OPTIONS.find(o => o.value === sort)?.label} ×</Link>
              )}
              <Link href="/products" style={{
                fontSize: '12px', color: '#c8920a', fontWeight: 700, textDecoration: 'underline',
              }}>Clear all</Link>
            </div>
          )}

          {/* Count + range */}
          <div style={{ fontSize: '12px', color: '#9a9a9a', marginBottom: '16px' }}>
            Showing {Math.min(offset + 1, count || 0)}–{Math.min(offset + PAGE_SIZE, count || 0)} of {count || 0} products
          </div>

          {products.length === 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '80px 20px', textAlign: 'center' }}>
              <div style={{ fontSize: '48px', marginBottom: '16px' }}>🔍</div>
              <h3 style={{ fontSize: '18px', fontWeight: 700, color: '#1a3a1e', marginBottom: '8px' }}>No products found</h3>
              <p style={{ color: '#7a7a7a', fontSize: '14px', marginBottom: '20px' }}>Try changing your filters</p>
              <Link href="/products" style={{
                background: '#1a3a1e', color: '#fff', borderRadius: '20px',
                padding: '10px 24px', fontSize: '13px', fontWeight: 700, textDecoration: 'none',
              }}>Clear all filters</Link>
            </div>
          ) : (
            <>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill,minmax(200px,1fr))',
                gap: '16px',
              }}>
                {products.map((p, i) => (
                  <ProductCard key={p.id} product={p} priority={i < 4} />
                ))}
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div style={{ display: 'flex', justifyContent: 'center', gap: '6px', marginTop: '40px', flexWrap: 'wrap' }}>
                  {page > 1 && (
                    <Link href={url({ page: String(page - 1) })} style={paginationStyle(false)}>← Prev</Link>
                  )}
                  {Array.from({ length: totalPages }, (_, i) => i + 1).map(pg => (
                    <Link key={pg} href={url({ page: String(pg) })} style={paginationStyle(pg === page)}>
                      {pg}
                    </Link>
                  ))}
                  {page < totalPages && (
                    <Link href={url({ page: String(page + 1) })} style={paginationStyle(false)}>Next →</Link>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <style>{`
        @media(max-width:768px) {
          aside { display: none !important; }
        }
      `}</style>
    </div>
  )
}

function paginationStyle(active: boolean): React.CSSProperties {
  return {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    minWidth: '36px', height: '36px', padding: '0 10px',
    borderRadius: '10px', fontSize: '13px', fontWeight: active ? 700 : 500,
    textDecoration: 'none',
    background: active ? '#1a3a1e' : '#fff',
    color: active ? '#fff' : '#444',
    border: `1.5px solid ${active ? '#1a3a1e' : '#e0e0e0'}`,
    transition: 'all .15s',
  }
}
