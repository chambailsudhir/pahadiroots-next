// ═══════════════════════════════════════════════════════════════
// 5 Pahadi Roots — Admin API (Vercel Serverless Function)
// Version: 2.2 — Secure storage upload + increased body limit
// File path: api/admin-api.js
// ═══════════════════════════════════════════════════════════════

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '6mb', // base64 of a 4MB image ≈ 5.3MB
    },
  },
};

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY || !process.env.ADMIN_PASSWORD) {
  console.error('FATAL: Missing required environment variables');
}

const SUPABASE_URL   = process.env.SUPABASE_URL;
const SUPABASE_KEY   = process.env.SUPABASE_SERVICE_KEY;
const ADMIN_PW       = process.env.ADMIN_PASSWORD;

const ALLOWED_TABLES = new Set([
  'products', 'categories', 'orders', 'order_items', 'customers',
  'coupons', 'coupon_usage', 'subscribers', 'reviews',
  'inventory_logs', 'order_logs', 'order_status_history',
  'admin_logs', 'order_detailed', 'order_summary', 'site_settings',
  'revenue_summary', 'states', 'sales_summary', 'stock_overview', 'daily_revenue',
  'state_images', 'product_images', 'founder_images',
  'product_variants', 'team_members', 'returns', 'stock_movements', 'abandoned_carts', 'channel_inventory', 'channels', 'inventory_overview', 'warehouses',
]);

const WRITE_METHODS = new Set(['POST', 'PATCH', 'DELETE']);

// ── General rate limit — all requests (200 per 30s per IP) ──
const rateLimitMap = new Map();
const RATE_LIMIT   = 200;
const RATE_WINDOW  = 30000;

function isRateLimited(ip) {
  const now   = Date.now();
  const entry = rateLimitMap.get(ip) || { count: 0, start: now };
  if (now - entry.start > RATE_WINDOW) { rateLimitMap.set(ip, { count: 1, start: now }); return false; }
  if (entry.count >= RATE_LIMIT) return true;
  entry.count++;
  rateLimitMap.set(ip, entry);
  return false;
}

// ── Login brute-force protection — 10 failed attempts → 15-min lockout ──
const loginFailMap  = new Map();
const MAX_FAILURES  = 10;
const LOCKOUT_MS    = 15 * 60 * 1000; // 15 minutes

function isLoginLocked(ip) {
  const entry = loginFailMap.get(ip);
  if (!entry) return false;
  if (entry.lockedUntil && Date.now() < entry.lockedUntil) return true;
  if (entry.lockedUntil && Date.now() >= entry.lockedUntil) {
    loginFailMap.delete(ip); // lockout window expired — fully reset
  }
  return false;
}

function recordLoginFailure(ip) {
  const now   = Date.now();
  const entry = loginFailMap.get(ip) || { failures: 0, lockedUntil: 0 };
  entry.failures++;
  if (entry.failures >= MAX_FAILURES) {
    entry.lockedUntil = now + LOCKOUT_MS;
    entry.failures    = 0; // reset counter after locking
  }
  loginFailMap.set(ip, entry);
}

function clearLoginFailures(ip) {
  loginFailMap.delete(ip);
}

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
  if (!r.ok) throw { status: r.status, message: text };
  return text ? JSON.parse(text) : null;
}

async function logAdminAction(table, method, recordId = null) {
  try {
    await sbFetch('POST', 'admin_logs', '', {
      table_name:  table,
      action:      method,
      record_id:   recordId || null,
      admin_email: 'admin@pahadiroots.com',
    });
  } catch (e) {
    console.warn('Admin log failed (non-critical):', e.message || e);
  }
}

