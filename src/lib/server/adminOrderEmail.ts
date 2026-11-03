// ─────────────────────────────────────────────────────────────────────────────
// lib/server/adminOrderEmail.ts — the e-mail the SHOP OWNER gets for a new COD order, a new online-paid order and a cancellation.
//
// Before (Nov 2026): a 5-line plain note — order number, name, city, total, "Payment: cod". No items, no address, no phone link,
// no idea whether the buyer was new, and no hint of what to DO. The owner has to open the admin for every order just to pack it.
//
// Now one scannable mail: what to do next, who the customer is (phone / WhatsApp / e-mail / account or guest / first order or Nth),
// where it ships, every line item with SKU and quantity, a price breakdown that adds up (coupon, coins, shipping, COD fee, GST),
// the payment, and where the order was placed from (city + device, recorded at order time). Built from the stored order so the COD,
// online-paid and cancelled mails always agree with the database.
//
// Pure HTML builder + one loader that reads the order. Every dynamic value is escaped here.
// ─────────────────────────────────────────────────────────────────────────────
import { esc } from '@/lib/server/htmlEscape'
import { brandHeaderRow } from '@/lib/server/emailShell'
import type { SupabaseClient } from '@supabase/supabase-js'

const ADMIN_URL = 'https://pahadi-admin.vercel.app'

export type AdminOrderEmailKind = 'cod' | 'paid' | 'cancelled'

export interface AdminOrderLine { name: string; variant?: string | null; sku?: string | null; qty: number; price: number }

export interface AdminOrderEmailInput {
  kind:          AdminOrderEmailKind
  orderNumber:   string
  placedAt?:     Date | string | null
  status?:       string | null
  paymentMethod: string
  paymentStatus?: string | null
  paymentId?:    string | null
  customer:      { name: string; phone?: string | null; email?: string | null; hasAccount: boolean; ordersCount?: number | null; lifetimeSpent?: number | null }
  address:       { line1?: string | null; line2?: string | null; city?: string | null; state?: string | null; pincode?: string | null }
  items:         AdminOrderLine[]
  subtotal:      number
  couponCode?:   string | null
  couponDiscount?: number
  coinsRedeemed?: number
  shipping:      number
  codSurcharge?: number
  gstIncluded?:  number
  roundOff?:     number
  total:         number
  /** Where the order was placed from (recorded at order time): e.g. "Delhi, Delhi, IN · Mobile (Chrome on Android)". */
  origin?:       string | null
  source?:       string | null
  /** Cancellation only. */
  cancelReason?: string | null
  cancelNote?:   string | null
}

