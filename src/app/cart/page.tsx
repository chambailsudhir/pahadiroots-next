'use client'

/**
 * cart/page.tsx — Lean orchestrator (~350 lines)
 *
 * Components used:
 *   CartSkeleton    → full animated skeleton while stores hydrate
 *
 * Features:
 *   - DB-driven upsells from /api/v1/store-data (real addItem wired)
 *   - Live reviews from site_settings keys (fallback to static)
 *   - Pincode autofill via free postalpincode.in API (in AddressForm)
 *   - Microinteractions: qty bounce, CTA glow, card hover elevation
 *   - Admin-driven: free_shipping_min, flat_shipping_charge, whatsapp_number
 */

import Link from 'next/link'
import Image from 'next/image'
import { useState, useEffect } from 'react'
import { useCartStore } from '@/store/cartStore'
import { formatPrice } from '@/lib/utils'
import { calcPriceSummary } from '@/lib/services/pricingService'
import useSWR from 'swr'
import { supabase } from '@/lib/supabase'
import type { SiteSettings } from '@/types'
import CartSkeleton from '@/components/cart/CartSkeleton'
import { useCartAnalytics } from '@/hooks/useCheckoutAnalytics'

// ─── Static fallback reviews ──────────────────────────────────────────────────
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

function safeNum(v: string | undefined, fb: number) {
  const n = parseFloat(v || ''); return isNaN(n) ? fb : n
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function CartPage() {
  // Hydration guard
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
  const [reviewIdx,     setReviewIdx]     = useState(0)
  const [addedUpsell,   setAddedUpsell]   = useState<string[]>([])
  const [upsellItems,   setUpsellItems]   = useState<any[]>([])
  const [reviews,       setReviews]       = useState(FALLBACK_REVIEWS)
  // Tracks qty animation — variantId → 'up'|'down'
  const [qtyAnim, setQtyAnim] = useState<Record<string, 'up'|'down'|null>>({})

  const { data: settings } = useSWR<SiteSettings>('site_settings', settingsFetcher)
  const s = settings || {} as SiteSettings

  const freeShipMin = safeNum(s.free_shipping_min, 0) || 0
  const pricing     = calcPriceSummary(items, s, coupon, 'cod')
  const progressPct = freeShipMin > 0 ? Math.min(100, (pricing.subtotal / freeShipMin) * 100) : 100

  // Analytics — tracks cart view, upsell adds, removals, qty changes
  const analytics = useCartAnalytics({ itemCount: items.length, subtotal: pricing.subtotal })

  // Fetch upsells + live reviews from store-data
  useEffect(() => {
    fetch('/api/v1/store-data')
      .then(async r => {
        if (!r.ok) return
        const data = await r.json()
        const cartIds  = new Set(items.map(i => i.variantId))
        const variants: any[] = data.product_variants || []
        const products: any[] = data.products         || []
        const images:   any[] = data.product_images   || []
        const prodMap = Object.fromEntries(products.map((p: any) => [p.id, p]))
        const imgMap:  Record<string,string> = {}
        images.forEach((img: any) => { if (!imgMap[img.product_id]) imgMap[img.product_id] = img.image_url })
        const badges = ['Bestseller','Organic','Popular','Farm Fresh','Pure','New Arrival']
        const upsells = variants
          .filter((v: any) => v.is_active && v.available_stock > 0 && !cartIds.has(v.id))
          .slice(0, 6)
          .map((v: any, i: number) => {
            const p = prodMap[v.product_id] || {}
            return {
              id:v.id, productId:v.product_id,
              name:p.name||'Product', slug:p.slug||'',
              size:v.size||v.weight||'', price:v.price,
              mrp:v.mrp||v.price, emoji:p.emoji||null,
              image:imgMap[v.product_id]||null,
              gstRate:p.gst_rate||5, maxQty:v.available_stock||10,
              badge:badges[i % badges.length],
            }
          })
        if (upsells.length > 0) setUpsellItems(upsells)

        // Live reviews from site_settings
        const ss = data.settings || {}
        const dbRevs = [1,2,3].map(n => ({
          name:     ss[`review_${n}_name`]     || FALLBACK_REVIEWS[n-1]?.name,
          location: ss[`review_${n}_location`] || FALLBACK_REVIEWS[n-1]?.location,
          text:     ss[`review_${n}_text`]     || FALLBACK_REVIEWS[n-1]?.text,
        })).filter(r => r.name && r.text)
        if (dbRevs.length > 0) setReviews(dbRevs)
      })
      .catch(() => {})
  }, [items.length])

  // Rotate reviews
  useEffect(() => {
    const t = setInterval(() => setReviewIdx(i => (i + 1) % reviews.length), 3800)
    return () => clearInterval(t)
  }, [reviews.length])

  // Qty with animation
  function changeQty(variantId: string, newQty: number, oldQty: number) {
    const dir = newQty > oldQty ? 'up' : 'down'
    setQtyAnim(a => ({ ...a, [variantId]: dir }))
    updateQty(variantId, newQty)
    setTimeout(() => setQtyAnim(a => ({ ...a, [variantId]: null })), 300)
  }

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
      applyCoupon(data.coupon); setCouponCode('')
    } catch { setCouponError('Failed to apply coupon') }
    finally  { setCouponLoading(false) }
  }

  const totalQty = items.reduce((s, i) => s + i.qty, 0)

  // ── Render guards ──────────────────────────────────────────────────────────
  if (!mounted) return <CartSkeleton />

  if (items.length === 0) return (
    <div className="ec-empty">
      <div className="ec-empty-icon">🛒</div>
      <h1 className="ec-empty-title">Your cart is empty</h1>
      <p className="ec-empty-sub">Discover natural Himalayan goodness crafted by mountain farmers.</p>
      <Link href="/products" className="ec-empty-btn">Browse Products →</Link>
      <style>{CART_CSS}</style>
    </div>
  )

  return (
    <>
      {/* Shipping progress */}
      {freeShipMin > 0 ? (
        <div className="ec-ship-bar">
          {pricing.isFreeShipping
            ? <span>🎉 You've unlocked <strong>free shipping</strong>!</span>
            : <span>🚚 Add <strong>{formatPrice(pricing.remainingForFreeShip)}</strong> more for FREE shipping</span>}
          <div className="ec-ship-track">
            <div className="ec-ship-fill" style={{ width:`${progressPct}%` }} />
          </div>
        </div>
      ) : (
        <div className="ec-ship-bar ec-ship-free">🚚 Free shipping on all orders!</div>
      )}

      {/* Progress steps */}
      <div className="ec-steps">
        <div className="ec-step ec-step-active"><span>1</span> Cart</div>
        <div className="ec-step-line" />
        <div className="ec-step"><span>2</span> Checkout</div>
        <div className="ec-step-line" />
        <div className="ec-step"><span>3</span> Confirmation</div>
      </div>

      <div className="ec-layout">

        {/* ══ LEFT ══════════════════════════════════════════ */}
        <div className="ec-left">

          {/* Cart items */}
          <div className="ec-card">
            <div className="ec-card-head">
              <h2 className="ec-card-title">Your Items ({totalQty})</h2>
              <Link href="/products" className="ec-card-link">+ Add more</Link>
            </div>
            <div className="ec-items">
              {items.map(item => (
                <div key={item.variantId} className="ec-item">
                  <div className="ec-item-img-wrap">
                    {item.image
                      ? <Image src={item.image} alt={item.name} fill sizes="120px" className="ec-item-img" />
                      : <span className="ec-item-emoji">{item.emoji || '🌿'}</span>}
                  </div>
                  <div className="ec-item-body">
                    <div className="ec-item-meta">
                      <Link href={`/products/${item.slug}`} className="ec-item-name">{item.name}</Link>
                      {item.size && <span className="ec-item-size">{item.size}</span>}
                      <div className="ec-item-badges">
                        <span className="ec-badge-org">🌿 Organic</span>
                        <span className="ec-badge-hml">🏔 Himalayan</span>
                        {/* Stock urgency */}
                        {item.maxQty <= 5 && (
                          <span className="ec-badge-stock">⚡ Only {item.maxQty} left</span>
                        )}
                      </div>
                    </div>
                    <div className="ec-item-footer">
                      <div className="ec-qty-wrap" role="group" aria-label="Quantity">
                        <button className="ec-qty-btn"
                          onClick={() => { analytics.trackQuantityChanged(item.name, item.qty, item.qty-1); changeQty(item.variantId, item.qty - 1, item.qty) }}
                          aria-label="Decrease">−</button>
                        <span
                          className={`ec-qty-num${qtyAnim[item.variantId] ? ` anim-${qtyAnim[item.variantId]}` : ''}`}
                          aria-live="polite"
                        >{item.qty}</span>
                        <button className="ec-qty-btn"
                          onClick={() => { analytics.trackQuantityChanged(item.name, item.qty, item.qty+1); changeQty(item.variantId, item.qty + 1, item.qty) }}
                          aria-label="Increase"
                          disabled={item.qty >= item.maxQty}>+</button>
                      </div>
                      <div className="ec-item-pricing">
                        {item.mrp > 0 && item.mrp > item.price && (
                          <span className="ec-item-mrp">{formatPrice(item.mrp * item.qty)}</span>
                        )}
                        <span className="ec-item-price">{formatPrice(item.price * item.qty)}</span>
                        {item.mrp > 0 && item.mrp > item.price && (
                          <span className="ec-item-save">Save {formatPrice((item.mrp - item.price) * item.qty)}</span>
                        )}
                      </div>
                      <button className="ec-item-del"
                        onClick={() => { analytics.trackItemRemoved(item.name, item.price); removeItem(item.variantId) }}
                        aria-label={`Remove ${item.name}`}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                          <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>
                        </svg>
                        Remove
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Upsell — DB driven */}
          {upsellItems.length > 0 && (
            <div className="ec-card">
              <div className="ec-card-head">
                <h2 className="ec-card-title">🛍 Customers Also Buy</h2>
                <span className="ec-card-sub">
                  {freeShipMin > 0 && !pricing.isFreeShipping
                    ? `Add ${formatPrice(pricing.remainingForFreeShip)} more for free ship`
                    : 'Top picks for you'}
                </span>
              </div>
              <div className="ec-upsells">
                {upsellItems.slice(0, 4).map(p => (
                  <div key={p.id} className={`ec-upsell${addedUpsell.includes(p.id) ? ' added' : ''}`}>
                    <div className="ec-upsell-img-wrap">
                      {p.image
                        ? <Image src={p.image} alt={p.name} fill sizes="50px" style={{ objectFit:'cover', borderRadius:'8px' }} />
                        : <span style={{ fontSize:'26px' }}>{p.emoji || '🌿'}</span>}
                    </div>
                    <div className="ec-upsell-info">
                      <div className="ec-upsell-badge">{p.badge}</div>
                      <div className="ec-upsell-name">{p.name}</div>
                      <div className="ec-upsell-size">{p.size}</div>
                      <div className="ec-upsell-price-row">
                        {p.mrp > p.price && <span className="ec-upsell-mrp">{formatPrice(p.mrp)}</span>}
                        <span className="ec-upsell-price">{formatPrice(p.price)}</span>
                      </div>
                    </div>
                    <button
                      className={`ec-upsell-btn${addedUpsell.includes(p.id) ? ' added' : ''}`}
                      onClick={() => {
                        if (addedUpsell.includes(p.id)) return
                        addItem({ productId:p.productId, variantId:p.id, name:p.name,
                          slug:p.slug, image:p.image, emoji:p.emoji, size:p.size,
                          price:p.price, mrp:p.mrp, gstRate:p.gstRate, maxQty:p.maxQty })
                        analytics.trackUpsellAdded(p.name, p.price)
                        setAddedUpsell(a => [...a, p.id])
                      }}
                      aria-label={`Add ${p.name}`}
                    >
                      {addedUpsell.includes(p.id) ? '✓ Added' : '+ Add'}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Trust grid */}
          <div className="ec-card ec-trust-card">
            <div className="ec-trust-grid">
              {([
                ['🌿','100% Natural','No chemicals or preservatives'],
                ['🏔','Himalayan Sourced','Direct from mountain farmers'],
                ['🤝','Farmer Direct','Fair trade, fair prices'],
                ['📦','Small Batch','Fresh, limited production'],
              ] as const).map(([icon, label, desc]) => (
                <div key={label} className="ec-trust-item">
                  <span className="ec-trust-icon">{icon}</span>
                  <div className="ec-trust-label">{label}</div>
                  <div className="ec-trust-desc">{desc}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Live reviews */}
          <div className="ec-card ec-review-card">
            <h3 className="ec-review-heading">💬 What Customers Say</h3>
            <div className="ec-review-body">
              <div className="ec-review-stars">★★★★★</div>
              <p className="ec-review-text">"{reviews[reviewIdx].text}"</p>
              <div className="ec-review-author">— {reviews[reviewIdx].name}, {reviews[reviewIdx].location}</div>
            </div>
            <div className="ec-review-dots" role="tablist">
              {reviews.map((_, i) => (
                <button key={i}
                  className={`ec-dot${i === reviewIdx ? ' active' : ''}`}
                  onClick={() => setReviewIdx(i)}
                  aria-label={`Review ${i+1}`} role="tab" aria-selected={i===reviewIdx} />
              ))}
            </div>
          </div>

          {/* Delivery promise */}
          <div className="ec-card ec-delivery-card">
            <div className="ec-delivery-grid">
              {([
                ['🚚','Delivery in 3–5 Days','Pan India'],
                ['🔄','Easy Returns','7-day policy'],
                ['🔒','Secure Payment','SSL encrypted'],
                ['📞','WhatsApp Support','Mon–Sat 9am–6pm'],
              ] as const).map(([icon, label, sub]) => (
                <div key={label} className="ec-delivery-item">
                  <span className="ec-delivery-icon">{icon}</span>
                  <div>
                    <div className="ec-delivery-label">{label}</div>
                    <div className="ec-delivery-sub">{sub}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* WhatsApp — admin-controlled number */}
          {s.whatsapp_number && (
            <a href={`https://wa.me/${s.whatsapp_number}`}
              target="_blank" rel="noopener noreferrer" className="ec-whatsapp">
              <span>💬</span><span>Have a question? Chat on WhatsApp</span>
            </a>
          )}
        </div>

        {/* ══ RIGHT ══════════════════════════════════════════ */}
        <div className="ec-right">
          <div className="ec-summary">

            {/* Coupon */}
            <div className="ec-coupon-wrap">
              <div className="ec-coupon-head">🏷 Have a coupon code?</div>
              {coupon ? (
                <div className="ec-coupon-applied">
                  <span>🎉 <strong>{coupon.code}</strong> — saving {formatPrice(coupon.discount)}</span>
                  <button className="ec-coupon-remove" onClick={removeCoupon} aria-label="Remove coupon">✕</button>
                </div>
              ) : (
                <div className="ec-coupon-row">
                  <input type="text" value={couponCode}
                    onChange={e => setCouponCode(e.target.value.toUpperCase())}
                    onKeyDown={e => e.key === 'Enter' && handleCoupon()}
                    placeholder="e.g. WELCOME50" className="ec-coupon-input"
                    aria-label="Coupon code" autoCapitalize="characters" />
                  <button className="ec-coupon-btn" onClick={handleCoupon}
                    disabled={couponLoading} type="button">
                    {couponLoading ? '...' : 'Apply'}
                  </button>
                </div>
              )}
              {couponError && <p className="ec-coupon-err" role="alert">⚠ {couponError}</p>}
            </div>

            {/* Price breakdown */}
            <div className="ec-price-block">
              <div className="ec-price-row">
                <span>Subtotal ({items.length} item{items.length > 1 ? 's' : ''})</span>
                <span>{formatPrice(pricing.subtotal)}</span>
              </div>
              {coupon && pricing.discount > 0 && (
                <div className="ec-price-row ec-green">
                  <span>Coupon ({coupon.code})</span>
                  <span>−{formatPrice(pricing.discount)}</span>
                </div>
              )}
              <div className="ec-price-row">
                <span>Shipping</span>
                <span className={pricing.isFreeShipping ? 'ec-free' : ''}>
                  {pricing.isFreeShipping ? '🚚 FREE' : formatPrice(pricing.shipping)}
                </span>
              </div>
              {pricing.gstTotal > 0 && (
                <div className="ec-price-row ec-muted">
                  <span>Tax (GST inclusive)</span><span>₹{pricing.gstTotal}</span>
                </div>
              )}
              <div className="ec-price-divider" />
              <div className="ec-price-total">
                <span>Total</span><span>{formatPrice(pricing.total)}</span>
              </div>
              {pricing.discount > 0 && (
                <div className="ec-save-pill">🎉 Saving {formatPrice(pricing.discount)} on this order!</div>
              )}
            </div>

            <Link href="/checkout" className="ec-cta">
              <span>🔒</span>
              <span>Proceed to Checkout</span>
              <span className="ec-cta-amt">{formatPrice(pricing.total)}</span>
            </Link>

            <Link href="/products" className="ec-continue">← Continue Shopping</Link>

            {/* Payment logos */}
            <div className="ec-trust-pay">
              <div className="ec-trust-pay-row">
                <span>🔐 SSL Encrypted</span><span>🏦 Razorpay</span><span>✅ Secure</span>
              </div>
              <div className="ec-pay-logos">
                {[['upi','UPI','#6a1b9a'],['visa','VISA','#1a1f71'],['mc','MC','#eb001b'],
                  ['rupay','RuPay','#008c44'],['gpay','GPay','#4285f4']].map(([cls,lbl,bg]) => (
                  <span key={cls} className="ec-pay-logo" style={{ background:bg }}>{lbl}</span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Mobile sticky */}
      <div className="ec-sticky-mobile" aria-hidden="true">
        <div>
          <div className="ec-sticky-total">{formatPrice(pricing.total)}</div>
          <div className="ec-sticky-sub">{totalQty} item{totalQty > 1 ? 's' : ''} · Incl. taxes</div>
        </div>
        <Link href="/checkout" className="ec-sticky-btn">🔒 Checkout</Link>
      </div>

      <style>{CART_CSS}</style>
    </>
  )
}

const CART_CSS = `
:root{
  --forest:#1a3a1e;--forest-mid:#2d5233;--forest-lt:#e8f5e9;
  --earth:#c8920a;--earth-lt:#fdf6e3;
  --stone:#f5f0e8;--stone-mid:#ede8df;
  --white:#fff;--ink:#1a1a1a;--muted:#7a7565;--border:#e2dbd0;
  --r:14px;--sh:0 2px 8px rgba(0,0,0,.06),0 0 0 1px rgba(0,0,0,.03);
}
/* Ship bar */
.ec-ship-bar{background:linear-gradient(135deg,var(--forest),var(--forest-mid));
  color:rgba(255,255,255,.95);text-align:center;padding:9px 20px;font-size:13px;}
.ec-ship-free{background:var(--forest);}
.ec-ship-track{height:5px;background:rgba(255,255,255,.2);border-radius:99px;
  margin:7px auto 0;max-width:380px;overflow:hidden;}
.ec-ship-fill{height:100%;background:linear-gradient(90deg,var(--earth),#e8a82a);
  border-radius:99px;transition:width .7s cubic-bezier(.4,0,.2,1);}
/* Steps */
.ec-steps{display:flex;align-items:center;justify-content:center;
  padding:13px 16px;background:var(--white);border-bottom:1px solid var(--border);}
.ec-step{display:flex;align-items:center;gap:6px;font-size:12px;font-weight:600;color:#bbb;}
.ec-step span{width:22px;height:22px;border-radius:50%;background:#eee;
  display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;}
.ec-step-active{color:var(--forest);}.ec-step-active span{background:var(--forest);color:#fff;}
.ec-step-line{width:44px;height:2px;background:#e8e8e8;margin:0 8px;}
/* Layout */
.ec-layout{display:grid;grid-template-columns:1fr 374px;gap:0;
  max-width:1380px;margin:0 auto;background:var(--stone);align-items:start;
  min-height:calc(100vh - 180px);}
@media(max-width:960px){.ec-layout{grid-template-columns:1fr;}}
.ec-left{padding:24px 28px;display:flex;flex-direction:column;gap:18px;}
@media(max-width:640px){.ec-left{padding:16px;}}
/* Cards */
.ec-card{background:var(--white);border-radius:var(--r);
  box-shadow:var(--sh);border:1px solid var(--border);overflow:hidden;
  transition:box-shadow .22s;}
.ec-card:hover{box-shadow:0 6px 20px rgba(0,0,0,.09),0 0 0 1px rgba(0,0,0,.04);}
.ec-card-head{padding:16px 20px 12px;border-bottom:1px solid var(--stone-mid);
  display:flex;align-items:center;justify-content:space-between;}
.ec-card-title{font-family:var(--font-playfair,'Playfair Display',serif);
  font-size:16px;font-weight:700;color:var(--ink);margin:0;}
.ec-card-link{font-size:12px;color:var(--forest);font-weight:600;text-decoration:none;transition:opacity .2s;}
.ec-card-link:hover{opacity:.7;}
.ec-card-sub{font-size:12px;color:var(--muted);}
/* Items */
.ec-items{padding:4px 0;}
.ec-item{display:flex;gap:16px;padding:16px 20px;
  border-bottom:1px solid var(--stone-mid);transition:background .18s;}
.ec-item:last-child{border-bottom:none;}
.ec-item:hover{background:#fafaf8;}
.ec-item-img-wrap{width:120px;height:120px;flex-shrink:0;border-radius:12px;
  overflow:hidden;background:var(--stone);position:relative;
  display:flex;align-items:center;justify-content:center;
  box-shadow:0 1px 6px rgba(0,0,0,.08);}
.ec-item-img{object-fit:cover;}
.ec-item-emoji{font-size:46px;}
.ec-item-body{flex:1;min-width:0;display:flex;flex-direction:column;justify-content:space-between;}
.ec-item-meta{display:flex;flex-direction:column;gap:3px;}
.ec-item-name{font-family:var(--font-playfair,'Playfair Display',serif);
  font-size:16px;font-weight:700;color:var(--ink);text-decoration:none;
  line-height:1.3;transition:color .2s;}
.ec-item-name:hover{color:var(--forest);}
.ec-item-size{font-size:12px;color:var(--muted);}
.ec-item-badges{display:flex;gap:6px;margin-top:4px;flex-wrap:wrap;}
.ec-badge-org,.ec-badge-hml,.ec-badge-stock{font-size:11px;font-weight:600;
  padding:2px 8px;border-radius:20px;}
.ec-badge-org{background:#e8f5e9;color:#2d6a4f;border:1px solid #c8e6c9;}
.ec-badge-hml{background:#e3f2fd;color:#1565c0;border:1px solid #bbdefb;}
.ec-badge-stock{background:#fff3e0;color:#e65100;border:1px solid #ffe0b2;}
.ec-item-footer{display:flex;align-items:center;justify-content:space-between;
  margin-top:10px;flex-wrap:wrap;gap:8px;}
/* Qty stepper with microinteraction */
.ec-qty-wrap{display:flex;align-items:center;background:var(--stone);
  border-radius:30px;padding:3px;border:1px solid var(--border);
  box-shadow:var(--sh);}
.ec-qty-btn{width:34px;height:34px;border:none;background:var(--white);border-radius:50%;
  font-size:17px;font-weight:700;color:var(--forest);cursor:pointer;
  display:flex;align-items:center;justify-content:center;
  transition:all .18s cubic-bezier(.4,0,.2,1);
  box-shadow:0 1px 4px rgba(0,0,0,.08);line-height:1;}
.ec-qty-btn:hover:not(:disabled){background:var(--forest);color:#fff;
  transform:scale(1.1);box-shadow:0 3px 10px rgba(26,58,30,.25);}
.ec-qty-btn:active:not(:disabled){transform:scale(.93);}
.ec-qty-btn:disabled{opacity:.3;cursor:not-allowed;}
.ec-qty-num{width:34px;text-align:center;font-size:14px;font-weight:700;
  color:var(--ink);transition:transform .2s cubic-bezier(.4,0,.2,1),opacity .2s;}
.ec-qty-num.anim-up{animation:qty-bounce-up .28s cubic-bezier(.4,0,.2,1);}
.ec-qty-num.anim-down{animation:qty-bounce-down .28s cubic-bezier(.4,0,.2,1);}
@keyframes qty-bounce-up{
  0%{transform:translateY(8px);opacity:0}
  60%{transform:translateY(-2px)}
  100%{transform:translateY(0);opacity:1}
}
@keyframes qty-bounce-down{
  0%{transform:translateY(-8px);opacity:0}
  60%{transform:translateY(2px)}
  100%{transform:translateY(0);opacity:1}
}
/* Item pricing */
.ec-item-pricing{display:flex;flex-direction:column;align-items:flex-end;}
.ec-item-mrp{font-size:12px;color:#bbb;text-decoration:line-through;}
.ec-item-price{font-family:var(--font-playfair,'Playfair Display',serif);
  font-size:18px;font-weight:700;color:var(--ink);}
.ec-item-save{font-size:11px;font-weight:600;color:#2d6a4f;
  background:#e8f5e9;padding:2px 7px;border-radius:10px;}
.ec-item-del{display:flex;align-items:center;gap:4px;
  background:none;border:1px solid #f0d5d5;color:#c0392b;
  font-size:12px;font-weight:600;padding:6px 11px;border-radius:8px;
  cursor:pointer;transition:all .15s;}
.ec-item-del:hover{background:#fdecea;border-color:#c0392b;}
/* Upsell */
.ec-upsells{display:grid;grid-template-columns:1fr 1fr;gap:10px;padding:14px 20px;}
@media(max-width:540px){.ec-upsells{grid-template-columns:1fr;}}
.ec-upsell{display:flex;gap:10px;align-items:center;border:1px solid var(--border);
  border-radius:12px;padding:10px;background:var(--stone);transition:all .2s;}
.ec-upsell:hover{border-color:var(--forest);background:#f0f7f1;}
.ec-upsell.added{opacity:.75;}
.ec-upsell-img-wrap{width:50px;height:50px;border-radius:8px;overflow:hidden;
  background:var(--stone);position:relative;display:flex;align-items:center;
  justify-content:center;flex-shrink:0;}
.ec-upsell-info{flex:1;min-width:0;}
.ec-upsell-badge{font-size:10px;font-weight:700;color:var(--earth);
  text-transform:uppercase;letter-spacing:.5px;}
.ec-upsell-name{font-size:13px;font-weight:700;color:var(--ink);
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.ec-upsell-size{font-size:11px;color:var(--muted);}
.ec-upsell-price-row{display:flex;align-items:center;gap:5px;margin-top:1px;}
.ec-upsell-mrp{font-size:10px;color:#bbb;text-decoration:line-through;}
.ec-upsell-price{font-size:13px;font-weight:700;color:var(--forest);}
.ec-upsell-btn{background:var(--forest);color:#fff;border:none;font-size:12px;
  font-weight:700;padding:6px 11px;border-radius:8px;cursor:pointer;
  white-space:nowrap;transition:all .2s;flex-shrink:0;}
.ec-upsell-btn:hover{background:var(--forest-mid);}
.ec-upsell-btn.added{background:#2d6a4f;}
/* Trust */
.ec-trust-card{padding:0;}
.ec-trust-grid{display:grid;grid-template-columns:1fr 1fr;}
.ec-trust-item{padding:18px 20px;text-align:center;
  border-right:1px solid var(--stone-mid);border-bottom:1px solid var(--stone-mid);}
.ec-trust-item:nth-child(2n){border-right:none;}
.ec-trust-item:nth-child(3),.ec-trust-item:nth-child(4){border-bottom:none;}
.ec-trust-icon{font-size:26px;display:block;}
.ec-trust-label{font-size:13px;font-weight:700;color:var(--ink);margin-top:5px;}
.ec-trust-desc{font-size:11px;color:var(--muted);margin-top:2px;}
/* Reviews */
.ec-review-card{padding:18px 20px;}
.ec-review-heading{font-size:15px;font-weight:700;color:var(--ink);margin:0 0 12px;
  font-family:var(--font-playfair,'Playfair Display',serif);}
.ec-review-body{text-align:center;padding:0 4px;}
.ec-review-stars{font-size:19px;color:var(--earth);letter-spacing:2px;margin-bottom:8px;}
.ec-review-text{font-family:var(--font-playfair,'Playfair Display',serif);
  font-size:14px;color:var(--ink);font-style:italic;line-height:1.6;margin:0 0 6px;}
.ec-review-author{font-size:12px;color:var(--muted);font-weight:600;}
.ec-review-dots{display:flex;justify-content:center;gap:6px;margin-top:12px;}
.ec-dot{width:8px;height:8px;border-radius:50%;background:#ddd;border:none;
  cursor:pointer;transition:all .2s;padding:0;}
.ec-dot.active{background:var(--forest);width:20px;border-radius:4px;}
/* Delivery */
.ec-delivery-card{padding:0;}
.ec-delivery-grid{display:grid;grid-template-columns:1fr 1fr;}
.ec-delivery-item{display:flex;align-items:flex-start;gap:10px;padding:14px 18px;
  border-right:1px solid var(--stone-mid);border-bottom:1px solid var(--stone-mid);}
.ec-delivery-item:nth-child(2n){border-right:none;}
.ec-delivery-item:nth-child(3),.ec-delivery-item:nth-child(4){border-bottom:none;}
.ec-delivery-icon{font-size:20px;flex-shrink:0;margin-top:2px;}
.ec-delivery-label{font-size:12px;font-weight:700;color:var(--ink);}
.ec-delivery-sub{font-size:11px;color:var(--muted);margin-top:1px;}
/* WhatsApp */
.ec-whatsapp{display:flex;align-items:center;justify-content:center;gap:8px;
  background:#25d366;color:#fff;text-decoration:none;padding:13px 20px;
  border-radius:12px;font-size:13px;font-weight:700;
  box-shadow:0 3px 10px rgba(37,211,102,.3);transition:all .2s;}
.ec-whatsapp:hover{background:#22be5c;transform:translateY(-1px);}
/* Right panel */
.ec-right{background:var(--white);border-left:1px solid var(--border);
  position:sticky;top:134px;max-height:calc(100vh - 134px);overflow-y:auto;}
@media(max-width:960px){.ec-right{position:static;border-left:none;
  border-top:1px solid var(--border);max-height:none;}}
.ec-summary{padding:20px 22px;display:flex;flex-direction:column;gap:14px;}
/* Coupon */
.ec-coupon-wrap{border:1px dashed var(--border);border-radius:12px;padding:13px;}
.ec-coupon-head{font-size:12px;font-weight:700;color:var(--ink);margin-bottom:9px;}
.ec-coupon-row{display:flex;gap:7px;}
.ec-coupon-input{flex:1;border:1.5px solid var(--border);border-radius:8px;
  padding:10px 12px;font-size:13px;font-weight:600;outline:none;
  transition:border-color .2s;letter-spacing:.4px;min-width:0;font-family:inherit;}
.ec-coupon-input:focus{border-color:var(--forest);}
.ec-coupon-btn{background:var(--forest);color:#fff;border:none;
  padding:10px 16px;border-radius:8px;font-size:13px;font-weight:700;
  cursor:pointer;transition:background .2s;white-space:nowrap;font-family:inherit;}
.ec-coupon-btn:hover:not(:disabled){background:var(--forest-mid);}
.ec-coupon-btn:disabled{opacity:.6;cursor:not-allowed;}
.ec-coupon-applied{background:var(--forest-lt);border:1px solid #c8e6c9;
  border-radius:8px;padding:10px 12px;display:flex;align-items:center;
  justify-content:space-between;font-size:13px;color:#2d6a4f;font-weight:600;gap:8px;}
.ec-coupon-remove{background:none;border:none;color:#888;font-size:15px;cursor:pointer;padding:0;}
.ec-coupon-err{font-size:11px;color:#c0392b;margin-top:5px;}
/* Price block */
.ec-price-block{display:flex;flex-direction:column;gap:9px;}
.ec-price-row{display:flex;justify-content:space-between;align-items:center;
  font-size:13px;color:var(--muted);}
.ec-green{color:#2d6a4f;font-weight:700;}
.ec-free{color:#2d6a4f;font-weight:700;}
.ec-muted{font-size:11px;color:#bbb;}
.ec-price-divider{height:1px;background:var(--border);margin:4px 0;}
.ec-price-total{display:flex;justify-content:space-between;align-items:center;
  font-family:var(--font-playfair,'Playfair Display',serif);
  font-size:20px;font-weight:700;color:var(--ink);}
.ec-save-pill{background:var(--forest-lt);border:1px solid #c8e6c9;border-radius:8px;
  padding:7px 11px;font-size:12px;font-weight:700;color:#2d6a4f;text-align:center;}
/* CTA with glow */
.ec-cta{display:flex;align-items:center;justify-content:space-between;
  background:linear-gradient(135deg,var(--forest),var(--forest-mid));
  color:#fff;text-decoration:none;padding:15px 18px;border-radius:13px;
  font-size:14px;font-weight:700;
  box-shadow:0 4px 16px rgba(26,58,30,.32);
  transition:all .28s cubic-bezier(.4,0,.2,1);
  position:relative;overflow:hidden;}
.ec-cta:hover{transform:translateY(-2px);box-shadow:0 12px 30px rgba(26,58,30,.45);}
.ec-cta:active{transform:translateY(0);}
.ec-cta-amt{background:rgba(255,255,255,.2);padding:4px 11px;
  border-radius:20px;font-size:14px;font-weight:800;}
.ec-continue{text-align:center;display:block;font-size:12px;color:var(--muted);
  text-decoration:none;transition:color .2s;}
.ec-continue:hover{color:var(--forest);}
/* Trust pay */
.ec-trust-pay{border-top:1px solid var(--stone-mid);padding-top:12px;}
.ec-trust-pay-row{display:flex;justify-content:space-between;font-size:11px;
  color:var(--muted);margin-bottom:8px;flex-wrap:wrap;gap:3px;}
.ec-pay-logos{display:flex;gap:5px;flex-wrap:wrap;}
.ec-pay-logo{font-size:10px;font-weight:800;padding:3px 7px;border-radius:5px;
  color:#fff;letter-spacing:.3px;}
/* Empty */
.ec-empty{max-width:440px;margin:80px auto;text-align:center;padding:0 20px;}
.ec-empty-icon{font-size:68px;margin-bottom:14px;}
.ec-empty-title{font-family:var(--font-playfair,'Playfair Display',serif);
  font-size:24px;font-weight:700;color:var(--ink);margin-bottom:8px;}
.ec-empty-sub{font-size:14px;color:var(--muted);margin-bottom:26px;}
.ec-empty-btn{display:inline-block;background:var(--forest);color:#fff;
  text-decoration:none;padding:12px 26px;border-radius:11px;
  font-weight:700;font-size:14px;transition:all .2s;}
.ec-empty-btn:hover{background:var(--forest-mid);transform:translateY(-1px);}
/* Mobile sticky */
.ec-sticky-mobile{display:none;position:fixed;bottom:0;left:0;right:0;
  background:var(--white);border-top:2px solid var(--border);
  padding:10px 16px;z-index:250;align-items:center;
  justify-content:space-between;gap:12px;
  box-shadow:0 -4px 18px rgba(0,0,0,.09);}
@media(max-width:960px){.ec-sticky-mobile{display:flex;}.ec-layout{padding-bottom:76px;}}
.ec-sticky-total{font-family:var(--font-playfair,'Playfair Display',serif);
  font-size:17px;font-weight:700;color:var(--ink);}
.ec-sticky-sub{font-size:11px;color:var(--muted);}
.ec-sticky-btn{background:linear-gradient(135deg,var(--forest),var(--forest-mid));
  color:#fff;text-decoration:none;padding:12px 22px;border-radius:11px;
  font-weight:700;font-size:14px;white-space:nowrap;
  box-shadow:0 4px 10px rgba(26,58,30,.28);}
@media(max-width:640px){
  .ec-item{flex-direction:column;}
  .ec-item-img-wrap{width:100%;height:160px;}
}
`
