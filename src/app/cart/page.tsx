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
import { useState, useEffect, useCallback, useMemo, lazy, Suspense } from 'react'
import { useCartStore } from '@/store/cartStore'
import { formatPrice } from '@/lib/utils'
import { calcPriceSummary } from '@/lib/services/pricingService'
import type { SiteSettings, UpsellItem } from '@/types'

import CartSkeleton               from '@/components/cart/CartSkeleton'
import CartItemCard, { CART_ITEM_CARD_CSS } from '@/components/cart/CartItemCard'
import CartSummary                 from '@/components/cart/CartSummary'
import { StickyCartCTA, EmptyCart } from '@/components/cart/CartUIComponents'
import { useCartAnalytics }        from '@/hooks/useCheckoutAnalytics'
import ErrorBoundary               from '@/components/ui/ErrorBoundary'

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
  const lastAppliedCouponCode = useCartStore(s => s.lastAppliedCouponCode)

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

  // Undo toast queue: Map<variantId, {name, timerId}>.
  // A Map (not a single slot) means removing item B while A is pending does NOT
  // silently commit A — each item gets its own independent 4-second undo window.
  const [pendingRemovals, setPendingRemovals] = useState<
    Map<string, { name: string; timerId: ReturnType<typeof setTimeout> }>
  >(new Map())

  const freeShipMin = useMemo(() => parseFloat(s.free_shipping_min || '0') || 0, [s.free_shipping_min])
  // useMemo — calcPriceSummary is non-trivial; skip recalculation when deps are unchanged
  const pricing     = useMemo(() => calcPriceSummary(items, s, coupon, 'cod'), [items, s, coupon])
  // Use pricing.progressBase (= afterDiscount) — NOT pricing.subtotal — so the bar
  // always matches the engine. subtotal ignores coupon/loyalty; afterDiscount does not.
  const progressPct = useMemo(
    () => freeShipMin > 0 ? Math.min(100, (pricing.progressBase / freeShipMin) * 100) : 100,
    [freeShipMin, pricing.progressBase]
  )
  const totalQty    = useMemo(() => items.reduce((sum, i) => sum + i.qty, 0), [items])

  // Analytics
  const analytics = useCartAnalytics({ itemCount: items.length, subtotal: pricing.subtotal })

  // Coupon hint: if the store has a lastAppliedCouponCode but no active coupon
  // (cleared on refresh because coupon is session-only), pre-fill the input so
  // the user can see and re-apply their code with one click.
  // Runs once after hydration; the condition becomes false after Apply is tapped.
  useEffect(() => {
    if (lastAppliedCouponCode && !coupon && !couponCode) {
      setCouponCode(lastAppliedCouponCode)
    }
  // Only want this to fire once after the store hydrates — dependencies are stable
  // identities after hydration, so this is intentionally tight.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastAppliedCouponCode])

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
    analytics.trackItemRemoved(name, price)
    // Each item gets its own independent 4-second undo slot in the Map.
    // Removing item B no longer silently commits item A — both are pending
    // simultaneously until their individual timers fire or the user undoes them.
    const timerId = setTimeout(() => {
      removeItem(variantId)
      setPendingRemovals(prev => {
        const next = new Map(prev)
        next.delete(variantId)
        return next
      })
    }, 4000)
    setPendingRemovals(prev => {
      // If this item is already pending (e.g. tapped remove twice), clear the old
      // timer first to avoid double-firing removeItem.
      const existing = prev.get(variantId)
      if (existing) clearTimeout(existing.timerId)
      return new Map(prev).set(variantId, { name, timerId })
    })
  }, [removeItem, analytics])

  const handleUndoRemove = useCallback((variantId: string) => {
    setPendingRemovals(prev => {
      const entry = prev.get(variantId)
      if (!entry) return prev
      clearTimeout(entry.timerId)
      const next = new Map(prev)
      next.delete(variantId)
      return next
    })
  }, [])

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
            ? <span aria-live="polite">🎉 You&apos;ve unlocked <strong>free shipping</strong>!</span>
            : <span aria-live="polite">🚚 Add <strong>{formatPrice(pricing.remainingForFreeShip)}</strong> more for FREE shipping</span>
        ) : '🚚 Free shipping on all orders!'}
        {freeShipMin > 0 && (
          <div
            className="cp-ship-track"
            role="progressbar"
            aria-valuenow={Math.round(progressPct)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Free shipping progress"
          >
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
                .filter(item => !pendingRemovals.has(item.variantId))
                .map(item => (
                <CartItemCard
                  key={item.variantId}
                  item={item}
                  qtyAnim={qtyAnim[item.variantId] || null}
                  onQtyChange={handleQtyChange}
                  onRemove={handleRemove}
                />
              ))}
              {/* Undo toasts — one per pending removal, each with its own Undo button */}
              {[...pendingRemovals.entries()].map(([vid, entry]) => (
                <div key={vid} className="cp-undo-toast" role="status">
                  <span>"{entry.name}" removed</span>
                  <button className="cp-undo-btn" onClick={() => handleUndoRemove(vid)}>Undo</button>
                </div>
              ))}
            </div>
          </div>

          {/* Upsell — lazy loaded, shimmer while loading */}
          <ErrorBoundary section="Upsell" fallback={null}>
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
          </ErrorBoundary>

          {/* Pahadi story — lazy loaded */}
          <ErrorBoundary section="Story" fallback={null}>
            <Suspense fallback={null}>
              <PahadiStoryCard />
            </Suspense>
          </ErrorBoundary>

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
          <ErrorBoundary section="Reviews" fallback={null}>
            <Suspense fallback={null}>
              <ReviewSection reviews={reviews} />
            </Suspense>
          </ErrorBoundary>

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
        {/* cp-right: sticky shell only — overflow lives on the inner div.
             Having position:sticky + overflow-y:auto on the SAME element causes
             some browsers to treat top:Npx as an internal offset, pushing content
             down by the sticky-top value and creating a blank gap at the top. */}
        <div className="cp-right">
          <div className="cp-right-inner">
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
      </div>

      {/* Mobile sticky CTA */}
      <StickyCartCTA total={pricing.total} totalQty={totalQty} minOrderAmt={parseFloat(s.min_order_amount || '0')} />

      <style>{PAGE_CSS + CART_ITEM_CARD_CSS}</style>
    </main>
  )
}

