import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import Image from 'next/image'
import Link from 'next/link'
import { getStoreData, getProductsWithImages } from '@/lib/storeData'
import { normalizeProducts, toCardProductData } from '@/lib/normalizeProduct'
import ProductCard from '@/components/product/ProductCard'
import type { Product } from '@/types'
// BUG FIX: this page previously never referenced the curated region copy
// (tagline, pills, per-region hero color) used on /regions and the
// homepage widget — it only showed the raw DB `state.description` (which
// can be null) against a hardcoded dark-green hero regardless of which
// state you were viewing. Now shares the same single source of truth.
import { getRegionMeta } from '@/lib/regionMeta'

export const revalidate = 300 // 5 min

// BUG FIX (Next.js 15+/16 migration): `params` is now a Promise.
interface Props { params: Promise<{ slug: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const storeData = await getStoreData()
  const state = (storeData.states || []).find((s: any) => String(s.id) === slug)
  if (!state) return { title: 'Region Not Found' }
  return {
    title:       `${state.name} Products — Shop Authentic Himalayan Products | Pahadi Roots`,
    description: state.description?.slice(0, 155) || `Explore pure natural products from ${state.name}, sourced directly from mountain farming communities.`,
  }
}

export default async function RegionPage({ params }: Props) {
  const { slug } = await params
  const storeData = await getStoreData()

  // Find state by id (e.g. "hp", "uk")
  const state = (storeData.states || []).find((s: any) => String(s.id) === slug)
  if (!state) notFound()

  // Get state image
  const stateImages = (storeData.state_images || [])
    .filter((i: any) => String(i.state_id) === String(state.id))
    .sort((a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
  const stateImageUrl = stateImages[0]?.image_url ?? state.image_path ?? null

  // Get products for this state using service key data (bypasses RLS)
  const withImages = getProductsWithImages(storeData)
  const allProducts = normalizeProducts(withImages)

  // BUG FIX: the old comparison only lowercased state.id, never `pid`
  // itself — so `pid === String(state.id).toLowerCase()` could never
  // match a pid that had different casing (e.g. state_id stored as "HP").
  // Both sides are now lowercased, matching the fix applied on
  // /regions/page.tsx and the homepage's buildStates().
  const stateProducts = allProducts.filter((p: any) => {
    const pid = String(p.state_id ?? '').toLowerCase()
    return pid === String(state.id).toLowerCase()
  }) as Product[]

  const meta = getRegionMeta(state.id)

  return (
    <div style={{ background: '#f9f4ec', minHeight: '100vh' }}>

      {/* Hero */}
      <div style={{
        position: 'relative', height: '280px',
        background: meta?.panelBg ?? 'linear-gradient(135deg,#1a3a1e,#2d5a35)',
        overflow: 'hidden'
      }}>
        {stateImageUrl && (
          <Image
            src={stateImageUrl}
            alt={state.name}
            fill
            sizes="100vw"
            style={{ objectFit: 'cover', objectPosition: 'center 30%', opacity: 0.55 }}
            priority
          />
        )}
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, rgba(0,0,0,.7) 0%, transparent 60%)' }} />
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', padding: '0 48px 32px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: 'rgba(255,255,255,.6)', marginBottom: '10px' }}>
            <Link href="/" style={{ color: 'rgba(255,255,255,.6)', textDecoration: 'none' }}>Home</Link>
            <span>/</span>
            <Link href="/products" style={{ color: 'rgba(255,255,255,.6)', textDecoration: 'none' }}>Products</Link>
            <span>/</span>
            <span style={{ color: '#fff' }}>Regions</span>
            <span>/</span>
            <span style={{ color: '#fff' }}>{state.name}</span>
          </div>
          <h1 style={{ fontFamily: '"Playfair Display",serif', fontSize: 'clamp(28px,4vw,48px)', fontWeight: 700, color: '#fff', margin: 0, fontStyle: 'italic' }}>
            {meta?.emoji ? `${meta.emoji} ` : ''}{state.name}
          </h1>
          {meta?.tagline && (
            <p style={{ fontSize: '13px', color: 'rgba(255,255,255,.7)', marginTop: '6px', fontFamily: 'Lato,sans-serif' }}>
              {meta.tagline}
            </p>
          )}
        </div>
      </div>

      <div style={{ maxWidth: '1400px', margin: '0 auto', padding: '36px 40px 60px' }}>

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
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
            <h2 style={{ fontFamily: '"Playfair Display",serif', fontSize: '22px', fontWeight: 700, color: '#1a3a1e' }}>
              Products from {state.name}
              <span style={{ marginLeft: '10px', fontSize: '14px', fontWeight: 400, fontFamily: 'Lato,sans-serif', color: '#999', fontStyle: 'normal' }}>
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

          {stateProducts.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '80px 20px' }}>
              <div style={{ fontSize: '48px', marginBottom: '16px' }}>🏔️</div>
              <p style={{ color: '#999', fontSize: '15px', marginBottom: '16px' }}>
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
    </div>
  )
}

export async function generateStaticParams() {
  try {
    const storeData = await getStoreData()
    return (storeData.states || []).map((s: any) => ({ slug: String(s.id) }))
  } catch { return [] }
}
