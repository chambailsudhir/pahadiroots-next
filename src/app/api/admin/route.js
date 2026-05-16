import { NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'crypto';

// ── Auth inlined here — cannot import from /api/auth/route in Next.js App Router
// Importing between route files causes bundler issues (verifyToken arrives as undefined at runtime)
const _SECRET = process.env.TOKEN_SECRET || process.env.ADMIN_PASSWORD || '';

function _parseToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, payload, sig] = parts;
  const expected = createHmac('sha256', _SECRET).update(`${header}.${payload}`).digest('base64url');
  const a = Buffer.from(sig,      'base64url');
  const b = Buffer.from(expected, 'base64url');
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  let data;
  try { data = JSON.parse(Buffer.from(payload, 'base64url').toString()); } catch { return null; }
  if (!data.exp || data.exp < Math.floor(Date.now() / 1000)) return null;
  return data;
}

function verifyToken(token) {
  const data = _parseToken(token);
  return data ? data.role : null;
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const OWNER_PW    = process.env.ADMIN_PASSWORD;
const MANAGER_PW  = process.env.MANAGER_PASSWORD || '';
const PACKING_PW  = process.env.PACKING_PASSWORD || '';
const VENDOR_PW   = process.env.VENDOR_PASSWORD  || '';
const RESEND_KEY  = process.env.RESEND_API_KEY || '';
const WA_NUMBER   = process.env.WHATSAPP_NUMBER || '919899984895';

// FIX #26 + #28: Added new audit tables to allowlist
const ALLOWED_TABLES = new Set([
  'products', 'categories', 'orders', 'order_items', 'customers',
  'coupons', 'coupon_usage', 'subscribers', 'reviews',
  'inventory_logs', 'order_logs', 'order_status_history', 'admin_logs',
  'revenue_summary', 'daily_revenue', 'sales_summary', 'order_summary',
  'order_detailed', 'stock_overview',
  'site_settings', 'states', 'state_images', 'founder_images',
  'product_variants', 'product_images', 'abandoned_carts',
  'team_members', 'payments',
  'inventory', 'stock_movements', 'channels', 'channel_inventory',
  'warehouses', 'inventory_locations', 'inventory_overview',
  'returns',
  'vendors', 'vendor_products',
  'profit_by_order_item',
  // FIX #10 #28: New audit/history tables
  'product_price_history',
  'inventory_ledger',
  'gst_rates',
  // v4 infra fixes: status config + error logging + snapshot view
  'order_status_config',
  'finance_error_events',
  'finance_order_snapshot',
  // B23+B24 fix: PG fees + shipping cost tables (were missing — caused 400 errors)
  'payment_transactions',
  'shipping_transactions',
  // B25 fix: finance views (were missing — caused ALL queries to fall to slow legacy path)
  'finance_by_product',
  'finance_by_category',
  // v5 enterprise gaps: journal entries, snapshots, reconciliation
  'finance_journal_entries',
  'finance_pl_from_journal',
  'finance_snapshots',
  'reconciliation_runs',
  // v6: DB finance logic views
  'finance_by_product_with_coupon',
  'finance_contribution_margin',
]);

// RPC functions allowed through the generic RPC handler
// Keep this list explicit — never allow arbitrary function calls
const ALLOWED_RPC = new Set([
  'get_orders_paginated',       // cursor-based order pagination
  'apply_coupon',               // coupon apply
  'restore_stock_safe',         // stock restore
  'take_finance_snapshot',      // month-end snapshot
  'run_reconciliation',         // reconciliation worker
  // v6: frontend logic moved to DB
  'validate_waterfall',         // waterfall integrity check
  'compute_reliability',        // reliability scoring
  'cross_table_check',          // cross-table validation
  'finance_daily_trend',        // daily revenue/profit trend
  'sku_exists',
  'update_product_with_version',
  'calculate_return_rate',
  'suggest_gst_rate',
  'get_channel_price',
  'activate_pricing_schedules',
  'return_rate_config',
  'product_channel_prices',
  'pricing_schedules',
  'product_ai_content',
  // Stock concurrency (006_stock_concurrency.sql) — NEVER write available_stock directly
  'adjust_variant_stock',       // atomic stock delta with advisory lock + ledger
  'bulk_stock_import',          // batch SKU import via adjust_variant_stock
  // Channel pricing (007_remaining_bugs.sql)
  'revalidate_channel_margins', // staleness + margin check after master price change
]);

const PACKING_ALLOWED    = new Set(['orders', 'order_status_history']);
const MANAGER_RESTRICTED = new Set(['admin_logs', 'site_settings']);
const ANY_ROLE_INSERT    = new Set(['finance_error_events']);
// N34 FIX: Views are read-only — block POST/PATCH/DELETE before hitting Supabase
const READ_ONLY_TABLES   = new Set([
  'finance_by_product', 'finance_by_category', 'finance_order_snapshot',
  'finance_pl_from_journal', 'finance_by_product_with_coupon',
  'finance_contribution_margin',
  'order_detailed', 'order_summary', 'revenue_summary', 'sales_summary',
  'stock_overview', 'inventory_overview',
]);
const VENDOR_ALLOWED     = new Set([
  'products', 'product_variants', 'product_images',
  'categories', 'states', 'vendors', 'vendor_products',
]);

function getRoleFromPw(pw) {
  if (pw === OWNER_PW)                 return 'owner';
  if (pw === MANAGER_PW && MANAGER_PW) return 'manager';
  if (pw === PACKING_PW && PACKING_PW) return 'packing';
  if (pw === VENDOR_PW  && VENDOR_PW)  return 'vendor';
  return null;
}

async function sbFetch(method, table, query, body) {
  const url = `${SUPABASE_URL}/rest/v1/${table}${query ? '?' + query : ''}`;
  const res = await fetch(url, {
    method,
    headers: {
      'apikey':        SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type':  'application/json',
      'Accept':        'application/json',
      'Prefer':        method === 'DELETE' ? 'return=minimal' : 'return=representation',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok && res.status !== 206) {
    const err = await res.text();
    throw new Error(`Supabase ${res.status}: ${err}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// ── FIX #37 #38: Storage upload — use buffer not base64-in-JSON ──
async function storageUpload(fileName, fileType, fileBase64) {
  const bucket = 'pahadi-images';
  const url = `${SUPABASE_URL}/storage/v1/object/${bucket}/${fileName}`;
  const buffer = Buffer.from(fileBase64, 'base64');
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'apikey':        SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type':  fileType || 'image/jpeg',
      'x-upsert':      'true',
    },
    body: buffer,
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Storage upload failed: ${err}`);
  }
  return `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${fileName}`;
}

// ── FIX #3: Paise-based money helpers ────────────────────────
function toPaise(n)  { return Math.round(Number(n) * 100); }
function toRupees(p) { return Math.round(p) / 100; }

// ── FIX #31: Atomic coupon apply via Supabase RPC ────────────
// Calls the apply_coupon() DB function we created in migration SQL
// which does SELECT FOR UPDATE atomically
async function applyCouponAtomic(couponId, orderId, customerId) {
  const url = `${SUPABASE_URL}/rest/v1/rpc/apply_coupon`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'apikey':        SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({
      p_coupon_id:    couponId,
      p_order_id:     orderId,
      p_customer_id:  customerId,
    }),
  });
  if (!res.ok) throw new Error('Coupon application failed');
  return await res.json();
}

// ── FIX #29: Idempotency-safe stock restore via RPC ──────────
async function restoreStockSafe(variantId, qty, orderId, idempotencyKey) {
  const url = `${SUPABASE_URL}/rest/v1/rpc/restore_stock_safe`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'apikey':        SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({
      p_variant_id:      variantId,
      p_qty:             qty,
      p_order_id:        orderId,
      p_idempotency_key: idempotencyKey,
    }),
  });
  if (!res.ok) throw new Error('Stock restore failed');
  return await res.json();
}

