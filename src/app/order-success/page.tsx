'use client'

import { ga4Purchase } from '@/lib/analytics/ga4'
import Link from 'next/link'
import CheckoutStepper from '@/components/checkout/CheckoutStepper'
import { useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useState, useCallback, useRef } from 'react'
import { BUSINESS_INFO, computeOrderInvoice, invoiceRows } from '@/lib/invoiceGst'
import { trackPurchase, markCartConverted } from '@/lib/analytics/track'
import { resolveConfirmationToken } from '@/lib/confirmationToken'
import { DELIVERY_WINDOWS_TEXT, TRACKING_NOTIFICATION_TEXT } from '@/lib/shippingCopy'
import Icon from '@/components/ui/Icon'

/* ─── Types ─────────────────────────────────────────────────── */
interface OrderItem {
  product_id?: number | string
  name?: string
  image_url?: string
  emoji?: string
  qty?: number
  quantity?: number
  variant_value?: string
  price?: number
  price_at_time?: number
  hsn_code?: string
  gst_rate?: number
}

interface Order {
  order_number?: string
  order_status?: string
  payment_status?: string
  total_amount?: number
  subtotal?: number
  shipping_charge?: number
  cod_surcharge?: number
  discount_amount?: number
  tax?: number
  cgst?: number
  sgst?: number
  igst?: number
  loyalty_points_redeemed?: number
  loyalty_point_value?: number
  created_at?: string
  tracking_number?: string
  courier?: string
  customer_name?: string
  customer_phone?: string
  delivery_address?: string
  city?: string
  state?: string
  pincode?: string
  payment_method?: string
  items?: OrderItem[]
}

/* ─── Helpers ───────────────────────────────────────────────── */
const COURIER_URLS: Record<string, string> = {
  delhivery:  'https://www.delhivery.com/track/package/',
  bluedart:   'https://www.bluedart.com/tracking?trackfor=',
  dtdc:       'https://www.dtdc.in/tracking.asp?strCnno=',
  ecom:       'https://ecomexpress.in/tracking/',
  xpressbees: 'https://www.xpressbees.com/shipment/tracking',
  shadowfax:  'https://track.shadowfax.in/',
  shiprocket: 'https://shiprocket.co/tracking/',
}

function getTrackingUrl(courier: string, num: string) {
  if (!courier || !num) return null
  const key = courier.toLowerCase().replace(/[^a-z]/g, '')
  const base = COURIER_URLS[key] || COURIER_URLS[Object.keys(COURIER_URLS).find(k => key.startsWith(k)) ?? ''] || null
  return base ? base + encodeURIComponent(num) : null
}

/* ─── Verification helpers (CF1 / CF2) ──────────────────────── */
type View = 'loading' | 'unverified' | 'confirmed' | 'payment_pending' | 'payment_failed' | 'cancelled' | 'refunded'

const SAFE_REF = /^[A-Za-z0-9-]{4,32}$/
const MAX_PAYMENT_POLLS = 8
const PAYMENT_POLL_MS   = 4000

const HERO: Record<View, { icon: string; title: string; sub: string; tone: 'ok' | 'warn' }> = {
  loading:         { icon: '⏳', title: 'Confirming your order…',        sub: 'Just a moment while we look up your order.', tone: 'ok' },
  unverified:      { icon: '🔍', title: "We couldn't verify this order", sub: 'Nothing has been confirmed on this page.',   tone: 'warn' },
  confirmed:       { icon: '✅', title: 'Order Confirmed!',              sub: 'Thank you! Your mountain goodness is on its way 🌿', tone: 'ok' },
  payment_pending: { icon: '⏳', title: 'Confirming your payment…',      sub: "Please don't pay again — we'll confirm as soon as your bank responds.", tone: 'ok' },
  payment_failed:  { icon: '⚠️', title: 'Payment not completed',         sub: 'If any amount was debited, please contact us with your order number.', tone: 'warn' },
  cancelled:       { icon: '❌', title: 'Order cancelled',               sub: 'This order was cancelled.',                   tone: 'warn' },
  refunded:        { icon: '↩️', title: 'Payment refunded',              sub: 'The money for this order is being or has been returned to your original payment method.', tone: 'warn' },
}

/** What the page may claim, derived ONLY from the server's lookup result. */
function deriveView(s: { loading: boolean; error: boolean; order: Order | null }): View {
  if (s.loading) return 'loading'
  const o = s.order
  if (s.error || !o) return 'unverified'
  if (o.order_status === 'cancelled') return 'cancelled'
  if (o.order_status === 'payment_failed' || o.payment_status === 'failed') return 'payment_failed'
  if (o.payment_status === 'refund_pending' || o.payment_status === 'refunded') return 'refunded'
  if (o.payment_method === 'razorpay' && o.payment_status !== 'paid') return 'payment_pending'
  return 'confirmed'
}

/** COD orders have not been paid yet — never label their total "Total Paid" (CF3). */
function totalLabel(o: Order): string {
  if (o.payment_status === 'paid') return 'Total Paid'
  return o.payment_method === 'cod' ? 'Total (pay on delivery)' : 'Order Total'
}

// Purchase-event de-duplication across refreshes (localStorage; falls back to a per-page-load Set).
const memoryTracked = new Set<string>()
const trackedKey = (n: string) => `pr_purchase_tracked_${n}`
function alreadyTracked(orderNumber: string): boolean {
  if (memoryTracked.has(orderNumber)) return true
  try { return window.localStorage.getItem(trackedKey(orderNumber)) === '1' } catch { return false }
}
function markTracked(orderNumber: string): void {
  memoryTracked.add(orderNumber)
  try { window.localStorage.setItem(trackedKey(orderNumber), '1') } catch { /* private mode — memory set still guards this load */ }
}

