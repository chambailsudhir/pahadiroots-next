import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getStoreData, buildCategories, getProductsWithImages } from '@/lib/storeData'
import { normalizeProducts, toCardProductData, getEffectivePrice } from '@/lib/normalizeProduct'
import { getSiteSettings } from '@/lib/getSiteSettings'
import ProductCard from '@/components/product/ProductCard'
import CategoryMotif from '@/components/collections/CategoryMotif'
import type { Product } from '@/types'
import Link from 'next/link'

export const revalidate = 60

// BUG FIX (Next.js 15+/16 migration): both `params` and `searchParams` are
// now Promises in Server Components — must be awaited before use.
interface Props {
  params:       Promise<{ slug: string }>
  searchParams: Promise<{ sort?: string; page?: string; instock?: string }>
}

const PAGE_SIZE = 24

const SORT_OPTIONS = [
  { value: 'newest',     label: 'Newest' },
  { value: 'price_asc',  label: 'Price ↑' },
  { value: 'price_desc', label: 'Price ↓' },
  { value: 'popular',    label: 'Best Sellers' },
]


export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const storeData = await getStoreData()
  const cat = storeData.categories.find(c => c.slug === slug)
  if (!cat) return { title: 'Collection Not Found' }
  return {
    title:       `${cat.name} — Himalayan ${cat.name} | HimVeda by Pahadi Roots`,
    description: cat.description || `Shop pure ${cat.name} sourced from the Himalayas.`,
    openGraph:   { images: cat.image_url ? [{ url: cat.image_url }] : [] },
  }
}

