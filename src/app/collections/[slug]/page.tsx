import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { PRODUCT_SELECT, normalizeProducts } from '@/lib/normalizeProduct'
import { getSiteSettings } from '@/lib/getSiteSettings'
import ProductCard from '@/components/product/ProductCard'
import type { Product, Category } from '@/types'
import Image from 'next/image'
import Link from 'next/link'

export const revalidate = 7200

interface Props {
  params:       { slug: string }
  searchParams: { sort?: string; page?: string; instock?: string }
}

const PAGE_SIZE = 24

const SORT_OPTIONS = [
  { value: 'newest',     label: 'Newest',       icon: '🆕' },
  { value: 'price_asc',  label: 'Price ↑',      icon: '↑' },
  { value: 'price_desc', label: 'Price ↓',      icon: '↓' },
  { value: 'popular',    label: 'Best Sellers',  icon: '⭐' },
]

function emojiFor(name: string): string {
  const n = name.toLowerCase()
  if (n.includes('honey'))  return '🍯'
  if (n.includes('ghee'))   return '🥛'
  if (n.includes('herb') || n.includes('spice')) return '🌿'
  if (n.includes('tea'))    return '🍵'
  if (n.includes('rice') || n.includes('grain') || n.includes('millet')) return '🌾'
  if (n.includes('oil'))    return '🫙'
  if (n.includes('juice'))  return '🧃'
  if (n.includes('shilajit') || n.includes('resin')) return '🪨'
  if (n.includes('jam') || n.includes('preserve')) return '🍓'
  if (n.includes('pulse') || n.includes('dal')) return '🫘'
  if (n.includes('coffee')) return '☕'
  return '🏔️'
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const cat = await fetchCategory(params.slug)
  if (!cat) return { title: 'Collection Not Found' }
  return {
    title:       `${cat.name} — Pure Himalayan ${cat.name} | Pahadi Roots`,
    description: cat.description || `Shop premium natural ${cat.name} sourced directly from the Himalayas by Pahadi Roots.`,
    openGraph: {
      title:  `${cat.name} | Pahadi Roots`,
      images: cat.image_url ? [{ url: cat.image_url }] : [],
    },
  }
}

