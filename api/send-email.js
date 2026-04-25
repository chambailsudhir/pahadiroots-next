// ═══════════════════════════════════════════════════════════════
// 5 Pahadi Roots — Email Service (Vercel Serverless Function)
// Types: order_confirmation | admin_new_order | order_shipped | order_cancelled
// File path: api/send-email.js
// ═══════════════════════════════════════════════════════════════

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const RESEND_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_KEY) return res.status(500).json({ error: 'Email service not configured' });

  let body = {};
  try { body = req.body || {}; if (typeof body === 'string') body = JSON.parse(body); }
  catch(e) { return res.status(400).json({ error: 'Invalid JSON' }); }

  // ── Load site_settings from Supabase ──
  let dbSettings = {};
  try {
    const sbRes = await fetch(`${process.env.SUPABASE_URL}/rest/v1/site_settings?select=key,value`, {
      headers: { 'apikey': process.env.SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}` }
    });
    if (sbRes.ok) { const rows = await sbRes.json(); (rows||[]).forEach(r => { dbSettings[r.key] = r.value; }); }
  } catch(e) { /* non-critical — fall back to defaults */ }

  // ── If order emails are disabled in Settings, skip (except admin notifications) ──
  if (dbSettings.order_email_enabled === 'false' && body.type !== 'admin_new_order') {
    return res.status(200).json({ success: true, skipped: true, reason: 'order_email_enabled is off' });
  }

  const { type, to, orderNumber, orderId, name, items, total, discount, shipping,
          address, city, state, pin, payMethod, whatsappNumber, trackingNumber, courier, gstAmount } = body;

  // ── Admin email: DB setting overrides Vercel env ──
  const ADMIN_EMAIL  = dbSettings.admin_notify_email || process.env.ADMIN_NOTIFY_EMAIL || 'support@pahadiroots.com';
  const FOOTER_TEXT  = dbSettings.email_footer_text  || '© Pahadi Roots. All rights reserved.';
  const WA_NUMBER    = whatsappNumber || process.env.WHATSAPP_NUMBER || '919899984895';
  const WA_DISPLAY   = WA_NUMBER.replace(/^91/, '+91 ').replace(/(\d{5})(\d{5})$/, '$1 $2');
  const ORDER_URL    = `https://pahadiroots.com/order-confirmation?id=${orderId}&num=${encodeURIComponent(orderNumber||'')}`;

  if (!type) return res.status(400).json({ error: 'Email type required' });

  // ── Shared helpers ──
  function itemsTable(items) {
    return (items || []).map(i =>
      `<tr>
        <td style="padding:10px 0;border-bottom:1px solid #f0f0f0">
          <span style="font-size:16px">${i.emoji || '🌿'}</span>
          <strong style="color:#1a1a1a;margin-left:8px">${i.name}</strong>
          <span style="color:#888;font-size:13px"> × ${i.qty}</span>
        </td>
        <td style="padding:10px 0;border-bottom:1px solid #f0f0f0;text-align:right;font-weight:700;color:#1a3a1e">
          ₹${(i.price * i.qty).toLocaleString('en-IN')}
        </td>
      </tr>`
    ).join('');
  }

  function emailWrapper(innerHtml) {
    return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f7f3ee;font-family:'Helvetica Neue',Arial,sans-serif">
<div style="max-width:580px;margin:0 auto;padding:24px 16px">
  <div style="background:linear-gradient(135deg,#1a3a1e,#2d5233);border-radius:16px 16px 0 0;padding:28px 32px;text-align:center">
    <div style="font-size:32px;margin-bottom:6px">🌿</div>
    <div style="font-family:Georgia,serif;font-size:22px;font-weight:900;color:#fff;margin-bottom:3px">5 Pahadi Roots</div>
    <div style="font-size:11px;color:rgba(255,255,255,.6);letter-spacing:2px;text-transform:uppercase">Himalayan Natural Store</div>
  </div>
  ${innerHtml}
  <div style="background:#1a3a1e;border-radius:0 0 16px 16px;padding:18px 32px;text-align:center">
    <div style="color:rgba(255,255,255,.5);font-size:12px;line-height:1.8">
      🌿 5 Pahadi Roots — Pure Himalayan Goodness<br>
      <a href="https://pahadiroots.com" style="color:#e8b84b;text-decoration:none">pahadiroots.com</a>
      &nbsp;·&nbsp;
      <a href="https://wa.me/${WA_NUMBER}" style="color:#e8b84b;text-decoration:none">WhatsApp Us</a><br>
      <span style="font-size:11px;opacity:0.7">${FOOTER_TEXT}</span>
    </div>
  </div>
</div>
</body></html>`;
  }

  let subject, html, sendTo;

  // ══════════════════════════════════════════════════════════
  // 1. ORDER CONFIRMATION — customer email
  // ══════════════════════════════════════════════════════════
  if (type === 'order_confirmation') {
    if (!to || !to.includes('@')) return res.status(400).json({ error: 'Valid customer email required' });
    sendTo = [to];
    const estDate = getDeliveryEstimate();
    const gstRow = (gstAmount > 0)
      ? `<tr><td style="padding:6px 0;color:#888;font-size:12px">↳ GST included</td><td style="text-align:right;color:#888;font-size:12px">₹${gstAmount}</td></tr>` : '';
    const discountRow = (discount > 0)
      ? `<tr><td style="padding:6px 0;color:#2d6a4f;font-weight:700">🎉 Discount</td><td style="text-align:right;color:#2d6a4f;font-weight:700">−₹${discount}</td></tr>` : '';
    const shipRow = (shipping > 0)
      ? `<tr><td style="padding:6px 0;color:#555">Shipping</td><td style="text-align:right;color:#555">₹${shipping}</td></tr>`
      : `<tr><td style="padding:6px 0;color:#2d6a4f;font-weight:700">Shipping</td><td style="text-align:right;color:#2d6a4f;font-weight:700">FREE 🎉</td></tr>`;
    const payLabel = payMethod === 'razorpay_online' ? '💳 Paid Online' : '💵 Cash on Delivery';

    subject = `Order Confirmed — ${orderNumber || 'Your 5 Pahadi Roots Order'} 🌿`;
    html = emailWrapper(`
      <div style="background:#fff;padding:28px 32px;text-align:center;border-left:1px solid #eee;border-right:1px solid #eee">
        <div style="font-size:44px;margin-bottom:10px">✅</div>
        <h1 style="font-family:Georgia,serif;font-size:24px;color:#1a3a1e;margin:0 0 8px">Order Confirmed!</h1>
        <p style="color:#666;font-size:14px;margin:0 0 16px">Thank you ${name || ''}! Your mountain goodness is on its way 🌿</p>
        <div style="display:inline-block;background:#f0f7f4;border:1.5px solid #c8e6c9;border-radius:20px;padding:8px 20px">
          <span style="font-size:13px;font-weight:700;color:#1a3a1e">📋 ${orderNumber || 'Order Placed'}</span>
        </div>
      </div>
      <div style="background:#fff9e6;border-left:4px solid #c8920a;padding:16px 32px;border-right:1px solid #eee">
        <strong style="color:#1a3a1e">🚚 Estimated Delivery: ${estDate}</strong><br>
        <span style="color:#888;font-size:12px">Pan India · We'll notify you when shipped</span>
      </div>
      <div style="background:#fff;padding:24px 32px;border-left:1px solid #eee;border-right:1px solid #eee">
        <h3 style="font-size:12px;font-weight:800;color:#aaa;text-transform:uppercase;letter-spacing:1px;margin:0 0 16px">Your Items</h3>
        <table style="width:100%;border-collapse:collapse">
          ${itemsTable(items)}
          ${gstRow}${discountRow}${shipRow}
          <tr style="border-top:2px solid #eee">
            <td style="padding:12px 0 0;font-weight:900;font-size:15px;color:#1a1a1a">Total</td>
            <td style="padding:12px 0 0;text-align:right;font-weight:900;font-size:17px;color:#1a3a1e">₹${(total||0).toLocaleString('en-IN')}</td>
          </tr>
          <tr><td colspan="2" style="padding:4px 0;font-size:12px;color:#888">${payLabel}</td></tr>
        </table>
      </div>
      <div style="background:#f9f9f9;padding:18px 32px;border-left:1px solid #eee;border-right:1px solid #eee">
        <h3 style="font-size:12px;font-weight:800;color:#aaa;text-transform:uppercase;letter-spacing:1px;margin:0 0 10px">📍 Delivering To</h3>
        <div style="color:#333;font-size:14px;line-height:1.7"><strong>${name||''}</strong><br>${address||''}, ${city||''}<br>${state||''} — ${pin||''}</div>
      </div>
      <div style="background:#fff;padding:24px 32px;text-align:center;border-left:1px solid #eee;border-right:1px solid #eee">
        <a href="${ORDER_URL}" style="display:inline-block;background:linear-gradient(135deg,#1a3a1e,#2d5233);color:#fff;padding:13px 30px;border-radius:12px;text-decoration:none;font-weight:800;font-size:14px">📦 Track Your Order</a>
        <p style="color:#aaa;font-size:12px;margin-top:14px">Questions? WhatsApp: <a href="https://wa.me/${WA_NUMBER}" style="color:#1a3a1e">${WA_DISPLAY}</a></p>
      </div>`);

  // ══════════════════════════════════════════════════════════
  // 2. ADMIN NEW ORDER NOTIFICATION
  // ══════════════════════════════════════════════════════════
  } else if (type === 'admin_new_order') {
    sendTo = [ADMIN_EMAIL];
    const payLabel = payMethod === 'razorpay_online' ? '💳 Online Paid' : '💵 COD';
    const itemsList = (items || []).map(i => `${i.emoji||'🌿'} ${i.name} × ${i.qty} — ₹${i.price * i.qty}`).join('<br>');

    subject = `🛍️ New Order ${orderNumber} — ₹${total} (${payLabel})`;
    html = emailWrapper(`
      <div style="background:#fff;padding:24px 32px;border-left:1px solid #eee;border-right:1px solid #eee">
        <div style="background:#e8f5e9;border-left:4px solid #2d5233;padding:14px 18px;border-radius:0 8px 8px 0;margin-bottom:20px">
          <div style="font-size:18px;font-weight:900;color:#1a3a1e">🛒 New Order Received!</div>
          <div style="font-size:13px;color:#555;margin-top:4px">${orderNumber} · ${payLabel} · ₹${(total||0).toLocaleString('en-IN')}</div>
        </div>
        <table style="width:100%;border-collapse:collapse;font-size:14px">
          <tr><td style="padding:6px 0;color:#888;width:120px">Customer</td><td style="font-weight:700;color:#1a1a1a">${name||'—'}</td></tr>
          <tr><td style="padding:6px 0;color:#888">Address</td><td style="color:#333">${address||''}, ${city||''}, ${state||''} — ${pin||''}</td></tr>
          <tr><td style="padding:6px 0;color:#888">Payment</td><td style="font-weight:700;color:${payMethod==='razorpay_online'?'#2d6a4f':'#c8920a'}">${payLabel}</td></tr>
          <tr><td style="padding:6px 0;color:#888">Items</td><td style="color:#333;line-height:1.8">${itemsList}</td></tr>
          <tr style="border-top:1px solid #eee"><td style="padding:10px 0;color:#888">Total</td><td style="font-weight:900;font-size:16px;color:#1a3a1e">₹${(total||0).toLocaleString('en-IN')}</td></tr>
        </table>
        <div style="margin-top:20px;text-align:center">
          <a href="https://pahadiroots.com/admin" style="display:inline-block;background:#1a3a1e;color:#fff;padding:11px 26px;border-radius:10px;text-decoration:none;font-weight:800;font-size:13px">Open Admin Panel →</a>
        </div>
      </div>`);

  // ══════════════════════════════════════════════════════════
  // 3. ORDER SHIPPED — customer email
  // ══════════════════════════════════════════════════════════
  } else if (type === 'order_shipped') {
    if (!to || !to.includes('@')) return res.status(400).json({ error: 'Valid customer email required' });
    sendTo = [to];
    const trackInfo = trackingNumber
      ? `<div style="background:#e8f5e9;border-left:4px solid #2d6a4f;padding:14px 18px;border-radius:0 8px 8px 0;margin:16px 0">
           <div style="font-weight:700;color:#1a3a1e">🔍 Tracking Number: ${trackingNumber}</div>
           ${courier ? `<div style="color:#555;font-size:12px;margin-top:4px">Courier: ${courier}</div>` : ''}
         </div>` : '';

    subject = `Your order is on its way! 🚚 — ${orderNumber}`;
    html = emailWrapper(`
      <div style="background:#fff;padding:28px 32px;text-align:center;border-left:1px solid #eee;border-right:1px solid #eee">
        <div style="font-size:44px;margin-bottom:10px">🚚</div>
        <h1 style="font-family:Georgia,serif;font-size:24px;color:#1a3a1e;margin:0 0 8px">Your Order is Shipped!</h1>
        <p style="color:#666;font-size:14px;margin:0 0 6px">Order <strong>${orderNumber}</strong> has been dispatched.</p>
        <p style="color:#888;font-size:13px;margin:0">Estimated delivery: ${getDeliveryEstimate()}</p>
        ${trackInfo}
        <div style="margin-top:20px">
          <a href="${ORDER_URL}" style="display:inline-block;background:linear-gradient(135deg,#1a3a1e,#2d5233);color:#fff;padding:13px 30px;border-radius:12px;text-decoration:none;font-weight:800;font-size:14px">📦 Track Order</a>
        </div>
        <p style="color:#aaa;font-size:12px;margin-top:16px">Questions? <a href="https://wa.me/${WA_NUMBER}" style="color:#1a3a1e">WhatsApp ${WA_DISPLAY}</a></p>
      </div>`);

  // ══════════════════════════════════════════════════════════
  // 4. ORDER CANCELLED — customer email
  // ══════════════════════════════════════════════════════════
  } else if (type === 'order_cancelled') {
    if (!to || !to.includes('@')) return res.status(400).json({ error: 'Valid customer email required' });
    sendTo = [to];
    subject = `Order Cancelled — ${orderNumber} | Refund Info`;
    html = emailWrapper(`
      <div style="background:#fff;padding:28px 32px;text-align:center;border-left:1px solid #eee;border-right:1px solid #eee">
        <div style="font-size:44px;margin-bottom:10px">❌</div>
        <h1 style="font-family:Georgia,serif;font-size:24px;color:#c0392b;margin:0 0 8px">Order Cancelled</h1>
        <p style="color:#666;font-size:14px;margin:0 0 16px">Your order <strong>${orderNumber}</strong> has been cancelled.</p>
        <div style="background:#fef9f9;border:1.5px solid #fadbd8;border-radius:12px;padding:16px 20px;text-align:left;margin-bottom:20px">
          <div style="font-weight:700;color:#c0392b;margin-bottom:8px">💰 Refund Information</div>
          <div style="color:#555;font-size:13px;line-height:1.8">
            • Prepaid orders: Refund to original payment method<br>
            • Timeline: 7–10 business days after approval<br>
            • COD: No charge collected
          </div>
        </div>
        <p style="color:#888;font-size:13px">Need help? <a href="https://wa.me/${WA_NUMBER}" style="color:#1a3a1e;font-weight:700">WhatsApp ${WA_DISPLAY}</a></p>
        <a href="https://pahadiroots.com" style="display:inline-block;background:#1a3a1e;color:#fff;padding:12px 28px;border-radius:12px;text-decoration:none;font-weight:800;font-size:14px;margin-top:8px">← Continue Shopping</a>
      </div>`);

  // ══════════════════════════════════════════════════════════
  // 5. ORDER STATUS UPDATE — packed / confirmed / delivered
  // ══════════════════════════════════════════════════════════
  } else if (type === 'order_status_update') {
    if (!to || !to.includes('@')) return res.status(400).json({ error: 'Valid customer email required' });
    sendTo = [to];
    const statusInfo = {
      confirmed:  { icon: '✅', title: 'Order Confirmed!',     msg: 'Your order has been confirmed and will be processed soon.' },
      packed:     { icon: '📦', title: 'Order Packed!',        msg: 'Your order has been packed and is ready for dispatch.' },
      delivered:  { icon: '🎉', title: 'Order Delivered!',     msg: 'Your order has been delivered. Enjoy your Himalayan goodness!' },
      processing: { icon: '⚙️', title: 'Order Processing',    msg: 'Your order is being processed.' },
    };
    const info = statusInfo[body.status] || { icon: '📋', title: 'Order Update', msg: 'Your order status has been updated.' };

    subject = `${info.icon} ${info.title} — ${orderNumber}`;
    html = emailWrapper(`
      <div style="background:#fff;padding:28px 32px;text-align:center;border-left:1px solid #eee;border-right:1px solid #eee">
        <div style="font-size:44px;margin-bottom:10px">${info.icon}</div>
        <h1 style="font-family:Georgia,serif;font-size:24px;color:#1a3a1e;margin:0 0 8px">${info.title}</h1>
        <p style="color:#666;font-size:14px;margin:0 0 16px">${info.msg}</p>
        <div style="display:inline-block;background:#f0f7f4;border:1.5px solid #c8e6c9;border-radius:20px;padding:8px 20px;margin-bottom:20px">
          <span style="font-size:13px;font-weight:700;color:#1a3a1e">📋 ${orderNumber || ''}</span>
        </div>
        <br>
        <a href="${ORDER_URL}" style="display:inline-block;background:linear-gradient(135deg,#1a3a1e,#2d5233);color:#fff;padding:13px 30px;border-radius:12px;text-decoration:none;font-weight:800;font-size:14px">📦 View Order Details</a>
        <p style="color:#aaa;font-size:12px;margin-top:16px">Questions? <a href="https://wa.me/${WA_NUMBER}" style="color:#1a3a1e">WhatsApp ${WA_DISPLAY}</a></p>
      </div>`);

  } else {
    return res.status(400).json({ error: `Unknown email type: ${type}` });
  }

  // ── Send via Resend ──
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_KEY}` },
      body: JSON.stringify({ from: '5 Pahadi Roots <noreply@pahadiroots.com>', to: sendTo, subject, html })
    });
    const data = await r.json();
    if (!r.ok) return res.status(500).json({ error: data.message || 'Email send failed' });
    return res.status(200).json({ success: true, id: data.id });
  } catch(e) {
    return res.status(500).json({ error: e.message || 'Email service error' });
  }
}

function getDeliveryEstimate() {
  var d = new Date();
  var added = 0;
  while (added < 5) { d.setDate(d.getDate() + 1); if (d.getDay() !== 0 && d.getDay() !== 6) added++; }
  var from = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'long' });
  d.setDate(d.getDate() + 2);
  var to = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'long' });
  return from + ' – ' + to;
}