// ═══════════════════════════════════════════════════════════════
// MAIN HANDLER
// ═══════════════════════════════════════════════════════════════
export default async function handler(req, res) {

  const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || 'https://pahadiroots.com';

  // ── CORS headers helper ──
  function setCORS() {
    res.setHeader('Access-Control-Allow-Origin',  ALLOWED_ORIGIN);
    res.setHeader('Vary',                         'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-password');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Content-Type',                 'application/json');
    res.setHeader('X-Content-Type-Options',       'nosniff');
    res.setHeader('X-Frame-Options',              'DENY');
    // Prevent Vercel edge / CDN / browser from caching API responses
    res.setHeader('Cache-Control',                'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma',                       'no-cache');
    res.setHeader('Surrogate-Control',            'no-store');
  }

  const ok  = (data)    => { setCORS(); return res.status(200).json(data); };
  const err = (s, msg)  => { setCORS(); return res.status(s).json({ error: msg }); };

  setCORS();
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST')   return err(405, 'Method not allowed');

  if (!SUPABASE_URL || !SUPABASE_KEY || !ADMIN_PW) {
    return err(500, 'Server misconfigured — check environment variables');
  }

  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || 'unknown';
  if (isRateLimited(ip)) return err(429, 'Too many requests — slow down');

  // ── Parse request body ──
  let reqBody = {};
  try {
    reqBody = req.body || {};
    if (typeof reqBody === 'string') reqBody = JSON.parse(reqBody);
  } catch (e) {
    return err(400, 'Invalid JSON body');
  }

  const pw = req.headers['x-admin-password'] || '';
  const isPublicAction = reqBody.action === 'save_order' || reqBody.action === 'public_get_order' || reqBody.action === 'check_stock';

  if (!isPublicAction) {
    // Check login lockout first
    if (isLoginLocked(ip)) {
      return err(429, 'Too many failed attempts — try again in 15 minutes');
    }
    // Validate password
    if (!pw || pw.length !== ADMIN_PW.length || pw !== ADMIN_PW) {
      recordLoginFailure(ip);
      return err(401, 'Unauthorized');
    }
    // Correct password — clear any failure history
    clearLoginFailures(ip);
  }

  const { method, table, query, body } = reqBody;

  // ── Storage Upload Handler ──
  if (reqBody.action === 'storage_upload') {
    try {
      const { fileName, fileType, fileBase64 } = reqBody;
      if (!fileName || !fileType || !fileBase64) return err(400, 'Missing fileName, fileType or fileBase64');
      const fileBuffer = Buffer.from(fileBase64, 'base64');
      const storageUrl = `${SUPABASE_URL}/storage/v1/object/pahadi-images/${fileName}`;
      const uploadRes  = await fetch(storageUrl, {
        method:  'POST',
        headers: { 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': fileType, 'x-upsert': 'true' },
        body:    fileBuffer,
      });
      if (!uploadRes.ok) { const t = await uploadRes.text(); return err(400, 'Storage upload failed: ' + t); }
      const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/pahadi-images/${fileName}`;
      return ok({ url: publicUrl });
    } catch (e) {
      return err(500, 'Storage error: ' + e.message);
    }
  }

  // ── Check Stock (public, no password) — used by frontend before checkout ──
  if (reqBody.action === 'check_stock') {
    try {
      const { items } = reqBody;
      if (!items || !items.length) return ok({ available: true });
      for (const item of items) {
        const qty = parseInt(item.qty) || 1;
        if (item.variantId) {
          const variant = await sbFetch('GET', 'product_variants',
            `id=eq.${item.variantId}&select=available_stock,variant_value,sku`
          ).catch(() => []);
          const available = variant && variant[0] ? (variant[0].available_stock || 0) : 0;
          if (available < qty) {
            const label = variant?.[0]?.variant_value || variant?.[0]?.sku || item.name || 'Item';
            return err(400, `Sorry, "${label}" is out of stock. Only ${available} left.`);
          }
        } else if (item.id) {
          const prod = await sbFetch('GET', 'products',
            `id=eq.${parseInt(item.id)}&select=available_stock,name`
          ).catch(() => []);
          const available = prod && prod[0] && prod[0].available_stock !== null
            ? Number(prod[0].available_stock) : 99;
          if (available < qty) {
            const label = (prod && prod[0] && prod[0].name) || item.name || 'Item';
            return err(400, `Sorry, "${label}" is out of stock. Only ${available} left.`);
          }
        }
      }
      return ok({ available: true });
    } catch(e) {
      return err(500, 'Stock check failed: ' + e.message);
    }
  }

  // ── Public Order Save (no password required) ──
  if (reqBody.action === 'save_order') {
    try {
      const { name, phone, email, addr, city, state, pin, final, discount, shipCharge, payMethod, paymentId, items, auth_user_id, gstAmount } = reqBody;
      if (!name || !phone || !final) return err(400, 'Missing required order fields');

      // 0. Stock + price validation — prevent overselling and price tampering
      // Always validate against DB — never trust frontend values
      if (items && items.length) {
        for (const item of items) {
          const qty = parseInt(item.qty) || 1;
          if (item.variantId) {
            // Validate variant stock + price
            const variant = await sbFetch('GET', 'product_variants',
              `id=eq.${item.variantId}&select=available_stock,sku,variant_value,price`
            ).catch(() => []);
            const v = variant && variant[0];
            if (!v) continue;
            const available = v.available_stock ?? 0;
            if (available < qty) {
              const label = v.sku || v.variant_value || item.name || `variant #${item.variantId}`;
              return err(400, `Sorry, "${label}" is out of stock. Only ${available} left.`);
            }
            if (v.price && item.price) {
              const dbPrice = parseFloat(v.price);
              const sentPrice = parseFloat(item.price);
              if (dbPrice > 0 && sentPrice < dbPrice * 0.9) {
                return err(400, `Price mismatch detected for "${item.name || 'item'}". Please refresh and try again.`);
              }
            }
          } else if (item.id) {
            // Validate base product stock + price
            try {
              const prod = await sbFetch('GET', 'products',
                `id=eq.${parseInt(item.id)}&select=price,name,available_stock`
              ).catch(() => []);
              const dbProd = prod && prod[0];
              if (dbProd) {
                const availStock = dbProd.available_stock !== null && dbProd.available_stock !== undefined
                  ? Number(dbProd.available_stock) : null;
                if (availStock !== null && availStock < qty) {
                  return err(400, `Sorry, "${item.name || dbProd.name}" is out of stock. Only ${availStock} left.`);
                }
                if (dbProd.price && item.price) {
                  const dbPrice = parseFloat(dbProd.price);
                  const sentPrice = parseFloat(item.price);
                  if (dbPrice > 0 && sentPrice < dbPrice * 0.9) {
                    return err(400, `Price mismatch for "${item.name || dbProd.name}". Please refresh and try again.`);
                  }
                }
              }
            } catch(e) { /* non-critical — proceed */ }
          }
        }
      }

      // 1. Upsert customer
      const nameParts = name.trim().split(' ');
      const firstName = nameParts[0] || name.trim();
      const lastName = nameParts.slice(1).join(' ') || null;
      const custBody = { first_name: firstName, last_name: lastName, phone: phone.trim(), email: email||null, address_line1: addr||null, city: city||null, state: state||null, postal_code: pin||null };
      if (auth_user_id) custBody.auth_user_id = auth_user_id;

      let custId = null;
      // First try by auth_user_id (most reliable for logged-in users)
      if (auth_user_id) {
        const byAuth = await sbFetch('GET', 'customers', `auth_user_id=eq.${auth_user_id}&select=id`).catch(()=>[]);
        if (byAuth && byAuth.length > 0) {
          custId = byAuth[0].id;
          await sbFetch('PATCH', 'customers', `id=eq.${custId}`, custBody);
        }
      }
      // Fallback: lookup by phone
      if (!custId) {
        const existing = await sbFetch('GET', 'customers', `phone=eq.${encodeURIComponent(phone.trim())}&select=id`).catch(()=>[]);
        if (existing && existing.length > 0) {
          custId = existing[0].id;
          await sbFetch('PATCH', 'customers', `id=eq.${custId}`, custBody);
        } else {
          const nc = await sbFetch('POST', 'customers', '', custBody);
          custId = nc && nc[0] ? nc[0].id : null;
        }
      }
      if (!custId) return err(500, 'Could not create customer');

      // Bug #2 fix: prevent duplicate orders for the same Razorpay payment_id
      if (paymentId) {
        const dupCheck = await sbFetch('GET', 'orders', `payment_id=eq.${paymentId}&select=id,order_number`).catch(() => []);
        if (dupCheck && dupCheck.length > 0) {
          return ok({ success: true, orderId: dupCheck[0].id, orderNumber: dupCheck[0].order_number });
        }
      }

      // 2. Create order
      const orderBody = {
        customer_id: custId,
        total_amount: final,
        subtotal: (final - (shipCharge||0)) + (discount||0),
        coupon_discount: discount||0,
        tax: gstAmount || 0, // GST inclusive — stored for invoice
        shipping_charge: shipCharge || 0,
        order_status: payMethod === 'razorpay_online' ? 'confirmed' : 'pending',
        payment_status: payMethod === 'razorpay_online' ? 'paid' : 'pending',
        payment_method: payMethod,
        payment_id: paymentId || null,
      };
      const newOrder = await sbFetch('POST', 'orders', '', orderBody);
      const orderId = newOrder && newOrder[0] ? newOrder[0].id : null;
      const orderNumber = newOrder && newOrder[0] ? newOrder[0].order_number : null;
      if (!orderId) return err(500, 'Could not create order');

      // 3. Save order items — critical, must succeed
      // Issue 18 fix: if items fail, delete orphan order and return error
      if (items && items.length) {
        const orderItems = items.map(i => ({
          order_id: orderId, product_id: i.id||null,
          variant_id: i.variantId||null, quantity: i.qty, price_at_time: i.price
        }));
        try {
          const savedItems = await sbFetch('POST', 'order_items', '', orderItems);
          if (!savedItems || savedItems.length === 0) throw new Error('no items saved');
        } catch(itemsErr) {
          console.error('order_items failed — cleaning up orphan order:', itemsErr.message);
          await sbFetch('DELETE', 'orders', `id=eq.${orderId}`, null).catch(()=>{});
          return err(500, 'Order could not be saved. Please try again.');
        }
      }
      // 4. Increment coupon uses_count + save coupon_usage
      if (reqBody.couponCode && discount > 0) {
        const coup = await sbFetch('GET', 'coupons', `code=eq.${reqBody.couponCode}&select=id`).catch(()=>[]);
        const couponId = coup && coup[0] ? coup[0].id : null;
        if (couponId) {
          // Save coupon_usage record
          await sbFetch('POST', 'coupon_usage', '', {
            coupon_id: couponId,
            order_id: orderId,
            customer_id: custId,
            discount_amount: discount
          }).catch(e => console.warn('coupon_usage save failed:', e));
          // Increment uses_count
          const curr = await sbFetch('GET', 'coupons', `id=eq.${couponId}&select=uses_count`).catch(()=>[]);
          const currCount = curr && curr[0] ? (curr[0].uses_count || 0) : 0;
          await sbFetch('PATCH', 'coupons', `id=eq.${couponId}`, { uses_count: currCount + 1 }).catch(()=>{});
        }
      }

      // 5. Stock movements — fire RESERVE on order creation
      // This reduces available_stock and increases orders_reserved.
      // OUT fires later when admin confirms (COD), or immediately here for Razorpay.
      // Flow: COD:      pending(RESERVE) → admin confirms(OUT)
      //       Razorpay: confirmed(RESERVE+OUT) → already sold
      if (items && items.length) {
        for (const item of items) {
          const qty = parseInt(item.qty) || 1;
          const ref = orderNumber || String(orderId);

          if (item.variantId) {
            // ── Variant product: use stock_movements table ──
            await sbFetch('POST', 'stock_movements', '', {
              variant_id:   item.variantId,
              type:         'RESERVE',
              quantity:     qty,
              source:       'website_order',
              reference_id: orderId,
              notes:        `Order ${ref} placed — stock reserved`,
              performed_by: 'system',
            }).catch(e => console.warn('RESERVE movement failed:', e));
            if (payMethod === 'razorpay_online') {
              await sbFetch('POST', 'stock_movements', '', {
                variant_id:   item.variantId,
                type:         'OUT',
                quantity:     qty,
                source:       'website_order',
                reference_id: orderId,
                notes:        `Order ${ref} confirmed (Razorpay) — stock sold`,
                performed_by: 'system',
              }).catch(e => console.warn('OUT movement failed:', e));
            }
          } else if (item.id) {
            // ── Non-variant product: directly decrement available_stock ──
            // stock_movements table requires variant_id so we update products directly
            try {
              const curr = await sbFetch('GET', 'products', `id=eq.${parseInt(item.id)}&select=available_stock`).catch(() => []);
              const currStock = curr && curr[0] && curr[0].available_stock !== null
                ? Number(curr[0].available_stock) : null;
              if (currStock !== null) {
                const newStock = Math.max(0, currStock - qty);
                await sbFetch('PATCH', 'products', `id=eq.${parseInt(item.id)}`, {
                  available_stock: newStock
                }).catch(e => console.warn('Stock decrement failed:', e));
              }
            } catch(e) { console.warn('Non-variant stock update failed:', e.message); }
          }
        }
      }

      // 6. Save order_status_history
      await sbFetch('POST', 'order_status_history', '', {
        order_id: orderId,
        old_status: 'new',
        new_status: payMethod === 'razorpay_online' ? 'confirmed' : 'pending',
        changed_at: new Date().toISOString()
      }).catch(()=>{});

      // 7. Notify admin — fire and forget
      const adminEmail = process.env.ADMIN_NOTIFY_EMAIL || 'support@pahadiroots.com';
      const baseUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'https://pahadiroots.com';
      fetch(`${baseUrl}/api/send-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'admin_new_order',
          to: adminEmail,
          orderNumber: orderNumber || '',
          orderId: orderId || '',
          name: name || '',
          items: (items || []).map(i => ({ name: i.name||'Product', emoji: i.emoji||'🌿', qty: i.qty||1, price: i.price||0 })),
          total: final || 0,
          discount: discount || 0,
          shipping: shipCharge || 0,
          address: addr || '',
          city: city || '',
          state: state || '',
          pin: pin || '',
          payMethod: payMethod || ''
        })
      }).catch(() => {}); // non-blocking — order is saved regardless

      return ok({ success: true, orderId, orderNumber });
    } catch(e) {
      console.error('save_order error:', e);
      return err(500, 'Order save failed: ' + (e.message || JSON.stringify(e)));
    }
  }

  // ── public_get_order — order confirmation page ──────────────────
  if (reqBody.action === 'public_get_order') {
    const order_id     = reqBody.order_id ? parseInt(reqBody.order_id, 10) : null;
    const order_number = reqBody.order_number ? String(reqBody.order_number).trim() : null;
    if ((!order_id || isNaN(order_id)) && !order_number) return err(400, 'order_id or order_number required');
    try {
      // Query 1: Fetch order — by id or order_number, minimal safe fields only
      const filter = order_id ? `id=eq.${order_id}` : `order_number=eq.${encodeURIComponent(order_number)}`;
      const orderRes = await fetch(
        `${SUPABASE_URL}/rest/v1/orders?${filter}&select=id,order_number,order_status,payment_status,total_amount,subtotal,shipping_charge,tracking_number,courier,shipped_at,delivered_at,created_at,payment_method,customer_id`,
        { headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY } }
      );
      if (!orderRes.ok) {
        const errText = await orderRes.text().catch(() => 'unknown');
        console.error('Order fetch failed:', orderRes.status, errText);
        return err(orderRes.status, 'Order fetch failed: ' + errText);
      }
      const orders = await orderRes.json();
      if (!orders || !orders.length) return err(404, 'Order not found');
      const raw = orders[0];

      // Try to get discount — separate query to avoid column-not-found errors
      let discountAmount = 0;
      try {
        const discRes = await fetch(
          `${SUPABASE_URL}/rest/v1/orders?id=eq.${raw.id}&select=coupon_discount`,
          { headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY } }
        );
        if (discRes.ok) {
          const discData = await discRes.json();
          discountAmount = discData?.[0]?.coupon_discount || 0;
        }
      } catch(e2) { /* coupon_discount column may not exist — OK */ }

      // Query 2: Fetch customer separately
      let cust = {};
      if (raw.customer_id) {
        try {
          const custRes = await fetch(
            `${SUPABASE_URL}/rest/v1/customers?id=eq.${raw.customer_id}&select=first_name,last_name,phone,address_line1,city,state,postal_code`,
            { headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY } }
          );
          if (custRes.ok) {
            const custData = await custRes.json();
            cust = (custData && custData[0]) || {};
          }
        } catch(e2) { /* customer fetch failed — show order without address */ }
      }

      // Build order object
      const order = {
        ...raw,
        discount_amount: discountAmount,
        customer_name: [cust.first_name, cust.last_name].filter(Boolean).join(' ') || '—',
        customer_phone: (cust.phone || '').replace(/^\+91/, '').replace(/\D/g,'').slice(-10),
        delivery_address: cust.address_line1 || '—',
        city: cust.city || '—',
        state: cust.state || '—',
        pincode: cust.postal_code || '—',
      };

      // Query 3: Fetch order items — use raw.id (always valid) not order_id (null when looked up by order_number)
      try {
        const itemsRes = await fetch(
          `${SUPABASE_URL}/rest/v1/order_items?order_id=eq.${raw.id}&select=quantity,price_at_time,products(name,emoji,image_url)`,
          { headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY } }
        );
        if (itemsRes.ok) {
          const rawItems = await itemsRes.json();
          order.items = (rawItems || []).map(i => ({
            name: i.products?.name || 'Product',
            emoji: i.products?.emoji || '🌿',
            image_url: i.products?.image_url || null,
            qty: i.quantity,
            price: i.price_at_time
          }));
        }
      } catch(e2) { order.items = []; }

      return ok({ order });
    } catch(e) {
      console.error('public_get_order error:', e.message);
      return err(500, e.message || 'Failed to fetch order');
    }
  }

  if (!table || !ALLOWED_TABLES.has(table)) return err(400, `Table "${table}" not permitted`);

  const allowedMethods = new Set(['GET', 'POST', 'PATCH', 'DELETE']);
  if (!allowedMethods.has(method)) return err(400, `Method "${method}" not allowed`);

  if (method === 'DELETE' && (!query || query.trim() === '')) return err(400, 'DELETE without filter is not allowed');
  if (method === 'PATCH'  && (!query || query.trim() === '')) return err(400, 'PATCH without filter is not allowed');

  try {
    const result = await sbFetch(method, table, query || '', body || null);
    if (WRITE_METHODS.has(method)) {
      const recordId = body?.id || (Array.isArray(result) ? result[0]?.id : result?.id) || null;
      await logAdminAction(table, method, recordId);
    }
    return ok(result ?? []);
  } catch (e) {
    console.error(`Supabase error [${method} ${table}]:`, e);
    return err(e.status || 500, e.message || 'Supabase error');
  }
}