export default async function CollectionPage({ params, searchParams }: Props) {
  const [cat, settings, allCategories] = await Promise.all([
    fetchCategory(params.slug),
    getSiteSettings(),
    fetchAllCategories(),
  ])

  if (!cat) notFound()
  if (settings.catalogue_visible === 'false') {
    return (
      <div style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ color: '#7a7a7a' }}>Catalogue coming soon.</p>
      </div>
    )
  }

  const sort    = searchParams.sort    || 'newest'
  const page    = Math.max(1, parseInt(searchParams.page || '1'))
  const instock = searchParams.instock === 'true'
  const offset  = (page - 1) * PAGE_SIZE

  let query = supabase
    .from('products')
    .select(`
      id, name, slug, emoji, price, mrp, cost_price, available_stock, gst_rate,
      image_url, unit_label, badges, category_id, is_deleted, status,
      categories:categories(id, name, slug),
      product_variants(id, price, mrp, variant_value, available_stock, is_active)
    `, { count: 'exact' })
    .eq('category_id', cat.id)
    .eq('is_deleted', false)
    .eq('status', 'active')
    .range(offset, offset + PAGE_SIZE - 1)

  if (instock) query = query.gt('available_stock', 0)

  switch (sort) {
    case 'price_asc':  query = query.order('price', { ascending: true });   break
    case 'price_desc': query = query.order('price', { ascending: false });  break
    case 'popular':    break
    default:           query = query.order('created_at', { ascending: false })
  }

  const { data, count } = await query
  const products   = normalizeProducts(data ?? [])
  const totalPages = Math.ceil((count || 0) / PAGE_SIZE)

  const emoji = emojiFor(cat.name)

  function url(overrides: Record<string, string | undefined>) {
    const params = new URLSearchParams()
    const vals = { sort, instock: instock ? 'true' : undefined, page: '1', ...overrides }
    Object.entries(vals).forEach(([k, v]) => { if (v) params.set(k, v) })
    return `/collections/${cat!.slug}?${params.toString()}`
  }

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type':    'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home',       item: 'https://pahadiroots.com' },
      { '@type': 'ListItem', position: 2, name: 'Products',   item: 'https://pahadiroots.com/products' },
      { '@type': 'ListItem', position: 3, name: cat.name,     item: `https://pahadiroots.com/collections/${cat.slug}` },
    ],
  }

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <div style={{ background: '#f9f4ec', minHeight: '100vh' }}>

        {/* Hero */}
        <div style={{ position: 'relative', height: '280px', background: 'linear-gradient(135deg,#1a3a1e,#2d5a35)', overflow: 'hidden' }}>
          {cat.image_url && (
            <Image
              src={cat.image_url} alt={cat.name} fill sizes="100vw"
              style={{ objectFit: 'cover', opacity: 0.35 }}
              priority
            />
          )}
          {/* Pattern overlay */}
          <div style={{ position: 'absolute', inset: 0, opacity: 0.06, backgroundImage: 'radial-gradient(circle at 20% 50%,#fff 1px,transparent 1px)', backgroundSize: '28px 28px' }} />

          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '0 40px' }}>
            {/* Breadcrumb */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: 'rgba(255,255,255,.6)', marginBottom: '16px' }}>
              <Link href="/" style={{ color: 'rgba(255,255,255,.6)', textDecoration: 'none' }}>Home</Link>
              <span>/</span>
              <Link href="/products" style={{ color: 'rgba(255,255,255,.6)', textDecoration: 'none' }}>Products</Link>
              <span>/</span>
              <span style={{ color: '#fff' }}>{cat.name}</span>
            </div>

            {/* Title row */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '10px' }}>
              <span style={{ fontSize: '56px', lineHeight: 1 }}>{emoji}</span>
              <h1 style={{
                fontFamily: '"Playfair Display",serif',
                fontSize: 'clamp(28px,4vw,48px)', fontWeight: 700, color: '#fff',
                margin: 0, fontStyle: 'italic', lineHeight: 1.15,
              }}>{cat.name}</h1>
            </div>

            {cat.description && (
              <p style={{ color: 'rgba(255,255,255,.8)', fontSize: '14px', maxWidth: '520px', margin: 0, lineHeight: 1.6 }}>
                {cat.description}
              </p>
            )}

            <div style={{ marginTop: '12px', display: 'inline-block' }}>
              <span style={{
                background: 'rgba(201,168,76,.25)', border: '1px solid rgba(201,168,76,.5)',
                borderRadius: '20px', padding: '4px 14px', fontSize: '12px',
                color: '#f0d080', fontWeight: 700,
              }}>{count || 0} Products</span>
            </div>
          </div>
        </div>

        {/* Other categories row */}
        {allCategories.length > 1 && (
          <div style={{ background: '#fff', borderBottom: '1px solid #e8e0d0', padding: '12px 40px', overflowX: 'auto' }}>
            <div style={{ display: 'flex', gap: '8px', minWidth: 'max-content' }}>
              <Link href="/products" style={{
                padding: '6px 16px', borderRadius: '20px', fontSize: '12px', fontWeight: 700,
                textDecoration: 'none', background: '#f0f7f1', color: '#1a3a1e',
                border: '1.5px solid #c8d8ca', whiteSpace: 'nowrap',
              }}>🌿 All</Link>
              {allCategories.map(c => (
                <Link key={c.id} href={`/collections/${c.slug}`} style={{
                  padding: '6px 16px', borderRadius: '20px', fontSize: '12px', fontWeight: 700,
                  textDecoration: 'none', whiteSpace: 'nowrap',
                  background: c.slug === cat.slug ? '#1a3a1e' : 'transparent',
                  color: c.slug === cat.slug ? '#fff' : '#555',
                  border: `1.5px solid ${c.slug === cat.slug ? '#1a3a1e' : '#e0e0e0'}`,
                  transition: 'all .15s',
                }}>{c.name}</Link>
              ))}
            </div>
          </div>
        )}

        <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '24px 20px 60px' }}>

          {/* Sort + filter bar */}
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '12px', marginBottom: '20px' }}>
            <p style={{ fontSize: '13px', color: '#7a7a7a', margin: 0 }}>
              {count || 0} products • Showing {Math.min(offset + 1, count || 0)}–{Math.min(offset + PAGE_SIZE, count || 0)}
            </p>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              {/* In-stock */}
              <Link
                href={url({ instock: instock ? 'false' : 'true' })}
                style={{
                  fontSize: '12px', fontWeight: 700, padding: '7px 14px',
                  borderRadius: '20px', border: '1.5px solid', textDecoration: 'none',
                  background: instock ? '#1a3a1e' : '#fff',
                  color: instock ? '#fff' : '#555',
                  borderColor: instock ? '#1a3a1e' : '#ddd',
                  transition: 'all .15s',
                }}
              >In Stock</Link>
              {/* Sort pills */}
              {SORT_OPTIONS.map(opt => (
                <Link key={opt.value} href={url({ sort: opt.value })} style={{
                  fontSize: '12px', fontWeight: 700, padding: '7px 14px',
                  borderRadius: '20px', border: '1.5px solid', textDecoration: 'none',
                  background: sort === opt.value ? '#c8920a' : '#fff',
                  color: sort === opt.value ? '#fff' : '#555',
                  borderColor: sort === opt.value ? '#c8920a' : '#ddd',
                  transition: 'all .15s',
                }}>{opt.icon} {opt.label}</Link>
              ))}
            </div>
          </div>

          {/* Grid */}
          {products.length === 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '80px 20px', textAlign: 'center' }}>
              <div style={{ fontSize: '52px', marginBottom: '16px' }}>🔍</div>
              <h3 style={{ fontSize: '18px', fontWeight: 700, color: '#1a3a1e', marginBottom: '8px' }}>No products found</h3>
              <Link href={`/collections/${cat.slug}`} style={{
                background: '#1a3a1e', color: '#fff', borderRadius: '20px',
                padding: '10px 24px', fontSize: '13px', fontWeight: 700, textDecoration: 'none',
                marginTop: '12px', display: 'inline-block',
              }}>Clear filters</Link>
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
                    <Link href={url({ page: String(page - 1) })} style={pagStyle(false)}>← Prev</Link>
                  )}
                  {Array.from({ length: totalPages }, (_, i) => i + 1).map(pg => (
                    <Link key={pg} href={url({ page: String(pg) })} style={pagStyle(pg === page)}>{pg}</Link>
                  ))}
                  {page < totalPages && (
                    <Link href={url({ page: String(page + 1) })} style={pagStyle(false)}>Next →</Link>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  )
}

function pagStyle(active: boolean): React.CSSProperties {
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

async function fetchAllCategories(): Promise<Category[]> {
  try {
    const { data } = await supabase
      .from('categories')
      .select('id, name, slug, description, image_url, is_active')
      .eq('is_active', true)
      .order('name')
    return data || []
  } catch { return [] }
}

export async function generateStaticParams() {
  let data = null
  try { const r = await supabase.from('categories').select('slug').eq('is_active', true); data = r.data } catch {}
  return (data || []).map((c: any) => ({ slug: c.slug }))
}