// ── FIX #23: Coupon margin floor validation ───────────────────
// Returns { ok, margin_after, error? }
function validateCouponMargin(sellingPrice, costPrice, couponValue, couponType, minMarginFloor = 8) {
  if (!costPrice || costPrice <= 0) return { ok: true, margin_after: null }; // no cost data, skip
  const sp_p    = toPaise(sellingPrice);
  const cost_p  = toPaise(costPrice);
  const discount_p = couponType === 'flat'
    ? toPaise(couponValue)
    : Math.round(sp_p * Number(couponValue) / 100);
  const sp_after_p   = sp_p - discount_p;
  const margin_after = sp_after_p > 0 ? (sp_after_p - cost_p) / sp_after_p * 100 : -100;
  if (margin_after < minMarginFloor) {
    return {
      ok: false,
      margin_after,
      error: `Coupon pushes gross margin to ${margin_after.toFixed(1)}% — below configured floor of ${minMarginFloor}%`,
    };
  }
  return { ok: true, margin_after };
}

// ── FIX #25 #35: Build order_item snapshot at order creation ─
// Call this when creating order_items so historical data is locked
function buildOrderItemSnapshot(product, variant, quantity) {
  const gstRate    = Number(product.gst_rate) || 5;
  const sell_p     = toPaise(variant.price || product.selling_price || product.mrp || 0);
  const base_p     = Math.round(sell_p / (1 + gstRate / 100));
  const gst_p      = sell_p - base_p;
  return {
    product_name_snapshot:  product.name,
    variant_value_snapshot: variant.variant_value,
    sku_snapshot:           variant.sku,
    price_snapshot:         toRupees(sell_p),
    mrp_snapshot:           product.mrp,
    cost_price_snapshot:    product.cost_price || null,
    gst_rate_snapshot:      gstRate,
    cgst_snapshot:          toRupees(Math.floor(gst_p / 2)),
    sgst_snapshot:          toRupees(gst_p - Math.floor(gst_p / 2)),  // odd paise goes to sgst
    igst_snapshot:          0,
    variant_snapshot:       JSON.stringify({
      variant_type:   variant.variant_type,
      variant_value:  variant.variant_value,
      price:          toRupees(sell_p),
      original_price: variant.original_price,
      sku:            variant.sku,
    }),
    quantity,
  };
}

