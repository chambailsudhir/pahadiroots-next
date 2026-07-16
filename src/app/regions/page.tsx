import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { getStoreData, getProductsWithImages } from '@/lib/storeData'
import { normalizeProducts } from '@/lib/normalizeProduct'
// BUG FIX: this file used to define its own local copy of REGION_META,
// duplicated (and already drifted) from the copy in ExploreByRegion.tsx.
// Now both — plus the region detail page — import the single shared copy.
import { getRegionMeta } from '@/lib/regionMeta'

export const revalidate = 300

export const metadata: Metadata = {
  title: 'Explore Himalayan Regions — Pahadi Roots',
  description: 'Every state carries its own story — ancient forests, sacred rivers, and flavours shaped by altitude. Discover the best of each region.',
}

export default async function RegionsPage() {
  const storeData = await getStoreData()
  const states = storeData.states || []

  // Count products per state
  const withImages = getProductsWithImages(storeData)
  const allProducts = normalizeProducts(withImages)
  const productCountByState: Record<string, number> = {}
  allProducts.forEach((p: any) => {
    if (p.state_id) {
      // BUG FIX: previously compared String(p.state_id) directly against
      // state ids with no case-normalization. If a product's state_id was
      // ever stored with different casing than states.id (e.g. "HP" vs
      // "hp"), this count would silently miss it and disagree with the
      // count shown on /regions/[slug]. Both sides are now lowercased.
      const sid = String(p.state_id).toLowerCase()
      productCountByState[sid] = (productCountByState[sid] || 0) + 1
    }
  })
  // BUG FIX: the hero "Products" stat previously used allProducts.length —
  // the ENTIRE catalog, including any product with no state_id at all
  // (e.g. gift sets/combos not tied to a region). It now sums only the
  // region-tagged products actually reflected in the cards below, so the
  // stat can never overcount vs. what's actually being showcased here.
  const totalRegionProducts = Object.values(productCountByState).reduce((a, b) => a + b, 0)

  // Get state images
  const stateImageMap: Record<string, string> = {}
  ;(storeData.state_images || []).forEach((img: any) => {
    const sid = String(img.state_id)
    if (!stateImageMap[sid]) stateImageMap[sid] = img.image_url
  })
  states.forEach((s: any) => {
    if (!stateImageMap[String(s.id)] && s.image_path) stateImageMap[String(s.id)] = s.image_path
  })

  const serif = '"Playfair Display",Georgia,serif'
  const sans  = 'Lato,sans-serif'

  return (
    <div style={{ background: '#f4eed6', minHeight: '100vh' }}>

      {/* ── Hero ── */}
      <div style={{
        background: 'linear-gradient(135deg,#1a3a1e 0%,#2d5a35 60%,#3a7042 100%)',
        padding: '52px 48px 44px', position: 'relative', overflow: 'hidden',
      }}>
        <div style={{ position: 'absolute', inset: 0, opacity: 0.04,
          backgroundImage: 'radial-gradient(circle at 20% 50%,#fff 1px,transparent 1px)',
          backgroundSize: '30px 30px' }} />
        <div style={{ maxWidth: '1400px', margin: '0 auto', position: 'relative' }}>
          {/* Breadcrumb */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'rgba(255,255,255,.55)', marginBottom: 18, fontFamily: sans }}>
            <Link href="/" style={{ color: 'rgba(255,255,255,.55)', textDecoration: 'none' }}>Home</Link>
            <span>/</span>
            <span style={{ color: '#fff' }}>All Regions</span>
          </div>
          <div style={{ fontSize: 36, marginBottom: 8 }}>🗺️</div>
          <h1 style={{ fontFamily: serif, fontSize: 'clamp(28px,4vw,52px)', fontWeight: 700, color: '#fff', margin: '0 0 12px', lineHeight: 1.15 }}>
            Explore Himalayan Regions
          </h1>
          <p style={{ color: 'rgba(255,255,255,.75)', fontSize: 15, maxWidth: 560, lineHeight: 1.7, margin: '0 0 28px', fontFamily: sans }}>
            Every state carries its own story — ancient forests, sacred rivers, and flavours shaped by altitude.
            Discover the best of each region, sourced directly from farming communities.
          </p>
          {/* Stats */}
          <div style={{ display: 'flex', gap: 36, flexWrap: 'wrap' }}>
            {[
              { val: `${states.length}`, lbl: 'Himalayan States' },
              { val: `${totalRegionProducts}`, lbl: 'Products' },
              { val: '200+', lbl: 'Farming Families' },
            ].map(s => (
              <div key={s.lbl}>
                <div style={{ fontFamily: serif, fontSize: 28, fontWeight: 700, color: '#e8b84b' }}>{s.val}</div>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,.6)', fontFamily: sans, marginTop: 2 }}>{s.lbl}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── States count ── */}
      <div style={{ maxWidth: '1400px', margin: '0 auto', padding: '28px 48px 8px', fontFamily: sans }}>
        <p style={{ fontSize: 13, color: '#7a7a7a' }}>{states.length} states found</p>
      </div>

      {/* ── Cards Grid ── */}
      <div style={{ maxWidth: '1400px', margin: '0 auto', padding: '8px 48px 60px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(300px,1fr))', gap: 28 }}>
          {states.map((state: any) => {
            const sid = String(state.id)
            const meta = getRegionMeta(sid)
            const imgUrl = stateImageMap[sid] || null
            // BUG FIX: lookup key must match the lowercased keys used to
            // build productCountByState above, or counts can silently
            // read as 0 whenever casing differs.
            const count = productCountByState[sid.toLowerCase()] || 0

            return (
              <Link
                key={sid}
                href={`/regions/${sid}`}
                style={{ textDecoration: 'none', display: 'flex', flexDirection: 'column', borderRadius: 20, overflow: 'hidden', background: '#fff', boxShadow: '0 2px 16px rgba(0,0,0,.08)', border: '1px solid rgba(0,0,0,.06)', transition: 'transform .25s, box-shadow .25s' }}
                className="region-card"
              >
                {/* Image */}
                <div style={{ position: 'relative', height: 180, background: meta?.panelBg ?? '#1a3a1e', overflow: 'hidden', flexShrink: 0 }}>
                  {imgUrl ? (
                    <Image src={imgUrl} alt={state.name} fill sizes="400px" style={{ objectFit: 'cover', objectPosition: 'center top' }} />
                  ) : (
                    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 64, opacity: .5 }}>
                      {meta?.emoji ?? '🏔️'}
                    </div>
                  )}
                  {/* Gradient overlay */}
                  <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top,rgba(0,0,0,.65) 0%,transparent 55%)' }} />
                  {/* Product count badge */}
                  {count > 0 && (
                    <div style={{ position: 'absolute', top: 12, right: 12, background: 'rgba(0,0,0,.55)', backdropFilter: 'blur(6px)', color: '#fff', fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 20, fontFamily: sans }}>
                      {count} product{count !== 1 ? 's' : ''}
                    </div>
                  )}
                  {/* State name on image */}
                  <div style={{ position: 'absolute', bottom: 14, left: 16, right: 16 }}>
                    <div style={{ fontFamily: serif, fontSize: 20, fontWeight: 700, color: '#fff', lineHeight: 1.2 }}>{state.name}</div>
                    {meta?.tagline && <div style={{ fontSize: 11, color: 'rgba(255,255,255,.7)', fontFamily: sans, marginTop: 2 }}>{meta.tagline}</div>}
                  </div>
                </div>

                {/* Body */}
                <div style={{ padding: '16px 18px 20px', flex: 1, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {/* Pills */}
                  {meta?.pills && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                      {meta.pills.slice(0, 3).map(pill => (
                        <span key={pill} style={{ background: '#f0f7f1', border: '1px solid #d4e8d8', color: '#2d5a35', fontSize: 10, fontWeight: 700, padding: '3px 9px', borderRadius: 20, fontFamily: sans }}>
                          {pill}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Snippet */}
                  <p style={{ fontSize: 13, color: '#555', lineHeight: 1.65, margin: 0, fontFamily: sans,
                    overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical' } as React.CSSProperties}>
                    {meta?.snippet ?? state.description ?? ''}
                  </p>

                  {/* CTA */}
                  <div style={{ marginTop: 'auto', paddingTop: 8 }}>
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', gap: 8,
                      background: '#1a3a1e', color: '#fff', borderRadius: 24,
                      padding: '9px 20px', fontSize: 12, fontWeight: 800,
                      fontFamily: sans, letterSpacing: '.3px',
                    }}>
                      Explore Products <span style={{ fontSize: 14 }}>→</span>
                    </span>
                  </div>
                </div>
              </Link>
            )
          })}
        </div>
      </div>

      <style>{`
        .region-card:hover { transform: translateY(-6px); box-shadow: 0 16px 48px rgba(26,58,30,.16) !important; }
        @media(max-width:768px) { .region-card { min-width: 0; } }
      `}</style>
    </div>
  )
}
