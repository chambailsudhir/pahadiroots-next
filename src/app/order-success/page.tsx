'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useState, useCallback } from 'react'

/* ─── Types ─────────────────────────────────────────────────── */
interface OrderItem {
  name?: string
  image_url?: string
  emoji?: string
  qty?: number
  quantity?: number
  variant_value?: string
  price?: number
  price_at_time?: number
}

interface Order {
  order_number?: string
  order_status?: string
  payment_status?: string
  total_amount?: number
  subtotal?: number
  shipping_charge?: number
  discount_amount?: number
  tax?: number
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
  bluedart:   'https://www.bluedart.com/tracking',
  dtdc:       'https://www.dtdc.in/tracking.asp',
  ecom:       'https://ecomexpress.in/tracking/',
  xpressbees: 'https://www.xpressbees.com/shipment/tracking',
  shadowfax:  'https://track.shadowfax.in/',
  shiprocket: 'https://shiprocket.co/tracking/',
}

function getTrackingUrl(courier: string, num: string) {
  if (!courier || !num) return null
  const base = COURIER_URLS[courier.toLowerCase().replace(/\s/g, '')] || null
  return base ? base + num : null
}

function getDeliveryEstimate(createdAt?: string) {
  const d = createdAt ? new Date(createdAt) : new Date()
  const lo = new Date(d); lo.setDate(lo.getDate() + 5)
  const hi = new Date(d); hi.setDate(hi.getDate() + 7)
  const fmt = (dt: Date) => dt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
  return `${fmt(lo)} – ${fmt(hi)}, ${hi.getFullYear()}`
}