const inr = (n: number | null | undefined): string => {
  const v = Math.round((Number(n) || 0) * 100) / 100
  return '₹' + v.toLocaleString('en-IN', Number.isInteger(v) ? { maximumFractionDigits: 0 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function when(d: Date | string | null | undefined): string {
  const dt = d ? new Date(d) : new Date()
  if (Number.isNaN(dt.getTime())) return ''
  return dt.toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' }) + ' IST'
}

const digits = (p: string | null | undefined) => String(p ?? '').replace(/\D/g, '').replace(/^91(?=\d{10}$)/, '')

export function adminOrderEmailSubject(o: { kind: AdminOrderEmailKind; orderNumber: string; total: number; customerName?: string | null; city?: string | null; itemCount?: number }): string {
  const lead = o.kind === 'cancelled' ? 'Order cancelled' : o.kind === 'paid' ? 'New PAID order' : 'New COD order'
  const who = [o.customerName, o.city].filter(Boolean).join(', ')
  return `${lead} #${o.orderNumber} · ${inr(o.total)}${who ? ` · ${who}` : ''}`
}

const row = (label: string, value: string, strong = false) =>
  `<tr><td style="padding:5px 0;color:#6b6b6b;font-size:13px;width:38%;vertical-align:top">${label}</td><td style="padding:5px 0;color:#1f1f1f;font-size:14px;${strong ? 'font-weight:700;' : ''}vertical-align:top">${value}</td></tr>`

const section = (title: string, inner: string) =>
  `<tr><td bgcolor="#ffffff" style="background-color:#ffffff;padding:18px 28px 4px;border-left:1px solid #eeeeee;border-right:1px solid #eeeeee">
    <div style="font-family:Arial,sans-serif;font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:#8a6d1f;font-weight:700;padding-bottom:6px;border-bottom:1px solid #eee7d6">${title}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:6px">${inner}</table>
  </td></tr>`

export function buildAdminOrderEmail(o: AdminOrderEmailInput): string {
  const cancelled = o.kind === 'cancelled'
  const isCod = o.paymentMethod.toLowerCase() === 'cod'
  const accent = cancelled ? '#b3261e' : o.kind === 'paid' ? '#2d6a4f' : '#c8962a'
  const badge = cancelled ? 'ORDER CANCELLED' : o.kind === 'paid' ? 'NEW ORDER · PAID ONLINE' : 'NEW ORDER · CASH ON DELIVERY'

  const todo = cancelled
    ? 'Nothing to pack. Stock has been put back, and any coupon or Pahadi Coins on this order were reversed automatically.'
    : o.kind === 'paid'
      ? 'Payment is already received. Pack it and hand it to the courier.'
      : `Cash on delivery: the courier collects <b>${inr(o.total)}</b> from the customer. Confirm the address on a call or WhatsApp if the order looks unusual, then pack it.`

  const phone = digits(o.customer.phone)
  const phoneHtml = phone
    ? `<a href="tel:+91${esc(phone)}" style="color:#2d6a4f;text-decoration:none">+91 ${esc(phone)}</a> &nbsp;·&nbsp; <a href="https://wa.me/91${esc(phone)}" style="color:#2d6a4f;text-decoration:none">WhatsApp</a>`
    : '—'
  const count = Number(o.customer.ordersCount ?? 0)
  const buyer = count <= 1 ? 'First order' : `${count} orders so far${o.customer.lifetimeSpent ? ` · ${inr(o.customer.lifetimeSpent)} spent` : ''}`

  const addr = [o.address.line1, o.address.line2].filter(Boolean).map(s => esc(s)).join(', ')
  const addr2 = [o.address.city, o.address.state].filter(Boolean).map(s => esc(s)).join(', ') + (o.address.pincode ? ` &ndash; ${esc(o.address.pincode)}` : '')

  const lines = o.items.map(i => `<tr>
      <td style="padding:8px 0;border-bottom:1px solid #f1ece2;font-size:14px;color:#1f1f1f;vertical-align:top"><b>${esc(i.name)}</b>${i.variant ? `<br><span style="color:#6b6b6b;font-size:12px">${esc(i.variant)}</span>` : ''}${i.sku ? `<br><span style="color:#9a9a9a;font-size:11px;font-family:Consolas,monospace">SKU ${esc(i.sku)}</span>` : ''}</td>
      <td align="center" style="padding:8px 6px;border-bottom:1px solid #f1ece2;font-size:14px;color:#1f1f1f;vertical-align:top;white-space:nowrap">× ${esc(i.qty)}</td>
      <td align="right" style="padding:8px 0;border-bottom:1px solid #f1ece2;font-size:14px;color:#1f1f1f;vertical-align:top;white-space:nowrap">${inr(i.price * i.qty)}<br><span style="color:#9a9a9a;font-size:11px">${inr(i.price)} each</span></td>
    </tr>`).join('')

  const money = (label: string, v: string, bold = false) =>
    `<tr><td style="padding:4px 0;font-size:${bold ? 15 : 13}px;color:${bold ? '#1f1f1f' : '#6b6b6b'};${bold ? 'font-weight:700;' : ''}">${label}</td><td align="right" style="padding:4px 0;font-size:${bold ? 15 : 13}px;color:#1f1f1f;${bold ? 'font-weight:700;' : ''}">${v}</td></tr>`
  const breakdown = [
    money('Items subtotal', inr(o.subtotal)),
    (o.couponDiscount ?? 0) > 0 ? money(`Coupon${o.couponCode ? ` (${esc(o.couponCode)})` : ''}`, '− ' + inr(o.couponDiscount)) : '',
    (o.coinsRedeemed ?? 0) > 0 ? money('Pahadi Coins redeemed', `${esc(o.coinsRedeemed)} coins`) : '',
    money('Shipping', o.shipping > 0 ? inr(o.shipping) : 'FREE'),
    (o.codSurcharge ?? 0) > 0 ? money('COD fee', inr(o.codSurcharge)) : '',
    Math.abs(o.roundOff ?? 0) >= 0.005 ? money('Round off', inr(o.roundOff)) : '',
    money(isCod && !cancelled ? 'Collect on delivery' : 'Order total', inr(o.total), true),
    (o.gstIncluded ?? 0) > 0 ? money('GST included in total', inr(o.gstIncluded)) : '',
  ].join('')

  const payLabel = isCod ? 'Cash on delivery' : 'Online (Razorpay)'
  const payState = cancelled ? 'Cancelled' : o.paymentStatus === 'paid' ? 'Paid' : isCod ? 'To collect' : (o.paymentStatus ?? '')
  const pay = [
    row('Method', esc(payLabel)),
    row('Status', esc(payState), true),
    o.paymentId ? row('Payment ID', `<span style="font-family:Consolas,monospace;font-size:12px">${esc(o.paymentId)}</span>`) : '',
  ].join('')

  const meta = [
    row('Placed', esc(when(o.placedAt))),
    o.status ? row('Order status', esc(String(o.status))) : '',
    o.origin ? row('Placed from', esc(o.origin)) : '',
    o.source ? row('Channel', esc(o.source)) : '',
  ].join('')

  const cancelBlock = cancelled
    ? section('Cancellation', row('Reason', esc(o.cancelReason || '—'), true) + (o.cancelNote ? row('Customer note', esc(o.cancelNote)) : ''))
    : ''

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background-color:#f7f3ee;font-family:'Helvetica Neue',Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f7f3ee" style="background-color:#f7f3ee"><tr><td align="center" style="padding:20px 12px">
<table role="presentation" width="620" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:620px">
  ${brandHeaderRow()}
  <tr><td bgcolor="${accent}" style="background-color:${accent};padding:14px 28px;color:#ffffff;font-family:Arial,sans-serif">
    <div style="font-size:11px;letter-spacing:2px;font-weight:700">${badge}</div>
    <div style="font-size:22px;font-weight:700;margin-top:4px">#${esc(o.orderNumber)} &nbsp;·&nbsp; ${inr(o.total)}</div>
  </td></tr>
  <tr><td bgcolor="#fbf6e9" style="background-color:#fbf6e9;padding:14px 28px;border-left:1px solid #eeeeee;border-right:1px solid #eeeeee;font-size:14px;line-height:1.5;color:#3d3d3d"><b>What to do:</b> ${todo}</td></tr>
  ${cancelBlock}
  ${section('Customer', row('Name', esc(o.customer.name), true) + row('Phone', phoneHtml) + row('E-mail', o.customer.email ? `<a href="mailto:${esc(o.customer.email)}" style="color:#2d6a4f;text-decoration:none">${esc(o.customer.email)}</a>` : '—') + row('Account', o.customer.hasAccount ? 'Signed-in customer' : 'Guest checkout') + row('History', esc(buyer)))}
  ${section('Ship to', row('Address', addr || '—') + row('City / PIN', addr2 || '—'))}
  <tr><td bgcolor="#ffffff" style="background-color:#ffffff;padding:18px 28px 4px;border-left:1px solid #eeeeee;border-right:1px solid #eeeeee">
    <div style="font-family:Arial,sans-serif;font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:#8a6d1f;font-weight:700;padding-bottom:6px;border-bottom:1px solid #eee7d6">Items (${o.items.reduce((s, i) => s + i.qty, 0)})</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${lines}</table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:8px">${breakdown}</table>
  </td></tr>
  ${section('Payment', pay)}
  ${section('Order details', meta)}
  <tr><td align="center" bgcolor="#ffffff" style="background-color:#ffffff;padding:20px 28px 26px;border-left:1px solid #eeeeee;border-right:1px solid #eeeeee">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
      <td align="center" bgcolor="#2d6a4f" style="background-color:#2d6a4f;border-radius:24px"><a href="${ADMIN_URL}/admin/orders?q=${encodeURIComponent(o.orderNumber)}&amp;days=365" target="_blank" style="display:inline-block;color:#ffffff;text-decoration:none;font-family:Arial,sans-serif;font-weight:700;font-size:14px;padding:12px 26px;border-radius:24px;border:1px solid #2d6a4f">Open order in admin</a></td>
      ${phone ? `<td width="10"></td><td align="center" bgcolor="#ffffff" style="background-color:#ffffff;border-radius:24px;border:1px solid #2d6a4f"><a href="https://wa.me/91${esc(phone)}" target="_blank" style="display:inline-block;color:#2d6a4f;text-decoration:none;font-family:Arial,sans-serif;font-weight:700;font-size:14px;padding:11px 24px">WhatsApp customer</a></td>` : ''}
    </tr></table>
  </td></tr>
  <tr><td align="center" bgcolor="#1a3a1e" style="background-color:#1a3a1e;border-radius:0 0 16px 16px;padding:14px 28px;color:#b9c7bb;font-size:12px">Shop-owner notification &middot; HimVeda by Pahadi Roots</td></tr>
</table>
</td></tr></table></body></html>`
}

/** "Delhi, Delhi, IN · Mobile (Chrome, Android)" from the request headers Vercel adds. Nothing identifying (no IP) is kept. */
export function describeOrigin(h: { get(name: string): string | null }): string {
  const dec = (v: string | null) => { if (!v) return ''; try { return decodeURIComponent(v) } catch { return v } }
  const place = [dec(h.get('x-vercel-ip-city')), dec(h.get('x-vercel-ip-country-region')), h.get('x-vercel-ip-country')].filter(Boolean).join(', ')
  const ua = h.get('user-agent') || ''
  const device = /iPad|Tablet/i.test(ua) ? 'Tablet' : /Mobi|Android|iPhone/i.test(ua) ? 'Mobile' : ua ? 'Desktop' : ''
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\/|Opera/.test(ua) ? 'Opera' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : ''
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad|iOS/.test(ua) ? 'iOS' : /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : ''
  const dev = device ? `${device}${browser || os ? ` (${[browser, os].filter(Boolean).join(', ')})` : ''}` : ''
  return [place, dev].filter(Boolean).join(' · ')
}

/**
 * Reads the order from the database and returns the finished owner e-mail. Returns null if the order cannot be read (callers then fall
 * back to nothing rather than a wrong mail).
 */
export async function loadAdminOrderEmail(
  db: SupabaseClient,
  orderId: string | number,
  opts: { kind: AdminOrderEmailKind; cancelReason?: string | null; cancelNote?: string | null },
): Promise<{ subject: string; html: string } | null> {
  const { data: o } = await db
    .from('orders')
    .select('id, order_number, created_at, status, source, payment_method, payment_status, payment_id, subtotal, coupon_discount, shipping_charge, cod_surcharge, tax, round_off, total_amount, loyalty_points_redeemed, shipping_address, customer_id, order_items(quantity, price_at_time, product_name_snapshot, variant_value_snapshot, sku_snapshot, products(name))')
    .eq('id', orderId)
    .single()
  if (!o || !o.order_number) return null

  const [{ data: cust }, { data: cu }, { data: ev }] = await Promise.all([
    o.customer_id ? db.from('customers').select('first_name, last_name, phone, email, auth_user_id, total_orders, total_spent').eq('id', o.customer_id).single() : Promise.resolve({ data: null }),
    db.from('coupon_usage').select('coupons(code)').eq('order_id', o.id).limit(1),
    db.from('order_events').select('metadata').eq('order_id', o.id).eq('event', 'order_origin').limit(1),
  ])

  const sa = (typeof o.shipping_address === 'string' ? (() => { try { return JSON.parse(o.shipping_address) } catch { return null } })() : o.shipping_address) as Record<string, string> | null
  type Item = { quantity: number; price_at_time: number; product_name_snapshot: string | null; variant_value_snapshot: string | null; sku_snapshot: string | null; products?: { name?: string } | { name?: string }[] | null }
  const items = ((o.order_items ?? []) as unknown as Item[]).map(r => {
    const p = Array.isArray(r.products) ? r.products[0] : r.products
    return { name: r.product_name_snapshot || p?.name || 'Product', variant: r.variant_value_snapshot, sku: r.sku_snapshot, qty: Number(r.quantity) || 0, price: Number(r.price_at_time) || 0 }
  })
  const couponRow = (cu?.[0] as unknown as { coupons?: { code?: string } | { code?: string }[] } | undefined)?.coupons
  const couponCode = Array.isArray(couponRow) ? couponRow[0]?.code : couponRow?.code
  const origin = ((ev?.[0]?.metadata ?? {}) as { origin?: string }).origin ?? null
  const name = sa?.name || [cust?.first_name, cust?.last_name].filter(Boolean).join(' ') || 'Customer'

  const input: AdminOrderEmailInput = {
    kind: opts.kind,
    orderNumber: o.order_number,
    placedAt: o.created_at,
    status: o.status,
    paymentMethod: o.payment_method ?? '',
    paymentStatus: o.payment_status,
    paymentId: o.payment_id,
    customer: { name, phone: sa?.phone || cust?.phone, email: sa?.email || cust?.email, hasAccount: cust?.auth_user_id != null, ordersCount: cust?.total_orders ?? null, lifetimeSpent: cust?.total_spent != null ? Number(cust.total_spent) : null },
    address: { line1: sa?.address_line1, line2: sa?.address_line2, city: sa?.city, state: sa?.state, pincode: sa?.pincode },
    items,
    subtotal: Number(o.subtotal ?? items.reduce((s, i) => s + i.price * i.qty, 0)) || 0,
    couponCode: couponCode ?? null,
    couponDiscount: Number(o.coupon_discount) || 0,
    coinsRedeemed: Number(o.loyalty_points_redeemed) || 0,
    shipping: Number(o.shipping_charge) || 0,
    codSurcharge: Number(o.cod_surcharge) || 0,
    gstIncluded: Number(o.tax) || 0,
    roundOff: Number(o.round_off) || 0,
    total: Number(o.total_amount) || 0,
    origin,
    source: o.source,
    cancelReason: opts.cancelReason,
    cancelNote: opts.cancelNote,
  }
  return {
    subject: adminOrderEmailSubject({ kind: opts.kind, orderNumber: o.order_number, total: input.total, customerName: name, city: sa?.city }),
    html: buildAdminOrderEmail(input),
  }
}
