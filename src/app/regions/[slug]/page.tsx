import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { getStoreData, getNormalizedProducts } from '@/lib/storeData'
import { toCardProductData } from '@/lib/normalizeProduct'
import ProductCard from '@/components/product/ProductCard'
import type { Product } from '@/types'
// BUG FIX: this page previously never referenced the curated region copy
// (tagline, pills, per-region hero color) used on /regions and the
// homepage widget — it only showed the raw DB `state.description` (which
// can be null) against a hardcoded dark-green hero regardless of which
// state you were viewing. Now shares the same single source of truth.
import { getRegionMeta } from '@/lib/regionMeta'
import { truncate } from '@/lib/utils'
// BUG FIX (feature gap — no sort/filter parity with /products): reuses the
// same extracted, unit-tested sortProducts() /products already uses, rather
// than inventing a second sort implementation for this page.
import { sortProducts, type ProductSort } from '@/lib/filterAndSortProducts'

const BASE = process.env.NEXT_PUBLIC_SITE_URL || 'https://pahadiroots.com'

const REGION_SORT_OPTIONS = [
  { value: 'newest',     label: 'Newest',      icon: '🆕' },
  { value: 'price_asc',  label: 'Price: Low → High', icon: '↑' },
  { value: 'price_desc', label: 'Price: High → Low', icon: '↓' },
  { value: 'popular',    label: 'Best Sellers', icon: '⭐' },
] as const

// BUG FIX (#27): same alignment as /regions — 300s was looser than the
// underlying 60s data cache TTL.
export const revalidate = 60 // was 300 (5 min) — now matches data cache TTL

// BUG FIX (Next.js 15+/16 migration): `params` is now a Promise.
interface Props { params: Promise<{ slug: string }>; searchParams: Promise<{ sort?: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const storeData = await getStoreData()
  const state = (storeData.states || []).find((s: any) => String(s.id) === slug)
  // BUG FIX (#15): the not-found case only set a title, relying solely on
  // the notFound()-triggered 404 HTTP status to keep it out of search
  // results. Explicit robots:noindex is a belt-and-braces signal search
  // engines respect even if the status code is misread by a crawler/proxy.
  if (!state) return { title: 'Region Not Found', robots: { index: false, follow: false } }

  const meta = getRegionMeta(state.id)
  // BUG FIX: previously only read the raw (possibly null) state.description
  // here — but the page body itself now prefers the curated
  // meta.description (see the /regions/[slug] content fix). Using the same
  // source for both keeps the SEO description and the actual on-page copy
  // in sync instead of silently disagreeing.
  const rawDesc = meta?.description || state.description || `Explore pure natural products from ${state.name}, sourced directly from mountain farming communities.`
  const desc = truncate(rawDesc, 155)
  const canonicalUrl = `${BASE}/regions/${state.id}`