// ── Email helpers (unchanged) ─────────────────────────────────
function emailWrapper(inner) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f7f3ee;font-family:'Helvetica Neue',Arial,sans-serif">
<div style="max-width:580px;margin:0 auto;padding:24px 16px">
  <div style="background:linear-gradient(135deg,#1a3a1e,#2d5233);border-radius:16px 16px 0 0;padding:28px 32px;text-align:center">
    <div style="font-size:32px;margin-bottom:6px">🌿</div>
    <div style="font-family:Georgia,serif;font-size:22px;font-weight:900;color:#fff;margin-bottom:3px">5 Pahadi Roots</div>
    <div style="font-size:11px;color:rgba(255,255,255,.6);letter-spacing:2px;text-transform:uppercase">Himalayan Natural Store</div>
  </div>
  ${inner}
  <div style="background:#1a3a1e;border-radius:0 0 16px 16px;padding:18px 32px;text-align:center">
    <div style="color:rgba(255,255,255,.5);font-size:12px;line-height:1.8">
      🌿 5 Pahadi Roots — Pure Himalayan Goodness<br>
      <a href="https://pahadiroots.com" style="color:#e8b84b;text-decoration:none">pahadiroots.com</a>
      &nbsp;·&nbsp;
      <a href="https://wa.me/${WA_NUMBER}" style="color:#e8b84b;text-decoration:none">WhatsApp Us</a>
    </div>
  </div>
</div>
</body></html>`;
}

async function sendEmail(to, subject, html) {
  if (!RESEND_KEY) throw new Error('RESEND_API_KEY not configured');
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_KEY}` },
    body: JSON.stringify({ from: '5 Pahadi Roots <noreply@pahadiroots.com>', to: [to], subject, html }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.message || 'Email send failed');
  return data;
}