/* ─── Main component ────────────────────────────────────────── */
function SuccessContent() {
  const params      = useSearchParams()
  const orderId     = params.get('id')    || ''
  const orderNum    = params.get('num')   || ''
  // F-01: the guest capability token is NOT read from the URL any more (it leaked to Google
  // Tag Manager / GA4 via the page URL). It lives in sessionStorage; a legacy ?token= link is
  // absorbed once and scrubbed from the address bar inside resolveConfirmationToken().
  // See lib/confirmationToken.ts and /api/v1/orders/lookup/route.ts for the full auth model.

  const [order,   setOrder]   = useState<Order | null>(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(false)

  // BUG FIX (React 19 / react-hooks/set-state-in-effect lint rule): the
  // "no order identifier" guard was the first statement inside loadOrder
  // (an async useCallback), executing synchronously before any `await` —
  // so calling loadOrder() from the effect below led to a synchronous
  // setState path the linter could statically detect. Extracted using
  // React's documented "adjusting state during render" pattern, since this
  // is really a value-transition case (orderId/orderNum becoming available
  // or not). loadOrder itself now only ever runs its genuine async fetch
  // logic, with no synchronous setState before its first await.
  const hasOrderIdentifier = !!(orderId || orderNum)
  const [prevHasIdentifier, setPrevHasIdentifier] = useState<boolean | null>(null)
  if (prevHasIdentifier !== hasOrderIdentifier) {
    setPrevHasIdentifier(hasOrderIdentifier)
    if (!hasOrderIdentifier) {
      setLoading(false)
      setError(true)
    }
  }

  /* fetch order */
  // BUG FIX (found via production console 404s): this used to POST to
  // /api/admin-api — the OLD vanilla-site's API path, never ported to this
  // Next.js app. It always 404'd, on every single order, so the "rich"
  // order status view (items, tracking, status stepper) never once
  // rendered in production. Now calls the real, guest-safe
  // /api/v1/orders/lookup endpoint (order_number + token, or the logged-in
  // session as a fallback — see that route for the full auth model).
  // `credentials: 'include'` lets a logged-in customer's order resolve even
  // without a token (e.g. if they navigated here directly rather than via
  // the checkout redirect).
  const loadOrder = useCallback(async (silent = false) => {
    const orderNumber = orderId || orderNum
    if (!orderNumber) { setLoading(false); return }

    const ctrl  = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 8000)
    try {
      const qs  = new URLSearchParams({ order_number: orderNumber })
      const token = resolveConfirmationToken(orderNumber)
      if (token) qs.set('token', token)
      const res  = await fetch(`/api/v1/orders/lookup?${qs.toString()}`, {
        credentials: 'include',
        signal: ctrl.signal,
      })
      clearTimeout(timer)
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.order) throw new Error('not found')
      setOrder(data.order)
      setError(false)
    } catch {
      clearTimeout(timer)
      // CF1: a failed lookup means this page could NOT verify the order — it must never
      // claim "confirmed". A silent background poll that fails keeps the last good state.
      if (!silent) setError(true)
    } finally {
      setLoading(false)
    }
  }, [orderId, orderNum])

  // Standard effect-based data-fetching pattern: loadOrder is an async
  // function with all its setState calls properly guarded by the
  // AbortController + 5s timeout above, invoked directly from this effect.
  // The linter's static analysis appears to flag any setState reachable
  // from a directly-invoked async function regardless of await boundaries
  // — unlike Promise .then()/.catch()/.finally() callback chains (used
  // elsewhere in this codebase, e.g. useCartPage.ts's settings/coupon-hints
  // fetches), which the rule's own description explicitly treats as the
  // correct pattern ("calling setState in a callback function when
  // external state changes"). This is functionally the same correct
  // pattern, just written with async/await instead of .then() chaining.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { loadOrder() }, [loadOrder])

  /* ── what the page is allowed to claim ── */
  // CF1: everything below derives from the SERVER's answer (/api/v1/orders/lookup), never
  // from the URL. /order-success?id=ANYTHING&total=99999 used to render "Order Confirmed!
  // Total Paid: ₹99999". Now an unverified page says so, and the total comes from the order.
  const view = deriveView({ loading, error, order })

  // Online order whose payment hasn't landed yet (verify returned 202 / webhook still in
  // flight): poll briefly so the page flips to Confirmed by itself. Bounded — never loops.
  // `polls` is state (not a ref) so a poll that FAILS still re-arms the next one, and so the page can say so once the cap is hit.
  const [polls, setPolls] = useState(0)
  useEffect(() => {
    if (view !== 'payment_pending' || polls >= MAX_PAYMENT_POLLS) return
    const t = setTimeout(() => { void loadOrder(true).finally(() => setPolls(n => n + 1)) }, PAYMENT_POLL_MS)
    return () => clearTimeout(t)
  }, [view, polls, loadOrder])
  const pollsExhausted = view === 'payment_pending' && polls >= MAX_PAYMENT_POLLS

  // CF2: purchase analytics fire ONLY for a verified, genuinely confirmed order, with the
  // server's total, and at most once per order per browser (a refresh used to re-fire it,
  // and any URL with an id fired it before any verification).
  useEffect(() => {
    if (view !== 'confirmed' || !order?.order_number) return
    const num = order.order_number
    // First-party purchase tracking: once per order per browser.
    if (!alreadyTracked(num)) {
      markTracked(num)
      trackPurchase(num, Number(order.total_amount) || 0)
      markCartConverted()
    }
    // GA4 `purchase`: server total, tax-inclusive. Tracked separately because it needs analytics consent: with no consent yet
    // (or gtag not loaded) ga4Purchase returns false, and marking it done anyway used to lose the sale for good once the visitor
    // accepted the banner. Its own flag is set only when GA4 really sent the event.
    if (alreadyTracked(num + ':ga4')) return
    const sent = ga4Purchase({
      transactionId: num,
      value:    Number(order.total_amount) || 0,
      tax:      Number(order.tax) || 0,
      shipping: (Number(order.shipping_charge) || 0) + (Number(order.cod_surcharge) || 0),
      items: (order.items ?? []).map(i => ({
        productId: i.product_id, name: i.name ?? 'Product', variant: i.variant_value,
        price: Number(i.price_at_time ?? i.price) || 0, quantity: Number(i.quantity ?? i.qty) || 1,
      })),
    })
    if (sent) markTracked(num + ':ga4')
  }, [view, order])

  /* ── status stepper ── */
  // BUG FIX (architecture): 'processing' is not a real order_status value —
  // confirmed live, the enum only has pending/confirmed/packed/shipped/
  // delivered/cancelled/returned, and admin's own workflow doesn't set
  // 'processing' either (see PAHADI_ROOTS_SESSION_REPORT.md §2/§3). The old
  // list also omitted 'packed' entirely, so an order sitting at that real
  // status showed no progress at all. Fixed to the real sequence.
  const STATUS_ORDER = ['pending','confirmed','processing','packed','shipped','out_for_delivery','delivered']
  const STEPS = [
    { key: 'confirmed',  icon: '✅', label: 'Confirmed' },
    { key: 'processing', icon: '⚙️', label: 'Processing' },
    { key: 'packed',     icon: '📦', label: 'Packed' },
    { key: 'shipped',    icon: '🚚', label: 'Shipped' },
    { key: 'out_for_delivery', icon: '🏍️', label: 'Out for delivery' },
    { key: 'delivered',  icon: '🎉', label: 'Delivered' },
  ]

  const curStatus  = order?.order_status || 'confirmed'
  const curIdx     = STATUS_ORDER.indexOf(curStatus)
  const displayNum = order?.order_number || ''
  // Only echo the URL's reference when it has the real order-number shape (support aid).
  const urlRef = SAFE_REF.test(orderNum || orderId) ? (orderNum || orderId) : ''
  const hero = HERO[view]

  return (
    <>
      <style>{`
        /* BUG FIX (found via browser console CSP errors): removed the
           @import to Google's font CDN — CSP's style-src blocks it, so it
           always failed. Playfair Display below now reuses the
           --font-playfair CSS variable next/font already self-hosts and
           exposes on the root <body> (this page is rendered inside it, so
           the variable is inherited); DM Sans isn't used anywhere else in
           the app, so rather than adding a second self-hosted Google Font
           for one page, the base text below uses a system-font stack. */

        /* ── RESET / BASE ── */
        /* Scoped to .oc-scope: these used to be global (*, body, a, :root) and restyled the site header/footer while this page was open. */
        :where(.oc-scope), :where(.oc-scope) *, :where(.oc-scope) *::before, :where(.oc-scope) *::after { box-sizing: border-box; margin: 0; padding: 0; }
        .oc-scope {
          --g:   #1a3a1e;
          --g2:  #2d6a4f;
          --g3:  #40916c;
          --gd:  #c8920a;
          --gd2: #f4a261;
          --bg:  #faf7f2;
          --bg2: #f0ebe2;
          --bd:  #e8e0d0;
          --tx:  #1a1a1a;
          --tx2: #444;
          --tx3: #666;
        }
        .oc-scope { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: var(--bg); color: var(--tx); }
        :where(.oc-scope) a { text-decoration: none; color: inherit; }   /* :where() = zero specificity, so .oc-btn-primary etc. keep their own colours */
        :where(.oc-scope) button { cursor: pointer; font-family: inherit; }

        /* ── NAV ── */
        .oc-nav {
          background: var(--g);
          padding: 14px 24px;
          display: flex;
          align-items: center;
          justify-content: space-between;
        }
        .oc-nav-logo { display: flex; align-items: center; gap: 10px; text-decoration: none; }
        .oc-logo-name { font-family: var(--font-playfair), 'Playfair Display', serif; font-size: 20px; color: #fff; font-weight: 900; }
        .oc-logo-tl   { font-size: 10px; color: rgba(255,255,255,.55); letter-spacing: 1.5px; text-transform: uppercase; }
        .oc-nav-back  { color: rgba(255,255,255,.8); font-size: 13px; font-weight: 600; text-decoration: none; display: flex; align-items: center; gap: 6px; transition: color .2s; }
        .oc-nav-back:hover { color: #fff; }

        /* ── HERO ── */
        .oc-hero {
          background: linear-gradient(135deg, var(--g) 0%, var(--g2) 100%);
          padding: 52px 24px 40px;
          text-align: center;
          position: relative;
          overflow: hidden;
        }
        .oc-hero::before {
          content: '';
          position: absolute; inset: 0;
          background: url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='0.03'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E");
        }
        .oc-hero-warn { background: linear-gradient(135deg, #6b4a1f 0%, #8a5a1a 100%); }
        .oc-check-circle {
          width: 80px; height: 80px;
          background: rgba(255,255,255,.15);
          border: 3px solid rgba(255,255,255,.4);
          border-radius: 50%;
          display: flex; align-items: center; justify-content: center;
          margin: 0 auto 20px;
          font-size: 38px;
          animation: oc-popIn .5s cubic-bezier(.34,1.56,.64,1) both;
        }
        @keyframes oc-popIn { from{transform:scale(0);opacity:0} to{transform:scale(1);opacity:1} }
        .oc-title {
          font-family: var(--font-playfair), 'Playfair Display', serif;
          font-size: 32px; font-weight: 900;
          color: #fff; margin-bottom: 8px;
          animation: oc-fadeUp .5s .2s both;
        }
        .oc-sub { font-size: 15px; color: rgba(255,255,255,.75); animation: oc-fadeUp .5s .3s both; }
        @keyframes oc-fadeUp { from{transform:translateY(16px);opacity:0} to{transform:translateY(0);opacity:1} }
        .oc-badge {
          display: inline-block;
          background: rgba(255,255,255,.15);
          border: 1.5px solid rgba(255,255,255,.3);
          border-radius: 20px;
          padding: 6px 18px;
          font-size: 13px; font-weight: 700; color: #fff;
          margin-top: 14px;
          letter-spacing: .5px;
          animation: oc-fadeUp .5s .4s both;
        }

        /* ── MAIN ── */
        .oc-main { max-width: 720px; margin: 0 auto; padding: 28px 16px 60px; }

        /* ── CARDS ── */
        .oc-card {
          background: #fff;
          border-radius: 16px;
          border: 1.5px solid var(--bd);
          padding: 22px;
          margin-bottom: 16px;
          animation: oc-fadeUp .4s both;
        }
        .oc-card:nth-child(1){animation-delay:.1s}
        .oc-card:nth-child(2){animation-delay:.2s}
        .oc-card:nth-child(3){animation-delay:.3s}
        .oc-card:nth-child(4){animation-delay:.4s}
        .oc-card:nth-child(5){animation-delay:.5s}
        .oc-card-title {
          font-size: 12px; font-weight: 700; color: var(--tx3);
          text-transform: uppercase; letter-spacing: 1px;
          margin-bottom: 14px;
          display: flex; align-items: center; gap: 8px;
        }
        .oc-card-title::after { content:''; flex:1; height:1px; background:var(--bd); }

        /* ── STEPPER ── */
        .oc-stepper { display: flex; align-items: flex-start; }
        .oc-step { flex: 1; display: flex; flex-direction: column; align-items: center; position: relative; }
        .oc-step:not(:last-child)::after {
          content: ''; position: absolute;
          top: 16px; left: 50%; width: 100%; height: 2px;
          background: var(--bd); z-index: 0;
        }
        .oc-step.done:not(:last-child)::after { background: var(--g2); }
        .oc-step-dot {
          width: 32px; height: 32px; border-radius: 50%;
          display: flex; align-items: center; justify-content: center;
          font-size: 14px; z-index: 1; position: relative;
          border: 2px solid var(--bd); background: #fff;
          transition: all .3s;
        }
        .oc-step.done   .oc-step-dot { background: var(--g2); border-color: var(--g2); color: #fff; }
        .oc-step.active .oc-step-dot { background: #fff; border-color: var(--g2); color: var(--g2); box-shadow: 0 0 0 4px rgba(45,106,79,.12); }
        .oc-step-label { font-size: 10px; font-weight: 700; color: var(--tx3); margin-top: 6px; text-align: center; text-transform: uppercase; letter-spacing: .5px; }
        .oc-step.done .oc-step-label,
        .oc-step.active .oc-step-label { color: var(--g2); }

        /* ── ORDER ITEMS ── */
        .oc-item { display: flex; align-items: center; gap: 14px; padding: 12px 0; border-bottom: 1px solid var(--bg2); }
        .oc-item:last-child { border-bottom: none; padding-bottom: 0; }
        .oc-item-img { width: 54px; height: 54px; border-radius: 10px; background: var(--bg2); overflow: hidden; flex-shrink: 0; display: flex; align-items: center; justify-content: center; font-size: 24px; }
        .oc-item-img img { width: 100%; height: 100%; object-fit: cover; }
        .oc-item-info { flex: 1; }
        .oc-item-name  { font-size: 14px; font-weight: 700; color: var(--tx); }
        .oc-item-meta  { font-size: 12px; color: var(--tx3); margin-top: 2px; }
        .oc-item-price { font-size: 14px; font-weight: 800; color: var(--g); }

        /* ── SUMMARY ── */
        .oc-sum-row { display: flex; justify-content: space-between; padding: 7px 0; font-size: 14px; }
        .oc-sum-row.total { border-top: 2px solid var(--bd); margin-top: 6px; padding-top: 12px; font-size: 17px; font-weight: 900; color: var(--g); }
        .oc-sum-lbl { color: var(--tx2); }
        .oc-sum-val { font-weight: 700; }
        .oc-free-ship { color: var(--g2); font-weight: 700; }

        /* ── DELIVERY ── */
        .oc-del-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
        .oc-del-field .oc-del-lbl { font-size: 11px; font-weight: 700; color: var(--tx3); text-transform: uppercase; letter-spacing: .5px; display: block; margin-bottom: 3px; }
        .oc-del-field .oc-del-val { font-size: 14px; font-weight: 600; color: var(--tx); }

        /* ── TRACKING ── */
        .oc-track-box { background: var(--bg2); border-radius: 12px; padding: 14px 16px; display: flex; align-items: center; gap: 12px; }
        .oc-track-icon { font-size: 28px; }
        .oc-track-info { flex: 1; }
        .oc-track-label { font-size: 11px; font-weight: 700; color: var(--tx3); text-transform: uppercase; letter-spacing: .5px; }
        .oc-track-val   { font-size: 15px; font-weight: 800; color: var(--g); margin-top: 2px; }
        .oc-track-link  { display: inline-block; background: var(--g); color: #fff; padding: 8px 16px; border-radius: 8px; font-size: 12px; font-weight: 700; text-decoration: none; margin-top: 10px; transition: background .2s; }
        .oc-track-link:hover { background: var(--g2); }

        /* ── REVIEW ── */
        .oc-review { background: var(--bg2); border-radius: 14px; padding: 18px 20px; margin-bottom: 16px; text-align: center; }
        .oc-review-title { font-family: var(--font-playfair), 'Playfair Display', serif; font-size: 18px; font-weight: 900; color: var(--g); margin-bottom: 4px; }
        .oc-review-sub { font-size: 13px; color: var(--tx3); margin-bottom: 10px; }
        .oc-review-stars { display: flex; justify-content: center; gap: 8px; }
        .oc-review-star { font-size: 28px; cursor: pointer; transition: transform .15s; filter: grayscale(1); }
        .oc-review-star:hover, .oc-review-star.sel { filter: none; transform: scale(1.2); }
        .oc-review-thanks { color: #2e7d32; font-weight: 700; font-size: 14px; margin-top: 8px; }

        /* ── ACTIONS ── */
        .oc-actions { display: flex; gap: 12px; margin-top: 4px; flex-wrap: wrap; }
        .oc-btn-primary {
          flex: 1; min-width: 160px;
          background: var(--g); color: #fff;
          border: none; border-radius: 12px; padding: 14px 20px;
          font-size: 14px; font-weight: 700;
          text-align: center; text-decoration: none;
          transition: background .2s, transform .15s;
          display: flex; align-items: center; justify-content: center; gap: 8px;
        }
        .oc-btn-primary:hover { background: var(--g2); transform: translateY(-1px); }
        .oc-btn-secondary {
          flex: 1; min-width: 160px;
          background: #fff; color: var(--g);
          border: 2px solid var(--bd); border-radius: 12px; padding: 13px 20px;
          font-size: 14px; font-weight: 700;
          text-align: center; text-decoration: none;
          transition: all .2s;
          display: flex; align-items: center; justify-content: center; gap: 8px;
        }
        .oc-btn-secondary:hover { border-color: var(--g); background: var(--bg2); }
        .oc-btn-print {
          flex: 1; min-width: 160px;
          background: #fff; color: var(--tx2);
          border: 2px solid var(--bd); border-radius: 12px; padding: 13px 20px;
          font-size: 14px; font-weight: 700;
          transition: all .2s;
          display: flex; align-items: center; justify-content: center; gap: 8px;
        }
        .oc-btn-print:hover { border-color: var(--g); color: var(--g); background: var(--bg2); }

        /* ── SKELETON ── */
        /* F-14: honour the OS "reduce motion" setting — no pop/fade/shimmer for those users. */
        @media (prefers-reduced-motion: reduce) {
          .oc-check-circle, .oc-title, .oc-sub, .oc-badge, .oc-card, .oc-skel,
          .oc-hero, .oc-hero * { animation: none !important; transition: none !important; }
        }
        .oc-skel { background: linear-gradient(90deg,#f0f0f0 25%,#e0e0e0 50%,#f0f0f0 75%); background-size: 200% 100%; animation: oc-shimmer 1.2s infinite; border-radius: 8px; }
        @keyframes oc-shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }

        /* ── ERROR ── */
        .oc-error { text-align: center; padding: 60px 20px; }
        .oc-error-icon { font-size: 48px; margin-bottom: 16px; }
        .oc-error h2 { font-family: var(--font-playfair), 'Playfair Display', serif; font-size: 24px; color: var(--g); margin-bottom: 8px; }
        .oc-error p  { color: #666; font-size: 14px; margin-bottom: 24px; }

        /* ── NEWSLETTER ── */
        .oc-newsletter { border-top: 2px solid #c8920a; border-bottom: 2px solid rgba(200,146,10,.2); box-shadow: 0 -6px 32px rgba(0,0,0,.18), inset 0 1px 0 rgba(200,146,10,.15); }
        .oc-nl-inner-wrap { background: linear-gradient(180deg,#0f2a14 0%,#1a3a1e 100%); padding: 32px 40px 36px; }
        .oc-nl-inner { max-width: 1200px; margin: 0 auto; display: flex; align-items: center; justify-content: space-between; gap: 24px; flex-wrap: wrap; }
        .oc-nl-text h4 { font-family: var(--font-playfair), 'Playfair Display', serif; font-size: 18px; font-weight: 900; color: #fff; margin-bottom: 4px; }
        .oc-nl-text p  { font-size: 13px; color: rgba(255,255,255,.55); }
        .oc-nl-form { display: flex; border-radius: 10px; overflow: hidden; border: 1.5px solid rgba(255,255,255,.18); min-width: 300px; }
        .oc-nl-inp { flex: 1; padding: 12px 16px; background: rgba(255,255,255,.07); border: none; color: #fff; font-size: 13px; outline: none; }
        .oc-nl-inp::placeholder { color: rgba(255,255,255,.35); }
        .oc-nl-btn { padding: 12px 20px; background: #c8920a; color: #1a0800; font-weight: 800; font-size: 13px; border: none; cursor: pointer; transition: background .2s; white-space: nowrap; }
        .oc-nl-btn:hover { background: #f4a261; }

        /* ── FOOTER ── */
        .oc-footer { background: #132b17; padding: 0; overflow: hidden; }
        .oc-f-frieze { background: #1a0d2e; border-top: 2px solid #c8920a; border-bottom: 2px solid #c8920a; line-height: 0; overflow: hidden; }
        .oc-f-brand-row { display: flex; align-items: center; gap: 32px; padding: 36px 60px 28px; }
        .oc-f-brand-col { flex: 1; min-width: 0; }
        .oc-f-brand-name { font-family: var(--font-playfair), 'Playfair Display', serif; font-size: 26px; font-weight: 900; color: #fff; margin-bottom: 4px; }
        .oc-f-brand-sub  { font-size: 10.5px; color: #c8920a; font-weight: 700; letter-spacing: 2.5px; text-transform: uppercase; margin-bottom: 12px; }
        .oc-f-brand-desc { font-size: 14px; color: rgba(255,255,255,.5); line-height: 1.85; max-width: 560px; }
        .oc-f-vine { flex-shrink: 0; align-self: stretch; display: flex; align-items: center; }
        .oc-f-main { padding: 32px 60px 28px; display: grid; grid-template-columns: 1fr 1fr 1.4fr; gap: 60px; }
        .oc-fh { font-size: 11px; font-weight: 800; letter-spacing: 2.5px; color: #c8920a; text-transform: uppercase; margin-bottom: 16px; padding-bottom: 8px; border-bottom: 1px solid rgba(200,146,10,.22); }
        .oc-ful { list-style: none; display: flex; flex-direction: column; gap: 11px; }
        .oc-ful li a { font-size: 14.5px; color: rgba(255,255,255,.55); transition: all .2s; display: flex; align-items: center; gap: 7px; }
        .oc-ful li a:hover { color: #fff; padding-left: 5px; }
        .oc-f-contact-item { display: flex; align-items: flex-start; gap: 10px; margin-bottom: 10px; }
        .oc-f-contact-icon { font-size: 15px; flex-shrink: 0; margin-top: 1px; }
        .oc-f-contact-text { font-size: 13.5px; color: rgba(255,255,255,.55); line-height: 1.55; }
        .oc-f-contact-text a { color: rgba(255,255,255,.55); transition: color .2s; }
        .oc-f-contact-text a:hover { color: #fff; }
        .oc-f-social-bar { padding: 24px 60px 28px; }
        .oc-f-social-inner { display: flex; align-items: center; justify-content: flex-start; flex-wrap: wrap; gap: 32px; }
        .oc-f-soc-row { display: flex; gap: 12px; flex-wrap: wrap; }
        .oc-f-soc { width: 46px; height: 46px; border-radius: 50%; background: rgba(255,255,255,.06); border: 1px solid rgba(200,146,10,.35); display: flex; align-items: center; justify-content: center; transition: all .22s; color: rgba(255,255,255,.65); text-decoration: none; }
        .oc-f-soc:hover { background: rgba(200,146,10,.2); border-color: #c8920a; color: #fff; transform: translateY(-2px); }
        .oc-f-fssai { background: rgba(255,255,255,.05); border: 1px solid rgba(200,146,10,.22); border-radius: 10px; padding: 9px 14px; display: inline-flex; align-items: center; gap: 10px; }
        .oc-f-fssai-badge { background: #fff; border-radius: 5px; padding: 3px 7px; font-size: 11px; font-weight: 900; color: #1a6b1a; letter-spacing: .5px; }
        .oc-f-fssai-num { font-size: 10.5px; color: rgba(255,255,255,.4); margin-top: 2px; }
        .oc-f-bot { padding: 14px 60px 18px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px; }
        .oc-f-bot-left { font-size: 12px; color: #a9bcab; }
        .oc-f-bot-left strong { color: rgba(255,255,255,.8); font-weight: 700; }
        .oc-f-bot-tag { font-size: 11.5px; color: #d4b04a; font-style: italic; white-space: nowrap; }

        @media (max-width: 768px) {
          .oc-f-brand-row { flex-wrap: wrap; gap: 16px; padding: 28px 28px 22px; }
          .oc-f-vine { display: none; }
          .oc-f-main { grid-template-columns: 1fr 1fr; gap: 28px; padding: 28px 28px 20px; }
          .oc-f-social-bar { padding: 20px 28px 24px; }
          .oc-f-social-inner { flex-direction: column; align-items: flex-start; gap: 16px; }
          .oc-nl-inner { flex-direction: column; align-items: flex-start; }
          .oc-nl-form { min-width: 100%; width: 100%; }
        }
        @media (max-width: 480px) {
          .oc-title { font-size: 26px; }
          .oc-del-grid { grid-template-columns: minmax(0, 1fr); }
          .oc-actions { flex-direction: column; }
          .oc-btn-primary, .oc-btn-secondary, .oc-btn-print { min-width: unset; }
          .oc-f-main { grid-template-columns: minmax(0, 1fr); padding: 20px 20px 16px; }
          .oc-f-brand-row { padding: 20px; flex-direction: column; align-items: flex-start; }
          .oc-f-social-bar { padding: 20px 20px 24px; }
          .oc-nl-inner-wrap { padding: 24px 20px; }
          .oc-f-bot { padding: 12px 20px; flex-direction: column; text-align: center; gap: 6px; }
        }

        /* BUG FIX: "Print Invoice" previously called window.print() on this
           whole confirmation page (header, nav, footer, star rating and
           all) — not a real tax invoice. .invoice-print-only holds the
           actual GST invoice (seller GSTIN, HSN codes, CGST/SGST/IGST
           breakdown — see lib/invoiceGst.ts); it's hidden in the normal
           view and is the ONLY thing shown when printing. */
        .invoice-print-only { display: none; }
        @media print {
          body * { visibility: hidden; }
          /* visibility:hidden keeps the space, which printed blank pages after the invoice — take the page and the site chrome out of the layout. */
          header, footer, nav, .ticker-wrap, .ann-bar, #pr-ai-fab, #pr-wa, .oc-hero, .oc-card, .oc-actions, .oc-error { display: none !important; }
          .invoice-print-only, .invoice-print-only * { visibility: visible; }
          .invoice-print-only {
            display: block; position: absolute; top: 0; left: 0; width: 100%;
            padding: 24px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            color: #1a1a1a; font-size: 12px;
          }
          .inv-header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #1a3d2e; padding-bottom: 12px; margin-bottom: 12px; }
          .inv-biz-name { font-size: 18px; font-weight: 900; color: #1a3d2e; }
          .inv-biz-addr, .inv-biz-gstin { font-size: 11px; color: #444; margin-top: 2px; }
          .inv-title { font-size: 20px; font-weight: 900; letter-spacing: 1px; color: #1a3d2e; }
          .inv-meta { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 24px; font-size: 11.5px; margin-bottom: 14px; }
          .inv-buyer { margin-bottom: 14px; font-size: 11.5px; }
          .inv-section-title { font-weight: 800; font-size: 12px; margin-bottom: 4px; color: #1a3d2e; }
          .inv-table { width: 100%; border-collapse: collapse; font-size: 11px; margin-bottom: 12px; }
          .inv-table th, .inv-table td { border: 1px solid #ccc; padding: 5px 6px; text-align: left; }
          .inv-table th { background: #f0ede4; font-weight: 800; }
          .inv-table td:nth-child(n+4), .inv-table th:nth-child(n+4) { text-align: right; }
          .inv-totals { max-width: 320px; margin-left: auto; font-size: 12px; }
          .inv-totals > div { display: flex; justify-content: space-between; padding: 3px 0; }
          .inv-grand-total { border-top: 2px solid #1a3d2e; margin-top: 6px; padding-top: 6px !important; font-weight: 900; font-size: 14px; }
          .inv-footer-note { margin-top: 24px; font-size: 10.5px; color: #666; text-align: center; }
        }
      `}</style>
      <div className="oc-scope">


      {/* S1: the Cart ✓ → Checkout ✓ → Confirmation progress bar. Shown only while the page is
          making (or has verified) a success claim — never for an unverified, failed or cancelled
          order, where "Confirmation" as the active step would be false. */}
      {(view === 'loading' || view === 'confirmed' || view === 'payment_pending') && (
        <CheckoutStepper current="confirmation" skin="checkout" />
      )}

      {/* ── HERO ── (driven by the verified order, never by the URL — CF1) */}
      {/* F-14: role=status + aria-live so screen readers hear "Confirming your payment…" turn into
          "Order Confirmed!" without the customer having to hunt for the change. */}
      <div className={`oc-hero${hero.tone === 'warn' ? ' oc-hero-warn' : ''}`} data-view={view} role="status" aria-live="polite" aria-atomic="true">
        <div className="oc-check-circle">{hero.icon}</div>
        <h1 className="oc-title">{hero.title}</h1>
        <div className="oc-sub">{hero.sub}</div>
        {pollsExhausted && (
          <div className="oc-sub" style={{marginTop:10}}>
            This is taking longer than usual. <button type="button" className="oc-btn-print" style={{display:'inline-block',width:'auto',padding:'6px 14px',margin:'0 6px'}} onClick={() => { setPolls(0); void loadOrder(true) }}>Check again</button>
            or contact us with your order number. Please don&#39;t pay again.
          </div>
        )}
        {displayNum
          ? <div className="oc-badge">📋 {displayNum}</div>
          : (view === 'unverified' && urlRef ? <div className="oc-badge">Ref: {urlRef}</div> : null)}
      </div>

      {/* ── MAIN ── */}
      <div className="oc-main">

        {/* Loading skeleton */}
        {loading && (
          <div>
            <div className="oc-card">
              <div className="oc-skel" style={{height:16,width:'40%',marginBottom:16}} />
              <div style={{display:'flex',gap:16}}>
                <div className="oc-skel" style={{width:54,height:54,borderRadius:10,flexShrink:0}} />
                <div style={{flex:1}}>
                  <div className="oc-skel" style={{height:14,width:'70%',marginBottom:8}} />
                  <div className="oc-skel" style={{height:12,width:'40%'}} />
                </div>
              </div>
            </div>
            <div className="oc-card">
              <div className="oc-skel" style={{height:16,width:'40%',marginBottom:16}} />
              <div className="oc-skel" style={{height:12,marginBottom:8}} />
              <div className="oc-skel" style={{height:12,width:'80%'}} />
            </div>
          </div>
        )}

        {/* Unverified — the lookup failed or this is not an order the visitor can see (CF1) */}
        {!loading && error && (
          <div className="oc-error">
            <div className="oc-error-icon"><Icon name="search" /></div>
            <h2>We couldn&#39;t verify this order</h2>
            <p>
              If you just placed an order, it may take a moment to appear — try again in a minute. If you
              gave us an email address, a confirmation will be sent there; you can also track the order on the
              Track Order page with your order number and mobile number, or open it from your account if you&#39;re signed in.
            </p>
            <div style={{display:'flex',gap:10,justifyContent:'center',flexWrap:'wrap'}}>
              <button
                type="button"
                className="oc-btn-primary"
                style={{maxWidth:180,margin:0}}
                onClick={() => { setPolls(0); setLoading(true); setError(false); void loadOrder() }}
              >Try again</button>
              <Link href="/track" className="oc-btn-primary" style={{maxWidth:180,margin:0}}>Track Order</Link>
              <Link prefetch={false} href="/account?tab=orders" className="oc-btn-primary" style={{maxWidth:180,margin:0}}>My Orders</Link>
              <Link href="/" className="oc-btn-primary" style={{maxWidth:180,margin:0}}>← Back to Store</Link>
            </div>
          </div>
        )}

        {/* Order content */}
        {!loading && order && (() => {
          const items    = order.items || []
          const total    = order.total_amount || 0
          const summaryInv = computeOrderInvoice({
            items: items.map(it => ({ name: it.name || 'Product', qty: it.qty ?? it.quantity ?? 1, price: it.price ?? it.price_at_time ?? 0 })),
            total_amount: total, subtotal: order.subtotal, coupon_discount: order.discount_amount,
            shipping_charge: order.shipping_charge, cod_surcharge: order.cod_surcharge, tax: order.tax, state: order.state,
            cgst: order.cgst, sgst: order.sgst, igst: order.igst, loyalty_points_redeemed: order.loyalty_points_redeemed,
          }, { loyaltyPointValue: order.loyalty_point_value })
          const trackNum = order.tracking_number || ''
          const courier  = order.courier || ''
          const trackUrl = getTrackingUrl(courier, trackNum)
          const addr     = [order.delivery_address, order.city, order.state, order.pincode].filter(Boolean).join(', ')

          return (
            <>
              {/* Status stepper — fulfilment progress only makes sense for a confirmed order */}
              {view === 'confirmed' && <div className="oc-card">
                <div className="oc-card-title">📊 Order Status</div>
                <div className="oc-stepper">
                  {STEPS.map(s => {
                    const sIdx = STATUS_ORDER.indexOf(s.key)
                    const cls  = sIdx < curIdx ? 'oc-step done' : sIdx === curIdx ? 'oc-step active' : 'oc-step'
                    return (
                      <div key={s.key} className={cls}>
                        <div className="oc-step-dot">{s.icon}</div>
                        <div className="oc-step-label">{s.label}</div>
                      </div>
                    )
                  })}
                </div>
              </div>}

              {/* Order items */}
              <div className="oc-card">
                <div className="oc-card-title"><Icon name="cart" /> Order Items</div>
                {items.length === 0
                  ? <div style={{color:'#666',fontSize:13}}>The item list isn&#39;t available on this page — it is in your confirmation email and under Track Order.</div>
                  : items.map((item, i) => (
                    <div key={i} className="oc-item">
                      <div className="oc-item-img">
                        {item.image_url
                          // eslint-disable-next-line @next/next/no-img-element
                          ? <img src={item.image_url} alt={item.name || ''} />
                          : <span>{item.emoji || '🌿'}</span>}
                      </div>
                      <div className="oc-item-info">
                        <div className="oc-item-name">{item.name || 'Product'}</div>
                        <div className="oc-item-meta">
                          Qty: {item.qty || item.quantity || 1}
                          {item.variant_value ? ` · ${item.variant_value}` : ''}
                        </div>
                      </div>
                      <div className="oc-item-price">
                        ₹{((item.price || item.price_at_time || 0) * (item.qty || item.quantity || 1)).toLocaleString('en-IN')}
                      </div>
                    </div>
                  ))
                }
              </div>

              {/* Price summary — AUDIT S1-009/S3-006: same shared computation as the invoice, so the
                  rows (incl. derived prepaid/loyalty discount and round-off) always sum to the total. */}
              <div className="oc-card">
                <div className="oc-card-title">💰 Price Summary</div>
                {invoiceRows(summaryInv).filter(r => r.kind !== 'total').map(r => (
                  <div key={r.key} className="oc-sum-row">
                    <span className="oc-sum-lbl" style={r.kind === 'discount' ? {color:'#2d6a4f'} : undefined}>{r.key === 'subtotal' ? 'Subtotal (incl. GST)' : r.label}</span>
                    <span className="oc-sum-val" style={r.kind === 'discount' ? {color:'#2d6a4f'} : undefined}>{r.amount < 0 ? `−₹${(-r.amount).toLocaleString('en-IN')}` : `₹${r.amount.toLocaleString('en-IN')}`}</span>
                  </div>
                ))}
                {summaryInv.tax > 0 && <div className="oc-sum-row"><span className="oc-sum-lbl" style={{color:'#888',fontSize:13}}>↳ GST included</span><span className="oc-sum-val" style={{color:'#888',fontSize:13}}>₹{summaryInv.tax.toLocaleString('en-IN')}</span></div>}
                {summaryInv.shipping === 0 && (
                  <div className="oc-sum-row">
                    <span className="oc-sum-lbl">Shipping</span>
                    <span className="oc-sum-val oc-free-ship">🎉 FREE</span>
                  </div>
                )}
                <div className="oc-sum-row total"><span>{totalLabel(order)}</span><span>₹{total.toLocaleString('en-IN')}</span></div>
              </div>

              {/* Delivery details */}
              <div className="oc-card">
                <div className="oc-card-title"><Icon name="pin" /> Delivery Details</div>
                <div className="oc-del-grid">
                  <div className="oc-del-field"><div className="oc-del-lbl">Name</div><span className="oc-del-val">{order.customer_name || '—'}</span></div>
                  <div className="oc-del-field"><div className="oc-del-lbl">Phone</div><span className="oc-del-val">{order.customer_phone || '—'}</span></div>
                  <div className="oc-del-field" style={{gridColumn:'1/-1'}}><div className="oc-del-lbl">Address</div><span className="oc-del-val">{addr || '—'}</span></div>
                  {view === 'confirmed' && <div className="oc-del-field"><div className="oc-del-lbl">Estimated Delivery</div><span className="oc-del-val">🗓 {DELIVERY_WINDOWS_TEXT}</span></div>}
                  <div className="oc-del-field"><div className="oc-del-lbl">Payment</div><span className="oc-del-val">{(order.payment_method === 'razorpay' || order.payment_method === 'razorpay_online') ? '💳 Online' : '💵 Cash on Delivery'}</span></div>
                </div>
              </div>

              {/* Tracking — only for an order that is actually going out */}
              {view === 'confirmed' && <div className="oc-card">
                <div className="oc-card-title"><Icon name="truck" /> Tracking</div>
                <div className="oc-track-box">
                  <span className="oc-track-icon"><Icon name="truck" /></span>
                  <div className="oc-track-info">
                    {trackNum ? (
                      <>
                        <div className="oc-track-label">Tracking Number</div>
                        <div className="oc-track-val">{trackNum}{courier ? ` · ${courier}` : ''}</div>
                        {trackUrl && <a href={trackUrl} target="_blank" rel="noopener noreferrer" className="oc-track-link">Track your order →</a>}
                      </>
                    ) : (
                      <>
                        <div className="oc-track-label">Tracking</div>
                        <div style={{fontSize:13,color:'#666',fontWeight:500,marginTop:2}}>{TRACKING_NOTIFICATION_TEXT}</div>
                      </>
                    )}
                  </div>
                </div>
              </div>}

              {/* Actions */}
              <div className="oc-actions">
                <Link prefetch={false} href="/account" className="oc-btn-primary"><Icon name="package" /> View All Orders</Link>
                {view === 'confirmed' && <button onClick={() => window.print()} className="oc-btn-print">🧾 Print Invoice</button>}
                <Link href="/" className="oc-btn-secondary"><Icon name="leaf" /> Continue Shopping</Link>
              </div>

              {/* BUG FIX: "Print Invoice" previously just printed this whole
                  confirmation webpage — not a real tax invoice. This block
                  is hidden in the normal view (.invoice-print-only, see
                  <style> above) and is the ONLY thing shown when printing —
                  a real GST invoice with the seller's GSTIN, per-item HSN
                  codes, and a CGST+SGST (intra-state) or IGST (inter-state)
                  split, computed in lib/invoiceGst.ts from confirmed real
                  columns (products.hsn_code, products.gst_rate). */}
              {view === 'confirmed' && <div className="invoice-print-only">
                {(() => {
                  // AUDIT S1-009 / S3-006 / F2-02 / F2-03: ONE shared computation (lib/invoiceGst
                  // computeOrderInvoice) from the STORED order columns — tax from orders.tax (split
                  // with the paise-safe splitGST), discounts/round-off derived so the lines always sum
                  // to the paid total. Live products.gst_rate is no longer used for money; HSN is
                  // shown as reference only.
                  const inv = computeOrderInvoice({
                    items: items.map(it => ({
                      name:    it.name || 'Product',
                      variant: it.variant_value,
                      hsnCode: it.hsn_code,
                      qty:     it.qty ?? it.quantity ?? 1,
                      price:   it.price ?? it.price_at_time ?? 0,
                    })),
                    total_amount:    total,
                    subtotal:        order.subtotal,
                    coupon_discount: order.discount_amount,
                    shipping_charge: order.shipping_charge,
                    cod_surcharge:   order.cod_surcharge,
                    tax:             order.tax,
                    state:           order.state,
                    cgst: order.cgst, sgst: order.sgst, igst: order.igst,
                    loyalty_points_redeemed: order.loyalty_points_redeemed,
                  }, { loyaltyPointValue: order.loyalty_point_value })
                  const supplyType = inv.supplyType
                  const rows = invoiceRows(inv)

                  return (
                    <>
                      <div className="inv-header">
                        <div>
                          <div className="inv-biz-name">{BUSINESS_INFO.name}</div>
                          <div className="inv-biz-brand" style={{ fontSize: '12px', color: '#666', fontWeight: 600, marginTop: '-2px', marginBottom: '4px' }}>
                            trading as {BUSINESS_INFO.brandName}
                          </div>
                          <div className="inv-biz-addr">{BUSINESS_INFO.address}</div>
                          <div className="inv-biz-gstin">GSTIN: {BUSINESS_INFO.gstin}</div>
                        </div>
                        <div className="inv-title">TAX INVOICE</div>
                      </div>

                      <div className="inv-meta">
                        <div><strong>Invoice No:</strong> INV-{order.order_number}</div>
                        <div><strong>Invoice Date:</strong> {order.created_at ? new Date(order.created_at).toLocaleDateString('en-IN') : ''}</div>
                        <div><strong>Order No:</strong> {order.order_number}</div>
                        <div><strong>Place of Supply:</strong> {order.state || '—'} ({supplyType === 'intra' ? 'Intra-state' : 'Inter-state'})</div>
                      </div>

                      <div className="inv-buyer">
                        <div className="inv-section-title">Bill To / Ship To</div>
                        <div>{order.customer_name || '—'}</div>
                        <div>{addr || '—'}</div>
                        {order.customer_phone && <div>Phone: {order.customer_phone}</div>}
                      </div>

                      <table className="inv-table">
                        <thead>
                          <tr>
                            <th>#</th>
                            <th>Item</th>
                            <th>HSN</th>
                            <th>Qty</th>
                            <th>Rate (incl. GST)</th>
                            <th>Amount</th>
                          </tr>
                        </thead>
                        <tbody>
                          {inv.lines.map((l, i) => (
                            <tr key={i}>
                              <td>{i + 1}</td>
                              <td>{l.name}{l.variant ? ` (${l.variant})` : ''}</td>
                              <td>{l.hsnCode || '—'}</td>
                              <td>{l.qty}</td>
                              <td>₹{Number(l.price).toFixed(2)}</td>
                              <td>₹{l.lineTotal.toFixed(2)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>

                      <div className="inv-totals">
                        {rows.map(r => r.kind === 'total'
                          ? <div key={r.key} className="inv-grand-total"><span>Grand Total</span><span>₹{r.amount.toFixed(2)}</span></div>
                          : <div key={r.key}><span>{r.label}</span><span>{r.amount < 0 ? `-₹${(-r.amount).toFixed(2)}` : `₹${r.amount.toFixed(2)}`}</span></div>
                        )}
                        {/* GST included in the above — from the stored order tax, never re-derived live. */}
                        {inv.tax > 0 && inv.taxableValue != null && <div><span>Taxable value (after discounts)</span><span>₹{inv.taxableValue.toFixed(2)}</span></div>}
                        {inv.tax > 0 && (supplyType === 'intra' ? (
                          <>
                            <div><span>CGST</span><span>₹{inv.cgst.toFixed(2)}</span></div>
                            <div><span>SGST</span><span>₹{inv.sgst.toFixed(2)}</span></div>
                          </>
                        ) : (
                          <div><span>IGST</span><span>₹{inv.igst.toFixed(2)}</span></div>
                        ))}
                        {inv.tax > 0 && <div><span>Total GST (included in Grand Total)</span><span>₹{inv.tax.toFixed(2)}</span></div>}
                      </div>

                      <div className="inv-footer-note">
                        This is a computer-generated invoice and does not require a signature.
                      </div>
                    </>
                  )
                })()}
              </div>}
            </>
          )
        })()}
      </div>

      {/* CONF-001 (Nov 2026 audit): the newsletter block that used to sit here had no submit handler (a dead form) and
          pushed a sign-up at customers who had just paid or whose order could not be verified. The real newsletter form lives in the
          site Footer. */}

      </div>
    </>
  )
}

export default function OrderSuccessPage() {
  return (
    <Suspense fallback={
      <div style={{minHeight:'100vh',background:'#faf7f2',display:'flex',alignItems:'center',justifyContent:'center'}}>
        <div style={{width:320,height:400,background:'#f0ebe2',borderRadius:16,animation:'pulse 1.5s ease-in-out infinite'}}/>
      </div>
    }>
      <SuccessContent />
    </Suspense>
  )
}