  // Same image resolution used by the page body (state_images sort_order,
  // falling back to state.image_path).
  const stateImages = (storeData.state_images || [])
    .filter((i: any) => String(i.state_id) === String(state.id))
    .sort((a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
  const stateImageUrl = stateImages[0]?.image_url ?? state.image_path ?? null

  return {
    title:       `${state.name} Products — Shop Authentic Himalayan Products | HimVeda by Pahadi Roots`,
    description: desc,
    // BUG FIX (#13): no canonical previously — added so the /regions/{id}
    // URL is always declared authoritative.
    alternates: { canonical: canonicalUrl },
    // BUG FIX (#14): no openGraph block previously — sharing a region page
    // link got a blank/default preview card instead of the state's own
    // photo, name, and description.
    openGraph: {
      title: `${state.name} Products | HimVeda by Pahadi Roots`,
      description: desc,
      url: canonicalUrl,
      type: 'website',
      // BUG FIX: '/og-default.jpg' does not exist in /public — fell back to
      // a broken image whenever a region has no state image set. Matches
      // layout.tsx's fallback to the real logo.png asset.
      images: stateImageUrl ? [{ url: stateImageUrl, width: 1200, height: 630, alt: state.name }] : [{ url: '/logo.png', width: 1200, height: 630, alt: state.name }],
    },
    twitter: {
      card:        'summary_large_image',
      title:       `${state.name} Products | HimVeda by Pahadi Roots`,
      description: desc,
    },
  }
}

export default async function RegionPage({ params, searchParams }: Props) {
  const { slug } = await params
  const sp = await searchParams
  const sort = (sp.sort || 'newest') as ProductSort
  const storeData = await getStoreData()

  // Find state by id (e.g. "hp", "uk")
  const state = (storeData.states || []).find((s: any) => String(s.id) === slug)
  if (!state) notFound()

  // Get products for this state
  // BUG FIX (perf): this ran a full-catalog normalize independently on
  // every one of the 12 statically-generated /regions/[slug] pages during
  // ISR — 12x redundant O(n) work over the same data. Now shares one
  // cached pass across all region pages (see getNormalizedProducts()).
  const allProducts = await getNormalizedProducts()

  // BUG FIX: the old comparison only lowercased state.id, never `pid`
  // itself — so `pid === String(state.id).toLowerCase()` could never
  // match a pid that had different casing (e.g. state_id stored as "HP").
  // Both sides are now lowercased, matching the fix applied on
  // /regions/page.tsx and the homepage's buildStates().
  let stateProducts = allProducts.filter((p: any) => {
    const pid = String(p.state_id ?? '').toLowerCase()
    return pid === String(state.id).toLowerCase()
  }) as Product[]

  // BUG FIX (feature gap): no sort control previously existed here — a
  // state with 15-20 products had no way to sort by price/bestseller,
  // unlike /products. Reuses the same sortProducts() utility.
  stateProducts = sortProducts(stateProducts, sort)

  const meta = getRegionMeta(state.id)

  return (
    <div style={{ background: '#f9f4ec', minHeight: '100vh' }}>

      {/* BUG FIX (missing BreadcrumbList JSON-LD, same gap already fixed on
          /products/[slug]). Matches the corrected visual breadcrumb (bug
          #20) — Home / Regions / {State}, not Home / Products / Regions. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'BreadcrumbList',
            itemListElement: [
              { '@type': 'ListItem', position: 1, name: 'Home', item: `${BASE}/` },
              { '@type': 'ListItem', position: 2, name: 'Regions', item: `${BASE}/regions` },
              { '@type': 'ListItem', position: 3, name: state.name /* current page — no item URL per spec */ },
            ],
          })
            .replace(/</g, '\\u003c')
            .replace(/>/g, '\\u003e')
            .replace(/&/g, '\\u0026'),
        }}
      />

      {/* Hero — same box model as /collections/[slug]: padding-based, not
          fixed-height, no background photo. Previously this hero absolutely
          positioned the state photo (dimmed under a dark gradient) inside a
          fixed/clamped-height box; removed the image entirely per explicit
          request and switched to the collections hero's padding-driven
          sizing so the two hero types stay visually consistent. */}
      <div style={{
        background: meta?.panelBg ?? 'linear-gradient(135deg,#1a3a1e 0%,#2d5a35 60%,#3a7042 100%)',
        padding: '40px 40px 36px', position: 'relative', overflow: 'hidden'
      }}>
        <div className="region-hero-content" style={{ maxWidth: '1200px', margin: '0 auto', position: 'relative' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: 'rgba(255,255,255,.6)', marginBottom: '16px' }}>
            <Link href="/" style={{ color: 'rgba(255,255,255,.6)', textDecoration: 'none' }}>Home</Link>
            <span>/</span>
            <Link href="/regions" style={{ color: 'rgba(255,255,255,.6)', textDecoration: 'none' }}>Regions</Link>
            <span>/</span>
            <span style={{ color: '#fff' }}>{state.name}</span>
          </div>
          <h1 style={{ fontFamily: '"Playfair Display",serif', fontSize: 'clamp(26px,4vw,44px)', fontWeight: 700, color: '#fff', margin: '0 0 8px', fontStyle: 'italic' }}>
            {meta?.emoji ? `${meta.emoji} ` : ''}{state.name}
          </h1>
          {meta?.tagline && (
            <p style={{ fontSize: '14px', color: 'rgba(255,255,255,.75)', margin: 0, lineHeight: 1.6, maxWidth: '520px' }}>
              {meta.tagline}
            </p>
          )}
        </div>
      </div>

      <div className="region-shell" style={{ maxWidth: '1400px', margin: '0 auto', padding: '36px 40px 60px' }}>

        {/* State description */}
        {(meta?.description || state.description) && (
          <div style={{ maxWidth: '700px', marginBottom: '36px' }}>
            <h2 style={{ fontFamily: '"Playfair Display",serif', fontSize: '20px', fontWeight: 700, color: '#1a3a1e', marginBottom: '10px' }}>
              About {state.name}
            </h2>
            <p style={{ color: '#555', lineHeight: 1.8, fontSize: '14px' }}>
              {meta?.description || state.description}
            </p>
            {meta?.pills && meta.pills.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 14 }}>
                {meta.pills.map(pill => (
                  <span key={pill} style={{ background: '#f0f7f1', border: '1px solid #d4e8d8', color: '#2d5a35', fontSize: 11, fontWeight: 700, padding: '4px 11px', borderRadius: 20, fontFamily: 'Lato,sans-serif' }}>
                    {pill}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Products section */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
            <h2 style={{ fontFamily: '"Playfair Display",serif', fontSize: '22px', fontWeight: 700, color: '#1a3a1e' }}>
              Products from {state.name}
              <span style={{ marginLeft: '10px', fontSize: '14px', fontWeight: 400, fontFamily: 'Lato,sans-serif', color: '#666', fontStyle: 'normal' }}>
                ({stateProducts.length})
              </span>
            </h2>
            <Link href="/products" style={{
              fontSize: '13px', fontWeight: 700, color: '#1a3a1e', textDecoration: 'none',
              border: '1.5px solid #1a3a1e', borderRadius: '20px', padding: '8px 18px'
            }}>
              All Products →
            </Link>
          </div>

          {/* BUG FIX (feature gap): no sort control previously existed on this
              page — a state with many products had no way to sort by price
              or popularity, unlike /products. Same Link-based pattern
              /products uses (works without client JS, since this stays a
              Server Component). */}
          {stateProducts.length > 1 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '24px' }}>
              {REGION_SORT_OPTIONS.map(opt => (
                <Link
                  key={opt.value}
                  href={`/regions/${state.id}${opt.value === 'newest' ? '' : `?sort=${opt.value}`}`}
                  prefetch={false}
                  style={{
                    fontSize: '12px', fontWeight: sort === opt.value ? 700 : 500,
                    color: sort === opt.value ? '#1a3a1e' : '#666',
                    background: sort === opt.value ? '#f0f7f1' : 'transparent',
                    border: sort === opt.value ? '1px solid #d4e8d8' : '1px solid transparent',
                    borderRadius: '16px', padding: '5px 12px', textDecoration: 'none', fontFamily: 'Lato,sans-serif',
                  }}
                >
                  {opt.icon} {opt.label}
                </Link>
              ))}
            </div>
          )}

          {stateProducts.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '80px 20px' }}>
              <div style={{ fontSize: '48px', marginBottom: '16px' }}>🏔️</div>
              <p style={{ color: '#666', fontSize: '15px', marginBottom: '16px' }}>
                Products from {state.name} coming soon.
              </p>
              <Link href="/products" style={{
                display: 'inline-block', background: '#1a3a1e', color: '#fff',
                borderRadius: '24px', padding: '10px 24px', fontSize: '13px',
                fontWeight: 700, textDecoration: 'none'
              }}>
                Browse all products
              </Link>
            </div>
          ) : (
            <div className="pgrid">
              {stateProducts.map((p, i) => (
                <ProductCard key={p.id} product={toCardProductData(p)} priority={i < 4} />
              ))}
            </div>
          )}
        </div>
      </div>

      <style>{`
        @media(max-width:640px) {
          .region-hero-content { padding-left: 20px !important; padding-right: 20px !important; }
          .region-shell { padding-left: 20px !important; padding-right: 20px !important; }
        }
      `}</style>
    </div>
  )
}

export async function generateStaticParams() {
  try {
    const storeData = await getStoreData()
    return (storeData.states || []).map((s: any) => ({ slug: String(s.id) }))
  } catch { return [] }
}
