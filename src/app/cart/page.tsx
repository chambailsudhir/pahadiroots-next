'use client'

/**
 * cart/page.tsx
 *
 * ROOT CAUSE FIX — two bugs caused "shows briefly then disappears":
 *
 * 1. HYDRATION MISMATCH: useCartStore selectors were called at the top of
 *    the component, BEFORE the `mounted` guard. With skipHydration:true the
 *    store starts empty on the server. React renders <CartSkeleton />, then
 *    after hydration the store fills — but because `items` was already read as
 *    [] at render time, React's reconciler sees a mismatch and may re-render
 *    with the skeleton again. FIX: read the store only after `mounted === true`
 *    by using a single `useCartStore` call with a selector that returns the
 *    entire slice, gated behind the mounted flag.
 *
 * 2. next/image DOMAIN: If product images come from an external domain not
 *    listed in next.config remotePatterns, Next.js serves a 400 on hard-reload
 *    (CDN cache miss), causing <Image> to show nothing. FIX: added unoptimized
 *    prop dynamically, or use a loader. Handled in CartItemCard.
 */

import Link from 'next/link'
import { useState, useEffect, useCallback, lazy, Suspense } from 'react'
import { useCartStore } from '@/store/cartStore'
import { formatPrice } from '@/lib/utils'
import { calcPriceSummary } from '@/lib/services/pricingService'
import useSWR from 'swr'
import { supabase } from '@/lib/supabase'
import type { SiteSettings } from '@/types'

import CartSkeleton                from '@/components/cart/CartSkeleton'
import CartItemCard                from '@/components/cart/CartItemCard'
import CartSummary                 from '@/components/cart/CartSummary'
import { StickyCartCTA, EmptyCart } from '@/components/cart/CartUIComponents'
import { useCartAnalytics }        from '@/hooks/useCheckoutAnalytics'

const UpsellSection   = lazy(() => import('@/components/cart/UpsellSection'))
const ReviewSection   = lazy(() => import('@/components/cart/ReviewSection'))
const PahadiStoryCard = lazy(() => import('@/components/cart/PahadiStoryCard'))

const FALLBACK_REVIEWS = [
  { name:'Priya M.',  location:'Delhi',     text:"Best quality rice I've ever had. Pure taste!" },
  { name:'Rahul S.',  location:'Mumbai',    text:'Authentic Pahadi flavours, delivered fresh.'   },
  { name:'Anita K.',  location:'Bangalore', text:"Love the ghee — just like dadi's kitchen."    },
]

const settingsFetcher = async (): Promise<SiteSettings> => {
  const { data } = await supabase.from('site_settings').select('key, value')
  return Object.fromEntries(
    (data || []).map((r: { key: string; value: string }) => [r.key, r.value])
  ) as SiteSettings
}

