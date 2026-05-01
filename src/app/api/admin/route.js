import { NextResponse } from 'next/server';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const OWNER_PW    = process.env.ADMIN_PASSWORD;
const MANAGER_PW  = process.env.MANAGER_PASSWORD || '';
const PACKING_PW  = process.env.PACKING_PASSWORD || '';
const VENDOR_PW   = process.env.VENDOR_PASSWORD  || '';  // shared vendor portal password
const RESEND_KEY  = process.env.RESEND_API_KEY || '';
const WA_NUMBER   = process.env.WHATSAPP_NUMBER || '919899984895';

const ALLOWED_TABLES = new Set([
  'products','categories','orders','order_items','customers',
  'coupons','coupon_usage','subscribers','reviews',
  'inventory_logs','order_logs','order_status_history','admin_logs',
  'revenue_summary','daily_revenue','sales_summary','order_summary',
  'order_detailed','stock_overview',
  'site_settings','states','state_images','founder_images',
  'product_variants','product_images','abandoned_carts',
  'team_members','payments',
  'inventory','stock_movements','channels','channel_inventory',
  'warehouses','inventory_locations','inventory_overview',
  'returns',
  'vendors','vendor_products',
]);

const PACKING_ALLOWED    = new Set(['orders','order_status_history']);
const MANAGER_RESTRICTED = new Set(['admin_logs','site_settings']);
// Vendor: can only read/write their own products and vendor_products rows
const VENDOR_ALLOWED     = new Set(['products','product_variants','product_images','categories','states','vendors','vendor_products']);

