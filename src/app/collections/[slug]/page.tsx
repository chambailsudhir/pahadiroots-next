import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getStoreData, buildCategories, imgFor, getProductsWithImages } from '@/lib/storeData'
import { normalizeProducts, toCardProductData, getEffectivePrice } from '@/lib/normalizeProduct'
import { getSiteSettings } from '@/lib/getSiteSettings'
import ProductCard from '@/components/product/ProductCard'
import CategoryMotif from '@/components/collections/CategoryMotif'
import type { Product } from '@/types'
import Image from 'next/image'
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
  { value: 'newest',     label: 'Newest',      icon: '🆕' },
  { value: 'price_asc',  label: 'Price ↑',     icon: '↑'  },
  { value: 'price_desc', label: 'Price ↓',     icon: '↓'  },
  { value: 'popular',    label: 'Best Sellers', icon: '⭐' },
]

function emojiFor(name: string): string {
  const n = name.toLowerCase()
  if (n.includes('honey'))                          return '🍯'
  if (n.includes('ghee'))                           return '🥛'
  if (n.includes('herb') || n.includes('spice'))    return '🌿'
  if (n.includes('tea'))                            return '🍵'
  if (n.includes('rice') || n.includes('grain'))    return '🌾'
  if (n.includes('oil'))                            return '🫙'
  if (n.includes('juice'))                          return '🧃'
  if (n.includes('shilajit'))                       return '🪨'
  if (n.includes('jam') || n.includes('preserve'))  return '🍓'
  if (n.includes('pulse') || n.includes('dal'))     return '🫘'
  return '🏔️'
}

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

  // Get image via same imgFor() logic as old site
  const catImageUrl = imgFor(cat, storeData.settings)

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
  const emoji      = emojiFor(cat.name)
  const catSlug    = cat.slug

  function url(overrides: Record<string, string | undefined>) {
    const p = new URLSearchParams()
    const vals = { sort, instock: instock ? 'true' : undefined, page: '1', ...overrides }
    Object.entries(vals).forEach(([k, v]) => { if (v) p.set(k, v) })
    return `/collections/${catSlug}?${p.toString()}`
  }

  // BUG FIX (Aug 21 2026 — collection hero looked "cheap"/template-y, flagged
  // by user against a competitor screenshot): root-caused via live DB query —
  // categories.image_url for every collection (uploaded in the same ~95s
  // batch, e.g. natural-oils/1777632012074-yi4ic.jpg) is the flat brand
  // SHIELD/TREE LOGO MARK, not landscape lifestyle photography. Two
  // compounding problems, confirmed against the live render:
  //   1) `opacity: 0.35` was applied to the WHOLE <Image>, which is a
  //      uniform wash — it doesn't just dim behind the text, it ghosts out
  //      the *entire* photo including the empty two-thirds where nothing
  //      needs dimming. Real photography would look pale and cheap here too.
  //   2) A square-ish logo mark, cover-cropped to a 100vw × 280px strip,
  //      necessarily blows up and off-crops — that's the "weird" giant
  //      floating shield the user circled. No amount of CSS makes a logo
  //      look like an editorial banner photo.
  // Fix ships two changes together:
  //   a) Hero no longer stretches the category "photo" full-bleed. Until
  //      real landscape lifestyle photography exists per collection, the
  //      hero uses a rich brand-gradient + subtle pattern background and
  //      features the category's own top PRODUCT shot (already professional
  //      studio photography — see the bottle shots on the grid below) as a
  //      contained, drop-shadowed visual on the right, the way premium DTC
  //      collection pages actually do it when a custom banner isn't ready.
  //   b) IF a category ever gets a proper wide (e.g. 1600×500+) lifestyle
  //      photo uploaded, `heroPhotoUrl` below is used full-bleed with a
  //      *directional* left-to-right scrim (dark only behind the text column)
  //      instead of a uniform opacity wash, so the photography stays vivid
  //      and full-strength on the right — this is what actually reads
  //      "premium" instead of "faded."
  const heroProduct    = catProducts[0]
  const heroProductImg = (heroProduct as any)?.image_url || null
  // Treat the current logo-style uploads as decorative-only (not a photo hero).
  const heroPhotoUrl = null // swap to `catImageUrl` once a real landscape photo is uploaded per collection

  return (
    <div style={{ background: '#f9f4ec', minHeight: '100vh' }}>

      {/* ── Hero ── */}
      <div style={{ position: 'relative', height: '320px', overflow: 'hidden',
        background: 'linear-gradient(120deg,#12271a 0%,#1a3a1e 45%,#2d5a35 100%)' }}>

        {heroPhotoUrl ? (
          <>
            <Image src={heroPhotoUrl} alt={cat.name} fill sizes="100vw"
              style={{ objectFit: 'cover', objectPosition: 'center' }} priority
            />
            {/* Directional scrim: full strength behind the text column only —
                the photo itself stays vivid, unlike the old uniform 0.35 wash. */}
            <div style={{ position: 'absolute', inset: 0,
              background: 'linear-gradient(90deg, rgba(15,35,20,.94) 0%, rgba(15,35,20,.82) 28%, rgba(15,35,20,.42) 52%, rgba(15,35,20,.08) 74%, transparent 100%)' }} />
          </>
        ) : (
          <>
            {/* Soft radial glow so a flat gradient doesn't read as a plain block */}
            <div style={{ position: 'absolute', inset: 0,
              background: 'radial-gradient(circle at 15% 30%, rgba(201,168,76,.14), transparent 55%)' }} />
            <div style={{ position: 'absolute', inset: 0, opacity: 0.06,
              backgroundImage: 'radial-gradient(circle at 20% 50%,#fff 1px,transparent 1px)',
              backgroundSize: '28px 28px' }} />
            {/* Bespoke on-brand line-art motif — see CategoryMotif.tsx for why
                this exists instead of a stretched logo or a bare gradient. */}
            <CategoryMotif slug={catSlug} style={{
              position: 'absolute', top: '-60px', right: '-40px', width: '460px', height: '460px',
            }} />
          </>
        )}

        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
          justifyContent: 'space-between', gap: '24px', maxWidth: '1200px', margin: '0 auto',
          left: 0, right: 0, padding: '0 40px' }}>

          <div style={{ flex: 1, minWidth: 0 }}>
            {/* Breadcrumb */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px',
              color: 'rgba(255,255,255,.6)', marginBottom: '16px' }}>
              <Link href="/" style={{ color: 'rgba(255,255,255,.6)', textDecoration: 'none' }}>Home</Link>
              <span>/</span>
              <Link href="/products" style={{ color: 'rgba(255,255,255,.6)', textDecoration: 'none' }}>Products</Link>
              <span>/</span>
              <span style={{ color: '#fff' }}>{cat.name}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '10px' }}>
              <span style={{ fontSize: '56px', lineHeight: 1 }}>{emoji}</span>
              <h1 style={{ fontFamily: '"Playfair Display",serif', fontSize: 'clamp(28px,4vw,48px)',
                fontWeight: 700, color: '#fff', margin: 0, fontStyle: 'italic' }}>{cat.name}</h1>
            </div>
            {cat.description && (
              <p style={{ color: 'rgba(255,255,255,.8)', fontSize: '14px', maxWidth: '520px', margin: 0, lineHeight: 1.6 }}>
                {cat.description}
              </p>
            )}
            <div style={{ marginTop: '12px' }}>
              <span style={{ background: 'rgba(201,168,76,.25)', border: '1px solid rgba(201,168,76,.5)',
                borderRadius: '20px', padding: '4px 14px', fontSize: '12px', color: '#f0d080', fontWeight: 700 }}>
                {count} Products
              </span>
            </div>
          </div>

          {/* Featured product visual — real studio photography that already
              exists, shown contained (never stretched/cropped) with a soft
              drop shadow, instead of a blown-up logo. Hidden on narrow
              screens where there's no room for it to breathe. */}
          {heroProductImg && (
            <div className="coll-hero-visual" style={{ flexShrink: 0, width: '230px', height: '230px',
              display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
              <div style={{ position: 'absolute', inset: '10%', borderRadius: '50%',
                background: 'radial-gradient(circle, rgba(201,168,76,.25), transparent 70%)' }} />
              <Image src={heroProductImg} alt="" width={210} height={210}
                style={{ objectFit: 'contain', maxWidth: '100%', maxHeight: '100%',
                  filter: 'drop-shadow(0 24px 28px rgba(0,0,0,.35))', position: 'relative' }} />
            </div>
          )}
        </div>
      </div>

      <style>{`
        @media (max-width: 760px) {
          .coll-hero-visual { display: none; }
        }
      `}</style>

      {/* ── Category nav bar ── */}
      {allCategories.length > 1 && (
        <div style={{ background: '#fff', borderBottom: '1px solid #e8e0d0',
          padding: '12px 40px', overflowX: 'auto' }}>
          <div style={{ display: 'flex', gap: '8px', minWidth: 'max-content' }}>
            <Link href="/products" style={{ padding: '6px 16px', borderRadius: '20px', fontSize: '12px',
              fontWeight: 700, textDecoration: 'none', background: '#f0f7f1', color: '#1a3a1e',
              border: '1.5px solid #c8d8ca', whiteSpace: 'nowrap' }}>🌿 All</Link>
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
                {opt.icon} {opt.label}
              </Link>
            ))}
          </div>
        </div>

        {/* Grid */}
        {products.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center',
            padding: '80px 20px', textAlign: 'center' }}>
            <div style={{ fontSize: '52px', marginBottom: '16px' }}>🔍</div>
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