function buildStatusEmail({ status, orderNumber, orderId, name, trackingNumber, courier, totalAmount, subtotal, shippingCharge, discount, address, city, state, postal, items }) {
  const ORDER_URL = `https://pahadiroots.com/order-confirmation?id=${orderId}&num=${encodeURIComponent(orderNumber || '')}`;
  const WA_DISPLAY = WA_NUMBER.replace(/^91/, '+91 ').replace(/(\d{5})(\d{5})$/, '$1 $2');
  const statusMap = {
    pending:          { icon:'⏳', title:'Order Received',         msg:`We've received your order <strong>${orderNumber}</strong> and it's awaiting confirmation.` },
    confirmed:        { icon:'✅', title:'Order Confirmed!',        msg:`Your order <strong>${orderNumber}</strong> has been confirmed and is being prepared for dispatch.` },
    packed:           { icon:'📦', title:'Order Packed!',           msg:`Your order <strong>${orderNumber}</strong> is packed and ready for courier pickup.` },
    shipped:          { icon:'🚚', title:'Order Shipped!',          msg:`Your order <strong>${orderNumber}</strong> is on its way!${trackingNumber ? `<br><br>📍 <strong>Tracking:</strong> ${trackingNumber}${courier ? ` via <strong>${courier}</strong>` : ''}` : ''}` },
    delivered:        { icon:'🎉', title:'Order Delivered!',        msg:`Your order <strong>${orderNumber}</strong> has been delivered. Enjoy your Himalayan goodness! 🌿` },
    cancelled:        { icon:'❌', title:'Order Cancelled',         msg:`Your order <strong>${orderNumber}</strong> has been cancelled. For any questions, please WhatsApp us.` },
    returned:         { icon:'↩️', title:'Return Processed',        msg:`Your return for order <strong>${orderNumber}</strong> has been processed. Refund within 3–5 business days.` },
    return_requested: { icon:'⏳', title:'Return Request Received', msg:`We've received your return request for order <strong>${orderNumber}</strong>. We'll respond within 24–48 hours.` },
    return_approved:  { icon:'✅', title:'Return Approved!',        msg:`Your return for order <strong>${orderNumber}</strong> has been approved.` },
    return_received:  { icon:'📬', title:'Return Items Received',   msg:`We've received the returned items for order <strong>${orderNumber}</strong>. Processing your refund now.` },
    return_rejected:  { icon:'❌', title:'Return Request Rejected', msg:`Your return request for order <strong>${orderNumber}</strong> could not be approved.` },
    refund_initiated: { icon:'💳', title:'Refund Initiated!',       msg:`Your refund for order <strong>${orderNumber}</strong> has been initiated. 3–5 business days.` },
    refund_completed: { icon:'💚', title:'Refund Credited!',        msg:`Your refund for order <strong>${orderNumber}</strong> has been successfully credited. Thank you!` },
  };
  const info = statusMap[status] || { icon:'📋', title:'Order Update', msg:`Your order <strong>${orderNumber}</strong> status updated to <strong>${status}</strong>.` };
  const subject = `${info.icon} ${info.title} — ${orderNumber}`;
  const itemsHtml = (items && items.length > 0) ? `
    <div style="margin:24px 0;border:1px solid #e8e0d8;border-radius:12px;overflow:hidden">
      <div style="background:#f7f3ee;padding:12px 16px;font-size:11px;font-weight:800;color:#1a3a1e;text-transform:uppercase;letter-spacing:1px">Order Items</div>
      ${items.map(it => `
        <div style="display:flex;align-items:center;padding:14px 16px;border-top:1px solid #f0ebe4;gap:14px">
          ${it.image ? `<img src="${it.image}" alt="${it.name}" style="width:56px;height:56px;object-fit:cover;border-radius:8px;border:1px solid #e8e0d8;flex-shrink:0">` : `<div style="width:56px;height:56px;background:#e8f5e9;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:24px;flex-shrink:0">🌿</div>`}
          <div style="flex:1;min-width:0">
            <div style="font-size:13px;font-weight:700;color:#1a3a1e;margin-bottom:3px">${it.name}</div>
            <div style="font-size:12px;color:#888">Qty: ${it.qty}</div>
          </div>
          <div style="font-size:13px;font-weight:800;color:#1a3a1e;white-space:nowrap">₹${Math.round((it.price || 0) * (it.qty || 1)).toLocaleString('en-IN')}</div>
        </div>`).join('')}
    </div>` : '';
  const summaryHtml = totalAmount ? `
    <div style="background:#f7f3ee;border-radius:12px;padding:16px 20px;margin:0 0 24px">
      ${subtotal ? `<div style="display:flex;justify-content:space-between;font-size:13px;color:#666;margin-bottom:8px"><span>Subtotal</span><span>₹${Math.round(subtotal).toLocaleString('en-IN')}</span></div>` : ''}
      ${shippingCharge ? `<div style="display:flex;justify-content:space-between;font-size:13px;color:#666;margin-bottom:8px"><span>Shipping</span><span>₹${Math.round(shippingCharge).toLocaleString('en-IN')}</span></div>` : '<div style="display:flex;justify-content:space-between;font-size:13px;color:#2d7a3a;margin-bottom:8px"><span>Shipping</span><span>FREE</span></div>'}
      ${discount ? `<div style="display:flex;justify-content:space-between;font-size:13px;color:#2d7a3a;margin-bottom:8px"><span>Discount</span><span>−₹${Math.round(discount).toLocaleString('en-IN')}</span></div>` : ''}
      <div style="display:flex;justify-content:space-between;font-size:15px;font-weight:800;color:#1a3a1e;border-top:1px solid #ddd6cc;padding-top:10px;margin-top:4px"><span>Total</span><span>₹${Math.round(totalAmount).toLocaleString('en-IN')}</span></div>
    </div>` : '';
  const addressHtml = (address || city) ? `
    <div style="border:1px solid #e8e0d8;border-radius:12px;padding:14px 18px;margin:0 0 24px;text-align:left">
      <div style="font-size:11px;font-weight:800;color:#1a3a1e;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px">📍 Delivery Address</div>
      <div style="font-size:13px;color:#555;line-height:1.7">${address ? `${address}<br>` : ''}${city}${state ? `, ${state}` : ''}${postal ? ` — ${postal}` : ''}</div>
    </div>` : '';
  const trackingHtml = (status === 'shipped' && trackingNumber) ? `
    <div style="background:#e8f5e9;border:1px solid #c8e6c9;border-radius:12px;padding:14px 18px;margin:0 0 24px;text-align:left">
      <div style="font-size:11px;font-weight:800;color:#1a3a1e;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px">🚚 Tracking Details</div>
      <div style="font-size:13px;color:#1a3a1e"><strong>Tracking ID:</strong> ${trackingNumber}</div>
      ${courier ? `<div style="font-size:13px;color:#1a3a1e;margin-top:4px"><strong>Courier:</strong> ${courier}</div>` : ''}
    </div>` : '';
  const html = emailWrapper(`
    <div style="background:#fff;padding:32px;border-left:1px solid #eee;border-right:1px solid #eee">
      <div style="text-align:center;margin-bottom:28px">
        <div style="font-size:52px;margin-bottom:12px">${info.icon}</div>
        <h1 style="font-family:Georgia,serif;font-size:26px;color:#1a3a1e;margin:0 0 10px">${info.title}</h1>
        <p style="color:#555;font-size:15px;margin:0 0 4px">Hi ${name || 'there'},</p>
        <p style="color:#555;font-size:14px;line-height:1.6;margin:0">${info.msg}</p>
      </div>
      ${itemsHtml}${summaryHtml}${trackingHtml}${addressHtml}
      <div style="text-align:center">
        <a href="${ORDER_URL}" style="display:inline-block;background:linear-gradient(135deg,#1a3a1e,#2d5233);color:#fff;padding:14px 32px;border-radius:12px;text-decoration:none;font-weight:800;font-size:15px">📦 View Order Details</a>
        <p style="color:#aaa;font-size:12px;margin-top:20px">Questions? <a href="https://wa.me/${WA_NUMBER}" style="color:#1a3a1e;font-weight:700">WhatsApp ${WA_DISPLAY}</a></p>
      </div>
    </div>`);
  return { subject, html };
}