/* ─── Main component ────────────────────────────────────────── */
function SuccessContent() {
  const params      = useSearchParams()
  const orderId     = params.get('id')    || ''
  const orderNum    = params.get('num')   || ''
  const totalParam  = params.get('total') || ''

  const [order,   setOrder]   = useState<Order | null>(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(false)
  const [rating,  setRating]  = useState(0)
  const [rated,   setRated]   = useState(false)

  /* fetch order */
  const loadOrder = useCallback(async () => {
    if (!orderId && !orderNum) { setLoading(false); setError(true); return }
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 5000)
    try {
      const res  = await fetch('/api/admin-api', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'public_get_order', order_id: orderId, orderNumber: orderNum }),
        signal: ctrl.signal,
      })
      clearTimeout(timer)
      const data = await res.json()
      if (!res.ok || !data.order) throw new Error('not found')
      setOrder(data.order)
    } catch {
      clearTimeout(timer)
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [orderId, orderNum])

  useEffect(() => { loadOrder() }, [loadOrder])

  /* rate order */
  async function rateOrder(n: number) {
    if (rated) return
    setRating(n); setRated(true)
    try {
      await fetch('/api/admin-api', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save_row', table: 'order_ratings', data: { order_id: orderId, rating: n, created_at: new Date().toISOString() } }),
      })
    } catch { /* non-critical */ }
  }

  /* ── status stepper ── */
  const STATUS_ORDER = ['pending','confirmed','processing','shipped','delivered']
  const STEPS = [
    { key: 'confirmed',  icon: '✅', label: 'Confirmed' },
    { key: 'processing', icon: '📦', label: 'Processing' },
    { key: 'shipped',    icon: '🚚', label: 'Shipped' },
    { key: 'delivered',  icon: '🎉', label: 'Delivered' },
  ]

  const curStatus  = order?.order_status || 'confirmed'
  const curIdx     = STATUS_ORDER.indexOf(curStatus)
  const displayNum = order?.order_number || (orderId ? `Order #${orderId.slice(0,8)}` : '')

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;900&family=DM+Sans:wght@400;500;600;700&display=swap');

        /* ── RESET / BASE ── */
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        :root {
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
          --tx3: #888;
        }
        body { font-family: 'DM Sans', sans-serif; background: var(--bg); color: var(--tx); }
        a { text-decoration: none; color: inherit; }
        button { cursor: pointer; font-family: inherit; }

        /* ── NAV ── */
        .oc-nav {
          background: var(--g);
          padding: 14px 24px;
          display: flex;
          align-items: center;
          justify-content: space-between;
        }
        .oc-nav-logo { display: flex; align-items: center; gap: 10px; text-decoration: none; }
        .oc-logo-name { font-family: 'Playfair Display', serif; font-size: 20px; color: #fff; font-weight: 900; }
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
          font-family: 'Playfair Display', serif;
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
        .oc-del-field label { font-size: 11px; font-weight: 700; color: var(--tx3); text-transform: uppercase; letter-spacing: .5px; display: block; margin-bottom: 3px; }
        .oc-del-field span  { font-size: 14px; font-weight: 600; color: var(--tx); }

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
        .oc-review-title { font-family: 'Playfair Display', serif; font-size: 18px; font-weight: 900; color: var(--g); margin-bottom: 4px; }
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
        .oc-skel { background: linear-gradient(90deg,#f0f0f0 25%,#e0e0e0 50%,#f0f0f0 75%); background-size: 200% 100%; animation: oc-shimmer 1.2s infinite; border-radius: 8px; }
        @keyframes oc-shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }

        /* ── ERROR ── */
        .oc-error { text-align: center; padding: 60px 20px; }
        .oc-error-icon { font-size: 48px; margin-bottom: 16px; }
        .oc-error h2 { font-family: 'Playfair Display', serif; font-size: 24px; color: var(--g); margin-bottom: 8px; }
        .oc-error p  { color: var(--tx3); font-size: 14px; margin-bottom: 24px; }

        /* ── NEWSLETTER ── */
        .oc-newsletter { border-top: 2px solid #c8920a; border-bottom: 2px solid rgba(200,146,10,.2); box-shadow: 0 -6px 32px rgba(0,0,0,.18), inset 0 1px 0 rgba(200,146,10,.15); }
        .oc-nl-inner-wrap { background: linear-gradient(180deg,#0f2a14 0%,#1a3a1e 100%); padding: 32px 40px 36px; }
        .oc-nl-inner { max-width: 1200px; margin: 0 auto; display: flex; align-items: center; justify-content: space-between; gap: 24px; flex-wrap: wrap; }
        .oc-nl-text h4 { font-family: 'Playfair Display', serif; font-size: 18px; font-weight: 900; color: #fff; margin-bottom: 4px; }
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
        .oc-f-brand-name { font-family: 'Playfair Display', serif; font-size: 26px; font-weight: 900; color: #fff; margin-bottom: 4px; }
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
        .oc-f-bot-left { font-size: 12px; color: rgba(255,255,255,.28); }
        .oc-f-bot-left strong { color: rgba(255,255,255,.8); font-weight: 700; }
        .oc-f-bot-tag { font-size: 11.5px; color: rgba(200,146,10,.45); font-style: italic; white-space: nowrap; }

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
          .oc-del-grid { grid-template-columns: 1fr; }
          .oc-actions { flex-direction: column; }
          .oc-btn-primary, .oc-btn-secondary, .oc-btn-print { min-width: unset; }
          .oc-f-main { grid-template-columns: 1fr; padding: 20px 20px 16px; }
          .oc-f-brand-row { padding: 20px; flex-direction: column; align-items: flex-start; }
          .oc-f-social-bar { padding: 20px 20px 24px; }
          .oc-nl-inner-wrap { padding: 24px 20px; }
          .oc-f-bot { padding: 12px 20px; flex-direction: column; text-align: center; gap: 6px; }
        }
      `}</style>

      {/* ── NAV ── */}
      <nav className="oc-nav">
        <Link href="/" className="oc-nav-logo">
          <div style={{width:38,height:38,borderRadius:9,overflow:'hidden',background:'rgba(255,255,255,.15)',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="https://ulyrhnpoiypuvaurlqqi.supabase.co/storage/v1/object/public/pahadi-images/5%20pahadi%20roots.png" alt="Pahadi Roots" style={{width:38,height:38,objectFit:'contain'}} onError={e=>{(e.target as HTMLImageElement).style.display='none'}} />
          </div>
          <div>
            <div className="oc-logo-name">5 Pahadi Roots</div>
            <div className="oc-logo-tl">Himalayan Natural Store</div>
          </div>
        </Link>
        <Link href="/" className="oc-nav-back">← Continue Shopping</Link>
      </nav>

      {/* ── HERO ── */}
      <div className="oc-hero">
        <div className="oc-check-circle">✅</div>
        <div className="oc-title">Order Confirmed!</div>
        <div className="oc-sub">Thank you! Your mountain goodness is on its way 🌿</div>
        <div className="oc-badge">
          {loading ? 'Loading…' : displayNum ? `📋 ${displayNum}` : (totalParam ? `Total Paid: ₹${totalParam}` : '✅ Order Placed')}
        </div>
      </div>

      {/* ── MAIN ── */}
      <main className="oc-main">

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

        {/* Error / fallback */}
        {!loading && error && (
          <div className="oc-error">
            <div className="oc-error-icon">📦</div>
            <h2>Order placed!</h2>
            <p>We couldn&#39;t load your order details right now.<br />Check your email or WhatsApp for confirmation.</p>
            <Link href="/" className="oc-btn-primary" style={{maxWidth:220,margin:'0 auto'}}>← Back to Store</Link>
          </div>
        )}

        {/* Order content */}
        {!loading && order && (() => {
          const items    = order.items || []
          const total    = order.total_amount || 0
          const sub      = order.subtotal || total
          const ship     = order.shipping_charge || 0
          const disc     = order.discount_amount || 0
          const tax      = order.tax || 0
          const trackNum = order.tracking_number || ''
          const courier  = order.courier || ''
          const trackUrl = getTrackingUrl(courier, trackNum)
          const estimate = getDeliveryEstimate(order.created_at)
          const addr     = [order.delivery_address, order.city, order.state, order.pincode].filter(Boolean).join(', ')

          return (
            <>
              {/* Status stepper */}
              <div className="oc-card">
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
              </div>

              {/* Order items */}
              <div className="oc-card">
                <div className="oc-card-title">🛒 Order Items</div>
                {items.length === 0
                  ? <div style={{color:'#888',fontSize:13}}>Items loading…</div>
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

              {/* Price summary */}
              <div className="oc-card">
                <div className="oc-card-title">💰 Price Summary</div>
                <div className="oc-sum-row"><span className="oc-sum-lbl">Subtotal (incl. GST)</span><span className="oc-sum-val">₹{sub.toLocaleString('en-IN')}</span></div>
                {disc > 0 && <div className="oc-sum-row"><span className="oc-sum-lbl" style={{color:'#2d6a4f'}}>Discount</span><span className="oc-sum-val" style={{color:'#2d6a4f'}}>−₹{disc.toLocaleString('en-IN')}</span></div>}
                {tax > 0 && <div className="oc-sum-row"><span className="oc-sum-lbl" style={{color:'#888',fontSize:13}}>↳ GST included</span><span className="oc-sum-val" style={{color:'#888',fontSize:13}}>₹{tax.toLocaleString('en-IN')}</span></div>}
                <div className="oc-sum-row">
                  <span className="oc-sum-lbl">Shipping</span>
                  <span className={`oc-sum-val${ship === 0 ? ' oc-free-ship' : ''}`}>{ship === 0 ? '🎉 FREE' : `₹${ship}`}</span>
                </div>
                <div className="oc-sum-row total"><span>Total Paid</span><span>₹{total.toLocaleString('en-IN')}</span></div>
              </div>

              {/* Delivery details */}
              <div className="oc-card">
                <div className="oc-card-title">📍 Delivery Details</div>
                <div className="oc-del-grid">
                  <div className="oc-del-field"><label>Name</label><span>{order.customer_name || '—'}</span></div>
                  <div className="oc-del-field"><label>Phone</label><span>{order.customer_phone || '—'}</span></div>
                  <div className="oc-del-field" style={{gridColumn:'1/-1'}}><label>Address</label><span>{addr || '—'}</span></div>
                  <div className="oc-del-field"><label>Estimated Delivery</label><span>🗓 {estimate}</span></div>
                  <div className="oc-del-field"><label>Payment</label><span>{order.payment_method === 'razorpay_online' ? '💳 Online' : '📱 COD + WhatsApp'}</span></div>
                </div>
              </div>

              {/* Tracking */}
              <div className="oc-card">
                <div className="oc-card-title">🚚 Tracking</div>
                <div className="oc-track-box">
                  <span className="oc-track-icon">🚚</span>
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
                        <div style={{fontSize:13,color:'#666',fontWeight:500,marginTop:2}}>Tracking details will be shared on WhatsApp once your order ships.</div>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* Review */}
              <div className="oc-review">
                <div className="oc-review-title">How was your experience? 🌿</div>
                <div className="oc-review-sub">Rate your order — takes 2 seconds!</div>
                <div className="oc-review-stars">
                  {[1,2,3,4,5].map(n => (
                    <span key={n} className={`oc-review-star${rating >= n ? ' sel' : ''}`} onClick={() => rateOrder(n)}>⭐</span>
                  ))}
                </div>
                {rated && <div className="oc-review-thanks">🙏 Thanks for your feedback!</div>}
              </div>

              {/* Actions */}
              <div className="oc-actions">
                <Link href="/account" className="oc-btn-primary">📦 View All Orders</Link>
                <button onClick={() => window.print()} className="oc-btn-print">🧾 Print Invoice</button>
                <Link href="/" className="oc-btn-secondary">🌿 Continue Shopping</Link>
              </div>
            </>
          )
        })()}
      </main>

      {/* ── NEWSLETTER ── */}
      <section className="oc-newsletter">
        <div className="oc-nl-inner-wrap">
          <div className="oc-nl-inner">
            <div className="oc-nl-text">
              <h4>🌿 Join the Pahadi Family</h4>
              <p>Exclusive deals, new arrivals &amp; Himalayan stories — straight to your inbox</p>
            </div>
            <div className="oc-nl-form">
              <input type="email" className="oc-nl-inp" placeholder="Enter your email address" autoComplete="email" />
              <button className="oc-nl-btn">Subscribe</button>
            </div>
          </div>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer className="oc-footer">
        {/* Himachali Frieze */}
        <div className="oc-f-frieze">
          <svg width="100%" viewBox="0 0 1440 68" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">
            <rect width="1440" height="68" fill="#1a0d2e"/>
            <line x1="0" y1="2.5" x2="1440" y2="2.5" stroke="#c8920a" strokeWidth="0.6" opacity="0.45"/>
            <line x1="0" y1="65.5" x2="1440" y2="65.5" stroke="#c8920a" strokeWidth="0.6" opacity="0.45"/>
            <defs>
              <g id="fu1a">
                <g transform="translate(32,54)"><polygon points="0,0 -13,-7 -9,-18 0,-22 9,-18 13,-7" fill="#d4186c" opacity=".85"/><rect x="-3.5" y="-29" width="7" height="9" rx="2" fill="#1e6bb0"/><circle cx="0" cy="-34" r="3.5" fill="#d4956a"/><line x1="-3.5" y1="-27" x2="-10" y2="-21" stroke="#d4956a" strokeWidth="1.3"/><line x1="3.5" y1="-27" x2="10" y2="-21" stroke="#d4956a" strokeWidth="1.3"/></g>
                <g transform="translate(56,54)"><polygon points="0,0 -9,-5 -5,-16 0,-14 5,-16 9,-5" fill="#f0a020" opacity=".85"/><rect x="-3.5" y="-23" width="7" height="8" rx="2" fill="#c8340c"/><circle cx="0" cy="-28" r="3.2" fill="#c8905a"/><line x1="-3.5" y1="-21" x2="-10" y2="-15" stroke="#c8905a" strokeWidth="1.3"/><line x1="3.5" y1="-21" x2="10" y2="-15" stroke="#c8905a" strokeWidth="1.3"/></g>
                <g transform="translate(98,34)"><circle cx="0" cy="0" r="4" fill="#c8920a"/><circle cx="0" cy="-7" r="2.5" fill="#e8b050"/><circle cx="7" cy="0" r="2.5" fill="#e8b050"/><circle cx="0" cy="7" r="2.5" fill="#e8b050"/><circle cx="-7" cy="0" r="2.5" fill="#e8b050"/></g>
              </g>
              <g id="fu2a">
                <g transform="translate(32,54)"><polygon points="0,0 -13,-7 -9,-18 0,-22 9,-18 13,-7" fill="#1e6bb0" opacity=".85"/><rect x="-3.5" y="-29" width="7" height="9" rx="2" fill="#d4186c"/><circle cx="0" cy="-34" r="3.5" fill="#d4956a"/><line x1="-3.5" y1="-27" x2="-10" y2="-21" stroke="#d4956a" strokeWidth="1.3"/><line x1="3.5" y1="-27" x2="10" y2="-21" stroke="#d4956a" strokeWidth="1.3"/></g>
                <g transform="translate(56,54)"><polygon points="0,0 -9,-5 -5,-16 0,-14 5,-16 9,-5" fill="#56b848" opacity=".85"/><rect x="-3.5" y="-23" width="7" height="8" rx="2" fill="#6a3090"/><circle cx="0" cy="-28" r="3.2" fill="#c8905a"/><line x1="-3.5" y1="-21" x2="-10" y2="-15" stroke="#c8905a" strokeWidth="1.3"/><line x1="3.5" y1="-21" x2="10" y2="-15" stroke="#c8905a" strokeWidth="1.3"/></g>
                <g transform="translate(98,34)"><circle cx="0" cy="0" r="4" fill="#d4186c"/><circle cx="0" cy="-7" r="2.5" fill="#f050a0"/><circle cx="7" cy="0" r="2.5" fill="#f050a0"/><circle cx="0" cy="7" r="2.5" fill="#f050a0"/><circle cx="-7" cy="0" r="2.5" fill="#f050a0"/></g>
              </g>
            </defs>
            {[0,112,224,336,448,560,672,784,896,1008,1120,1232,1344].map((x,i) => (
              <use key={x} href={i%2===0 ? '#fu1a' : '#fu2a'} x={x}/>
            ))}
          </svg>
        </div>

        {/* Brand row */}
        <div className="oc-f-brand-row">
          <div className="oc-f-vine">
            <svg width="52" height="120" viewBox="0 0 52 120" xmlns="http://www.w3.org/2000/svg" style={{transform:'scaleX(-1)'}}>
              <line x1="26" y1="0" x2="26" y2="120" stroke="#c8920a" strokeWidth=".7" opacity=".25"/>
              <g transform="translate(26,14)"><circle cx="0" cy="0" r="5" fill="#d4186c" opacity=".8"/><circle cx="-8" cy="0" r="3" fill="#e87c3e" opacity=".65"/><circle cx="8" cy="0" r="3" fill="#e87c3e" opacity=".65"/></g>
              <g transform="translate(26,58)"><circle cx="0" cy="0" r="5" fill="#1e6bb0" opacity=".8"/><circle cx="-8" cy="0" r="3" fill="#c84090" opacity=".65"/><circle cx="8" cy="0" r="3" fill="#c84090" opacity=".65"/></g>
              <g transform="translate(26,102)"><circle cx="0" cy="0" r="4" fill="#c8920a" opacity=".65"/><circle cx="-6" cy="0" r="2" fill="#e8b050" opacity=".5"/><circle cx="6" cy="0" r="2" fill="#e8b050" opacity=".5"/></g>
            </svg>
          </div>
          <div style={{flexShrink:0,marginLeft:20}}>
            <svg width="104" height="104" viewBox="0 0 110 110" xmlns="http://www.w3.org/2000/svg">
              <circle cx="55" cy="55" r="52" fill="none" stroke="#c8920a" strokeWidth="1.5" opacity=".6"/>
              <circle cx="55" cy="55" r="48" fill="#1a0400" opacity=".95"/>
              <g opacity=".7">
                {[0,45,90,135,180,225,270,315].map((r,i) => (
                  <ellipse key={i} cx="55" cy="13" rx="5" ry="9" fill={['#d4186c','#e87c3e','#1e6bb0','#56b848','#d4186c','#e87c3e','#1e6bb0','#56b848'][i]} transform={`rotate(${r} 55 55)`}/>
                ))}
              </g>
              <circle cx="55" cy="55" r="12" fill="#0b160d"/>
              <circle cx="55" cy="55" r="9" fill="none" stroke="#c8920a" strokeWidth="1.5"/>
              <line x1="55" y1="47" x2="55" y2="63" stroke="#c8920a" strokeWidth="1.5"/>
              <line x1="47" y1="55" x2="63" y2="55" stroke="#c8920a" strokeWidth="1.5"/>
              <circle cx="55" cy="55" r="3" fill="#c8920a"/>
            </svg>
          </div>
          <div className="oc-f-brand-col">
            <div className="oc-f-brand-name">5 Pahadi Roots</div>
            <div className="oc-f-brand-sub">Himalayan Natural Store</div>
            <p className="oc-f-brand-desc">Born in the mountains, delivered to your doorstep. Pure Himalayan natural products, sourced with love from farming communities across 10 Himalayan states.</p>
          </div>
          <div className="oc-f-vine">
            <svg width="52" height="120" viewBox="0 0 52 120" xmlns="http://www.w3.org/2000/svg">
              <line x1="26" y1="0" x2="26" y2="120" stroke="#c8920a" strokeWidth=".7" opacity=".25"/>
              <g transform="translate(26,14)"><circle cx="0" cy="0" r="5" fill="#d4186c" opacity=".8"/><circle cx="-8" cy="0" r="3" fill="#e87c3e" opacity=".65"/><circle cx="8" cy="0" r="3" fill="#e87c3e" opacity=".65"/></g>
              <g transform="translate(26,58)"><circle cx="0" cy="0" r="5" fill="#1e6bb0" opacity=".8"/><circle cx="-8" cy="0" r="3" fill="#c84090" opacity=".65"/><circle cx="8" cy="0" r="3" fill="#c84090" opacity=".65"/></g>
              <g transform="translate(26,102)"><circle cx="0" cy="0" r="4" fill="#c8920a" opacity=".65"/><circle cx="-6" cy="0" r="2" fill="#e8b050" opacity=".5"/><circle cx="6" cy="0" r="2" fill="#e8b050" opacity=".5"/></g>
            </svg>
          </div>
        </div>

        {/* Links grid */}
        <div className="oc-f-main">
          <div>
            <div className="oc-fh">Quick Selects</div>
            <ul className="oc-ful">
              {['🍯 Wild Honey','🧈 A2 Bilona Ghee','🌸 Kashmiri Saffron','🪨 Ladakhi Shilajit','🍃 Himalayan Teas','🌾 Ancient Grains'].map(t => (
                <li key={t}><Link href="/#products">{t}</Link></li>
              ))}
            </ul>
          </div>
          <div>
            <div className="oc-fh">Company</div>
            <ul className="oc-ful">
              <li><Link href="/our-story">Our Story</Link></li>
              <li><Link href="/#states">By Region</Link></li>
              <li><Link href="/terms#returns">Returns &amp; Refunds</Link></li>
              <li><Link href="/terms#shipping">Shipping Policy</Link></li>
              <li><Link href="/terms#privacy">Privacy Policy</Link></li>
              <li><Link href="/terms">Terms &amp; Conditions</Link></li>
            </ul>
          </div>
          <div>
            <div className="oc-fh">Connect With Us</div>
            {[
              {icon:'🌐', text:'pahadiroots.com', href:'https://pahadiroots.com'},
              {icon:'📧', text:'hello@pahadiroots.com', href:'mailto:hello@pahadiroots.com'},
              {icon:'📞', text:'+91 98999 84895', href:'tel:+919899984895'},
              {icon:'📍', text:'Village Sakoh, PO Sakoh, Distt Kangra, Himachal Pradesh 176082', href:null},
            ].map(c => (
              <div key={c.icon} className="oc-f-contact-item">
                <span className="oc-f-contact-icon">{c.icon}</span>
                <div className="oc-f-contact-text">
                  {c.href ? <a href={c.href}>{c.text}</a> : c.text}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Social bar */}
        <div className="oc-f-social-bar">
          <div className="oc-f-social-inner">
            <div className="oc-f-soc-row">
              {[
                {href:'https://www.instagram.com/pahadiroots',label:'Instagram', svg:<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/></svg>},
                {href:'https://www.facebook.com/pahadiroots',label:'Facebook', svg:<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>},
                {href:'https://twitter.com/pahadiroots',label:'X', svg:<svg width="19" height="19" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.748l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>},
                {href:'https://www.youtube.com/@pahadiroots',label:'YouTube', svg:<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M23.495 6.205a3.007 3.007 0 0 0-2.088-2.088c-1.87-.501-9.396-.501-9.396-.501s-7.507-.01-9.396.501A3.007 3.007 0 0 0 .527 6.205a31.247 31.247 0 0 0-.522 5.805 31.247 31.247 0 0 0 .522 5.783 3.007 3.007 0 0 0 2.088 2.088c1.868.502 9.396.502 9.396.502s7.506 0 9.396-.502a3.007 3.007 0 0 0 2.088-2.088 31.247 31.247 0 0 0 .5-5.783 31.247 31.247 0 0 0-.5-5.805zM9.609 15.601V8.408l6.264 3.602z"/></svg>},
              ].map(s => (
                <a key={s.label} href={s.href} target="_blank" rel="noopener noreferrer" className="oc-f-soc" title={s.label}>{s.svg}</a>
              ))}
            </div>
            <div className="oc-f-fssai">
              <div className="oc-f-fssai-badge">FSSAI</div>
              <div>
                <div style={{fontSize:11,color:'rgba(255,255,255,.6)',fontWeight:700}}>Licensed</div>
                <div className="oc-f-fssai-num">Lic. No. — update karein</div>
              </div>
            </div>
          </div>
        </div>

        {/* Diamond divider */}
        <svg viewBox="0 0 1440 22" preserveAspectRatio="xMidYMid slice" style={{display:'block',width:'100%'}} xmlns="http://www.w3.org/2000/svg">
          <line x1="0" y1="11" x2="1440" y2="11" stroke="#c8920a" strokeWidth=".5" opacity=".18"/>
          <g opacity=".45">
            {Array.from({length:38},(_,i) => {
              const cx = 18 + i*38
              return <polygon key={i} points={`${cx},11 ${cx+6},5 ${cx+12},11 ${cx+6},17`} fill="none" stroke="#c8920a" strokeWidth=".8"/>
            })}
          </g>
        </svg>

        {/* Copyright */}
        <div className="oc-f-bot">
          <div className="oc-f-bot-left">© 2026 <strong>5 Pahadi Roots</strong> · Founded by Sudhir Chambail · New Delhi, India</div>
          <div className="oc-f-bot-tag">Making India eat clean</div>
        </div>
      </footer>
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
