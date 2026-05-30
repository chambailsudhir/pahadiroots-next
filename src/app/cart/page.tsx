'use client'

/**
 * cart/page.tsx — Lean orchestrator (~200 lines)
 *
 * All UI delegated to:
 *   CartSkeleton      → animated skeleton while stores hydrate
 *   CartItemCard      → memoized item row with qty animations
 *   UpsellSection     → DB-driven upsells with shimmer loading
 *   ReviewSection     → rotating reviews (DB keys + fallback)
 *   PahadiStoryCard   → farmer story, certifications, sourcing journey
 *   CartSummary       → coupon, price breakdown, CTA
 *   StickyCartCTA     → mobile fixed bottom CTA
 *   EmptyCart         → empty state
 *
 * ADMIN SETTINGS CONSUMED:
 *   free_shipping_min, flat_shipping_charge, whatsapp_number
 *   review_1/2/3_name/location/text
 */

import Link from 'next/link'
import { useState, useEffect, useCallback, lazy, Suspense } from 'react'
import { useCartStore } from '@/store/cartStore'
import { formatPrice } from '@/lib/utils'
import { calcPriceSummary } from '@/lib/services/pricingService'
import type { SiteSettings, UpsellItem } from '@/types'

import CartSkeleton               from '@/components/cart/CartSkeleton'
import CartItemCard                from '@/components/cart/CartItemCard'
import CartSummary                 from '@/components/cart/CartSummary'
import { StickyCartCTA, EmptyCart } from '@/components/cart/CartUIComponents'
import { useCartAnalytics }        from '@/hooks/useCheckoutAnalytics'

// Lazy-load below-fold sections for performance (Issue 9)
const UpsellSection   = lazy(() => import('@/components/cart/UpsellSection'))
const ReviewSection   = lazy(() => import('@/components/cart/ReviewSection'))
const PahadiStoryCard = lazy(() => import('@/components/cart/PahadiStoryCard'))

// ─── Fallback reviews ─────────────────────────────────────────────────────────
const FALLBACK_REVIEWS = [
  { name:'Priya M.',  location:'Delhi',     text:"Best quality rice I've ever had. Pure taste!" },
  { name:'Rahul S.',  location:'Mumbai',    text:'Authentic Pahadi flavours, delivered fresh.'   },
  { name:'Anita K.',  location:'Bangalore', text:"Love the ghee — just like dadi's kitchen."    },
]

