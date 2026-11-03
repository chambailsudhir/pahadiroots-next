// ─────────────────────────────────────────────────────────────────────────────
// lib/server/orderEmail.ts — the ONE order-confirmation e-mail, for Cash on Delivery and online-paid orders.
//
// Modelled on what the big marketplaces (Amazon, Myntra, BigBasket) send: a clear status headline with the order number and total,
// a 4-step progress strip, a single primary "Track your order" button, itemised lines with photos, a full price breakdown that adds up
// to the total (incl. the GST that is already in the prices), the delivery address, the payment method, the delivery estimate, what
// happens next, and a help block. Before this, online-paid customers only got a 5-line "Payment Confirmed" note with no items.
//
// Pure (string in → string out), table-based with inline styles (Outlook/Gmail/Apple Mail safe), one small <style> block only for the
// mobile stack. Every dynamic value is HTML-escaped here — callers pass raw values.
// ─────────────────────────────────────────────────────────────────────────────
import { esc } from '@/lib/server/htmlEscape'
import { brandHeaderRow } from '@/lib/server/emailShell'

const SITE = 'https://www.pahadiroots.com'
const WHATSAPP = 'https://wa.me/919899984895'

export interface OrderEmailLine {
  name:     string
  variant?: string | null
  qty:      number
  /** Unit price, GST-inclusive, rupees. */
  price:    number
  image?:   string | null
  emoji?:   string | null
}

export interface OrderEmailInput {
  /** 'cod' = pay on delivery; 'paid' = payment already received online. */
  kind:           'cod' | 'paid'
  orderNumber:    string
  customerName:   string
  placedAt?:      Date | string | null
  items:          OrderEmailLine[]
  subtotal:       number
  couponDiscount?: number
  /** Prepaid % discount and/or coin redemption, shown as one "savings" line each when > 0. */
  prepaidDiscount?: number
  loyaltyDiscount?: number
  shipping:       number
  codSurcharge?:  number
  /** GST already included in the prices (informational). */
  gstIncluded?:   number
  total:          number
  address: { name?: string | null; line1?: string | null; line2?: string | null; city?: string | null; state?: string | null; pincode?: string | null; phone?: string | null }
  /** Razorpay payment id (paid orders). */
  paymentId?:     string | null
  deliveryText:   string
  trackingText:   string
  /** Pahadi Coins the customer WILL earn on delivery — pass ONLY for a signed-in customer (guests cannot use coins). */
  coinsEarned?:   number
  /** True when the customer has an account (invoice is available under My Orders). */
  signedIn?:      boolean
}

