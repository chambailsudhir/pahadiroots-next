// ═══════════════════════════════════════════════════════════════
// 5 Pahadi Roots — Razorpay Webhook Handler
// Version: 1.0
// File path: api/razorpay-webhook.js
//
// Razorpay → POST /api/razorpay-webhook → verify signature → save order
//
// ENV VARS NEEDED:
//   RAZORPAY_WEBHOOK_SECRET  — from Razorpay Dashboard → Webhooks
//   SUPABASE_URL
//   SUPABASE_SERVICE_KEY
// ═══════════════════════════════════════════════════════════════

import crypto from 'crypto';

export const config = {
  api: {
    bodyParser: false, // MUST be false — we need raw body for signature verification
  },
};

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET;

// ── Read raw body (needed for HMAC signature check) ──────────
async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

// ── Supabase helper ──────────────────────────────────────────
async function sbFetch(method, table, query = '', body = null) {
  let url = `${SUPABASE_URL}/rest/v1/${table}`;
  if (query) url += `?${query}`;
  const r = await fetch(url, {
    method,
    headers: {
      'apikey':        SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type':  'application/json',
      'Prefer':        'return=representation',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`Supabase ${table} ${method}: ${text}`);
  return text ? JSON.parse(text) : null;
}

// ── Check if order already exists (idempotency) ──────────────
async function orderAlreadyExists(paymentId) {
  try {
    const rows = await sbFetch('GET', 'orders', `payment_id=eq.${paymentId}&select=id`);
    return rows && rows.length > 0;
  } catch (e) {
    return false;
  }
}

// ── Save order from webhook payload ─────────────────────────
async function saveOrderFromWebhook(payment) {
  const paymentId = payment.id;
  const amount    = payment.amount / 100; // paise → rupees
  const notes     = payment.notes || {};

  // Parse customer info from Razorpay notes/contact
  const name    = notes.name    || payment.contact || 'Customer';
  const phone   = payment.contact || notes.phone || '';
  const email   = payment.email  || notes.email  || null;
  const address = notes.address  || '';

  // Parse address — format: "street, city, state - pin"
  // Bug #11 fix: parse from the RIGHT so multi-comma streets like
  // "Flat 4, Block B, MG Road, Delhi - 110001" are handled correctly.
  let addr = '', city = '', state = '', pin = '';
  try {
    // Step 1: split on " - " (space-dash-space) to extract pincode from the right
    const dashIdx = address.lastIndexOf(' - ');
    let remainder = address;
    if (dashIdx !== -1) {
      const pinCandidate = address.slice(dashIdx + 3).trim();
      if (/^\d{6}$/.test(pinCandidate)) {
        pin = pinCandidate;
        remainder = address.slice(0, dashIdx).trim();
      }
    }
    // Step 2: split remainder on last comma to get state
    const lastComma = remainder.lastIndexOf(',');
    if (lastComma !== -1) {
      state = remainder.slice(lastComma + 1).trim();
      remainder = remainder.slice(0, lastComma).trim();
    }
    // Step 3: split again on last comma to get city
    const secLastComma = remainder.lastIndexOf(',');
    if (secLastComma !== -1) {
      city = remainder.slice(secLastComma + 1).trim();
      addr = remainder.slice(0, secLastComma).trim();
    } else {
      // Only one segment left — treat as street
      addr = remainder;
    }
    // Fallback: if nothing matched, store full address as street
    if (!addr && !city && !state) addr = address;
  } catch(e) {}

  // 1. Upsert customer
  const nameParts = name.trim().split(' ');
  const firstName = nameParts[0] || 'Customer';
  const lastName  = nameParts.slice(1).join(' ') || null;
  const custBody  = {
    first_name:    firstName,
    last_name:     lastName,
    phone:         phone || null,
    email:         email || null,
    address_line1: addr  || null,
    city:          city  || null,
    state:         state || null,
    postal_code:   pin   || null,
  };

  let custId = null;
  if (phone) {
    const existing = await sbFetch('GET', 'customers', `phone=eq.${encodeURIComponent(phone)}&select=id`).catch(() => []);
    if (existing && existing.length > 0) {
      custId = existing[0].id;
      await sbFetch('PATCH', 'customers', `id=eq.${custId}`, custBody).catch(() => {});
    }
  }
  if (!custId) {
    const nc = await sbFetch('POST', 'customers', '', custBody);
    custId = nc && nc[0] ? nc[0].id : null;
  }
  if (!custId) throw new Error('Could not create customer');

  // 2. Create order
  const orderBody = {
    customer_id:     custId,
    total_amount:    amount,
    subtotal:        amount,
    coupon_discount: 0,
    tax:             0,
    shipping_charge: 0,
    order_status:    'confirmed',
    payment_status:  'paid',
    payment_method:  'razorpay_online',
    payment_id:      paymentId,
  };
  const newOrder   = await sbFetch('POST', 'orders', '', orderBody);
  const orderId    = newOrder && newOrder[0] ? newOrder[0].id : null;
  const orderNumber = newOrder && newOrder[0] ? newOrder[0].order_number : null;
  if (!orderId) throw new Error('Could not create order');

  // 3. Save order_items — webhook has no cart data from Razorpay payload
  // items[] in notes field if passed, otherwise create a placeholder so DB trigger doesn't block
  let notesItems = null;
  try { notesItems = payment.notes?.items ? JSON.parse(payment.notes.items) : null; } catch(e) { notesItems = null; }
  if (Array.isArray(notesItems) && notesItems.length > 0) {
    // items were passed via Razorpay notes — save them
    const orderItems = notesItems.map(i => ({
      order_id:       orderId,
      product_id:     i.id     || null,
      variant_id:     i.variantId || null,
      quantity:       i.qty    || 1,
      price_at_time:  i.price  || 0,
    }));
    await sbFetch('POST', 'order_items', '', orderItems).catch(e => {
      console.warn('[Webhook] order_items insert failed:', e.message);
    });
  } else {
    // No cart data in webhook — log for manual review
    console.warn(`[Webhook] No items data for order ${orderNumber} (payment: ${paymentId}) — admin must add items manually`);
    await sbFetch('POST', 'admin_logs', '', {
      table_name:  'order_items',
      action:      'WEBHOOK_MISSING_ITEMS',
      record_id:   orderId,
      admin_email: 'webhook@razorpay',
    }).catch(() => {});
  }

  // 4. Save order_status_history
  await sbFetch('POST', 'order_status_history', '', {
    order_id:   orderId,
    old_status: 'new',
    new_status: 'confirmed',
    changed_at: new Date().toISOString(),
    notes:      `Webhook — payment_id: ${paymentId}`,
  }).catch(() => {});

  // 5. Log to admin_logs
  await sbFetch('POST', 'admin_logs', '', {
    table_name:  'orders',
    action:      'WEBHOOK_CREATE',
    record_id:   orderId,
    admin_email: 'webhook@razorpay',
  }).catch(() => {});

  console.log(`[Webhook] Order saved: ${orderNumber} | payment: ${paymentId} | ₹${amount}`);
  return { orderId, orderNumber };
}

// ══════════════════════════════════════════════════════════════
// MAIN HANDLER
// ══════════════════════════════════════════════════════════════
export default async function handler(req, res) {
  // Only POST allowed
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('[Webhook] Missing Supabase env vars');
    return res.status(500).json({ error: 'Server misconfigured' });
  }

  // ── 1. Read raw body ──────────────────────────────────────
  let rawBody = '';
  try {
    rawBody = await getRawBody(req);
  } catch (e) {
    return res.status(400).json({ error: 'Could not read body' });
  }

  // ── 2. Verify Razorpay signature ─────────────────────────
  // Razorpay sends: X-Razorpay-Signature header
  // We verify: HMAC-SHA256(rawBody, WEBHOOK_SECRET) === signature
  const signature = req.headers['x-razorpay-signature'];

  // WEBHOOK_SECRET is required — reject all requests if not configured
  if (!WEBHOOK_SECRET) {
    console.error('[Webhook] RAZORPAY_WEBHOOK_SECRET not set — rejecting request for security');
    return res.status(500).json({ error: 'Webhook secret not configured' });
  }
  if (!signature) {
    console.warn('[Webhook] Missing x-razorpay-signature header');
    return res.status(400).json({ error: 'Missing signature' });
  }
  const expectedSig = crypto
    .createHmac('sha256', WEBHOOK_SECRET)
    .update(rawBody)
    .digest('hex');
  if (expectedSig !== signature) {
    console.warn('[Webhook] Signature mismatch — possible fake/spoofed request');
    return res.status(400).json({ error: 'Invalid signature' });
  }

  // ── 3. Parse event ────────────────────────────────────────
  let event;
  try {
    event = JSON.parse(rawBody);
  } catch (e) {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  const eventType = event.event;
  console.log(`[Webhook] Event received: ${eventType}`);

  // ── 4. Handle payment.captured ───────────────────────────
  // This fires when payment is successfully captured
  if (eventType === 'payment.captured') {
    const payment = event.payload?.payment?.entity;
    if (!payment) {
      return res.status(400).json({ error: 'Missing payment entity' });
    }

    const paymentId = payment.id;

    // ── Idempotency check — don't save duplicate orders ──
    const exists = await orderAlreadyExists(paymentId);
    if (exists) {
      console.log(`[Webhook] Order already exists for payment ${paymentId} — skipping`);
      return res.status(200).json({ status: 'already_processed' });
    }

    try {
      const result = await saveOrderFromWebhook(payment);
      return res.status(200).json({ status: 'ok', ...result });
    } catch (e) {
      console.error('[Webhook] saveOrderFromWebhook failed:', e.message);
      // Return 200 to Razorpay so it doesn't retry infinitely
      // But log the error for manual review
      return res.status(200).json({ status: 'error_logged', error: e.message });
    }
  }

  // ── 5. Handle payment.failed ─────────────────────────────
  if (eventType === 'payment.failed') {
    const payment = event.payload?.payment?.entity;
    console.log(`[Webhook] Payment failed: ${payment?.id} | reason: ${payment?.error_description}`);
    // Log to admin_logs for visibility
    await sbFetch('POST', 'admin_logs', '', {
      table_name:  'orders',
      action:      'PAYMENT_FAILED',
      record_id:   null,
      admin_email: 'webhook@razorpay',
    }).catch(() => {});
    return res.status(200).json({ status: 'logged' });
  }

  // ── 6. Other events — acknowledge and ignore ─────────────
  return res.status(200).json({ status: 'ignored', event: eventType });
}