function getRoleFromPw(pw) {
  if (pw === OWNER_PW)                   return 'owner';
  if (pw === MANAGER_PW && MANAGER_PW)   return 'manager';
  if (pw === PACKING_PW && PACKING_PW)   return 'packing';
  if (pw === VENDOR_PW  && VENDOR_PW)    return 'vendor';
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

// ── Email helper ──────────────────────────────────────────────
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
  const ORDER_URL = `https://pahadiroots.com/order-confirmation?id=${orderId}&num=${encodeURIComponent(orderNumber||'')}`;
  const WA_DISPLAY = WA_NUMBER.replace(/^91/, '+91 ').replace(/(\d{5})(\d{5})$/, '$1 $2');

  const statusMap = {
    pending:          { icon:'⏳', title:'Order Received',           msg:`We've received your order <strong>${orderNumber}</strong> and it's awaiting confirmation.` },
    confirmed:        { icon:'✅', title:'Order Confirmed!',          msg:`Your order <strong>${orderNumber}</strong> has been confirmed and is being prepared for dispatch.` },
    packed:           { icon:'📦', title:'Order Packed!',             msg:`Your order <strong>${orderNumber}</strong> is packed and ready for courier pickup.` },
    shipped:          { icon:'🚚', title:'Order Shipped!',            msg:`Your order <strong>${orderNumber}</strong> is on its way!${trackingNumber ? `<br><br>📍 <strong>Tracking:</strong> ${trackingNumber}${courier ? ` via <strong>${courier}</strong>` : ''}` : ''}` },
    delivered:        { icon:'🎉', title:'Order Delivered!',          msg:`Your order <strong>${orderNumber}</strong> has been delivered. Enjoy your Himalayan goodness! 🌿` },
    cancelled:        { icon:'❌', title:'Order Cancelled',           msg:`Your order <strong>${orderNumber}</strong> has been cancelled. For any questions, please WhatsApp us.` },
    returned:         { icon:'↩️', title:'Return Processed',          msg:`Your return for order <strong>${orderNumber}</strong> has been processed. Refund will be issued within 3–5 business days.` },
    return_requested: { icon:'⏳', title:'Return Request Received',   msg:`We've received your return request for order <strong>${orderNumber}</strong>. Our team will review and respond within 24–48 hours.` },
    return_approved:  { icon:'✅', title:'Return Approved!',          msg:`Your return for order <strong>${orderNumber}</strong> has been approved. Please courier the items back to us at our return address.` },
    return_received:  { icon:'📬', title:'Return Items Received',     msg:`We've received the returned items for order <strong>${orderNumber}</strong>. Processing your refund now.` },
    return_rejected:  { icon:'❌', title:'Return Request Rejected',   msg:`Unfortunately your return request for order <strong>${orderNumber}</strong> could not be approved. Please WhatsApp us if you have questions.` },
    refund_initiated: { icon:'💳', title:'Refund Initiated!',         msg:`Your refund for order <strong>${orderNumber}</strong> has been initiated. The amount will reflect in your account within 3–5 business days depending on your bank/payment method.` },
    refund_completed: { icon:'💚', title:'Refund Credited!',          msg:`Great news! Your refund for order <strong>${orderNumber}</strong> has been successfully credited to your original payment method. Thank you for shopping with 5 Pahadi Roots!` },
  };

  const info = statusMap[status] || { icon:'📋', title:'Order Update', color:'#1a3a1e', msg:`Your order <strong>${orderNumber}</strong> status has been updated to <strong>${status}</strong>.` };

  const subject = `${info.icon} ${info.title} — ${orderNumber}`;

  // ── Items table ──
  const itemsHtml = (items && items.length > 0) ? `
    <div style="margin:24px 0;border:1px solid #e8e0d8;border-radius:12px;overflow:hidden">
      <div style="background:#f7f3ee;padding:12px 16px;font-size:11px;font-weight:800;color:#1a3a1e;text-transform:uppercase;letter-spacing:1px">
        Order Items
      </div>
      ${items.map(it => `
        <div style="display:flex;align-items:center;padding:14px 16px;border-top:1px solid #f0ebe4;gap:14px">
          ${it.image ? `<img src="${it.image}" alt="${it.name}" style="width:56px;height:56px;object-fit:cover;border-radius:8px;border:1px solid #e8e0d8;flex-shrink:0">` : `<div style="width:56px;height:56px;background:#e8f5e9;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:24px;flex-shrink:0">🌿</div>`}
          <div style="flex:1;min-width:0">
            <div style="font-size:13px;font-weight:700;color:#1a3a1e;margin-bottom:3px">${it.name}</div>
            <div style="font-size:12px;color:#888">Qty: ${it.qty}</div>
          </div>
          <div style="font-size:13px;font-weight:800;color:#1a3a1e;white-space:nowrap">₹${Math.round((it.price||0) * (it.qty||1)).toLocaleString('en-IN')}</div>
        </div>
      `).join('')}
    </div>` : '';

  // ── Order summary ──
  const summaryHtml = totalAmount ? `
    <div style="background:#f7f3ee;border-radius:12px;padding:16px 20px;margin:0 0 24px">
      ${subtotal ? `<div style="display:flex;justify-content:space-between;font-size:13px;color:#666;margin-bottom:8px"><span>Subtotal</span><span>₹${Math.round(subtotal).toLocaleString('en-IN')}</span></div>` : ''}
      ${shippingCharge ? `<div style="display:flex;justify-content:space-between;font-size:13px;color:#666;margin-bottom:8px"><span>Shipping</span><span>₹${Math.round(shippingCharge).toLocaleString('en-IN')}</span></div>` : '<div style="display:flex;justify-content:space-between;font-size:13px;color:#2d7a3a;margin-bottom:8px"><span>Shipping</span><span>FREE</span></div>'}
      ${discount ? `<div style="display:flex;justify-content:space-between;font-size:13px;color:#2d7a3a;margin-bottom:8px"><span>Discount</span><span>−₹${Math.round(discount).toLocaleString('en-IN')}</span></div>` : ''}
      <div style="display:flex;justify-content:space-between;font-size:15px;font-weight:800;color:#1a3a1e;border-top:1px solid #ddd6cc;padding-top:10px;margin-top:4px"><span>Total</span><span>₹${Math.round(totalAmount).toLocaleString('en-IN')}</span></div>
    </div>` : '';

  // ── Delivery address ──
  const addressHtml = (address || city) ? `
    <div style="border:1px solid #e8e0d8;border-radius:12px;padding:14px 18px;margin:0 0 24px;text-align:left">
      <div style="font-size:11px;font-weight:800;color:#1a3a1e;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px">📍 Delivery Address</div>
      <div style="font-size:13px;color:#555;line-height:1.7">
        ${address ? `${address}<br>` : ''}
        ${city}${state ? `, ${state}` : ''}${postal ? ` — ${postal}` : ''}
      </div>
    </div>` : '';

  // ── Tracking info ──
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

      ${itemsHtml}
      ${summaryHtml}
      ${trackingHtml}
      ${addressHtml}

      <div style="text-align:center">
        <a href="${ORDER_URL}" style="display:inline-block;background:linear-gradient(135deg,#1a3a1e,#2d5233);color:#fff;padding:14px 32px;border-radius:12px;text-decoration:none;font-weight:800;font-size:15px">📦 View Order Details</a>
        <p style="color:#aaa;font-size:12px;margin-top:20px">Questions? <a href="https://wa.me/${WA_NUMBER}" style="color:#1a3a1e;font-weight:700">WhatsApp ${WA_DISPLAY}</a></p>
      </div>
    </div>`);

  return { subject, html };
}

export async function POST(req) {
  try {
    const pw   = req.headers.get('x-admin-password') || '';
    const role = getRoleFromPw(pw);
    if (!role) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();

    // ── Storage upload ─────────────────────────────────────────
    if (body.action === 'storage_upload') {
      if (role !== 'owner' && role !== 'manager')
        return NextResponse.json({ error: 'Access denied' }, { status: 403 });
      const { fileName, fileType, fileBase64 } = body;
      if (!fileName || !fileBase64) return NextResponse.json({ error: 'fileName and fileBase64 required' }, { status: 400 });
      const url = await storageUpload(fileName, fileType, fileBase64);
      return NextResponse.json({ url });
    }

    // ── Generate AI Content for product ───────────────────────
    // Called from catalogue page — runs server-side so NO CORS issue
    if (body.action === 'generate_ai_content') {
      if (role !== 'owner' && role !== 'manager')
        return NextResponse.json({ error: 'Access denied' }, { status: 403 });

      const { productId, name, category, ingredients } = body;
      if (!productId || !name)
        return NextResponse.json({ error: 'productId and name are required' }, { status: 400 });

      const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
      if (!ANTHROPIC_KEY)
        return NextResponse.json({ error: 'ANTHROPIC_API_KEY not set in Vercel environment variables' }, { status: 500 });

      const ingredientsLine = ingredients ? `\nIngredients/Key Components: ${ingredients}` : '';
      const categoryLine    = category    ? `\nCategory: ${category}` : '';

      const prompt =
        `You are a product content writer for "5 Pahadi Roots" — premium Himalayan organic products brand.\n` +
        `Products are sourced directly from mountain farming communities across India.\n\n` +
        `Product: ${name}${categoryLine}${ingredientsLine}\n` +
        `Brand tone: Natural, honest, warm — no marketing fluff, no fake claims.\n\n` +
        `Write ALL content below. Respond ONLY with valid JSON — no markdown, no backticks:\n\n` +
        `{\n` +
        `  "description": "2-3 sentences: what it is, Himalayan/regional origin, why special. Honest, no hyperbole.",\n` +
        `  "benefits": [\n` +
        `    {"icon":"relevant health emoji","title":"3-4 word title","desc":"One specific sentence 12-15 words."}\n` +
        `  ],\n` +
        `  "how_to_use": ["Step 1: clear action","Step 2: ...","Step 3: ..."],\n` +
        `  "storage_tips": ["Tip 1","Tip 2","Tip 3"],\n` +
        `  "who_should_buy": "2 sentences describing ideal customer and why."\n` +
        `}\n\n` +
        `Rules: "benefits" = exactly 5 items specific to ${name}. "how_to_use" = 3-5 steps. "storage_tips" = 3-4 tips.`;

      // Call Claude Haiku
      const aiResp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 1200,
          messages: [{ role: 'user', content: prompt }],
        }),
      });

      if (!aiResp.ok) {
        const err = await aiResp.text();
        return NextResponse.json({ error: `Claude API error: ${aiResp.status} — ${err}` }, { status: 502 });
      }

      const aiData = await aiResp.json();
      const rawText = (aiData.content || []).map(c => c.text || '').join('');

      let parsed;
      try {
        parsed = JSON.parse(rawText.replace(/```json|```/g, '').trim());
      } catch {
        return NextResponse.json({ error: 'Claude returned invalid JSON. Please try again.' }, { status: 502 });
      }

      if (!parsed.description || !Array.isArray(parsed.benefits)) {
        return NextResponse.json({ error: 'Incomplete AI response. Please regenerate.' }, { status: 502 });
      }

      // Save all AI fields to Supabase products table
      const saved = await sbFetch('PATCH', 'products', `id=eq.${productId}`, {
        ai_description:    parsed.description,
        ai_health_benefits: JSON.stringify(parsed.benefits),
        ai_how_to_use:     JSON.stringify(parsed.how_to_use   || []),
        ai_storage_tips:   JSON.stringify(parsed.storage_tips || []),
        ai_who_should_buy: parsed.who_should_buy || null,
        ai_generated_at:   new Date().toISOString(),
        ai_provider:       'claude',
      });

      return NextResponse.json({ success: true, data: parsed, saved });
    }

    // ── Generate SEO content with AI ───────────────────────────
    if (body.action === 'generate_seo') {
      const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
      if (!ANTHROPIC_KEY)
        return NextResponse.json({ error: 'ANTHROPIC_API_KEY not set in Vercel environment variables' }, { status: 500 });

      const { siteName, productNames } = body;
      const prompt =
        `You are an SEO expert for an Indian e-commerce store called "${siteName || '5 Pahadi Roots'}".\n` +
        `Store: Sells pure Himalayan natural products sourced directly from mountain farmers.\n` +
        `Products: ${productNames || 'wild honey, A2 ghee, Kashmiri saffron, Himalayan herbs, spices, teas, grains'}\n` +
        `Ships Pan India. Free shipping above ₹799. Target: health-conscious Indians.\n\n` +
        `Generate optimized SEO. Respond ONLY with valid JSON, no markdown, no extra text:\n` +
        `{"meta_title":"60 chars max, include brand name and main keyword","meta_description":"150 chars max, compelling, include keywords naturally, mention Pan India delivery","meta_keywords":"15-20 comma-separated keywords, mix Hindi-English, include real product names","suggestion":"One actionable sentence to further improve SEO for this store"}`;

      try {
        const aiResp = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 800, messages: [{ role: 'user', content: prompt }] }),
        });
        if (!aiResp.ok) { const err = await aiResp.text(); return NextResponse.json({ error: `AI error: ${aiResp.status} — ${err}` }, { status: 502 }); }
        const aiData = await aiResp.json();
        const text = (aiData.content || []).map(b => b.text || '').join('').trim();
        const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
        return NextResponse.json({ success: true, seo: parsed });
      } catch (e) {
        return NextResponse.json({ error: 'SEO generation failed: ' + (e.message || e) }, { status: 500 });
      }
    }

    // ── Send status email ──────────────────────────────────────
    if (body.action === 'send_status_email') {
      if (!['owner','manager'].includes(role))
        return NextResponse.json({ error: 'Access denied' }, { status: 403 });
      const { to, status, orderNumber, orderId, name, trackingNumber, courier, totalAmount, subtotal, shippingCharge, discount, address, city, state, postal, items } = body;
      if (!to || !status || !orderNumber) return NextResponse.json({ error: 'to, status, orderNumber required' }, { status: 400 });
      try {
        const { subject, html } = buildStatusEmail({ status, orderNumber, orderId, name, trackingNumber, courier, totalAmount, subtotal, shippingCharge, discount, address, city, state, postal, items });
        await sendEmail(to, subject, html);
        return NextResponse.json({ success: true });
      } catch(e) {
        // Non-fatal — log but don't fail the order update
        console.warn('Email send failed:', e.message);
        return NextResponse.json({ success: false, error: e.message });
      }
    }

    // ── Normal table CRUD ──────────────────────────────────────
    const { method, table, query, body: rowBody } = body;
    if (!table || !ALLOWED_TABLES.has(table))
      return NextResponse.json({ error: `Table "${table}" not permitted` }, { status: 400 });

    if (role === 'packing' && !PACKING_ALLOWED.has(table))
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    if (role === 'manager' && MANAGER_RESTRICTED.has(table) && method !== 'GET')
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    if (role === 'packing' && !['GET','PATCH'].includes(method))
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });

    // Vendor: restricted to their own data only
    if (role === 'vendor') {
      if (!VENDOR_ALLOWED.has(table))
        return NextResponse.json({ error: 'Access denied' }, { status: 403 });
      // Vendors can only GET categories/states (reference data), not mutate them
      if (['categories','states'].includes(table) && method !== 'GET')
        return NextResponse.json({ error: 'Access denied' }, { status: 403 });
      // Storage upload allowed for vendors (product images/videos)
    }

    const data = await sbFetch(method, table, query, rowBody);
    return NextResponse.json(data);
  } catch (e) {
    console.error('Admin API error:', e.message);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