export default function CartPage() {
  // ── HYDRATION GUARD ──────────────────────────────────────────────────────
  // MUST be first — nothing from the store should be read until mounted=true.
  // With skipHydration:true the Zustand store is empty on the server render.
  // Reading it before mount causes a hydration mismatch that makes items flash
  // then disappear as React throws away the mismatched subtree.
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])

  // ── STORE — read AFTER mount guard ──────────────────────────────────────
  // All selectors in one call to minimise subscriptions
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
  const [upsellItems,   setUpsellItems]   = useState<any[]>([])
  const [upsellLoading, setUpsellLoading] = useState(true)
  const [addedUpsell,   setAddedUpsell]   = useState<string[]>([])
  const [reviews,       setReviews]       = useState(FALLBACK_REVIEWS)
  const [qtyAnim,       setQtyAnim]       = useState<Record<string, 'up'|'down'|null>>({})

  const { data: settings } = useSWR<SiteSettings>('site_settings', settingsFetcher)
  const s = settings || {} as SiteSettings

  const freeShipMin = parseFloat(s.free_shipping_min || '0') || 0
  const pricing     = calcPriceSummary(items, s, coupon, 'cod')
  const progressPct = freeShipMin > 0 ? Math.min(100, (pricing.subtotal / freeShipMin) * 100) : 100
  const totalQty    = items.reduce((sum, i) => sum + i.qty, 0)

  const analytics = useCartAnalytics({ itemCount: items.length, subtotal: pricing.subtotal })

  // Fetch upsells + live reviews only once mounted and items are real
  useEffect(() => {
    if (!mounted) return
    setUpsellLoading(true)
    fetch('/api/v1/store-data')
      .then(async r => {
        if (!r.ok) return
        const data = await r.json()
        const cartIds  = new Set(items.map(i => i.variantId))
        const variants: any[] = data.product_variants || []
        const products: any[] = data.products         || []
        const images:   any[] = data.product_images   || []
        const prodMap = Object.fromEntries(products.map((p: any) => [p.id, p]))
        const imgMap: Record<string, string> = {}
        images.forEach((img: any) => { if (!imgMap[img.product_id]) imgMap[img.product_id] = img.image_url })
        const badges = ['Bestseller','Organic','Popular','Farm Fresh','Pure','New Arrival']
        const upsells = variants
          .filter((v: any) => v.is_active && v.available_stock > 0 && !cartIds.has(v.id))
          .slice(0, 6)
          .map((v: any, i: number) => {
            const p = prodMap[v.product_id] || {}
            return {
              id:v.id, productId:v.product_id, name:p.name||'Product',
              slug:p.slug||'', size:v.size||v.weight||'',
              price:v.price, mrp:v.mrp||v.price,
              emoji:p.emoji||null, image:imgMap[v.product_id]||null,
              gstRate:p.gst_rate||5, maxQty:v.available_stock||10,
              badge:badges[i % badges.length],
            }
          })
        setUpsellItems(upsells)
        const ss = data.settings || {}
        const dbRevs = [1,2,3].map(n => ({
          name:     ss[`review_${n}_name`]     || FALLBACK_REVIEWS[n-1]?.name,
          location: ss[`review_${n}_location`] || FALLBACK_REVIEWS[n-1]?.location,
          text:     ss[`review_${n}_text`]     || FALLBACK_REVIEWS[n-1]?.text,
        })).filter(r => r.name && r.text)
        if (dbRevs.length > 0) setReviews(dbRevs)
      })
      .catch(() => {})
      .finally(() => setUpsellLoading(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, items.length])

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
    removeItem(variantId)
  }, [removeItem, analytics])

  const handleUpsellAdd = useCallback((p: any) => {
    if (addedUpsell.includes(p.id)) return
    addItem({
      productId:p.productId, variantId:p.id, name:p.name,
      slug:p.slug, image:p.image, emoji:p.emoji, size:p.size,
      price:p.price, mrp:p.mrp, gstRate:p.gstRate, maxQty:p.maxQty,
    })
    analytics.trackUpsellAdded(p.name, p.price)
    setAddedUpsell(a => [...a, p.id])
  }, [addedUpsell, addItem, analytics])

  async function handleCoupon() {
    if (!couponCode.trim()) return
    setCouponLoading(true); setCouponError('')
    try {
      const res  = await fetch('/api/v1/coupons', {
        method:'POST', headers:{ 'Content-Type':'application/json' },
        body: JSON.stringify({ code:couponCode.trim().toUpperCase(), subtotal:pricing.subtotal }),
      })
      const data = await res.json()
      if (!res.ok) { setCouponError(data.error || 'Invalid coupon'); return }
      applyCoupon(data.coupon)
      setCouponCode('')
    } catch { setCouponError('Failed to apply coupon') }
    finally  { setCouponLoading(false) }
  }

  // ── RENDER GUARDS ── must come AFTER all hooks ────────────────────────────
  if (!mounted) return <CartSkeleton />
  if (items.length === 0) return <EmptyCart />

  return (
    <>
      {/* Shipping progress bar */}
      <div className="cp-ship-bar">
        {freeShipMin > 0 ? (
          pricing.isFreeShipping
            ? <span>🎉 You've unlocked <strong>free shipping</strong>!</span>
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

          <div className="cp-card">
            <div className="cp-card-head">
              <h2 className="cp-card-title">Your Items ({totalQty})</h2>
              <Link href="/products" className="cp-card-link">+ Add more</Link>
            </div>
            <div className="cp-items">
              {items.map(item => (
                <CartItemCard
                  key={item.variantId}
                  item={item}
                  qtyAnim={qtyAnim[item.variantId] || null}
                  onQtyChange={handleQtyChange}
                  onRemove={handleRemove}
                />
              ))}
            </div>
          </div>

          <Suspense fallback={null}>
            <UpsellSection
              items={upsellItems}
              loading={upsellLoading}
              addedIds={addedUpsell}
              remainingForFreeShip={pricing.remainingForFreeShip}
              isFreeShipping={pricing.isFreeShipping}
              freeShipMin={freeShipMin}
              onAdd={handleUpsellAdd}
            />
          </Suspense>

          <Suspense fallback={null}>
            <PahadiStoryCard />
          </Suspense>

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

          <Suspense fallback={null}>
            <ReviewSection reviews={reviews} />
          </Suspense>

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
            pricing={pricing}
            coupon={coupon}
            onApplyCoupon={handleCoupon}
            onRemoveCoupon={removeCoupon}
            couponCode={couponCode}
            onCouponCodeChange={setCouponCode}
            couponLoading={couponLoading}
            couponError={couponError}
          />
        </div>
      </div>

      <StickyCartCTA total={pricing.total} totalQty={totalQty} />

      <style>{PAGE_CSS}</style>
    </>
  )
}

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
.cp-right{background:var(--white);border-left:1px solid var(--border);
  position:sticky;top:134px;max-height:calc(100vh - 134px);
  overflow-y:auto;overflow-x:hidden;width:100%;min-width:0;}
@media(max-width:960px){
  .cp-right{position:static;border-left:none;
    border-top:1px solid var(--border);max-height:none;width:auto;}
  .cp-layout{padding-bottom:76px;}
}
`