// ════════════════════════════════════════════════════════════════
// MAIN POST HANDLER
// ════════════════════════════════════════════════════════════════
export async function POST(req) {
  try {
    // FIX #51: Verify session token — never raw password
    const token = req.headers.get('x-session-token') || '';
    const role  = verifyToken(token);
    if (!role) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();

    // ── Storage upload ───────────────────────────────────────
    if (body.action === 'storage_upload') {
      if (role !== 'owner' && role !== 'manager')
        return NextResponse.json({ error: 'Access denied' }, { status: 403 });
      const { fileName, fileType, fileBase64 } = body;
      if (!fileName || !fileBase64)
        return NextResponse.json({ error: 'fileName and fileBase64 required' }, { status: 400 });
      const url = await storageUpload(fileName, fileType, fileBase64);
      return NextResponse.json({ url });
    }

    // ── FIX #52/#37/#38: Signed upload URL ──────────────────────────────────
    // Browser uploads directly to Supabase Storage — file never touches Vercel.
    // Resolves the 4.5MB serverless body limit for all image and video uploads.
    // FIX #57 — server-side upload validation
    if (body.action === 'get_upload_url') {
      const ALLOWED_MIME = new Set([
        'image/jpeg','image/jpg','image/png','image/webp','image/gif',
        'video/mp4','video/quicktime','video/webm','video/x-msvideo',
      ]);
      const ALLOWED_EXT = new Set([
        'jpg','jpeg','png','webp','gif','mp4','mov','webm','avi',
      ]);
      const { fileType, fileName } = body;
      const ext = (fileName || '').split('.').pop().toLowerCase();
      if (!ALLOWED_MIME.has(fileType) || !ALLOWED_EXT.has(ext)) {
        return NextResponse.json(
          { error: `File type not allowed: ${fileType} (.${ext})` },
          { status: 400 }
        );
      }
      if (role !== 'owner' && role !== 'manager')
        return NextResponse.json({ error: 'Access denied' }, { status: 403 });
      if (!fileName || !fileType)
        return NextResponse.json({ error: 'fileName and fileType required' }, { status: 400 });

      const bucket   = 'pahadi-images';
      const signRes  = await fetch(
        `${SUPABASE_URL}/storage/v1/object/sign/upload/${bucket}/${fileName}`,
        {
          method:  'POST',
          headers: {
            'apikey':        SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`,
            'Content-Type':  'application/json',
          },
          body: JSON.stringify({ expiresIn: 300 }),  // 5-minute window
        }
      );
      if (!signRes.ok) {
        const err = await signRes.text();
        return NextResponse.json({ error: `Supabase sign error: ${err}` }, { status: 502 });
      }
      const { signedURL, token: signedToken } = await signRes.json();

      // Public URL is available immediately after upload completes
      const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${fileName}`;

      return NextResponse.json({ signedURL, token: signedToken, publicUrl });
    }

    // ── Generate AI product content ──────────────────────────
    if (body.action === 'generate_ai_content') {
      if (role !== 'owner' && role !== 'manager')
        return NextResponse.json({ error: 'Access denied' }, { status: 403 });
      const { productId, name, category, ingredients } = body;
      if (!productId || !name)
        return NextResponse.json({ error: 'productId and name are required' }, { status: 400 });
      const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
      if (!ANTHROPIC_KEY)
        return NextResponse.json({ error: 'ANTHROPIC_API_KEY not set in Vercel environment variables' }, { status: 500 });
      const prompt =
        `You are a product content writer for "5 Pahadi Roots" — premium Himalayan organic products brand.\n` +
        `Products are sourced directly from mountain farming communities across India.\n\n` +
        `Product: ${name}${category ? `\nCategory: ${category}` : ''}${ingredients ? `\nIngredients/Key Components: ${ingredients}` : ''}\n` +
        `Brand tone: Natural, honest, warm — no marketing fluff, no fake claims.\n\n` +
        `Write ALL content below. Respond ONLY with valid JSON — no markdown, no backticks:\n\n` +
        `{\n` +
        `  "description": "2-3 sentences: what it is, Himalayan/regional origin, why special.",\n` +
        `  "benefits": [\n` +
        `    {"icon":"relevant health emoji","title":"3-4 word title","desc":"One specific sentence 12-15 words."}\n` +
        `  ],\n` +
        `  "how_to_use": ["Step 1: clear action","Step 2: ...","Step 3: ..."],\n` +
        `  "storage_tips": ["Tip 1","Tip 2","Tip 3"],\n` +
        `  "who_should_buy": "2 sentences describing ideal customer and why."\n` +
        `}\n\n` +
        `Rules: "benefits" = exactly 5 items specific to ${name}. "how_to_use" = 3-5 steps. "storage_tips" = 3-4 tips.`;
      const aiResp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 1200, messages: [{ role: 'user', content: prompt }] }),
      });
      if (!aiResp.ok) {
        const err = await aiResp.text();
        return NextResponse.json({ error: `Claude API error: ${aiResp.status} — ${err}` }, { status: 502 });
      }
      const aiData  = await aiResp.json();
      const rawText = (aiData.content || []).map(c => c.text || '').join('');
      let parsed;
      try { parsed = JSON.parse(rawText.replace(/```json|```/g, '').trim()); }
      catch { return NextResponse.json({ error: 'Claude returned invalid JSON. Please try again.' }, { status: 502 }); }
      if (!parsed.description || !Array.isArray(parsed.benefits))
        return NextResponse.json({ error: 'Incomplete AI response. Please regenerate.' }, { status: 502 });
      const saved = await sbFetch('PATCH', 'products', `id=eq.${productId}`, {
        ai_description:     parsed.description,
        ai_health_benefits: JSON.stringify(parsed.benefits),
        ai_how_to_use:      JSON.stringify(parsed.how_to_use   || []),
        ai_storage_tips:    JSON.stringify(parsed.storage_tips || []),
        ai_who_should_buy:  parsed.who_should_buy || null,
        ai_generated_at:    new Date().toISOString(),
        ai_provider:        'claude',
      });
      return NextResponse.json({ success: true, data: parsed, saved });
    }

    // FIX #47 — AI content in dedicated table
    if (body.action === 'save_ai_content') {
      const { productId, fieldName, content, provider, model } = body;
      if (!productId || !fieldName || !content)
        return NextResponse.json({ error: 'productId, fieldName, content required' }, { status: 400 });
      const res = await sbFetch('POST', 'product_ai_content', '',
        { product_id: productId, field_name: fieldName, content, provider: provider || 'gemini',
          model: model || null, approved: false, generated_at: new Date().toISOString() });
      return NextResponse.json({ ok: true, data: res });
    }

    if (body.action === 'approve_ai_content') {
      const { productId, fieldName } = body;
      if (!productId || !fieldName)
        return NextResponse.json({ error: 'productId and fieldName required' }, { status: 400 });
      await sbFetch('PATCH', 'product_ai_content',
        `product_id=eq.${productId}&field_name=eq.${fieldName}`,
        { approved: true, approved_by: role, approved_at: new Date().toISOString() });
      return NextResponse.json({ ok: true });
    }

    // ── Generate SEO content ─────────────────────────────────
    if (body.action === 'generate_seo') {
      const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
      if (!ANTHROPIC_KEY)
        return NextResponse.json({ error: 'ANTHROPIC_API_KEY not set' }, { status: 500 });
      const { siteName, productNames } = body;
      const prompt =
        `You are an SEO expert for an Indian e-commerce store called "${siteName || '5 Pahadi Roots'}".\n` +
        `Store: Sells pure Himalayan natural products sourced directly from mountain farmers.\n` +
        `Products: ${productNames || 'wild honey, A2 ghee, Kashmiri saffron, Himalayan herbs, spices, teas, grains'}\n` +
        `Ships Pan India. Free shipping above ₹799. Target: health-conscious Indians.\n\n` +
        `Generate optimized SEO. Respond ONLY with valid JSON, no markdown:\n` +
        `{"meta_title":"60 chars max","meta_description":"150 chars max","meta_keywords":"15-20 keywords","suggestion":"One actionable sentence"}`;
      try {
        const aiResp = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 800, messages: [{ role: 'user', content: prompt }] }),
        });
        if (!aiResp.ok) { const err = await aiResp.text(); return NextResponse.json({ error: `AI error: ${aiResp.status} — ${err}` }, { status: 502 }); }
        const aiData = await aiResp.json();
        const text   = (aiData.content || []).map(b => b.text || '').join('').trim();
        const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
        return NextResponse.json({ success: true, seo: parsed });
      } catch (e) {
        return NextResponse.json({ error: 'SEO generation failed: ' + (e.message || e) }, { status: 500 });
      }
    }

    // ── FIX #23 + #31: Coupon validation with margin floor + atomic apply ──
    if (body.action === 'validate_coupon') {
      const { code, selling_price, cost_price, order_id, customer_id } = body;
      if (!code) return NextResponse.json({ error: 'Coupon code required' }, { status: 400 });

      // Fetch coupon
      const rows = await sbFetch('GET', 'coupons',
        `code=ilike.${encodeURIComponent(code)}&select=id,code,discount_type,discount_value,min_order_value,max_uses,uses_count,expires_at,is_active,min_margin_floor,excluded_skus&limit=1`
      );
      const coupon = rows?.[0];
      if (!coupon) return NextResponse.json({ ok: false, error: 'Invalid coupon code' });
      if (!coupon.is_active) return NextResponse.json({ ok: false, error: 'This coupon is no longer active' });
      if (coupon.expires_at && new Date(coupon.expires_at) < new Date())
        return NextResponse.json({ ok: false, error: 'This coupon has expired' });
      if (coupon.max_uses != null && coupon.uses_count >= coupon.max_uses)
        return NextResponse.json({ ok: false, error: 'This coupon has reached its usage limit' });
      if (coupon.min_order_value && selling_price < coupon.min_order_value)
        return NextResponse.json({ ok: false, error: `Minimum order value ₹${coupon.min_order_value} required for this coupon` });

      // FIX #23: Margin floor check
      const marginCheck = validateCouponMargin(
        selling_price,
        cost_price,
        coupon.discount_value,
        coupon.discount_type,
        coupon.min_margin_floor ?? 8
      );
      if (!marginCheck.ok) {
        return NextResponse.json({ ok: false, error: 'This coupon cannot be applied to this product (margin floor protection)', detail: marginCheck.error });
      }

      // FIX #31: Apply atomically only if order_id provided (at checkout)
      if (order_id && customer_id) {
        const result = await applyCouponAtomic(coupon.id, order_id, customer_id);
        if (!result.ok) return NextResponse.json({ ok: false, error: result.error });
      }

      return NextResponse.json({
        ok: true,
        coupon: {
          id:             coupon.id,
          code:           coupon.code,
          discount_type:  coupon.discount_type,
          discount_value: coupon.discount_value,
          margin_after:   marginCheck.margin_after,
        },
      });
    }

    // ── FIX #29: Safe stock restore with idempotency ─────────
    if (body.action === 'restore_stock') {
      if (!['owner', 'manager'].includes(role))
        return NextResponse.json({ error: 'Access denied' }, { status: 403 });
      const { variant_id, qty, order_id, idempotency_key } = body;
      if (!variant_id || !qty || !order_id)
        return NextResponse.json({ error: 'variant_id, qty, order_id required' }, { status: 400 });
      const key = idempotency_key || `restore-${order_id}-${variant_id}`;
      const result = await restoreStockSafe(variant_id, qty, order_id, key);
      return NextResponse.json(result);
    }

    // ── FIX #25: Build + return order item snapshot ──────────
    if (body.action === 'build_order_snapshot') {
      const { product, variant, quantity } = body;
      if (!product || !variant) return NextResponse.json({ error: 'product and variant required' }, { status: 400 });
      const snapshot = buildOrderItemSnapshot(product, variant, quantity || 1);
      return NextResponse.json({ ok: true, snapshot });
    }

    // ── FIX #10: Log price change to history table ───────────
    if (body.action === 'log_price_change') {
      if (!['owner', 'manager'].includes(role))
        return NextResponse.json({ error: 'Access denied' }, { status: 403 });
      const { product_id, old_price, new_price, old_selling_price, new_selling_price, old_mrp, new_mrp, old_cost_price, new_cost_price, reason } = body;
      if (!product_id) return NextResponse.json({ error: 'product_id required' }, { status: 400 });
      // Note: DB trigger trg_log_price_change does this automatically on product UPDATE.
      // This action is a manual override for bulk-price-change logging where trigger may not fire.
      await sbFetch('POST', 'product_price_history', null, {
        product_id, old_price, new_price,
        old_selling_price, new_selling_price,
        old_mrp, new_mrp,
        old_cost_price, new_cost_price,
        reason: reason || 'manual',
        changed_by: role,
        channel: 'admin_panel',
      });
      return NextResponse.json({ ok: true });
    }

    // ── Send status email ────────────────────────────────────
    if (body.action === 'send_status_email') {
      if (!['owner', 'manager'].includes(role))
        return NextResponse.json({ error: 'Access denied' }, { status: 403 });
      const { to, status, orderNumber, orderId, name, trackingNumber, courier, totalAmount, subtotal, shippingCharge, discount, address, city, state, postal, items } = body;
      if (!to || !status || !orderNumber)
        return NextResponse.json({ error: 'to, status, orderNumber required' }, { status: 400 });
      try {
        const { subject, html } = buildStatusEmail({ status, orderNumber, orderId, name, trackingNumber, courier, totalAmount, subtotal, shippingCharge, discount, address, city, state, postal, items });
        await sendEmail(to, subject, html);
        return NextResponse.json({ success: true });
      } catch (e) {
        console.warn('Email send failed:', e.message);
        return NextResponse.json({ success: false, error: e.message });
      }
    }

    // ── Generic RPC handler (Fix 4 — pagination + future DB functions) ────
    if (body.method === 'RPC') {
      const { fn, args } = body;
      if (!fn || !ALLOWED_RPC.has(fn))
        return NextResponse.json({ error: `RPC function "${fn}" not permitted` }, { status: 400 });
      // Only owner/manager can call RPC functions
      if (!['owner', 'manager'].includes(role))
        return NextResponse.json({ error: 'Access denied — RPC requires owner or manager role' }, { status: 403 });
      const url = `${SUPABASE_URL}/rest/v1/rpc/${fn}`;
      const res = await fetch(url, {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'apikey':         SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Prefer':         'return=representation',
        },
        body: JSON.stringify(args || {}),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        return NextResponse.json(
          { error: d.message || d.error || `RPC HTTP ${res.status}` },
          { status: res.status >= 500 ? 502 : 400 }
        );
      }
      const text = await res.text();
      return NextResponse.json(text ? JSON.parse(text) : null);
    }

    // ── Normal table CRUD ────────────────────────────────────
    const { method, table, body: rowBody } = body;
    let { query } = body;
    if (!table || !ALLOWED_TABLES.has(table))
      return NextResponse.json({ error: `Table "${table}" not permitted` }, { status: 400 });

    // N34 FIX: Block mutations on DB views — they are read-only
    if (READ_ONLY_TABLES.has(table) && method !== 'GET')
      return NextResponse.json({ error: `Table "${table}" is read-only (view) — only GET allowed` }, { status: 405 });

    // B18 fix: Append-only tables (error logs, audit events) writable by any authenticated role
    // but only for POST — no mutations or reads by low-privilege roles
    if (ANY_ROLE_INSERT.has(table)) {
      if (method !== 'POST')
        return NextResponse.json({ error: `Only INSERT allowed on ${table}` }, { status: 403 });
      const data = await sbFetch(method, table, query, rowBody);
      return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store, private' } });
    }

    if (role === 'packing' && !PACKING_ALLOWED.has(table))
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    if (role === 'manager' && MANAGER_RESTRICTED.has(table) && method !== 'GET')
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    if (role === 'packing' && !['GET', 'PATCH'].includes(method))
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    if (role === 'vendor') {
      if (!VENDOR_ALLOWED.has(table)) return NextResponse.json({ error: 'Access denied' }, { status: 403 });
      if (['categories', 'states'].includes(table) && method !== 'GET')
        return NextResponse.json({ error: 'Access denied' }, { status: 403 });
      // Strip internal cost fields from vendor product queries — vendors must not see margin data
      if (table === 'products' && query) {
        query = query
          .replace(/,?cost_price/g, '')
          .replace(/,?margin_pct/g, '');
      }
    }

    // FIX #26: Block public-role mutations on sensitive tables via service-key guard
    // (service_role bypasses RLS — all mutations here are owner/manager only)
    if (['products', 'coupons', 'orders'].includes(table) && ['POST', 'PATCH', 'DELETE'].includes(method)) {
      if (!['owner', 'manager'].includes(role))
        return NextResponse.json({ error: 'Access denied — mutations require owner or manager role' }, { status: 403 });
    }

    const data = await sbFetch(method, table, query, rowBody);
    return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store, private' } });

  } catch (e) {
    console.error('Admin API error:', e.message);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