// Page-level layout CSS only — component CSS lives in each component
const PAGE_CSS = `
/* ── Luxury design tokens ─────────────────────────────────────────────────── */
:root{
  --forest:#1a3a1e;--forest-mid:#2d5233;--forest-lt:#eef8f0;
  --gold:#c9a240;--gold-lt:#fdf6e8;--gold-dk:#9e7a15;
  --cream:#faf6f0;--cream-dk:#f0e8d8;
  --white:#fff;--ink:#1a1611;--muted:#7a6e5f;
  --border:#e0d5c5;--border-lt:#ece4d8;
  --r:16px;
  --sh:0 2px 14px rgba(26,22,17,.07),0 0 0 1px rgba(26,22,17,.04);
  --sh-hover:0 8px 32px rgba(26,22,17,.11),0 0 0 1px rgba(26,22,17,.06);
}

/* ── Shipping announcement bar ─────────────────────────────────────────────── */
.cp-ship-bar{
  background:linear-gradient(135deg,#1a3a1e 0%,#2d5233 55%,#3a6640 100%);
  color:rgba(255,255,255,.95);text-align:center;padding:11px 20px;font-size:13px;
  letter-spacing:.15px;
}
.cp-ship-track{
  height:6px;background:rgba(255,255,255,.15);border-radius:99px;
  margin:8px auto 0;max-width:340px;overflow:hidden;
  box-shadow:inset 0 1px 3px rgba(0,0,0,.2);
}
.cp-ship-fill{
  height:100%;
  background:linear-gradient(90deg,#9e7a15,var(--gold),#e8c060);
  border-radius:99px;transition:width .85s cubic-bezier(.4,0,.2,1);
  box-shadow:0 0 10px rgba(201,162,64,.55);
}

/* ── Progress steps ─────────────────────────────────────────────────────────── */
.cp-steps{
  display:flex;align-items:center;justify-content:center;
  padding:14px 16px;background:var(--white);
  border-bottom:1px solid var(--border-lt);
}
.cp-step{
  display:flex;align-items:center;gap:7px;font-size:12px;
  font-weight:600;color:#c0b8ae;letter-spacing:.25px;text-transform:uppercase;
}
.cp-step span{
  width:24px;height:24px;border-radius:50%;
  background:#f2ece4;border:1.5px solid #e0d5c5;
  display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;
}
.cp-step-active{color:var(--forest);}
.cp-step-active span{
  background:var(--forest);color:#fff;border-color:var(--forest);
  box-shadow:0 2px 8px rgba(26,58,30,.28);
}
.cp-step-line{
  width:52px;height:1px;
  background:linear-gradient(90deg,#e0d5c5,#ece4d8);
  margin:0 8px;flex-shrink:0;
}

/* ── Page layout ─────────────────────────────────────────────────────────────── */
.cp-layout{
  display:grid;grid-template-columns:1fr 395px;gap:0;
  max-width:1420px;margin:0 auto;background:var(--cream);
  align-items:start;min-height:calc(100vh - 180px);overflow:hidden;
}
@media(max-width:960px){.cp-layout{grid-template-columns:1fr;}}
.cp-left{padding:28px 32px;display:flex;flex-direction:column;gap:20px;}
@media(max-width:640px){.cp-left{padding:16px;gap:16px;}}

/* ── Cards ──────────────────────────────────────────────────────────────────── */
.cp-card{
  background:var(--white);border-radius:var(--r);
  box-shadow:var(--sh);border:1px solid var(--border-lt);
  overflow:hidden;transition:box-shadow .26s ease,transform .26s ease;
}
.cp-card:hover{box-shadow:var(--sh-hover);}

.cp-card-head{
  padding:18px 22px 14px;border-bottom:1px solid var(--border-lt);
  display:flex;align-items:center;justify-content:space-between;
}
.cp-card-title{
  font-family:var(--font-playfair,'Playfair Display',serif);
  font-size:17px;font-weight:700;color:var(--ink);margin:0;letter-spacing:.15px;
}
.cp-card-link{
  font-size:11px;color:var(--forest);font-weight:700;text-decoration:none;
  letter-spacing:.5px;text-transform:uppercase;
  padding:5px 11px;border:1px solid var(--forest-lt);border-radius:7px;
  transition:all .18s;
}
.cp-card-link:hover{background:var(--forest-lt);}

.cp-items{padding:4px 0;}

/* ── Trust card ─────────────────────────────────────────────────────────────── */
.cp-trust-card{padding:0;}
.cp-trust-grid{display:grid;grid-template-columns:1fr 1fr;}
.cp-trust-item{
  padding:20px 22px;text-align:center;
  border-right:1px solid var(--border-lt);border-bottom:1px solid var(--border-lt);
  transition:background .2s;
}
.cp-trust-item:hover{background:var(--cream);}
.cp-trust-item:nth-child(2n){border-right:none;}
.cp-trust-item:nth-child(3),.cp-trust-item:nth-child(4){border-bottom:none;}
.cp-trust-icon{font-size:28px;display:block;margin-bottom:7px;}
.cp-trust-label{font-size:13px;font-weight:700;color:var(--ink);letter-spacing:.1px;}
.cp-trust-desc{font-size:11px;color:var(--muted);margin-top:3px;}

/* ── Delivery card ──────────────────────────────────────────────────────────── */
.cp-delivery-card{padding:0;}
.cp-delivery-grid{display:grid;grid-template-columns:1fr 1fr;}
.cp-delivery-item{
  display:flex;align-items:flex-start;gap:11px;padding:15px 20px;
  border-right:1px solid var(--border-lt);border-bottom:1px solid var(--border-lt);
  transition:background .18s;
}
.cp-delivery-item:hover{background:var(--cream);}
.cp-delivery-item:nth-child(2n){border-right:none;}
.cp-delivery-item:nth-child(3),.cp-delivery-item:nth-child(4){border-bottom:none;}
.cp-delivery-icon{font-size:20px;flex-shrink:0;margin-top:1px;}
.cp-delivery-label{font-size:12px;font-weight:700;color:var(--ink);letter-spacing:.1px;}
.cp-delivery-sub{font-size:11px;color:var(--muted);margin-top:2px;}

/* ── WhatsApp ────────────────────────────────────────────────────────────────── */
.cp-whatsapp{
  display:flex;align-items:center;justify-content:center;gap:9px;
  background:#25d366;color:#fff;text-decoration:none;padding:14px 20px;
  border-radius:13px;font-size:13px;font-weight:700;letter-spacing:.2px;
  box-shadow:0 4px 14px rgba(37,211,102,.28);transition:all .22s;
}
.cp-whatsapp:hover{background:#22be5c;transform:translateY(-1px);box-shadow:0 6px 20px rgba(37,211,102,.36);}

/* ── Undo toast ─────────────────────────────────────────────────────────────── */
.cp-undo-toast{
  display:flex;align-items:center;justify-content:space-between;
  padding:13px 22px;
  background:linear-gradient(135deg,#1a1611,#2a211a);
  color:rgba(255,255,255,.92);font-size:13px;letter-spacing:.1px;
  animation:cp-toast-in .25s cubic-bezier(.4,0,.2,1);
  border-left:3px solid var(--gold);
}
@keyframes cp-toast-in{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:translateY(0)}}
.cp-undo-btn{
  background:none;border:1.5px solid rgba(201,162,64,.45);color:var(--gold);
  font-size:12px;font-weight:700;padding:5px 14px;border-radius:8px;
  cursor:pointer;transition:all .16s;font-family:inherit;flex-shrink:0;letter-spacing:.3px;
}
.cp-undo-btn:hover{background:rgba(201,162,64,.1);border-color:var(--gold);}

/* ── Right summary panel ─────────────────────────────────────────────────────── */
/* cp-right: sticky SHELL only — no overflow here.
   Bug: sticky + overflow-y on the same element makes some browsers offset
   the content by top:Npx, creating a phantom gap at the top of the sidebar. */
.cp-right{
  background:var(--white);border-left:1px solid var(--border-lt);
  box-shadow:-6px 0 28px rgba(26,22,17,.05);
  position:sticky;top:134px;
  width:100%;min-width:0;
  /* overflow intentionally NOT set here — lives on cp-right-inner */
}
/* Inner scroll container — separated from sticky so top:134px is never
   misread as an internal offset by the browser */
.cp-right-inner{
  max-height:calc(100vh - 134px);
  overflow-y:auto;overflow-x:hidden;
}
/* Short viewports — un-stick so CTA is never clipped below fold */
@media(max-height:700px){
  .cp-right{position:static;}
  .cp-right-inner{max-height:none;}
}
@media(max-width:960px){
  .cp-right{position:static;border-left:none;border-top:1px solid var(--border-lt);
    width:auto;box-shadow:none;}
  .cp-right-inner{max-height:none;overflow-y:visible;}
  .cp-layout{padding-bottom:80px;}
}
`
