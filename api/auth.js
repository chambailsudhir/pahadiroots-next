// ═══════════════════════════════════════════════════════════════
// 5 Pahadi Roots — Customer Auth API (Vercel Serverless Function)
// Version: 1.0 — Phone OTP + Email/Password, linked accounts
// File path: api/auth.js
// ═══════════════════════════════════════════════════════════════

const SUPABASE_URL  = process.env.SUPABASE_URL;
const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_KEY;  // service key for admin ops
const SUPABASE_ANON = process.env.SUPABASE_ANON_KEY;     // anon key for auth

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  process.env.ALLOWED_ORIGIN || 'https://pahadiroots.com',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type':                 'application/json',
  'Cache-Control':                'no-store, no-cache, must-revalidate',
  'Surrogate-Control':            'no-store',
};

// ── Supabase Auth REST helper ──────────────────────────────────
async function sbAuth(path, body = null, token = null) {
  const url = `${SUPABASE_URL}/auth/v1${path}`;
  const headers = {
    'Content-Type':  'application/json',
    'apikey':        SUPABASE_ANON,
    'Authorization': token ? `Bearer ${token}` : `Bearer ${SUPABASE_ANON}`,
  };
  const res = await fetch(url, {
    method: body !== null ? 'POST' : 'GET',
    headers,
    body: body !== null ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) throw { status: res.status, message: data.msg || data.error_description || data.message || 'Auth error' };
  return data;
}

// ── Supabase Admin helper (service key) ───────────────────────
async function sbAdmin(method, path, body = null) {
  const url = `${SUPABASE_URL}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type':  'application/json',
      'apikey':        SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Prefer':        'return=representation',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw { status: res.status, message: text };
  return text ? JSON.parse(text) : null;
}

// ── Get/create customer profile from customers table ──────────
async function syncCustomerProfile(user) {
  const phone = user.phone || '';
  const email = user.email || '';
  try {
    // Try find by supabase auth user id first
    let existing = await sbAdmin('GET', `/rest/v1/customers?auth_user_id=eq.${user.id}&select=*`).catch(() => null);
    if (existing && existing.length > 0) return existing[0];

    // Try find by phone or email
    if (phone) {
      const byPhone = await sbAdmin('GET', `/rest/v1/customers?phone=eq.${encodeURIComponent(phone)}&select=*`).catch(() => null);
      if (byPhone && byPhone.length > 0) {
        // Link auth_user_id to existing customer
        await sbAdmin('PATCH', `/rest/v1/customers?id=eq.${byPhone[0].id}`, { auth_user_id: user.id }).catch(() => {});
        return byPhone[0];
      }
    }
    if (email) {
      const byEmail = await sbAdmin('GET', `/rest/v1/customers?email=eq.${encodeURIComponent(email)}&select=*`).catch(() => null);
      if (byEmail && byEmail.length > 0) {
        await sbAdmin('PATCH', `/rest/v1/customers?id=eq.${byEmail[0].id}`, { auth_user_id: user.id, phone: phone || byEmail[0].phone }).catch(() => {});
        return byEmail[0];
      }
    }

    // Create new customer profile
    const nameParts = (user.user_metadata?.full_name || '').trim().split(' ');
    const newCustomer = await sbAdmin('POST', '/rest/v1/customers', {
      auth_user_id: user.id,
      first_name:   nameParts[0] || (email ? email.split('@')[0] : 'Customer'),
      last_name:    nameParts.slice(1).join(' ') || null,
      phone:        phone || null,
      email:        email || null,
    });
    return newCustomer && newCustomer[0] ? newCustomer[0] : null;
  } catch (e) {
    console.warn('syncCustomerProfile failed:', e);
    return null;
  }
}

// ── Get customer orders ────────────────────────────────────────
async function getCustomerOrders(customerId) {
  try {
    const orders = await sbAdmin('GET',
      `/rest/v1/orders?customer_id=eq.${customerId}&order=created_at.desc&limit=20&select=id,order_number,total_amount,order_status,payment_status,payment_method,created_at,tracking_number,courier,shipped_at,delivered_at`
    );
    if (!orders || !orders.length) return [];
    const orderIds = orders.map(o => o.id);

    // Fetch items + images in parallel with returns
    const [items, returns] = await Promise.all([
      sbAdmin('GET',
        `/rest/v1/order_items?order_id=in.(${orderIds.join(',')})&select=order_id,quantity,price_at_time,product_id,products(name,emoji,image_url)`
      ).catch(() => []),
      sbAdmin('GET',
        `/rest/v1/returns?order_id=in.(${orderIds.join(',')})&select=order_id,id,status,reason,created_at,updated_at`
      ).catch(() => []),
    ]);

    // Map return status per order
    const returnMap = {};
    (returns || []).forEach(r => { returnMap[String(r.order_id)] = r; });

    return orders.map(o => {
      const ret = returnMap[String(o.id)];
      // Compute display status: return status takes priority over order_status
      let displayStatus = o.order_status;
      if (ret) {
        const statusMap = {
          requested:         'return_requested',
          approved:          'return_approved',
          received:          'return_received',
          refunded:          'refunded',
          refund_initiated:  'refund_initiated',
          refund_completed:  'refund_completed',
          rejected:          'return_rejected',
        };
        displayStatus = statusMap[ret.status] || 'return_requested';
      }
      return {
        ...o,
        _return: ret || null,
        _displayStatus: displayStatus,
        items: (items || []).filter(i => String(i.order_id) === String(o.id)).map(i => ({
          qty:       i.quantity,
          price:     i.price_at_time,
          name:      i.products?.name || 'Product',
          emoji:     i.products?.emoji || '🌿',
          image_url: i.products?.image_url || null,
        }))
      };
    });
  } catch (e) {
    return [];
  }
}

// ══════════════════════════════════════════════════════════════
// MAIN HANDLER
// ══════════════════════════════════════════════════════════════
export default async function handler(req, res) {
  const ok  = (data)   => { Object.entries(CORS_HEADERS).forEach(([k,v]) => res.setHeader(k,v)); return res.status(200).json(data); };
  const err = (s, msg) => { Object.entries(CORS_HEADERS).forEach(([k,v]) => res.setHeader(k,v)); return res.status(s).json({ error: msg }); };

  Object.entries(CORS_HEADERS).forEach(([k,v]) => res.setHeader(k,v));
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST')   return err(405, 'Method not allowed');

  if (!SUPABASE_URL || !SUPABASE_KEY || !SUPABASE_ANON) {
    return err(500, 'Server misconfigured — check SUPABASE_ANON_KEY env var');
  }

  let body = {};
  try { body = req.body || {}; if (typeof body === 'string') body = JSON.parse(body); } catch(e) { return err(400, 'Invalid JSON'); }

  const { action } = body;

  // ── 1. Send Phone OTP ──────────────────────────────────────
  if (action === 'send_otp') {
    const { phone } = body;
    if (!phone) return err(400, 'Phone required');
    const normalised = phone.startsWith('+') ? phone : '+91' + phone.replace(/\D/g, '').slice(-10);
    try {
      await sbAuth('/otp', { phone: normalised, channel: 'sms' });
      return ok({ success: true, message: 'OTP sent' });
    } catch(e) {
      // Friendly error if SMS provider not configured
      const msg = e.message || '';
      if (msg.toLowerCase().includes('unsupported') || msg.toLowerCase().includes('provider') || e.status === 422) {
        return err(422, 'SMS_NOT_CONFIGURED');
      }
      return err(e.status || 500, e.message || 'Failed to send OTP');
    }
  }

  // ── 2. Verify Phone OTP ────────────────────────────────────
  if (action === 'verify_otp') {
    const { phone, token } = body;
    if (!phone || !token) return err(400, 'Phone and OTP required');
    const normalised = phone.startsWith('+') ? phone : '+91' + phone.replace(/\D/g, '').slice(-10);
    try {
      const data = await sbAuth('/verify', { phone: normalised, token, type: 'sms' });
      const user = data.user || data;
      if (!user || !user.id) return err(400, 'Verification failed');
      const profile = await syncCustomerProfile(user);
      return ok({
        success:      true,
        access_token: data.access_token,
        refresh_token:data.refresh_token,
        user: {
          id:    user.id,
          phone: user.phone || normalised,
          email: user.email || null,
        },
        profile,
      });
    } catch(e) {
      return err(e.status || 400, e.message || 'Invalid OTP');
    }
  }

  // ── 3. Email Sign Up ───────────────────────────────────────
  if (action === 'email_signup') {
    const { email, password, full_name } = body;
    if (!email || !password) return err(400, 'Email and password required');
    if (password.length < 6)  return err(400, 'Password must be at least 6 characters');
    try {
      const data = await sbAuth('/signup', {
        email, password,
        data: { full_name: full_name || '' }
      });
      // Supabase may return user in data.user or data directly
      const user = data.user || data;
      if (!user || !user.id) return err(400, 'Signup failed — could not create user');
      const profile = await syncCustomerProfile(user);
      return ok({
        success:      true,
        access_token: data.access_token || null,
        refresh_token:data.refresh_token || null,
        user: {
          id:    user.id,
          email: user.email || email,
          phone: user.phone || null,
        },
        profile,
      });
    } catch(e) {
      return err(e.status || 400, e.message || 'Signup failed');
    }
  }

  // ── 4. Email Sign In ───────────────────────────────────────
  if (action === 'email_login') {
    const { email, password } = body;
    if (!email || !password) return err(400, 'Email and password required');
    try {
      const data = await sbAuth('/token?grant_type=password', { email, password });
      const user = data.user || data;
      if (!user || !user.id) return err(401, 'Invalid email or password');
      const profile = await syncCustomerProfile(user);
      return ok({
        success:      true,
        access_token: data.access_token,
        refresh_token:data.refresh_token,
        user: {
          id:    user.id,
          email: user.email || email,
          phone: user.phone || null,
        },
        profile,
      });
    } catch(e) {
      return err(e.status || 401, e.message || 'Invalid email or password');
    }
  }

  // ── 5. Refresh Token ───────────────────────────────────────
  if (action === 'refresh_token') {
    const { refresh_token } = body;
    if (!refresh_token) return err(400, 'refresh_token required');
    try {
      const data = await sbAuth('/token?grant_type=refresh_token', { refresh_token });
      return ok({
        success:       true,
        access_token:  data.access_token,
        refresh_token: data.refresh_token,
      });
    } catch(e) {
      return err(401, 'Session expired — please login again');
    }
  }

  // ── 6. Get Profile + Orders ────────────────────────────────
  if (action === 'get_profile') {
    const token = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
    if (!token) return err(401, 'Not logged in');
    try {
      const user = await sbAuth('/user', null, token);
      const profile = await syncCustomerProfile(user);
      const orders  = profile ? await getCustomerOrders(profile.id) : [];
      return ok({ success: true, user: { id: user.id, email: user.email, phone: user.phone }, profile, orders });
    } catch(e) {
      return err(401, 'Session expired — please login again');
    }
  }

  // ── 7. Link Email to Phone account (or vice versa) ─────────
  if (action === 'link_email') {
    const token = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
    const { email, password } = body;
    if (!token)          return err(401, 'Not logged in');
    if (!email || !password) return err(400, 'Email and password required');
    try {
      // Update user email via admin API
      const user = await sbAuth('/user', null, token);
      await sbAdmin('PUT', `/auth/v1/admin/users/${user.id}`, { email, password });
      // Also update customer table
      const profile = await syncCustomerProfile(user);
      if (profile) await sbAdmin('PATCH', `/rest/v1/customers?id=eq.${profile.id}`, { email });
      return ok({ success: true, message: 'Email linked successfully' });
    } catch(e) {
      return err(e.status || 400, e.message || 'Failed to link email');
    }
  }

  // ── 8. Link Phone to Email account ────────────────────────
  if (action === 'link_phone') {
    const token = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
    const { phone } = body;
    if (!token) return err(401, 'Not logged in');
    if (!phone) return err(400, 'Phone required');
    try {
      const normalised = phone.startsWith('+') ? phone : '+91' + phone.replace(/\D/g, '').slice(-10);
      const user = await sbAuth('/user', null, token);
      await sbAdmin('PUT', `/auth/v1/admin/users/${user.id}`, { phone: normalised });
      const profile = await syncCustomerProfile(user);
      if (profile) await sbAdmin('PATCH', `/rest/v1/customers?id=eq.${profile.id}`, { phone: normalised });
      return ok({ success: true, message: 'Phone linked successfully' });
    } catch(e) {
      return err(e.status || 400, e.message || 'Failed to link phone');
    }
  }

  // ── 9. Update Profile ──────────────────────────────────────
  if (action === 'update_profile') {
    const token = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
    if (!token) return err(401, 'Not logged in');
    const { first_name, last_name, address_line1, city, state, postal_code, saved_addresses } = body;
    try {
      const user    = await sbAuth('/user', null, token);
      const profile = await syncCustomerProfile(user);
      if (!profile) return err(404, 'Profile not found');
      const updates = {};
      if (first_name       !== undefined) updates.first_name       = first_name;
      if (last_name        !== undefined) updates.last_name        = last_name;
      if (address_line1    !== undefined) updates.address_line1    = address_line1;
      if (city             !== undefined) updates.city             = city;
      if (state            !== undefined) updates.state            = state;
      if (postal_code      !== undefined) updates.postal_code      = postal_code;
      if (saved_addresses  !== undefined) updates.saved_addresses  = typeof saved_addresses === 'string' ? saved_addresses : JSON.stringify(saved_addresses);
      await sbAdmin('PATCH', `/rest/v1/customers?id=eq.${profile.id}`, updates);
      return ok({ success: true, profile: { ...profile, ...updates } });
    } catch(e) {
      return err(e.status || 500, e.message || 'Update failed');
    }
  }

  // ── 10. Logout ─────────────────────────────────────────────
  if (action === 'logout') {
    const token = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
    if (token) {
      try { await sbAuth('/logout', {}, token); } catch(e) {}
    }
    return ok({ success: true });
  }

  // ── 11. Forgot Password — send reset email via Resend ───────
  if (action === 'forgot_password') {
    const { email } = body;
    if (!email) return err(400, 'Email required');

    const RESEND_KEY = process.env.RESEND_API_KEY;
    const SITE_URL   = 'https://pahadiroots.com';

    if (!RESEND_KEY) {
      console.error('[forgot_password] RESEND_API_KEY not set');
      return err(500, 'Email service not configured');
    }

    try {
      // Step 1: Generate recovery link via Supabase Admin generate_link
      // This is the most reliable method — returns a ready-to-use action_link
      const genRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'apikey':        SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
        },
        body: JSON.stringify({
          type:       'recovery',
          email:      email,
          options:    { redirect_to: `${SITE_URL}/reset-password` }
        }),
      });

      const genText = await genRes.text();
      console.log('[forgot_password] Supabase raw response:', genRes.status, genText.slice(0, 300));

      let genData = {};
      try { genData = JSON.parse(genText); } catch(e) {}

      if (!genRes.ok) {
        // User may not exist — don't reveal, return success
        console.warn('[forgot_password] generate_link failed:', genRes.status);
        return ok({ success: true });
      }

      // Extract action_link — Supabase returns it at top level or inside properties
      const finalResetUrl =
        genData.action_link ||
        (genData.properties && genData.properties.action_link) ||
        (genData.data && genData.data.action_link) || '';

      if (!finalResetUrl) {
        console.error('[forgot_password] No action_link in response. Keys:', Object.keys(genData).join(','));
        return err(500, 'Could not generate reset link — please try again');
      }

      console.log('[forgot_password] action_link OK for:', email);

      // Step 2: Send beautiful email via Resend
      const resendRes = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${RESEND_KEY}`,
        },
        body: JSON.stringify({
          from:    '5 Pahadi Roots <noreply@pahadiroots.com>',
          to:      [email],
          subject: '🔑 Reset Your Password — 5 Pahadi Roots',
          html: `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f5f0e8;font-family:Arial,sans-serif">
<div style="max-width:520px;margin:32px auto;padding:0 16px">
  <div style="background:linear-gradient(135deg,#1a3a1e,#2d6a4f);border-radius:16px 16px 0 0;padding:36px 24px;text-align:center">
    <div style="font-size:40px;margin-bottom:8px">🌿</div>
    <div style="font-size:24px;font-weight:900;color:#fff;font-family:Georgia,serif">5 Pahadi Roots</div>
    <div style="font-size:12px;color:rgba(255,255,255,.6);letter-spacing:2px;margin-top:4px">HIMALAYAN ORGANIC STORE</div>
  </div>
  <div style="background:#fff;border-radius:0 0 16px 16px;padding:40px 32px;box-shadow:0 4px 24px rgba(0,0,0,.08)">
    <div style="text-align:center;margin-bottom:28px">
      <div style="width:64px;height:64px;background:#e8f5e9;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:28px;margin-bottom:16px">🔑</div>
      <h2 style="font-family:Georgia,serif;color:#1a3a1e;margin:0 0 8px;font-size:24px">Reset Your Password</h2>
      <p style="color:#666;font-size:15px;line-height:1.6;margin:0">We received a request to reset your password.<br>Click the button below to set a new one.</p>
    </div>
    <div style="text-align:center;margin:32px 0">
      <a href="${finalResetUrl}"
         style="display:inline-block;background:linear-gradient(135deg,#1a5c2a,#2d6a4f);color:#fff;padding:18px 48px;border-radius:12px;text-decoration:none;font-weight:800;font-size:17px;letter-spacing:.3px;box-shadow:0 4px 16px rgba(45,106,79,.35)">
        🔑 Reset Password
      </a>
    </div>
    <div style="background:#f8fdf9;border-radius:10px;padding:16px;border-left:4px solid #2d6a4f;margin-bottom:24px">
      <p style="color:#555;font-size:13px;margin:0;line-height:1.7">
        ⏱ <strong>This link expires in 1 hour.</strong><br>
        🔒 If you did not request this, please ignore this email — your account is safe.
      </p>
    </div>
    <p style="color:#aaa;font-size:12px;text-align:center;margin:0">
      Need help? <a href="https://wa.me/919899984895" style="color:#2d6a4f">WhatsApp us</a> — we're happy to help!
    </p>
  </div>
  <p style="text-align:center;color:#bbb;font-size:11px;margin-top:20px">
    © 2026 5 Pahadi Roots · pahadiroots.com
  </p>
</div>
</body>
</html>`,
        }),
      });

      const resendText = await resendRes.text();
      console.log('[forgot_password] Resend response:', resendRes.status, resendText.slice(0, 200));

      if (!resendRes.ok) {
        console.error('[forgot_password] Resend failed:', resendRes.status, resendText);
        return err(500, 'Could not send email — please try again in a few minutes');
      }

      console.log('[forgot_password] Reset email sent successfully to:', email);
      return ok({ success: true });

    } catch(e) {
      console.error('[forgot_password] Unexpected error:', e.message);
      return err(500, 'Something went wrong — please try again');
    }
  }


  // ── 12. Reset Password — set new password with token ────────
  if (action === 'reset_password') {
    const token = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
    const { password } = body;
    if (!token)   return err(401, 'Invalid or expired reset link');
    if (!password || password.length < 6) return err(400, 'Password must be at least 6 characters');
    try {
      const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
        method: 'PUT',
        headers: {
          'Content-Type':  'application/json',
          'apikey':        SUPABASE_ANON,
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (!res.ok) throw { status: res.status, message: data.msg || data.message || 'Reset failed' };
      return ok({ success: true });
    } catch(e) {
      return err(e.status || 400, e.message || 'Reset failed — link expire ho gaya');
    }
  }

  // ── Google OAuth callback — handle token from Supabase redirect ──
  if (action === 'google_callback') {
    const { access_token, refresh_token } = body;
    if (!access_token) return err(400, 'No access_token provided');
    try {
      const user = await sbAuth('/user', null, access_token);
      const profile = await syncCustomerProfile(user);
      return ok({
        success: true,
        access_token,
        refresh_token: refresh_token || null,
        user: { id: user.id, email: user.email, phone: user.phone || null },
        profile,
      });
    } catch(e) {
      return err(401, 'Google login failed: ' + (e.message || 'Unknown error'));
    }
  }

  // ── change_password ──────────────────────────────────────────
  if (action === 'change_password') {
    const token = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
    const { new_password } = body;
    if (!token) return err(401, 'Not logged in');
    if (!new_password || new_password.length < 6) return err(400, 'Password min 6 characters');
    try {
      const user = await sbAuth('/user', null, token);
      await sbAdmin('PUT', `/auth/v1/admin/users/${user.id}`, { password: new_password });
      return ok({ success: true });
    } catch(e) {
      return err(e.status || 400, e.message || 'Password update failed');
    }
  }

  // ── create_return — customer self-service return request ────
  if (action === 'create_return') {
    const token = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
    if (!token) return err(401, 'Not logged in');
    const { order_id, order_number, customer_name, reason, description, refund_amount, selected_items, is_partial } = body;
    if (!order_id || !reason) return err(400, 'order_id and reason required');
    try {
      // Verify the order belongs to this customer
      const user = await sbAuth('/user', null, token);
      const profile = await syncCustomerProfile(user);
      if (!profile) return err(401, 'Profile not found');

      const orders = await sbAdmin('GET',
        `/rest/v1/orders?id=eq.${order_id}&customer_id=eq.${profile.id}&select=id,order_status,order_number,total_amount`
      );
      if (!orders || !orders.length) return err(403, 'Order not found or does not belong to you');
      const order = orders[0];
      // Allow return for delivered orders (order_status may still be 'delivered' even if return in progress)
      const allowedStatuses = ['delivered', 'returned'];
      if (!allowedStatuses.includes(order.order_status)) {
        return err(400, `Returns are only accepted for delivered orders. Current status: ${order.order_status}`);
      }

      // Check if return already exists — if so return friendly message
      const existing = await sbAdmin('GET',
        `/rest/v1/returns?order_id=eq.${order_id}&select=id,status`
      ).catch(() => []);
      if (existing && existing.length > 0) {
        return err(400, `A return request already exists for this order (status: ${existing[0].status}). Please check your order status.`);
      }

      // Create return record
      const returnRecord = await sbAdmin('POST', '/rest/v1/returns', {
        order_id:       Number(order_id),
        order_number:   order_number || order.order_number,
        customer_name:  customer_name || null,
        reason,
        description:    description
          ? description
          : (is_partial && selected_items?.length)
            ? `Partial return: ${selected_items.map(i => i.name).join(', ')}`
            : null,
        refund_amount:  refund_amount ? parseFloat(refund_amount) : null,
        status:         'requested',
        restock:        true,
        created_at:     new Date().toISOString(),
        updated_at:     new Date().toISOString(),
      });
      return ok({ success: true, return: returnRecord });
    } catch(e) {
      return err(e.status || 500, e.message || 'Return request failed');
    }
  }

  return err(400, `Unknown action: ${action}`);
}