export default async function CollectionPage({ params, searchParams }: Props) {
  const [{ slug }, sp, storeData, settings] = await Promise.all([
    params, searchParams, getStoreData(), getSiteSettings(),
  ])

  // Find category using SERVICE KEY data (no RLS issues)
  const cat = storeData.categories.find(c => c.slug === slug)
  if (!cat) notFound()

  // All categories for the nav bar (apply images same way)
  const allCategories = buildCategories(storeData)

  const sort    = sp.sort    || 'newest'
  const page    = Math.max(1, parseInt(sp.page || '1'))
  const instock = sp.instock === 'true'
  const offset  = (page - 1) * PAGE_SIZE

  // BUG FIX (price mismatch — this page showed a different price than the
  // homepage/products page/admin for the same product): was
  // `applyProductImages(storeData.products, storeData.product_images)`,
  // which never attaches product_variants. getBaseVariant() then always
  // returned null here, so ProductCard fell back to the stale top-level
  // `products.price` column (a leftover from an older pricing-engine run —
  // confirmed live: 714.29, vs the real current price of 800 in
  // products.selling_price / product_variants.price). Every other listing
  // page (new-arrivals, /products, homepage via getNormalizedProducts())
  // already uses this same combined helper — this page was the one
  // outlier still doing the two steps manually and skipping the second one.
  const allProductsWithImages = getProductsWithImages(storeData)
  const allNormalized = normalizeProducts(allProductsWithImages)

  // Filter by this category
  let catProducts = allNormalized.filter((p: any) => String(p.category_id) === String(cat.id))
  if (instock) catProducts = catProducts.filter((p: any) => (p.available_stock ?? 0) > 0)

  // Sort
  switch (sort) {
    // BUG FIX (found during Aug 2026 catalogue-wide audit): was sorting by
    // raw a.price/b.price — the top-level products.price column, which is
    // legacy and no longer written by the pricing engine (confirmed
    // disagreeing with the real price for nearly the whole catalogue).
    // ProductCard actually displays getEffectivePrice() (the base variant's
    // price), so "Price ↑/↓" could visibly disagree with the prices shown
    // on the very cards it was sorting. Every other listing page
    // (new-arrivals, /products, BestSellersClient) already sorts by
    // getEffectivePrice/getEffectiveMrp for this exact reason — this page
    // was the one outlier still comparing the raw column directly.
    case 'price_asc':  catProducts.sort((a, b) => getEffectivePrice(a) - getEffectivePrice(b));  break
    case 'price_desc': catProducts.sort((a, b) => getEffectivePrice(b) - getEffectivePrice(a));  break
    case 'popular':    catProducts.sort((a, b) => (b.badges_bestseller ? 1 : 0) - (a.badges_bestseller ? 1 : 0)); break
    default:           catProducts.sort((a: any, b: any) => new Date(b.created_at||0).getTime() - new Date(a.created_at||0).getTime())
  }

  const count      = catProducts.length
  const products   = catProducts.slice(offset, offset + PAGE_SIZE) as Product[]
  const totalPages = Math.ceil(count / PAGE_SIZE)
  const catSlug    = cat.slug

  function url(overrides: Record<string, string | undefined>) {
    const p = new URLSearchParams()
    const vals = { sort, instock: instock ? 'true' : undefined, page: '1', ...overrides }
    Object.entries(vals).forEach(([k, v]) => { if (v) p.set(k, v) })
    return `/collections/${catSlug}?${p.toString()}`
  }

  // BUG FIX (Aug 23 2026 — user flagged the collection hero's product photo
  // as still looking wrong, circled on Himalayan Tea): the featured product
  // image approach from Aug 21 traded one problem for another. Several
  // source product photos have letterboxing/black bars baked into the shot
  // itself (visible in the product grid below the hero too) — contained at
  // a fixed 210×210 box, that letterboxing shows up as ugly black rectangles
  // floating in the hero. A decorative element sourced from data we don't
  // fully control (arbitrary product photography) isn't reliable enough to
  // keep shipping. Removed entirely per explicit request — the hero is now
  // deliberately simple: gradient + line-art motif + text, matching the
  // plain, considered look of the /products "All Products" hero, no photo.
  // Also fixed a real color inconsistency flagged in the same message: this
  // hero was using `120deg,#12271a→#1a3a1e→#2d5a35`, a different angle and a
  // darker start stop than every other hero on the site. /products (and
  // BestSellersClient) use `135deg,#1a3a1e 0%,#2d5a35 60%,#3a7042 100%` —
  // this page now matches that exactly, and the dot-pattern opacity (was
  // 0.06 here vs 0.04 on /products) matches too.

  // BUG FIX (Aug 23 2026 — hero was visibly taller than /products' hero for
  // the same amount of content, flagged with a side-by-side comparison):
  // root cause was a structural mismatch, not a tunable number. /products'
  // hero has no fixed height — it's `padding: 40px 40px 36px` and the box
  // sizes itself to whatever content is inside. This page instead forced
  // `height: 320px` and absolutely centered a flex column inside it, so it
  // was always exactly 320px regardless of content — taller than /products
  // for the same title + one line of text. Removed the fixed height and the
  // absolute-center layout; this hero now uses the identical padding-based
  // box as /products, so the two are the same size for the same content.
  // The product-count pill was also its own row before (extra height /products
  // doesn't have) — it now sits inline with the description on one line,
  // the way /products keeps its count line to one row.

  return (
    <div style={{ background: '#f9f4ec', minHeight: '100vh' }}>

      {/* ── Hero — same box model as /products: padding-based, not fixed-height ── */}
      <div style={{ background: 'linear-gradient(135deg,#1a3a1e 0%,#2d5a35 60%,#3a7042 100%)',
        padding: '40px 40px 36px', position: 'relative', overflow: 'hidden' }}>

        {/* Soft radial glow so a flat gradient doesn't read as a plain block */}
        <div style={{ position: 'absolute', inset: 0,
          background: 'radial-gradient(circle at 15% 30%, rgba(201,168,76,.14), transparent 55%)' }} />
        <div style={{ position: 'absolute', inset: 0, opacity: 0.04,
          backgroundImage: 'radial-gradient(circle at 20% 50%,#fff 1px,transparent 1px)',
          backgroundSize: '28px 28px' }} />
        {/* Bespoke on-brand line-art motif — see CategoryMotif.tsx */}
        <CategoryMotif slug={catSlug} style={{
          position: 'absolute', top: '-60px', right: '-40px', width: '460px', height: '460px',
        }} />

        <div style={{ maxWidth: '1200px', margin: '0 auto', position: 'relative' }}>

          {/* Breadcrumb */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px',
            color: 'rgba(255,255,255,.6)', marginBottom: '16px' }}>
            <Link href="/" style={{ color: 'rgba(255,255,255,.6)', textDecoration: 'none' }}>Home</Link>
            <span>/</span>
            <Link href="/products" style={{ color: 'rgba(255,255,255,.6)', textDecoration: 'none' }}>Products</Link>
            <span>/</span>
            <span style={{ color: '#fff' }}>{cat.name}</span>
          </div>
          <h1 style={{ fontFamily: '"Playfair Display",serif', fontSize: 'clamp(26px,4vw,44px)',
            fontWeight: 700, color: '#fff', margin: '0 0 8px', fontStyle: 'italic' }}>{cat.name}</h1>
          <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
            {cat.description && (
              <p style={{ color: 'rgba(255,255,255,.75)', fontSize: '14px', maxWidth: '520px', margin: 0, lineHeight: 1.6 }}>
                {cat.description}
              </p>
            )}
            <span style={{ background: 'rgba(201,168,76,.25)', border: '1px solid rgba(201,168,76,.5)',
              borderRadius: '20px', padding: '4px 14px', fontSize: '12px', color: '#f0d080', fontWeight: 700,
              whiteSpace: 'nowrap' }}>
              {count} Products
            </span>
          </div>
        </div>
      </div>

      {/* ── Category nav bar ── */}
      {allCategories.length > 1 && (
        <div style={{ background: '#fff', borderBottom: '1px solid #e8e0d0',
          padding: '12px 40px', overflowX: 'auto' }}>
          <div style={{ display: 'flex', gap: '8px', minWidth: 'max-content' }}>
            <Link href="/products" style={{ padding: '6px 16px', borderRadius: '20px', fontSize: '12px',
              fontWeight: 700, textDecoration: 'none', background: '#f0f7f1', color: '#1a3a1e',
              border: '1.5px solid #c8d8ca', whiteSpace: 'nowrap' }}>All</Link>
            {allCategories.map(c => (
              <Link key={c.id} href={`/collections/${c.slug}`} style={{
                padding: '6px 16px', borderRadius: '20px', fontSize: '12px', fontWeight: 700,
                textDecoration: 'none', whiteSpace: 'nowrap',
                background: c.slug === catSlug ? '#1a3a1e' : 'transparent',
                color:      c.slug === catSlug ? '#fff'    : '#555',
                border:     `1.5px solid ${c.slug === catSlug ? '#1a3a1e' : '#e0e0e0'}`,
              }}>{c.name}</Link>
            ))}
          </div>
        </div>
      )}

      <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '24px 20px 60px' }}>

        {/* Sort bar */}
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center',
          justifyContent: 'space-between', gap: '12px', marginBottom: '20px' }}>
          <p style={{ fontSize: '13px', color: '#7a7a7a', margin: 0 }}>
            {count} products • Showing {Math.min(offset + 1, count)}–{Math.min(offset + PAGE_SIZE, count)}
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <Link href={url({ instock: instock ? 'false' : 'true' })} style={{
              fontSize: '12px', fontWeight: 700, padding: '7px 14px', borderRadius: '20px',
              border: '1.5px solid', textDecoration: 'none',
              background: instock ? '#1a3a1e' : '#fff', color: instock ? '#fff' : '#555',
              borderColor: instock ? '#1a3a1e' : '#ddd' }}>In Stock</Link>
            {SORT_OPTIONS.map(opt => (
              <Link key={opt.value} href={url({ sort: opt.value })} style={{
                fontSize: '12px', fontWeight: 700, padding: '7px 14px', borderRadius: '20px',
                border: '1.5px solid', textDecoration: 'none',
                background: sort === opt.value ? '#c8920a' : '#fff',
                color:      sort === opt.value ? '#fff'    : '#555',
                borderColor: sort === opt.value ? '#c8920a' : '#ddd' }}>
                {opt.label}
              </Link>
            ))}
          </div>
        </div>

        {/* Grid */}
        {products.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center',
            padding: '80px 20px', textAlign: 'center' }}>
            <h3 style={{ fontSize: '18px', fontWeight: 700, color: '#1a3a1e', marginBottom: '8px' }}>
              No products found
            </h3>
            <Link href={`/collections/${catSlug}`} style={{ background: '#1a3a1e', color: '#fff',
              borderRadius: '20px', padding: '10px 24px', fontSize: '13px', fontWeight: 700,
              textDecoration: 'none', marginTop: '12px', display: 'inline-block' }}>
              Clear filters
            </Link>
          </div>
        ) : (
          <>
            <div className="prod-page-grid">
              {products.map((p, i) => <ProductCard key={p.id} product={toCardProductData(p)} priority={i < 4} />)}
            </div>
            {totalPages > 1 && (
              <div style={{ display: 'flex', justifyContent: 'center', gap: '6px', marginTop: '40px', flexWrap: 'wrap' }}>
                {page > 1 && <Link href={url({ page: String(page - 1) })} style={pagStyle(false)}>← Prev</Link>}
                {Array.from({ length: totalPages }, (_, i) => i + 1).map(pg => (
                  <Link key={pg} href={url({ page: String(pg) })} style={pagStyle(pg === page)}>{pg}</Link>
                ))}
                {page < totalPages && <Link href={url({ page: String(page + 1) })} style={pagStyle(false)}>Next →</Link>}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function pagStyle(active: boolean): React.CSSProperties {
  return {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    minWidth: '36px', height: '36px', padding: '0 10px', borderRadius: '10px',
    fontSize: '13px', fontWeight: active ? 700 : 500, textDecoration: 'none',
    background: active ? '#1a3a1e' : '#fff', color: active ? '#fff' : '#444',
    border: `1.5px solid ${active ? '#1a3a1e' : '#e0e0e0'}`,
  }
}

export async function generateStaticParams() {
  try {
    const sd = await getStoreData()
    return sd.categories.map(c => ({ slug: c.slug }))
  } catch { return [] }
}
