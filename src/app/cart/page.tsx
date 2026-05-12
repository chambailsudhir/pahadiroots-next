'use client'

/**
 * cart/page.tsx — Enterprise Cart Page
 *
 * ARCHITECTURE NOTES:
 * ─────────────────────────────────────────────────────────────────────────────
 * 1. SETTINGS: This page fetches site_settings via useSWR (client-side).
 *    The layout.tsx already fetches settings server-side and passes them to
 *    Header/Footer/CartDrawer, but page.tsx cannot receive server props directly
 *    in the App Router without making this a Server Component. Since we need
 *    client-side cart state (Zustand), we keep useSWR here. This is consistent
 *    with the existing checkout/page.tsx pattern in this codebase.
 *
 * 2. FONTS: The layout.tsx already loads Inter, Playfair, Lato, DM_Sans via
 *    next/font. We do NOT re-import them here. The <style> tag below only sets
 *    CSS variables that reference those font vars already on <body>.
 *    @import inside <style> tags is removed to avoid double-loading.
 *
 * 3. HEADER HEIGHT: The real header is:
 *      AnnouncementBar (~34px, hidden when ann_hide=true)
 *      TickerBar       (~36px, hidden when ticker_hide=true)
 *      Nav             (~64px)
 *    Worst case = ~134px. The ec-right sticky panel uses top:134px.
 *    Our own ec-header is NOT rendered here — it conflicts with the site header.
 *    We show a slim checkout-context bar instead (non-sticky, inside content).
 *
 * 4. UPSELL: Static display-only. To wire real addItem(), fetch product/variant
 *    IDs from DB by slug and call useCartStore.getState().addItem().
 *
 * 5. ADMIN SETTINGS THAT DIRECTLY AFFECT THIS PAGE:
 *    - free_shipping_min     → shipping progress bar threshold
 *    - flat_shipping_charge  → shipping cost shown
 *    - prepaid_discount_pct  → shown in summary (cart uses 'cod' pricing)
 *    - cod_enabled           → NOT used on cart page (used on checkout)
 *    - show_wishlist         → could gate "Save for Later" (not yet implemented)
 *    - ann_hide / ticker_hide → affects header height → sticky offset
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

// ─── Static upsell data ───────────────────────────────────────────────────────
// TODO: Replace with real DB fetch. Each item needs productId + variantId
// to call useCartStore.getState().addItem() for real cart integration.
const UPSELL_PRODUCTS = [
  { id: 'up-1', name: 'Pahadi Honey',         size: '500g',  price: 349, emoji: '🍯', badge: 'Bestseller' },
  { id: 'up-2', name: 'Himalayan Pink Salt',  size: '250g',  price: 199, emoji: '🧂', badge: 'Organic' },
  { id: 'up-3', name: 'Ghee (A2 Cow)',        size: '500ml', price: 649, emoji: '🫙', badge: 'New' },
  { id: 'up-4', name: 'Wild Forest Turmeric', size: '100g',  price: 179, emoji: '🌿', badge: 'Pure' },
]

const TRUST_REVIEWS = [
  { name: 'Priya M.',  location: 'Delhi',     text: "Best quality rice I've ever had. Pure taste!" },
  { name: 'Rahul S.',  location: 'Mumbai',    text: 'Authentic Pahadi flavours, delivered fresh.'  },
  { name: 'Anita K.',  location: 'Bangalore', text: "Love the ghee — just like dadi's kitchen."   },
]

// ─── SWR fetcher — matches exact pattern used across this codebase ────────────
const settingsFetcher = async (): Promise<SiteSettings> => {
  const { data } = await supabase.from('site_settings').select('key, value')
  return Object.fromEntries(
    (data || []).map((r: { key: string; value: string }) => [r.key, r.value])
  ) as SiteSettings
}

// ─── Safe number parser — same as asNumber() in getSiteSettings ──────────────
function safeNum(val: string | undefined, fallback: number): number {
  const n = parseFloat(val || '')
  return isNaN(n) ? fallback : n
}

export default function CartPage() {
  const items        = useCartStore(s => s.items)
  const coupon       = useCartStore(s => s.coupon)
  const applyCoupon  = useCartStore(s => s.applyCoupon)
  const removeCoupon = useCartStore(s => s.removeCoupon)
  const removeItem   = useCartStore(s => s.removeItem)
  const updateQty    = useCartStore(s => s.updateQty)

  const [couponCode,    setCouponCode]    = useState('')
  const [couponLoading, setCouponLoading] = useState(false)
  const [couponError,   setCouponError]   = useState('')
  const [reviewIdx,     setReviewIdx]     = useState(0)
  const [addedUpsell,   setAddedUpsell]   = useState<string[]>([])

  // ── Settings from Supabase ──
  const { data: settings } = useSWR<SiteSettings>('site_settings', settingsFetcher)

  // ── Derived values — all using real SiteSettings keys from types/index.ts ──
  const freeShipMin  = safeNum(settings?.free_shipping_min,  0) || 0
  const pricing      = calcPriceSummary(items, settings || {} as SiteSettings, coupon, 'cod')
  // Guard: avoid Infinity when freeShipMin=0 (admin has set always-free shipping)
  const progressPct  = freeShipMin > 0
    ? Math.min(100, (pricing.subtotal / freeShipMin) * 100)
    : 100

  // ── Auto-rotate reviews ──
  useEffect(() => {
    const t = setInterval(() => setReviewIdx(i => (i + 1) % TRUST_REVIEWS.length), 3800)
    return () => clearInterval(t)
  }, [])

  // ── Coupon handler ──
  async function handleCoupon() {
    if (!couponCode.trim()) return
    setCouponLoading(true)
    setCouponError('')
    try {
      const res  = await fetch('/api/v1/coupons', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ code: couponCode.trim().toUpperCase(), subtotal: pricing.subtotal }),
      })
      const data = await res.json()
      if (!res.ok) { setCouponError(data.error || 'Invalid coupon'); return }
      applyCoupon(data.coupon)
      setCouponCode('')
    } catch {
      setCouponError('Failed to apply coupon. Please try again.')
    } finally {
      setCouponLoading(false)
    }
  }

  const totalQty = items.reduce((s, i) => s + i.qty, 0)

  // ── Empty cart ──
  if (items.length === 0) {
    return (
      <div className="ec-empty">
        <div className="ec-empty-icon">🛒</div>
        <h1 className="ec-empty-title">Your cart is empty</h1>
        <p className="ec-empty-sub">Discover natural Himalayan goodness crafted by mountain farmers.</p>
        <Link href="/products" className="ec-empty-btn">Browse Products →</Link>
        <style>{CART_CSS}</style>
      </div>
    )
  }

  return (
    <>
      {/* ── Shipping progress bar ──────────────────────────────── */}
      {freeShipMin > 0 ? (
        <div className="ec-ship-bar">
          {pricing.isFreeShipping
            ? <span>🎉 You have unlocked <strong>free shipping</strong>!</span>
            : <span>🚚 Add <strong>{formatPrice(pricing.remainingForFreeShip)}</strong> more for FREE shipping</span>}
          <div className="ec-ship-track">
            <div className="ec-ship-fill" style={{ width: `${progressPct}%` }} />
          </div>
        </div>
      ) : (
        <div className="ec-ship-bar ec-ship-bar-free">
          🚚 Free shipping on all orders!
        </div>
      )}

      {/* ── Progress steps ────────────────────────────────────── */}
      <div className="ec-steps">
        <div className="ec-step ec-step-active"><span>1</span> Cart</div>
        <div className="ec-step-line" />
        <div className="ec-step"><span>2</span> Checkout</div>
        <div className="ec-step-line" />
        <div className="ec-step"><span>3</span> Confirmation</div>
      </div>

      {/* ── Main layout ───────────────────────────────────────── */}
      <div className="ec-layout">

        {/* ═══ LEFT ════════════════════════════════════════════ */}
        <div className="ec-left">

          {/* Cart Items */}
          <div className="ec-card">
            <div className="ec-card-head">
              <h2 className="ec-card-title">Your Items ({totalQty})</h2>
              <Link href="/products" className="ec-card-link">+ Add more</Link>
            </div>

            <div className="ec-items">
              {items.map(item => (
                <div key={item.variantId} className="ec-item">
                  {/* next/image fill requires position:relative on parent — set in CSS */}
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
                      </div>
                    </div>

                    <div className="ec-item-footer">
                      {/* Qty stepper */}
                      <div className="ec-qty-wrap" role="group" aria-label="Quantity">
                        <button
                          className="ec-qty-btn"
                          onClick={() => updateQty(item.variantId, item.qty - 1)}
                          aria-label="Decrease quantity"
                        >−</button>
                        <span className="ec-qty-num" aria-live="polite">{item.qty}</span>
                        <button
                          className="ec-qty-btn"
                          onClick={() => updateQty(item.variantId, item.qty + 1)}
                          aria-label="Increase quantity"
                          disabled={item.qty >= item.maxQty}
                        >+</button>
                      </div>

                      {/* Pricing */}
                      <div className="ec-item-pricing">
                        {item.mrp > 0 && item.mrp > item.price && (
                          <span className="ec-item-mrp">{formatPrice(item.mrp * item.qty)}</span>
                        )}
                        <span className="ec-item-price">{formatPrice(item.price * item.qty)}</span>
                        {item.mrp > 0 && item.mrp > item.price && (
                          <span className="ec-item-save">
                            Save {formatPrice((item.mrp - item.price) * item.qty)}
                          </span>
                        )}
                      </div>

                      {/* Remove */}
                      <button
                        className="ec-item-del"
                        onClick={() => removeItem(item.variantId)}
                        aria-label={`Remove ${item.name}`}
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                          <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
                        </svg>
                        Remove
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Upsell / Frequently Bought Together */}
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
              {UPSELL_PRODUCTS.map(p => (
                <div key={p.id} className="ec-upsell">
                  <span className="ec-upsell-emoji">{p.emoji}</span>
                  <div className="ec-upsell-info">
                    <div className="ec-upsell-badge">{p.badge}</div>
                    <div className="ec-upsell-name">{p.name}</div>
                    <div className="ec-upsell-size">{p.size}</div>
                    <div className="ec-upsell-price">{formatPrice(p.price)}</div>
                  </div>
                  <button
                    className={`ec-upsell-btn${addedUpsell.includes(p.id) ? ' added' : ''}`}
                    onClick={() => setAddedUpsell(a => a.includes(p.id) ? a : [...a, p.id])}
                    aria-label={`Add ${p.name}`}
                  >
                    {addedUpsell.includes(p.id) ? '✓ Added' : '+ Add'}
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Brand Trust */}
          <div className="ec-card ec-trust-card">
            <div className="ec-trust-grid">
              {([
                ['🌿', '100% Natural',      'No chemicals or preservatives'],
                ['🏔', 'Himalayan Sourced', 'Direct from mountain farmers'],
                ['🤝', 'Farmer Direct',     'Fair trade, fair prices'],
                ['📦', 'Small Batch',       'Fresh, limited production'],
              ] as const).map(([icon, label, desc]) => (
                <div key={label} className="ec-trust-item">
                  <span className="ec-trust-icon">{icon}</span>
                  <div className="ec-trust-label">{label}</div>
                  <div className="ec-trust-desc">{desc}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Rotating Reviews */}
          <div className="ec-card ec-review-card">
            <h3 className="ec-review-heading">💬 What Customers Say</h3>
            <div className="ec-review-body">
              <div className="ec-review-stars">★★★★★</div>
              <p className="ec-review-text">"{TRUST_REVIEWS[reviewIdx].text}"</p>
              <div className="ec-review-author">
                — {TRUST_REVIEWS[reviewIdx].name}, {TRUST_REVIEWS[reviewIdx].location}
              </div>
            </div>
            <div className="ec-review-dots" role="tablist">
              {TRUST_REVIEWS.map((_, i) => (
                <button
                  key={i}
                  className={`ec-dot${i === reviewIdx ? ' active' : ''}`}
                  onClick={() => setReviewIdx(i)}
                  aria-label={`Review ${i + 1}`}
                  role="tab"
                  aria-selected={i === reviewIdx}
                />
              ))}
            </div>
          </div>

          {/* Delivery Promise */}
          <div className="ec-card ec-delivery-card">
            <div className="ec-delivery-grid">
              {([
                ['🚚', 'Delivery in 3–5 Days', 'Pan India'],
                ['🔄', 'Easy Returns',         '7-day policy'],
                ['🔒', 'Secure Payment',       'SSL encrypted'],
                ['📞', 'WhatsApp Support',     'Mon–Sat 9am–6pm'],
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

          {/* WhatsApp CTA — uses real whatsapp_number from settings */}
          {settings?.whatsapp_number && (
            <a
              href={`https://wa.me/${settings.whatsapp_number}`}
              target="_blank"
              rel="noopener noreferrer"
              className="ec-whatsapp"
            >
              <span>💬</span>
              <span>Have a question? Chat on WhatsApp</span>
            </a>
          )}
        </div>

        {/* ═══ RIGHT — Order Summary ════════════════════════════ */}
        <div className="ec-right">
          <div className="ec-summary">

            {/* Urgency nudge */}
            <div className="ec-urgency">
              ⚡ <strong>3,241</strong> customers ordered this month — order within{' '}
              <strong>2 hrs</strong> for priority dispatch
            </div>

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
                  <input
                    type="text"
                    value={couponCode}
                    onChange={e => setCouponCode(e.target.value.toUpperCase())}
                    onKeyDown={e => e.key === 'Enter' && handleCoupon()}
                    placeholder="e.g. WELCOME50"
                    className="ec-coupon-input"
                    aria-label="Coupon code"
                    autoCapitalize="characters"
                  />
                  <button
                    className="ec-coupon-btn"
                    onClick={handleCoupon}
                    disabled={couponLoading}
                    type="button"
                  >
                    {couponLoading ? '...' : 'Apply'}
                  </button>
                </div>
              )}
              {couponError && <p className="ec-coupon-err" role="alert">⚠ {couponError}</p>}
            </div>

            {/* Price breakdown — matches exact PriceSummary fields */}
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
                  <span>Tax (GST inclusive)</span>
                  <span>₹{pricing.gstTotal}</span>
                </div>
              )}
              <div className="ec-price-divider" />
              <div className="ec-price-total">
                <span>Total</span>
                <span>{formatPrice(pricing.total)}</span>
              </div>
              {pricing.discount > 0 && (
                <div className="ec-savings-pill">
                  🎉 Saving {formatPrice(pricing.discount)} on this order!
                </div>
              )}
            </div>

            {/* Primary CTA */}
            <Link href="/checkout" className="ec-cta">
              <span>🔒</span>
              <span>Proceed to Checkout</span>
              <span className="ec-cta-amt">{formatPrice(pricing.total)}</span>
            </Link>

            <Link href="/products" className="ec-continue">← Continue Shopping</Link>

            {/* Payment trust logos */}
            <div className="ec-trust-pay">
              <div className="ec-trust-pay-row">
                <span>🔐 SSL Encrypted</span>
                <span>🏦 Razorpay</span>
                <span>✅ Secure</span>
              </div>
              <div className="ec-pay-logos">
                {[['upi','UPI'],['visa','VISA'],['mc','MC'],['rupay','RuPay'],['gpay','GPay']] .map(([cls, label]) => (
                  <span key={cls} className={`ec-pay-logo ${cls}`}>{label}</span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Mobile sticky CTA ─────────────────────────────────── */}
      <div className="ec-sticky-mobile" aria-hidden="true">
        <div className="ec-sticky-info">
          <div className="ec-sticky-total">{formatPrice(pricing.total)}</div>
          <div className="ec-sticky-sub">{totalQty} item{totalQty > 1 ? 's' : ''} • Free delivery</div>
        </div>
        <Link href="/checkout" className="ec-sticky-btn">🔒 Checkout</Link>
      </div>

      <style>{CART_CSS}</style>
    </>
  )
}

// ─── CSS ─────────────────────────────────────────────────────────────────────
// NOTE: Fonts are NOT re-imported here. The layout.tsx already loads
// Lora (Playfair_Display), DM_Sans, and Lato via next/font.
// We reference the CSS vars set by layout: --font-playfair, --font-dm-sans, --font-lato
const CART_CSS = `
:root{
  --forest:#1a3a1e;--forest-mid:#2d5233;--forest-lt:#e8f5e9;
  --earth:#c8920a;--earth-lt:#fdf6e3;
  --stone:#f5f0e8;--stone-mid:#ede8df;
  --white:#fff;--ink:#1a1a1a;--muted:#7a7565;--border:#e2dbd0;
  --r:14px;
  --sh:0 2px 10px rgba(0,0,0,.07);
}

/* ── Shipping bar ──────────────────────────────────── */
.ec-ship-bar{
  background:var(--forest-mid);color:rgba(255,255,255,.92);
  text-align:center;padding:9px 20px;font-size:13px;
  font-family:var(--font-dm-sans,var(--font-lato,'DM Sans'),sans-serif);
}
.ec-ship-bar-free{background:var(--forest);}
.ec-ship-track{height:4px;background:rgba(255,255,255,.2);border-radius:99px;margin:7px auto 0;max-width:380px;overflow:hidden;}
.ec-ship-fill{height:100%;background:var(--earth);border-radius:99px;transition:width .6s ease;}

/* ── Progress steps ────────────────────────────────── */
.ec-steps{
  display:flex;align-items:center;justify-content:center;
  padding:13px 16px;background:var(--white);border-bottom:1px solid var(--border);
  font-family:var(--font-dm-sans,var(--font-lato),sans-serif);
}
.ec-step{display:flex;align-items:center;gap:6px;font-size:12px;font-weight:600;color:#bbb;}
.ec-step span{width:22px;height:22px;border-radius:50%;background:#eee;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;}
.ec-step-active{color:var(--forest);}
.ec-step-active span{background:var(--forest);color:#fff;}
.ec-step-line{width:44px;height:2px;background:#e8e8e8;margin:0 8px;}

/* ── Layout ────────────────────────────────────────── */
.ec-layout{
  display:grid;grid-template-columns:1fr 374px;gap:0;
  max-width:1380px;margin:0 auto;
  background:var(--stone);align-items:start;
  min-height:calc(100vh - 180px);
}
@media(max-width:960px){.ec-layout{grid-template-columns:1fr;}}

/* ── Left ──────────────────────────────────────────── */
.ec-left{padding:24px 28px;display:flex;flex-direction:column;gap:18px;}
@media(max-width:640px){.ec-left{padding:16px;}}

/* ── Cards ─────────────────────────────────────────── */
.ec-card{
  background:var(--white);border-radius:var(--r);
  box-shadow:var(--sh);border:1px solid var(--border);overflow:hidden;
}
.ec-card-head{
  padding:16px 20px 12px;border-bottom:1px solid var(--stone-mid);
  display:flex;align-items:center;justify-content:space-between;
}
.ec-card-title{
  font-family:var(--font-playfair,'Playfair Display',serif);
  font-size:16px;font-weight:700;color:var(--ink);margin:0;
}
.ec-card-link{font-size:12px;color:var(--forest);font-weight:600;text-decoration:none;}
.ec-card-sub{font-size:12px;color:var(--muted);}

/* ── Items ─────────────────────────────────────────── */
.ec-items{padding:4px 0;}
.ec-item{display:flex;gap:16px;padding:16px 20px;border-bottom:1px solid var(--stone-mid);transition:background .15s;}
.ec-item:last-child{border-bottom:none;}
.ec-item:hover{background:#fafaf8;}
/* position:relative REQUIRED for next/image fill */
.ec-item-img-wrap{
  width:120px;height:120px;flex-shrink:0;border-radius:12px;
  overflow:hidden;background:var(--stone);position:relative;
  display:flex;align-items:center;justify-content:center;
  box-shadow:0 1px 6px rgba(0,0,0,.08);
}
.ec-item-img{object-fit:cover;}
.ec-item-emoji{font-size:46px;}
.ec-item-body{flex:1;min-width:0;display:flex;flex-direction:column;justify-content:space-between;}
.ec-item-meta{display:flex;flex-direction:column;gap:3px;}
.ec-item-name{
  font-family:var(--font-playfair,'Playfair Display',serif);
  font-size:16px;font-weight:700;color:var(--ink);
  text-decoration:none;line-height:1.3;transition:color .2s;
}
.ec-item-name:hover{color:var(--forest);}
.ec-item-size{font-size:12px;color:var(--muted);}
.ec-item-badges{display:flex;gap:6px;margin-top:4px;}
.ec-badge-org,.ec-badge-hml{font-size:11px;font-weight:600;padding:2px 8px;border-radius:20px;}
.ec-badge-org{background:#e8f5e9;color:#2d6a4f;border:1px solid #c8e6c9;}
.ec-badge-hml{background:#e3f2fd;color:#1565c0;border:1px solid #bbdefb;}
.ec-item-footer{display:flex;align-items:center;justify-content:space-between;margin-top:10px;flex-wrap:wrap;gap:8px;}

/* ── Qty stepper ───────────────────────────────────── */
.ec-qty-wrap{
  display:flex;align-items:center;background:var(--stone);
  border-radius:30px;padding:3px;border:1px solid var(--border);
  box-shadow:var(--sh);
}
.ec-qty-btn{
  width:34px;height:34px;border:none;background:var(--white);border-radius:50%;
  font-size:17px;font-weight:700;color:var(--forest);cursor:pointer;
  display:flex;align-items:center;justify-content:center;
  transition:all .15s;box-shadow:0 1px 4px rgba(0,0,0,.08);line-height:1;
}
.ec-qty-btn:hover:not(:disabled){background:var(--forest);color:#fff;}
.ec-qty-btn:disabled{opacity:.3;cursor:not-allowed;}
.ec-qty-num{width:34px;text-align:center;font-size:14px;font-weight:700;color:var(--ink);}

/* ── Item pricing ──────────────────────────────────── */
.ec-item-pricing{display:flex;flex-direction:column;align-items:flex-end;}
.ec-item-mrp{font-size:12px;color:#bbb;text-decoration:line-through;}
.ec-item-price{
  font-family:var(--font-playfair,'Playfair Display',serif);
  font-size:18px;font-weight:700;color:var(--ink);
}
.ec-item-save{font-size:11px;font-weight:600;color:#2d6a4f;background:#e8f5e9;padding:2px 7px;border-radius:10px;}
.ec-item-del{
  display:flex;align-items:center;gap:4px;
  background:none;border:1px solid #f0d5d5;color:#c0392b;
  font-size:12px;font-weight:600;padding:6px 11px;border-radius:8px;
  cursor:pointer;transition:all .15s;
}
.ec-item-del:hover{background:#fdecea;border-color:#c0392b;}

/* ── Upsell ────────────────────────────────────────── */
.ec-upsells{display:grid;grid-template-columns:1fr 1fr;gap:10px;padding:14px 20px;}
@media(max-width:540px){.ec-upsells{grid-template-columns:1fr;}}
.ec-upsell{
  display:flex;gap:10px;align-items:center;
  border:1px solid var(--border);border-radius:12px;padding:10px;
  background:var(--stone);transition:all .2s;
}
.ec-upsell:hover{border-color:var(--forest);background:#f0f7f1;}
.ec-upsell-emoji{font-size:30px;flex-shrink:0;}
.ec-upsell-info{flex:1;min-width:0;}
.ec-upsell-badge{font-size:10px;font-weight:700;color:var(--earth);text-transform:uppercase;letter-spacing:.5px;}
.ec-upsell-name{font-size:13px;font-weight:700;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.ec-upsell-size{font-size:11px;color:var(--muted);}
.ec-upsell-price{
  font-family:var(--font-playfair,'Playfair Display',serif);
  font-size:13px;font-weight:700;color:var(--forest);
}
.ec-upsell-btn{
  background:var(--forest);color:#fff;border:none;
  font-size:12px;font-weight:700;padding:6px 11px;border-radius:8px;
  cursor:pointer;white-space:nowrap;transition:all .2s;flex-shrink:0;
}
.ec-upsell-btn:hover{background:var(--forest-mid);}
.ec-upsell-btn.added{background:#2d6a4f;}

/* ── Trust grid ────────────────────────────────────── */
.ec-trust-card{padding:0;}
.ec-trust-grid{display:grid;grid-template-columns:1fr 1fr;}
.ec-trust-item{padding:18px 20px;text-align:center;border-right:1px solid var(--stone-mid);border-bottom:1px solid var(--stone-mid);}
.ec-trust-item:nth-child(2n){border-right:none;}
.ec-trust-item:nth-child(3),.ec-trust-item:nth-child(4){border-bottom:none;}
.ec-trust-icon{font-size:26px;display:block;}
.ec-trust-label{font-size:13px;font-weight:700;color:var(--ink);margin-top:5px;}
.ec-trust-desc{font-size:11px;color:var(--muted);margin-top:2px;}

/* ── Review card ───────────────────────────────────── */
.ec-review-card{padding:18px 20px;}
.ec-review-heading{
  font-family:var(--font-playfair,'Playfair Display',serif);
  font-size:15px;font-weight:700;color:var(--ink);margin:0 0 12px;
}
.ec-review-body{text-align:center;padding:0 4px;}
.ec-review-stars{font-size:19px;color:var(--earth);letter-spacing:2px;margin-bottom:8px;}
.ec-review-text{
  font-family:var(--font-playfair,'Playfair Display',serif);
  font-size:14px;color:var(--ink);font-style:italic;line-height:1.6;margin:0 0 6px;
}
.ec-review-author{font-size:12px;color:var(--muted);font-weight:600;}
.ec-review-dots{display:flex;justify-content:center;gap:6px;margin-top:12px;}
.ec-dot{width:8px;height:8px;border-radius:50%;background:#ddd;border:none;cursor:pointer;transition:all .2s;padding:0;}
.ec-dot.active{background:var(--forest);width:20px;border-radius:4px;}

/* ── Delivery grid ─────────────────────────────────── */
.ec-delivery-card{padding:0;}
.ec-delivery-grid{display:grid;grid-template-columns:1fr 1fr;}
.ec-delivery-item{display:flex;align-items:flex-start;gap:10px;padding:14px 18px;border-right:1px solid var(--stone-mid);border-bottom:1px solid var(--stone-mid);}
.ec-delivery-item:nth-child(2n){border-right:none;}
.ec-delivery-item:nth-child(3),.ec-delivery-item:nth-child(4){border-bottom:none;}
.ec-delivery-icon{font-size:20px;flex-shrink:0;margin-top:2px;}
.ec-delivery-label{font-size:12px;font-weight:700;color:var(--ink);}
.ec-delivery-sub{font-size:11px;color:var(--muted);margin-top:1px;}

/* ── WhatsApp link ─────────────────────────────────── */
.ec-whatsapp{
  display:flex;align-items:center;justify-content:center;gap:8px;
  background:#25d366;color:#fff;text-decoration:none;
  padding:13px 20px;border-radius:12px;
  font-size:13px;font-weight:700;
  box-shadow:0 3px 10px rgba(37,211,102,.3);
  transition:all .2s;
}
.ec-whatsapp:hover{background:#22be5c;transform:translateY(-1px);}

/* ── Right panel ───────────────────────────────────── */
/*
  sticky top = AnnouncementBar(~34px) + TickerBar(~36px) + Nav(~64px) = ~134px
  If ann_hide=true or ticker_hide=true, these bars are removed by the server.
  We use 134px as the safe maximum. If the admin hides bars, there's extra space above
  the panel — not ideal but safe (panel never slides under the header).
  TODO: read settings in a layout to pass header height as CSS var.
*/
.ec-right{
  background:var(--white);border-left:1px solid var(--border);
  position:sticky;top:134px;max-height:calc(100vh - 134px);overflow-y:auto;
}
@media(max-width:960px){
  .ec-right{position:static;border-left:none;border-top:1px solid var(--border);max-height:none;}
}
.ec-summary{padding:20px 22px;display:flex;flex-direction:column;gap:14px;}

/* ── Urgency ───────────────────────────────────────── */
.ec-urgency{
  background:var(--earth-lt);border:1px solid #f0d080;border-radius:10px;
  padding:10px 14px;font-size:12px;color:#7a5a00;line-height:1.5;
}

/* ── Coupon ────────────────────────────────────────── */
.ec-coupon-wrap{border:1px dashed var(--border);border-radius:12px;padding:13px;}
.ec-coupon-head{font-size:12px;font-weight:700;color:var(--ink);margin-bottom:9px;}
.ec-coupon-row{display:flex;gap:7px;}
.ec-coupon-input{
  flex:1;border:1.5px solid var(--border);border-radius:8px;
  padding:10px 12px;font-size:13px;font-weight:600;
  outline:none;transition:border-color .2s;letter-spacing:.4px;min-width:0;
}
.ec-coupon-input:focus{border-color:var(--forest);}
.ec-coupon-btn{
  background:var(--forest);color:#fff;border:none;
  padding:10px 16px;border-radius:8px;font-size:13px;font-weight:700;
  cursor:pointer;transition:background .2s;white-space:nowrap;
}
.ec-coupon-btn:hover:not(:disabled){background:var(--forest-mid);}
.ec-coupon-btn:disabled{opacity:.6;cursor:not-allowed;}
.ec-coupon-applied{
  background:var(--forest-lt);border:1px solid #c8e6c9;border-radius:8px;
  padding:10px 12px;display:flex;align-items:center;justify-content:space-between;
  font-size:13px;color:#2d6a4f;font-weight:600;gap:8px;
}
.ec-coupon-remove{background:none;border:none;color:#888;font-size:15px;cursor:pointer;padding:0;}
.ec-coupon-err{font-size:11px;color:#c0392b;margin-top:5px;}

/* ── Price block ───────────────────────────────────── */
.ec-price-block{display:flex;flex-direction:column;gap:9px;}
.ec-price-row{display:flex;justify-content:space-between;align-items:center;font-size:13px;color:var(--muted);}
.ec-green{color:#2d6a4f;font-weight:700;}
.ec-free{color:#2d6a4f;font-weight:700;}
.ec-muted{font-size:11px;color:#bbb;}
.ec-price-divider{height:1px;background:var(--border);margin:4px 0;}
.ec-price-total{
  display:flex;justify-content:space-between;align-items:center;
  font-family:var(--font-playfair,'Playfair Display',serif);
  font-size:20px;font-weight:700;color:var(--ink);
}
.ec-savings-pill{
  background:var(--forest-lt);border:1px solid #c8e6c9;border-radius:8px;
  padding:7px 11px;font-size:12px;font-weight:700;color:#2d6a4f;text-align:center;
}

/* ── CTA ───────────────────────────────────────────── */
.ec-cta{
  display:flex;align-items:center;justify-content:space-between;
  background:linear-gradient(135deg,var(--forest),var(--forest-mid));
  color:#fff;text-decoration:none;padding:15px 18px;border-radius:13px;
  font-size:14px;font-weight:700;
  box-shadow:0 4px 16px rgba(26,58,30,.32);transition:all .25s;
}
.ec-cta:hover{transform:translateY(-2px);box-shadow:0 8px 22px rgba(26,58,30,.38);}
.ec-cta-amt{background:rgba(255,255,255,.2);padding:4px 11px;border-radius:20px;font-size:14px;font-weight:800;}
.ec-continue{text-align:center;display:block;font-size:12px;color:var(--muted);text-decoration:none;transition:color .2s;}
.ec-continue:hover{color:var(--forest);}

/* ── Payment trust ─────────────────────────────────── */
.ec-trust-pay{border-top:1px solid var(--stone-mid);padding-top:12px;}
.ec-trust-pay-row{display:flex;justify-content:space-between;font-size:11px;color:var(--muted);margin-bottom:8px;flex-wrap:wrap;gap:3px;}
.ec-pay-logos{display:flex;gap:5px;flex-wrap:wrap;}
.ec-pay-logo{font-size:10px;font-weight:800;padding:3px 7px;border-radius:5px;}
.ec-pay-logo.upi{background:#7b1fa2;color:#fff;}
.ec-pay-logo.visa{background:#1a1f71;color:#fff;}
.ec-pay-logo.mc{background:#eb001b;color:#fff;}
.ec-pay-logo.rupay{background:#0a6e20;color:#fff;}
.ec-pay-logo.gpay{background:#4285f4;color:#fff;}

/* ── Empty state ───────────────────────────────────── */
.ec-empty{max-width:440px;margin:80px auto;text-align:center;padding:0 20px;}
.ec-empty-icon{font-size:68px;margin-bottom:14px;}
.ec-empty-title{font-family:var(--font-playfair,'Playfair Display',serif);font-size:24px;font-weight:700;color:var(--ink);margin-bottom:8px;}
.ec-empty-sub{font-size:14px;color:var(--muted);margin-bottom:26px;}
.ec-empty-btn{display:inline-block;background:var(--forest);color:#fff;text-decoration:none;padding:12px 26px;border-radius:11px;font-weight:700;font-size:14px;transition:all .2s;}
.ec-empty-btn:hover{background:var(--forest-mid);transform:translateY(-1px);}

/* ── Mobile sticky ─────────────────────────────────── */
.ec-sticky-mobile{
  display:none;position:fixed;bottom:0;left:0;right:0;
  background:var(--white);border-top:2px solid var(--border);
  padding:10px 16px;z-index:250;
  align-items:center;justify-content:space-between;gap:12px;
  box-shadow:0 -4px 18px rgba(0,0,0,.09);
}
@media(max-width:960px){
  .ec-sticky-mobile{display:flex;}
  .ec-layout{padding-bottom:76px;}
}
.ec-sticky-total{font-family:var(--font-playfair,'Playfair Display',serif);font-size:17px;font-weight:700;color:var(--ink);}
.ec-sticky-sub{font-size:11px;color:var(--muted);}
.ec-sticky-btn{
  background:linear-gradient(135deg,var(--forest),var(--forest-mid));
  color:#fff;text-decoration:none;padding:12px 22px;border-radius:11px;
  font-weight:700;font-size:14px;white-space:nowrap;
  box-shadow:0 4px 10px rgba(26,58,30,.28);
}

/* ── Responsive fine-tuning ────────────────────────── */
@media(max-width:640px){
  .ec-item{flex-direction:column;}
  .ec-item-img-wrap{width:100%;height:160px;}
  .ec-ship-bar{font-size:12px;}
}
`
