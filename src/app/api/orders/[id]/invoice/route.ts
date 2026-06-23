// ─────────────────────────────────────────────────────────────
// GET /api/orders/[id]/invoice
//
// Returns a print-ready HTML invoice page for the given order.
// Opens directly in a new tab — user prints with Ctrl+P / ⌘+P.
//
//  ✅ Token auth + ownership check (prevents IDOR)
//  ✅ Returns text/html (browser renders + allows native print)
//  ✅ No external PDF library — pure HTML + print CSS
//  ✅ Cache-Control: private, max-age=60 (invoice rarely changes)
// ─────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server'
import {
  sbAuth, sbAdmin,
  getToken, tryRefresh, applyNewCookies,
  syncCustomerProfile,
} from '@/lib/api/serverUtils'

function fail(status: number, msg: string) {
  return new NextResponse(msg, { status, headers: { 'Content-Type': 'text/plain' } })
}

// ── HTML escape — CRITICAL for this route ────────────────────
// This endpoint returns text/html directly rendered in the browser.
// Unlike JSON API routes where values are JSON-encoded, here every
// user-supplied value is interpolated into a raw HTML string.
// Without escaping, a customer who sets first_name to:
//   <script>fetch('/api/auth',{method:'POST',body:JSON.stringify({action:'logout'})})</script>
// would have that script execute every time they (or admin staff) open
// the invoice.  This is a stored XSS via the customers table.
//
// BUG FIX: added escHtml() and applied it to every user-controlled
// value before it is placed inside an HTML template string.
// Affected fields: customerName, customerPhone, user.email,
// addrBlock (shipping address snapshot), item names, item variants,
// order_number, order_status.
//
// We deliberately do NOT import from @/lib/server/htmlEscape so this
// file stays self-contained (the invoice route has no other server-only
// imports and adding one for a 5-line helper would be overkill).
const HTML_ESC: Record<string, string> = {
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;',
}
function escHtml(value: unknown): string {
  if (value === null || value === undefined) return ''
  return String(value).replace(/[&<>"']/g, ch => HTML_ESC[ch] ?? ch)
}

// ── Format helpers (no external deps) ────────────────────────
function fmt(n: number) {
  return '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })
}

export async function GET(
  req: NextRequest,
  // BUG FIX (Next.js 15+/16 migration): `params` is now a Promise.
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  if (!id) return fail(400, 'Order ID required')

  let token = getToken(req)
  let refreshed = !token ? await tryRefresh(req) : null
  if (!token && !refreshed) return fail(401, 'Not logged in')
  if (refreshed) token = refreshed.token

  try {
    const user    = await sbAuth('/user', null, token!)
    const profile = await syncCustomerProfile(user)
    if (!profile) return fail(404, 'Profile not found')

    // Fetch order — customer_id guard prevents IDOR
    const rows = await sbAdmin(
      'GET',
      `/rest/v1/orders?id=eq.${id}&customer_id=eq.${profile.id}&select=*,order_items(quantity,price_at_time,product_name_snapshot,variant_value_snapshot,products(name))&limit=1`,
    ).catch(() => null)

    if (!rows || !Array.isArray(rows) || rows.length === 0) {
      return fail(404, 'Order not found')
    }

    const o = rows[0] as Record<string, unknown>

    const items = ((o.order_items as Array<{
      quantity:               number
      price_at_time:          number
      product_name_snapshot:  string | null
      variant_value_snapshot: string | null
      products?: { name?: string }
    }>) || []).map(i => ({
      name:    i.product_name_snapshot || i.products?.name || 'Product',
      variant: i.variant_value_snapshot || null,
      qty:     i.quantity,
      price:   i.price_at_time,
      total:   i.quantity * i.price_at_time,
    }))

    const subtotal       = items.reduce((s, i) => s + i.total, 0)
    const discount       = Number(o.coupon_discount)  || 0
    const shipping       = Number(o.shipping_charge)  || 0
    const tax            = Number(o.tax)              || 0
    const grandTotal     = Number(o.total_amount)     || subtotal - discount + shipping + tax
    // BUG FIX: escape every user-controlled value before HTML interpolation.
    // Raw profile fields (first_name, last_name, phone) come from the customers
    // table and are user-editable via POST /api/profile with no HTML stripping.
    const customerName   = escHtml(
      [profile.first_name, profile.last_name].filter(Boolean).join(' ') || 'Customer'
    )
    const customerPhone  = escHtml((profile.phone || '').replace(/^\+91/, ''))
    const customerEmail  = escHtml(String(user.email || ''))
    const orderDate      = o.created_at ? escHtml(fmtDate(String(o.created_at))) : '—'
    const orderNum       = escHtml(String(o.order_number || o.id))
    const paymentMethod  = String(o.payment_method || '').toUpperCase() === 'COD'
      ? 'Cash on Delivery'
      : 'Online Payment'
    // order_status is DB-generated but escape defensively
    const orderStatus    = escHtml(String(o.order_status || '').replace(/_/g, ' '))

    let addrBlock = ''
    try {
      const addr = typeof o.shipping_address === 'string'
        ? JSON.parse(o.shipping_address)
        : (o.shipping_address as Record<string, string> | null)
      if (addr) {
        // escHtml each address field individually before joining — the joined
        // string goes straight into HTML so each part must be safe.
        addrBlock = [addr.name, addr.addr, addr.city, addr.state, addr.pin]
          .filter(Boolean)
          .map(v => escHtml(v))
          .join(', ')
      }
    } catch { /* no address */ }

    const itemRows = items.map(i => `
      <tr>
        <td>${escHtml(i.name)}${i.variant ? ` <span class="var">(${escHtml(i.variant)})</span>` : ''}</td>
        <td class="num">${i.qty}</td>
        <td class="num">${fmt(i.price)}</td>
        <td class="num">${fmt(i.total)}</td>
      </tr>`).join('')

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Invoice · ${orderNum} · 5 Pahadi Roots</title>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body   { font-family: Arial, Helvetica, sans-serif; font-size: 13px; color: #1a1a1a; background: #fff; padding: 32px; max-width: 780px; margin: 0 auto; }
    .hdr   { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 28px; padding-bottom: 20px; border-bottom: 2px solid #1a3a1e; }
    .brand { display: flex; align-items: center; gap: 10px; }
    .logo  { font-size: 28px; }
    .bname { font-size: 20px; font-weight: 900; color: #1a3a1e; font-family: Georgia, serif; }
    .btag  { font-size: 11px; color: #5a8a5a; margin-top: 2px; }
    .inv   { text-align: right; }
    .inv h1 { font-size: 22px; font-weight: 900; color: #1a3a1e; text-transform: uppercase; letter-spacing: 1px; }
    .inv .num { font-size: 15px; font-weight: 700; color: #333; margin-top: 4px; }
    .inv .dt  { font-size: 12px; color: #777; margin-top: 4px; }
    .meta  { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-bottom: 24px; }
    .meta-box h3 { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; color: #999; margin-bottom: 6px; }
    .meta-box p  { font-size: 13px; line-height: 1.6; color: #333; }
    table  { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
    thead  { background: #1a3a1e; color: #fff; }
    th     { padding: 9px 12px; text-align: left; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; }
    td     { padding: 10px 12px; border-bottom: 1px solid #e8e3db; font-size: 13px; }
    .num   { text-align: right; }
    tr:last-child td { border-bottom: none; }
    tbody tr:nth-child(even) { background: #f9f7f4; }
    .var   { color: #888; font-size: 11px; }
    .totals { margin-left: auto; width: 280px; }
    .trow  { display: flex; justify-content: space-between; padding: 5px 0; font-size: 13px; color: #555; }
    .trow.disc { color: #2e7d32; }
    .trow.grand { font-size: 16px; font-weight: 900; color: #1a3a1e; padding-top: 10px; margin-top: 6px; border-top: 2px solid #1a3a1e; }
    .footer { margin-top: 36px; padding-top: 16px; border-top: 1px solid #e8e3db; display: flex; justify-content: space-between; align-items: flex-end; }
    .footer-note { font-size: 11px; color: #999; line-height: 1.6; }
    .footer-seal { text-align: right; }
    .seal-line { width: 160px; border-top: 1px solid #ccc; margin-bottom: 4px; }
    .seal-lbl  { font-size: 11px; color: #999; }
    .badge     { display: inline-block; padding: 3px 10px; border-radius: 20px; font-size: 11px; font-weight: 700; background: #e8f5e9; color: #1b5e20; }
    @media print {
      body { padding: 0; }
      .no-print { display: none !important; }
      @page { margin: 16mm; }
    }
  </style>
</head>
<body>

<div class="no-print" style="margin-bottom:24px;display:flex;gap:12px;align-items:center">
  <button onclick="window.print()" style="background:#1a3a1e;color:#fff;border:none;padding:10px 24px;border-radius:8px;font-size:14px;font-weight:700;cursor:pointer">🖨 Print / Save as PDF</button>
  <button onclick="window.close()" style="background:#f0ece6;color:#333;border:none;padding:10px 20px;border-radius:8px;font-size:13px;cursor:pointer">Close</button>
</div>

<div class="hdr">
  <div class="brand">
    <div class="logo">🌿</div>
    <div>
      <div class="bname">5 Pahadi Roots</div>
      <div class="btag">Natural Himalayan Products</div>
    </div>
  </div>
  <div class="inv">
    <h1>Invoice</h1>
    <div class="num"># ${orderNum}</div>
    <div class="dt">${orderDate}</div>
  </div>
</div>

<div class="meta">
  <div class="meta-box">
    <h3>Billed To</h3>
    <p>
      <strong>${customerName}</strong><br/>
      ${customerPhone ? '+91 ' + customerPhone + '<br/>' : ''}
      ${customerEmail ? customerEmail + '<br/>' : ''}
      ${addrBlock || ''}
    </p>
  </div>
  <div class="meta-box">
    <h3>Order Details</h3>
    <p>
      <strong>Order #:</strong> ${orderNum}<br/>
      <strong>Date:</strong> ${orderDate}<br/>
      <strong>Payment:</strong> ${paymentMethod}<br/>
      <strong>Status:</strong> <span class="badge">${orderStatus}</span>
    </p>
  </div>
</div>

<table>
  <thead>
    <tr>
      <th>Product</th>
      <th class="num">Qty</th>
      <th class="num">Unit Price</th>
      <th class="num">Amount</th>
    </tr>
  </thead>
  <tbody>
    ${itemRows}
  </tbody>
</table>

<div class="totals">
  <div class="trow"><span>Subtotal</span><span>${fmt(subtotal)}</span></div>
  ${discount > 0 ? `<div class="trow disc"><span>Discount</span><span>- ${fmt(discount)}</span></div>` : ''}
  ${shipping > 0 ? `<div class="trow"><span>Shipping</span><span>${fmt(shipping)}</span></div>` : ''}
  ${tax > 0 ? `<div class="trow"><span>Tax</span><span>${fmt(tax)}</span></div>` : ''}
  <div class="trow grand"><span>Total</span><span>${fmt(grandTotal)}</span></div>
</div>

<div class="footer">
  <div class="footer-note">
    5 Pahadi Roots · pahadiroots.com<br/>
    Questions? WhatsApp us at +91 98999 84895<br/>
    Thank you for supporting Himalayan farming communities 🙏
  </div>
  <div class="footer-seal">
    <div class="seal-line"></div>
    <div class="seal-lbl">Authorised Signatory</div>
  </div>
</div>

</body>
</html>`

    const res = new NextResponse(html, {
      status: 200,
      headers: {
        'Content-Type':  'text/html; charset=utf-8',
        'Cache-Control': 'private, max-age=60',
      },
    })
    if (refreshed) applyNewCookies(res, refreshed.token, refreshed.refresh)
    return res

  } catch (e: unknown) {
    const err = e as { status?: number; message?: string }
    if (err.status === 401) return fail(401, 'Session expired — please login again')
    return fail(500, err.message || 'Invoice generation failed')
  }
}