/** Whole rupees without decimals; any fraction with exactly two (₹266.67, never ₹266.5). */
const inr = (n: number | null | undefined): string => {
  const v = Math.round((Number(n) || 0) * 100) / 100
  return '₹' + v.toLocaleString('en-IN', Number.isInteger(v) ? { maximumFractionDigits: 0 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function absUrl(u: string | null | undefined): string | null {
  if (!u) return null
  if (/^https:\/\//i.test(u)) return u
  if (u.startsWith('/')) return SITE + u
  return null   // http:, data: and anything odd is not embedded
}

function fmtDate(d: Date | string | null | undefined): string {
  const dt = d ? new Date(d) : new Date()
  if (Number.isNaN(dt.getTime())) return ''
  return dt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })
}

export function orderEmailSubject(kind: 'cod' | 'paid', orderNumber: string): string {
  return kind === 'paid'
    ? `Payment received — order ${orderNumber} confirmed | HimVeda by Pahadi Roots`
    : `Order confirmed — ${orderNumber} | HimVeda by Pahadi Roots`
}

export function buildOrderEmail(o: OrderEmailInput): string {
  const paid = o.kind === 'paid'
  const trackUrl = `${SITE}/track?order=${encodeURIComponent(o.orderNumber)}`
  const firstName = (o.customerName || '').trim().split(/\s+/)[0] || 'there'

  const headline = paid ? 'Payment received. Your order is confirmed.' : 'Your order is confirmed.'
  const preheader = paid
    ? `We've received ${inr(o.total)} for order ${o.orderNumber}. Here is everything about your order.`
    : `Order ${o.orderNumber} is confirmed — pay ${inr(o.total)} on delivery. Here is everything about your order.`

  // ── items ──
  const itemRows = o.items.map(i => {
    const img = absUrl(i.image)
    const thumb = img
      ? `<img src="${esc(img)}" width="64" height="64" alt="" style="display:block;width:64px;height:64px;border-radius:10px;object-fit:cover;border:1px solid #ece5d8" />`
      : `<div style="width:64px;height:64px;border-radius:10px;background:#f0f4ee;text-align:center;line-height:64px;font-size:26px">${esc(i.emoji || '🌿')}</div>`
    const line = (Number(i.price) || 0) * (Number(i.qty) || 0)
    return `<tr>
      <td width="76" valign="top" style="padding:14px 0;border-bottom:1px solid #f0ebe1">${thumb}</td>
      <td valign="top" style="padding:14px 0;border-bottom:1px solid #f0ebe1">
        <div style="font-size:15px;font-weight:700;color:#1a1611;line-height:1.35">${esc(i.name)}</div>
        ${i.variant ? `<div style="font-size:12px;color:#6b6256;margin-top:2px">${esc(i.variant)}</div>` : ''}
        <div style="font-size:13px;color:#6b6256;margin-top:4px">Qty ${esc(i.qty)} × ${inr(i.price)}</div>
      </td>
      <td valign="top" align="right" style="padding:14px 0;border-bottom:1px solid #f0ebe1;font-size:15px;font-weight:700;color:#1a3a1e;white-space:nowrap">${inr(line)}</td>
    </tr>`
  }).join('')

  // ── price breakdown (every row shown adds up to the total) ──
  const row = (label: string, value: string, opts: { color?: string; bold?: boolean } = {}) =>
    `<tr><td style="padding:5px 0;font-size:14px;color:${opts.color || '#4a4338'};${opts.bold ? 'font-weight:700;' : ''}">${label}</td>` +
    `<td align="right" style="padding:5px 0;font-size:14px;color:${opts.color || '#4a4338'};${opts.bold ? 'font-weight:700;' : ''}">${value}</td></tr>`
  // Subtotal is the SUM OF THE LINES above, so the page adds up. Prices carry paise and the payable total is rounded to a whole rupee:
  // the stored subtotal is the rounded figure, so a sub-₹1 gap is shown as an explicit "Round off" row (a gap of ₹1 or more is not dressed
  // up as rounding — the stored subtotal is used as-is).
  const itemsSum = Math.round(o.items.reduce((s, i) => s + (Number(i.price) || 0) * (Number(i.qty) || 0), 0) * 100) / 100
  const gap = Math.round(((Number(o.subtotal) || 0) - itemsSum) * 100) / 100
  const showRound = Math.abs(gap) > 0 && Math.abs(gap) < 1
  const subtotalShown = showRound ? itemsSum : (Number(o.subtotal) || itemsSum)
  const rows = [
    row('Subtotal', inr(subtotalShown)),
    showRound ? row('Round off', (gap > 0 ? '+' : '−') + inr(Math.abs(gap))) : '',
    (o.couponDiscount ?? 0) > 0 ? row('Coupon discount', '−' + inr(o.couponDiscount), { color: '#2d6a4f' }) : '',
    (o.prepaidDiscount ?? 0) > 0 ? row('Prepaid discount', '−' + inr(o.prepaidDiscount), { color: '#2d6a4f' }) : '',
    (o.loyaltyDiscount ?? 0) > 0 ? row('Pahadi Coins redeemed', '−' + inr(o.loyaltyDiscount), { color: '#2d6a4f' }) : '',
    row('Shipping', (o.shipping ?? 0) > 0 ? inr(o.shipping) : '<span style="color:#2d6a4f;font-weight:700">FREE</span>'),
    (o.codSurcharge ?? 0) > 0 ? row('COD Charges', inr(o.codSurcharge)) : '',
  ].join('')
  const gstNote = (o.gstIncluded ?? 0) > 0
    ? `<tr><td colspan="2" style="padding:2px 0 0;font-size:12px;color:#6b6256">Total includes GST of ${inr(o.gstIncluded)}</td></tr>` : ''

  // ── progress strip ──
  const steps = ['Confirmed', 'Packed', 'Shipped', 'Delivered']
  const stepCells = steps.map((s, idx) => {
    const on = idx === 0
    return `<td align="center" width="25%" style="padding:0 2px">
      <div style="width:26px;height:26px;line-height:26px;border-radius:50%;margin:0 auto;font-size:13px;font-weight:700;${on ? 'background:#1a3a1e;color:#ffffff' : 'background:#ece5d8;color:#6b6256'}">${on ? '✓' : idx + 1}</div>
      <div style="font-size:11px;margin-top:6px;color:${on ? '#1a3a1e' : '#6b6256'};font-weight:${on ? '700' : '500'}">${s}</div>
    </td>`
  }).join('')

  // ── address / payment ──
  const a = o.address
  const addrLines = [a.name, a.line1, a.line2, [a.city, a.state].filter(Boolean).join(', ') + (a.pincode ? ' - ' + a.pincode : ''), a.phone ? 'Phone: ' + a.phone : '']
    .filter(x => x && String(x).trim() && String(x).trim() !== '-')
    .map(x => esc(x)).join('<br>')
  const payBlock = paid
    ? `<strong style="color:#1a1611">Paid online</strong><br>${inr(o.total)} received${o.paymentId ? `<br><span style="color:#6b6256;font-size:12px">Payment ID ${esc(o.paymentId)}</span>` : ''}`
    : `<strong style="color:#1a1611">Cash on delivery</strong><br>Please keep <strong>${inr(o.total)}</strong> ready when your parcel arrives`

  const coins = (o.coinsEarned ?? 0) > 0
    ? `<tr><td style="padding:0 28px 20px">
        <div style="background:#fbf6e6;border:1px solid #ecd98a;border-radius:12px;padding:14px 18px;text-align:center">
          <div style="font-size:15px;font-weight:700;color:#6b4a00">🪙 You will earn ${esc(o.coinsEarned)} Pahadi Coins when this order is delivered</div>
          <div style="font-size:12px;color:#7a6320;margin-top:3px">Use them for a discount on your next order. (Coins are taken back if the order is returned.)</div>
        </div></td></tr>` : ''

  const invoiceNote = o.signedIn
    ? `<li style="margin-bottom:6px">Your GST tax invoice is available any time under <a href="${SITE}/account?tab=orders" style="color:#1a3a1e">My Orders</a>.</li>`
    : `<li style="margin-bottom:6px">Need a GST invoice? Open your order on the <a href="${trackUrl}" style="color:#1a3a1e">tracking page</a> or message us on WhatsApp.</li>`

  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light">
<title>${esc(orderEmailSubject(o.kind, o.orderNumber))}</title>
<style>
  @media only screen and (max-width:520px){
    .wrap{width:100%!important}
    .col{display:block!important;width:100%!important;padding:0 0 16px 0!important}
    .px{padding-left:18px!important;padding-right:18px!important}
  }
  a{color:#1a3a1e}
</style></head>
<body style="margin:0;padding:0;background:#f4efe6;-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#f4efe6">${esc(preheader)}&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4efe6"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" class="wrap" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;color:#1a1611">

  ${brandHeaderRow()}

  <tr><td class="px" align="center" style="background:#ffffff;padding:32px 28px 8px">
    <div style="width:56px;height:56px;line-height:56px;border-radius:50%;background:#e6f2e8;color:#1a3a1e;font-size:28px;margin:0 auto 14px">✓</div>
    <h1 style="margin:0 0 8px;font-family:Georgia,'Times New Roman',serif;font-size:26px;line-height:1.25;color:#1a3a1e;font-weight:700">${esc(headline)}</h1>
    <p style="margin:0 0 18px;font-size:15px;line-height:1.55;color:#4a4338">Hi ${esc(firstName)}, thank you for choosing the mountains. We are getting your order ready.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 6px"><tr>
      <td style="padding:10px 18px;background:#f4efe6;border-radius:10px;font-size:13px;color:#4a4338;text-align:center">
        Order <strong style="color:#1a1611">${esc(o.orderNumber)}</strong> &nbsp;·&nbsp; ${esc(fmtDate(o.placedAt))} &nbsp;·&nbsp; <strong style="color:#1a1611">${inr(o.total)}</strong>
      </td></tr></table>
  </td></tr>

  <tr><td class="px" align="center" style="background:#ffffff;padding:18px 28px 26px">
    <a href="${trackUrl}" style="display:inline-block;background:#1a3a1e;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:14px 34px;border-radius:10px">Track your order</a>
  </td></tr>

  <tr><td class="px" style="background:#ffffff;padding:0 28px 22px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #f0ebe1;border-bottom:1px solid #f0ebe1"><tr><td style="padding:18px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${stepCells}</tr></table></td></tr></table>
    <p style="margin:14px 0 0;font-size:13px;line-height:1.55;color:#4a4338"><strong style="color:#1a1611">Estimated delivery:</strong> ${esc(o.deliveryText)}</p>
    <p style="margin:4px 0 0;font-size:12px;line-height:1.5;color:#6b6256">${esc(o.trackingText)}</p>
  </td></tr>

  <tr><td class="px" style="background:#ffffff;padding:4px 28px 8px">
    <div style="font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#6b6256;padding-bottom:4px">Order summary</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${itemRows}</table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px">${rows}
      <tr><td style="padding:12px 0 2px;border-top:2px solid #1a3a1e;font-size:17px;font-weight:800;color:#1a3a1e">${paid ? 'Total paid' : 'Total to pay on delivery'}</td>
          <td align="right" style="padding:12px 0 2px;border-top:2px solid #1a3a1e;font-size:17px;font-weight:800;color:#1a3a1e">${inr(o.total)}</td></tr>
      ${gstNote}
    </table>
  </td></tr>

  <tr><td class="px" style="background:#ffffff;padding:22px 28px 22px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      <td class="col" width="50%" valign="top" style="padding-right:12px">
        <div style="font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#6b6256;margin-bottom:6px">Delivering to</div>
        <div style="font-size:14px;line-height:1.6;color:#4a4338">${addrLines}</div>
      </td>
      <td class="col" width="50%" valign="top" style="padding-left:12px">
        <div style="font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#6b6256;margin-bottom:6px">Payment</div>
        <div style="font-size:14px;line-height:1.6;color:#4a4338">${payBlock}</div>
      </td>
    </tr></table>
  </td></tr>

  ${coins ? coins.replace('<tr><td style="padding:0 28px 20px">', '<tr><td class="px" style="background:#ffffff;padding:0 28px 20px">') : ''}

  <tr><td class="px" style="background:#fbf8f2;padding:22px 28px">
    <div style="font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#6b6256;margin-bottom:8px">What happens next</div>
    <ul style="margin:0;padding-left:18px;font-size:13px;line-height:1.6;color:#4a4338">
      <li style="margin-bottom:6px">We pack your order with care and hand it to our courier partner.</li>
      <li style="margin-bottom:6px">You will get the tracking details as soon as it ships.</li>
      ${invoiceNote}
    </ul>
  </td></tr>

  <tr><td class="px" align="center" style="background:#ffffff;padding:24px 28px">
    <div style="font-size:15px;font-weight:700;color:#1a1611;margin-bottom:4px">Need help with this order?</div>
    <div style="font-size:13px;color:#4a4338;margin-bottom:12px">Message us on WhatsApp with order number ${esc(o.orderNumber)} — we usually reply the same day.</div>
    <a href="${WHATSAPP}?text=${encodeURIComponent('Hi, I need help with order ' + o.orderNumber)}" style="display:inline-block;border:1.5px solid #1a3a1e;color:#1a3a1e;text-decoration:none;font-weight:700;font-size:14px;padding:10px 24px;border-radius:10px">Chat on WhatsApp</a>
  </td></tr>

  <tr><td align="center" style="background:#1a3a1e;border-radius:0 0 18px 18px;padding:22px 28px">
    <div style="font-family:Georgia,serif;font-size:15px;color:#ffffff;margin-bottom:6px">Pure Himalayan goodness, from our farms to your door.</div>
    <div style="font-size:12px;line-height:1.8;color:#a9c3ad">
      <a href="${SITE}" style="color:#e8c46a;text-decoration:none">pahadiroots.com</a> &nbsp;·&nbsp;
      <a href="${SITE}/policies/shipping" style="color:#e8c46a;text-decoration:none">Shipping</a> &nbsp;·&nbsp;
      <a href="${SITE}/policies/returns" style="color:#e8c46a;text-decoration:none">Returns</a> &nbsp;·&nbsp;
      <a href="${SITE}/policies/privacy" style="color:#e8c46a;text-decoration:none">Privacy</a>
    </div>
    <div style="font-size:11px;color:#7f9c85;margin-top:8px">Chambail International (HimVeda by Pahadi Roots) · Village Sakoh, PO Sakoh, Distt Kangra, Himachal Pradesh 176082 · GSTIN 02AAWFC5939L1ZV</div>
  </td></tr>

</table>
<div style="font-size:11px;color:#8a8070;margin-top:14px;font-family:Arial,sans-serif">You are receiving this because you placed an order on pahadiroots.com.</div>
</td></tr></table>
</body></html>`
}