// ─── Component ────────────────────────────────────────────────────────────────
export default function CartPage() {
  // Hydration guard — stores use skipHydration:true
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])

  const items        = useCartStore(s => s.items)
  const coupon       = useCartStore(s => s.coupon)
  const applyCoupon  = useCartStore(s => s.applyCoupon)
  const removeCoupon = useCartStore(s => s.removeCoupon)
  const removeItem   = useCartStore(s => s.removeItem)
  const updateQty    = useCartStore(s => s.updateQty)
  const addItem      = useCartStore(s => s.addItem)

  const [couponCode,    setCouponCode]    = useState('')
  const [couponLoading, setCouponLoading] = useState(false)
  const [couponError,   setCouponError]   = useState('')
  const [upsellItems,   setUpsellItems]   = useState<UpsellItem[]>([])
  const [upsellLoading, setUpsellLoading] = useState(true)
  const [upsellError,   setUpsellError]   = useState(false)
  const [addedUpsell,   setAddedUpsell]   = useState<string[]>([])
  const [reviews,       setReviews]       = useState(FALLBACK_REVIEWS)
  const [qtyAnim,       setQtyAnim]       = useState<Record<string,'up'|'down'|null>>({})
  // Settings loaded from store-data — single fetch, no SWR double-fetch
  const [s, setS] = useState<SiteSettings>({} as SiteSettings)

  // Undo toast: keyed by variantId — holds the item snapshot + timer ref
  const [pendingRemoval, setPendingRemoval] = useState<{
    variantId: string
    name: string
    timerId: ReturnType<typeof setTimeout>
  } | null>(null)

  const freeShipMin = parseFloat(s.free_shipping_min || '0') || 0
  const pricing     = calcPriceSummary(items, s, coupon, 'cod')
  const progressPct = freeShipMin > 0 ? Math.min(100, (pricing.subtotal / freeShipMin) * 100) : 100
  const totalQty    = items.reduce((sum, i) => sum + i.qty, 0)

  // Analytics
  const analytics = useCartAnalytics({ itemCount: items.length, subtotal: pricing.subtotal })

  // Stable fingerprint of cart item IDs (sorted variantIds, no quantities).
  // Changes only when items are added or removed — NOT on qty updates.
  // This prevents a spurious re-fetch every time the user taps +/−.
  const cartFingerprint = items.map(i => i.variantId).sort().join(',')

  // Fetch upsells + live reviews + settings in a single request.
  // Previously settings were also fetched via SWR (useSWR → Supabase direct).
  // That second fetch has been removed — store-data already returns settings.
  useEffect(() => {
    // Capture a snapshot of cart IDs at fetch time so the closure is stable
    const variantIds  = new Set(items.map(i => i.variantId))
    const productIds  = new Set(items.map(i => i.productId))

    setUpsellLoading(true)
    setUpsellError(false)

    fetch('/api/v1/store-data')
      .then(async r => {
        if (!r.ok) throw new Error(`store-data ${r.status}`)
        const data = await r.json()

        // ── Settings (single source of truth) ─────────────────────────────
        const ss: SiteSettings = data.settings || {}
        setS(ss)

        // Live reviews from site_settings keys
        const dbRevs = [1,2,3].map(n => ({
          name:     ss[`review_${n}_name`     as keyof SiteSettings] as string || FALLBACK_REVIEWS[n-1]?.name,
          location: ss[`review_${n}_location` as keyof SiteSettings] as string || FALLBACK_REVIEWS[n-1]?.location,
          text:     ss[`review_${n}_text`     as keyof SiteSettings] as string || FALLBACK_REVIEWS[n-1]?.text,
        })).filter(r => r.name && r.text)
        if (dbRevs.length > 0) setReviews(dbRevs)

        // ── Upsells ────────────────────────────────────────────────────────
        // Raw API shapes — narrowed just enough for the fields we access
        interface RawVariant { id: string; product_id: string; is_active: boolean; available_stock: number; price: number; mrp: number; size?: string; weight?: string }
        interface RawProduct  { id: string; name?: string; slug?: string; emoji?: string | null; gst_rate?: number; state_id?: string | null; badges_organic?: boolean; badges_bestseller?: boolean; badges_new?: boolean }
        interface RawImage    { product_id: string; image_url: string }
        const variants: RawVariant[] = data.product_variants || []
        const products: RawProduct[] = data.products         || []
        const images:   RawImage[]   = data.product_images   || []
        const prodMap = Object.fromEntries(products.map(p => [p.id, p]))
        const imgMap: Record<string,string> = {}
        images.forEach(img => { if (!imgMap[img.product_id]) imgMap[img.product_id] = img.image_url })

        // Deduplicate by product_id: pick the best-stocked variant per product.
        const seenProducts = new Set<string>()
        const upsells = variants
          .filter(v => v.is_active && v.available_stock > 0 && !variantIds.has(v.id) && !productIds.has(v.product_id))
          .sort((a, b) => b.available_stock - a.available_stock)
          .filter(v => {
            if (seenProducts.has(v.product_id)) return false
            seenProducts.add(v.product_id)
            return true
          })
          .slice(0, 6)
          .map(v => {
            const p = prodMap[v.product_id] || {}
            const badge = p.badges_bestseller ? 'Bestseller'
              : p.badges_organic              ? 'Organic'
              : p.badges_new                  ? 'New Arrival'
              : null
            return {
              id:v.id, productId:v.product_id, name:p.name||'Product',
              slug:p.slug||'', size:v.size||v.weight||'',
              price:v.price, mrp:v.mrp||v.price,
              emoji:p.emoji||null, image:imgMap[v.product_id]||null,
              gstRate:p.gst_rate||5, maxQty:v.available_stock||10,
              badge,
              isOrganic:    !!(p.badges_organic),
              isHimalayan:  !!(p.state_id),
              isBestseller: !!(p.badges_bestseller),
            }
          })
        setUpsellItems(upsells)
      })
      .catch((err: unknown) => {
        // Surface the error so devs can diagnose failures in production logs
        console.error('[CartPage] store-data fetch failed:', err)
        setUpsellError(true)
        // Reviews and settings fall back to their initial values (FALLBACK_REVIEWS / {})
      })
      .finally(() => setUpsellLoading(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cartFingerprint]) // stable fingerprint: only changes on item add/remove, not qty

  // Handlers — all stable with useCallback (Issue 9: avoid re-renders)
  const handleQtyChange = useCallback((variantId: string, newQty: number, oldQty: number) => {
    const item = items.find(i => i.variantId === variantId)
    if (item) analytics.trackQuantityChanged(item.name, oldQty, newQty)
    const dir = newQty > oldQty ? 'up' : 'down'
    setQtyAnim(a => ({ ...a, [variantId]: dir }))
    updateQty(variantId, newQty)
    setTimeout(() => setQtyAnim(a => ({ ...a, [variantId]: null })), 320)
  }, [items, updateQty, analytics])

  const handleRemove = useCallback((variantId: string, name: string, price: number) => {
    // Cancel any existing pending removal (user removed a different item)
    if (pendingRemoval) {
      clearTimeout(pendingRemoval.timerId)
      removeItem(pendingRemoval.variantId) // commit the previous one immediately
    }
    analytics.trackItemRemoved(name, price)
    // Schedule actual removal after 4s — user can undo in the meantime
    const timerId = setTimeout(() => {
      removeItem(variantId)
      setPendingRemoval(null)
    }, 4000)
    setPendingRemoval({ variantId, name, timerId })
  }, [pendingRemoval, removeItem, analytics])

  const handleUndoRemove = useCallback(() => {
    if (!pendingRemoval) return
    clearTimeout(pendingRemoval.timerId)
    setPendingRemoval(null)
  }, [pendingRemoval])

  const handleUpsellAdd = useCallback((p: UpsellItem) => {
    if (addedUpsell.includes(p.id)) return
    addItem({
      productId:p.productId, variantId:p.id, name:p.name,
      slug:p.slug, image:p.image, emoji:p.emoji, size:p.size,
      price:p.price, mrp:p.mrp, gstRate:p.gstRate, maxQty:p.maxQty,
      isOrganic:    p.isOrganic    ?? false,
      isHimalayan:  p.isHimalayan  ?? false,
      isBestseller: p.isBestseller ?? false,
    })
    analytics.trackUpsellAdded(p.name, p.price)
    setAddedUpsell(a => [...a, p.id])
  }, [addedUpsell, addItem, analytics])

  const handleCoupon = useCallback(async () => {
    if (!couponCode.trim()) return
    setCouponLoading(true); setCouponError('')
    try {
      const res  = await fetch('/api/v1/coupons', {
        method:'POST', headers:{ 'Content-Type':'application/json' },
        body: JSON.stringify({ code:couponCode.trim().toUpperCase(), subtotal:pricing.subtotal }),
      })
      const data = await res.json()
      if (!res.ok) {
        setCouponError(data.error || 'Invalid coupon')
        return
      }
      applyCoupon(data.coupon)
      setCouponCode('')
    } catch { setCouponError('Failed to apply coupon') }
    finally  { setCouponLoading(false) }
  }, [couponCode, pricing.subtotal, applyCoupon])

  // ── Render guards ──────────────────────────────────────────────────────────
  if (!mounted) return <CartSkeleton />
  if (items.length === 0) return <EmptyCart />

  return (
    <main id="main-content">
      {/* Shipping progress bar */}
      <div className="cp-ship-bar">
        {freeShipMin > 0 ? (
          pricing.isFreeShipping
            ? <span>🎉 You&apos;ve unlocked <strong>free shipping</strong>!</span>
            : <span>🚚 Add <strong>{formatPrice(pricing.remainingForFreeShip)}</strong> more for FREE shipping</span>
        ) : '🚚 Free shipping on all orders!'}
        {freeShipMin > 0 && (
          <div className="cp-ship-track">
            <div className="cp-ship-fill" style={{ width:`${progressPct}%` }} />
          </div>
        )}
      </div>

      {/* Progress steps */}
      <div className="cp-steps">
        <div className="cp-step cp-step-active"><span>1</span> Cart</div>
        <div className="cp-step-line" />
        <div className="cp-step"><span>2</span> Checkout</div>
        <div className="cp-step-line" />
        <div className="cp-step"><span>3</span> Confirmation</div>
      </div>

      <div className="cp-layout">

        {/* ══ LEFT ══════════════════════════════════════════ */}
        <div className="cp-left">

          {/* Cart items card */}
          <div className="cp-card">
            <div className="cp-card-head">
              <h2 className="cp-card-title">Your Items ({totalQty})</h2>
              <Link href="/products" className="cp-card-link">+ Add more</Link>
            </div>
            <div className="cp-items">
              {items
                .filter(item => item.variantId !== pendingRemoval?.variantId)
                .map(item => (
                <CartItemCard
                  key={item.variantId}
                  item={item}
                  qtyAnim={qtyAnim[item.variantId] || null}
                  onQtyChange={handleQtyChange}
                  onRemove={handleRemove}
                />
              ))}
              {/* Undo toast */}
              {pendingRemoval && (
                <div className="cp-undo-toast" role="status" aria-live="polite">
                  <span>"{pendingRemoval.name}" removed</span>
                  <button className="cp-undo-btn" onClick={handleUndoRemove}>Undo</button>
                </div>
              )}
            </div>
          </div>

          {/* Upsell — lazy loaded, shimmer while loading */}
          <Suspense fallback={null}>
            <UpsellSection
              items={upsellItems}
              loading={upsellLoading}
              error={upsellError}
              addedIds={addedUpsell}
              remainingForFreeShip={pricing.remainingForFreeShip}
              isFreeShipping={pricing.isFreeShipping}
              freeShipMin={freeShipMin}
              onAdd={handleUpsellAdd}
            />
          </Suspense>

          {/* Pahadi story — lazy loaded */}
          <Suspense fallback={null}>
            <PahadiStoryCard />
          </Suspense>

          {/* Trust grid */}
          <div className="cp-card cp-trust-card">
            <div className="cp-trust-grid">
              {([
                ['🌿','100% Natural','No chemicals or preservatives'],
                ['🏔','Himalayan Sourced','Direct from mountain farmers'],
                ['🤝','Farmer Direct','Fair trade, fair prices'],
                ['📦','Small Batch','Fresh, limited production'],
              ] as const).map(([icon, label, desc]) => (
                <div key={label} className="cp-trust-item">
                  <span className="cp-trust-icon">{icon}</span>
                  <div className="cp-trust-label">{label}</div>
                  <div className="cp-trust-desc">{desc}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Reviews — lazy loaded */}
          <Suspense fallback={null}>
            <ReviewSection reviews={reviews} />
          </Suspense>

          {/* Delivery promise */}
          <div className="cp-card cp-delivery-card">
            <div className="cp-delivery-grid">
              {([
                ['🚚','Delivery in 3–5 Days','Pan India'],
                ['🔄','Easy Returns','7-day policy'],
                ['🔒','Secure Payment','SSL encrypted'],
                ['📞','WhatsApp Support','Mon–Sat 9am–6pm'],
              ] as const).map(([icon, label, sub]) => (
                <div key={label} className="cp-delivery-item">
                  <span className="cp-delivery-icon">{icon}</span>
                  <div>
                    <div className="cp-delivery-label">{label}</div>
                    <div className="cp-delivery-sub">{sub}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* WhatsApp — admin-controlled */}
          {s.whatsapp_number && (
            <a href={`https://wa.me/${s.whatsapp_number}`}
              target="_blank" rel="noopener noreferrer" className="cp-whatsapp">
              <span>💬</span><span>Have a question? Chat on WhatsApp</span>
            </a>
          )}
        </div>

        {/* ══ RIGHT ══════════════════════════════════════════ */}
        <div className="cp-right">
          <CartSummary
            items={items}
            totalQty={totalQty}
            pricing={pricing}
            coupon={coupon}
            onApplyCoupon={handleCoupon}
            onRemoveCoupon={removeCoupon}
            couponCode={couponCode}
            onCouponCodeChange={setCouponCode}
            couponLoading={couponLoading}
            couponError={couponError}
            minOrderAmt={parseFloat(s.min_order_amount || '0')}
          />
        </div>
      </div>

      {/* Mobile sticky CTA */}
      <StickyCartCTA total={pricing.total} totalQty={totalQty} />

      <style>{PAGE_CSS}</style>
    </main>
  )
}

// Page-level layout CSS only — component CSS lives in each component
const PAGE_CSS = `
:root{
  --forest:#1a3a1e;--forest-mid:#2d5233;--forest-lt:#e8f5e9;
  --earth:#c8920a;--stone:#f5f0e8;--stone-mid:#ede8df;
  --white:#fff;--ink:#1a1a1a;--muted:#7a7565;--border:#e2dbd0;
  --r:14px;
}
.cp-ship-bar{
  background:linear-gradient(135deg,var(--forest),var(--forest-mid));
  color:rgba(255,255,255,.95);text-align:center;padding:9px 20px;font-size:13px;
}
.cp-ship-track{height:5px;background:rgba(255,255,255,.2);border-radius:99px;
  margin:7px auto 0;max-width:380px;overflow:hidden;}
.cp-ship-fill{height:100%;background:linear-gradient(90deg,var(--earth),#e8a82a);
  border-radius:99px;transition:width .7s cubic-bezier(.4,0,.2,1);}
.cp-steps{display:flex;align-items:center;justify-content:center;
  padding:13px 16px;background:var(--white);border-bottom:1px solid var(--border);}
.cp-step{display:flex;align-items:center;gap:6px;font-size:12px;font-weight:600;color:#bbb;}
.cp-step span{width:22px;height:22px;border-radius:50%;background:#eee;
  display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;}
.cp-step-active{color:var(--forest);}
.cp-step-active span{background:var(--forest);color:#fff;}
.cp-step-line{width:44px;height:2px;background:#e8e8e8;margin:0 8px;}
.cp-layout{display:grid;grid-template-columns:1fr 374px;gap:0;
  max-width:1380px;margin:0 auto;background:var(--stone);
  align-items:start;min-height:calc(100vh - 180px);overflow:hidden;}
@media(max-width:960px){.cp-layout{grid-template-columns:1fr;}}
.cp-left{padding:24px 28px;display:flex;flex-direction:column;gap:18px;}
@media(max-width:640px){.cp-left{padding:16px;}}
.cp-card{background:var(--white);border-radius:var(--r);
  box-shadow:0 2px 8px rgba(0,0,0,.06),0 0 0 1px rgba(0,0,0,.03);
  border:1px solid var(--border);overflow:hidden;transition:box-shadow .22s;}
.cp-card:hover{box-shadow:0 6px 20px rgba(0,0,0,.09),0 0 0 1px rgba(0,0,0,.04);}
.cp-card-head{padding:16px 20px 12px;border-bottom:1px solid var(--stone-mid);
  display:flex;align-items:center;justify-content:space-between;}
.cp-card-title{font-family:var(--font-playfair,'Playfair Display',serif);
  font-size:16px;font-weight:700;color:var(--ink);margin:0;}
.cp-card-link{font-size:12px;color:var(--forest);font-weight:600;text-decoration:none;}
.cp-card-link:hover{opacity:.7;}
.cp-items{padding:4px 0;}
.cp-trust-card{padding:0;}
.cp-trust-grid{display:grid;grid-template-columns:1fr 1fr;}
.cp-trust-item{padding:18px 20px;text-align:center;
  border-right:1px solid var(--stone-mid);border-bottom:1px solid var(--stone-mid);}
.cp-trust-item:nth-child(2n){border-right:none;}
.cp-trust-item:nth-child(3),.cp-trust-item:nth-child(4){border-bottom:none;}
.cp-trust-icon{font-size:26px;display:block;}
.cp-trust-label{font-size:13px;font-weight:700;color:var(--ink);margin-top:5px;}
.cp-trust-desc{font-size:11px;color:var(--muted);margin-top:2px;}
.cp-delivery-card{padding:0;}
.cp-delivery-grid{display:grid;grid-template-columns:1fr 1fr;}
.cp-delivery-item{display:flex;align-items:flex-start;gap:10px;padding:14px 18px;
  border-right:1px solid var(--stone-mid);border-bottom:1px solid var(--stone-mid);}
.cp-delivery-item:nth-child(2n){border-right:none;}
.cp-delivery-item:nth-child(3),.cp-delivery-item:nth-child(4){border-bottom:none;}
.cp-delivery-icon{font-size:20px;flex-shrink:0;margin-top:2px;}
.cp-delivery-label{font-size:12px;font-weight:700;color:var(--ink);}
.cp-delivery-sub{font-size:11px;color:var(--muted);margin-top:1px;}
.cp-whatsapp{display:flex;align-items:center;justify-content:center;gap:8px;
  background:#25d366;color:#fff;text-decoration:none;padding:13px 20px;
  border-radius:12px;font-size:13px;font-weight:700;
  box-shadow:0 3px 10px rgba(37,211,102,.3);transition:all .2s;}
.cp-whatsapp:hover{background:#22be5c;transform:translateY(-1px);}
.cp-undo-toast{
  display:flex;align-items:center;justify-content:space-between;
  padding:12px 20px;background:#1a1a1a;color:#fff;
  font-size:13px;animation:cp-toast-in .22s ease;
}
@keyframes cp-toast-in{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:translateY(0)}}
.cp-undo-btn{
  background:none;border:1.5px solid rgba(255,255,255,.4);color:#fff;
  font-size:12px;font-weight:700;padding:4px 12px;border-radius:8px;
  cursor:pointer;transition:all .15s;font-family:inherit;flex-shrink:0;
}
.cp-undo-btn:hover{background:rgba(255,255,255,.15);border-color:rgba(255,255,255,.7);}
.cp-right{background:var(--white);border-left:1px solid var(--border);
  position:sticky;top:134px;max-height:calc(100vh - 134px);
  overflow-y:auto;overflow-x:hidden;width:100%;min-width:0;}
@media(max-width:960px){
  .cp-right{position:static;border-left:none;
    border-top:1px solid var(--border);max-height:none;width:auto;}
  .cp-layout{padding-bottom:76px;}
}
`
