// ═══════════════════════════════════════════════════════════════
// 5 Pahadi Roots — Customer Auth API (Next.js App Router)
// Mirrors old api/auth.js 100% — same actions, same logic.
// ═══════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server'

const SUPABASE_URL  = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_KEY!
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

function ok(data: any) {
  return NextResponse.json(data, { status: 200 })
}
function err(status: number, message: string) {
  return NextResponse.json({ error: message }, { status })
}

async function sbAuth(path: string, body: any = null, token?: string) {
  const url = `${SUPABASE_URL}/auth/v1${path}`
  const headers: Record<string, string> = {
    'Content-Type':  'application/json',
    'apikey':        SUPABASE_ANON,
    'Authorization': token ? `Bearer ${token}` : `Bearer ${SUPABASE_ANON}`,
  }
  const res = await fetch(url, {
    method: body !== null ? 'POST' : 'GET',
    headers,
    body: body !== null ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  const data = text ? JSON.parse(text) : {}
  if (!res.ok) throw { status: res.status, message: data.msg || data.error_description || data.message || 'Auth error' }
  return data
}

async function sbAdmin(method: string, path: string, body: any = null) {
  const url = `${SUPABASE_URL}${path}`
  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type':  'application/json',
      'apikey':        SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Prefer':        'return=representation',
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  if (!res.ok) throw { status: res.status, message: text }
  return text ? JSON.parse(text) : null
}

async function syncCustomerProfile(user: any) {
  const phone = user.phone || ''
  const email = user.email || ''
  try {
    const orParts = [`auth_user_id.eq.${user.id}`]
    if (phone) orParts.push(`phone.eq.${encodeURIComponent(phone)}`)
    if (email) orParts.push(`email.eq.${encodeURIComponent(email)}`)

    const rows = await sbAdmin(
      'GET',
      `/rest/v1/customers?or=(${orParts.join(',')})&select=*&limit=3`
    ).catch(() => null)

    if (rows && rows.length > 0) {
      let match = rows.find((r: any) => r.auth_user_id === user.id)
        || rows.find((r: any) => phone && r.phone === phone)
        || rows[0]

      if (match.auth_user_id !== user.id) {
        const patch: any = { auth_user_id: user.id }
        if (phone && !match.phone) patch.phone = phone
        await sbAdmin('PATCH', `/rest/v1/customers?id=eq.${match.id}`, patch).catch(() => {})
        match = { ...match, ...patch }
      }
      return match
    }

    const nameParts = (user.user_metadata?.full_name || '').trim().split(' ')
    const newCustomer = await sbAdmin('POST', '/rest/v1/customers', {
      auth_user_id: user.id,
      first_name:   nameParts[0] || (email ? email.split('@')[0] : 'Customer'),
      last_name:    nameParts.slice(1).join(' ') || null,
      phone:        phone || null,
      email:        email || null,
    })
    return newCustomer && newCustomer[0] ? newCustomer[0] : null
  } catch (e) {
    console.warn('syncCustomerProfile failed:', e)
    return null
  }
}

async function getCustomerOrders(customerId: string) {
  try {
    const orders = await sbAdmin('GET',
      `/rest/v1/orders?customer_id=eq.${customerId}&order=created_at.desc&limit=20&select=id,order_number,total_amount,order_status,payment_status,payment_method,created_at,tracking_number,courier,shipped_at,delivered_at`
    )
    if (!orders || !orders.length) return []
    const orderIds = orders.map((o: any) => o.id)

    const [items, returns] = await Promise.all([
      sbAdmin('GET',
        `/rest/v1/order_items?order_id=in.(${orderIds.join(',')})&select=order_id,quantity,price_at_time,product_id,products(name,emoji,image_url)`
      ).catch(() => []),
      sbAdmin('GET',
        `/rest/v1/returns?order_id=in.(${orderIds.join(',')})&select=order_id,id,status,reason,created_at,updated_at`
      ).catch(() => []),
    ])

    const returnMap: Record<string, any> = {}
    ;(returns || []).forEach((r: any) => { returnMap[String(r.order_id)] = r })

    return orders.map((o: any) => {
      const ret = returnMap[String(o.id)]
      let displayStatus = o.order_status
      if (ret) {
        const statusMap: Record<string, string> = {
          requested:        'return_requested',
          approved:         'return_approved',
          received:         'return_received',
          refunded:         'refunded',
          refund_initiated: 'refund_initiated',
          refund_completed: 'refund_completed',
          rejected:         'return_rejected',
        }
        displayStatus = statusMap[ret.status] || 'return_requested'
      }
      return {
        ...o,
        _return: ret || null,
        _displayStatus: displayStatus,
        items: (items || []).filter((i: any) => String(i.order_id) === String(o.id)).map((i: any) => ({
          qty:       i.quantity,
          price:     i.price_at_time,
          name:      i.products?.name || 'Product',
          emoji:     i.products?.emoji || '🌿',
          image_url: i.products?.image_url || null,
        }))
      }
    })
  } catch (e) {
    return []
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204 })
}

export async function POST(req: NextRequest) {
  if (!SUPABASE_URL || !SUPABASE_KEY || !SUPABASE_ANON) {
    return err(500, 'Server misconfigured — check env vars')
  }

  let body: any = {}
  try {
    body = await req.json()
  } catch {
    return err(400, 'Invalid JSON')
  }

  const { action } = body

  // ── Keep-warm ping ──
  if (action === '_ping') return ok({ ok: true })

  // ── OTP ──
  if (action === 'send_otp') {
    const { phone } = body
    if (!phone) return err(400, 'Phone required')
    const normalised = phone.startsWith('+') ? phone : '+91' + phone.replace(/\D/g, '').slice(-10)
    try {
      await sbAuth('/otp', { phone: normalised, channel: 'sms' })
      return ok({ success: true, message: 'OTP sent' })
    } catch (e: any) {
      const msg = e.message || ''
      if (msg.toLowerCase().includes('unsupported') || msg.toLowerCase().includes('provider') || e.status === 422) {
        return err(422, 'SMS_NOT_CONFIGURED')
      }
      return err(e.status || 500, e.message || 'Failed to send OTP')
    }
  }

  if (action === 'verify_otp') {
    const { phone, token } = body
    if (!phone || !token) return err(400, 'Phone and OTP required')
    const normalised = phone.startsWith('+') ? phone : '+91' + phone.replace(/\D/g, '').slice(-10)
    try {
      const data = await sbAuth('/verify', { phone: normalised, token, type: 'sms' })
      const user = data.user || data
      if (!user || !user.id) return err(400, 'Verification failed')
      const profile = await syncCustomerProfile(user)
      return ok({
        success: true, access_token: data.access_token, refresh_token: data.refresh_token,
        user: { id: user.id, phone: user.phone || normalised, email: user.email || null }, profile,
      })
    } catch (e: any) {
      return err(e.status || 400, e.message || 'Invalid OTP')
    }
  }

  // ── Email Signup — supports both old action name and new ──
  if (action === 'email_signup' || action === 'register_email') {
    const { email, password, full_name, name } = body
    const resolvedName = full_name || name || ''
    if (!email || !password) return err(400, 'Email and password required')
    if (password.length < 6)  return err(400, 'Password must be at least 6 characters')
    try {
      const data = await sbAuth('/signup', { email, password, data: { full_name: resolvedName } })
      const user = data.user || data
      if (!user || !user.id) return err(400, 'Signup failed — could not create user')
      const profile = await syncCustomerProfile(user)
      return ok({
        success: true, access_token: data.access_token || null, refresh_token: data.refresh_token || null,
        user: { id: user.id, email: user.email || email, phone: user.phone || null }, profile,
      })
    } catch (e: any) {
      return err(e.status || 400, e.message || 'Signup failed')
    }
  }

  // ── Email Login — supports both old action name and new ──
  if (action === 'email_login' || action === 'login_email') {
    const { email, password } = body
    if (!email || !password) return err(400, 'Email and password required')
    try {
      const data = await sbAuth('/token?grant_type=password', { email, password })
      const user = data.user || data
      if (!user || !user.id) return err(401, 'Invalid email or password')
      const profile = await syncCustomerProfile(user)
      return ok({
        success: true, access_token: data.access_token, refresh_token: data.refresh_token,
        user: { id: user.id, email: user.email || email, phone: user.phone || null }, profile,
      })
    } catch (e: any) {
      return err(e.status || 401, e.message || 'Invalid email or password')
    }
  }

  // ── Refresh Token ──
  if (action === 'refresh_token') {
    const { refresh_token } = body
    if (!refresh_token) return err(400, 'refresh_token required')
    try {
      const data = await sbAuth('/token?grant_type=refresh_token', { refresh_token })
      return ok({ success: true, access_token: data.access_token, refresh_token: data.refresh_token })
    } catch {
      return err(401, 'Session expired — please login again')
    }
  }

  // ── Get Profile ──
  if (action === 'get_profile') {
    const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
    if (!token) return err(401, 'Not logged in')
    try {
      const user    = await sbAuth('/user', null, token)
      const profile = await syncCustomerProfile(user)
      return ok({ success: true, user: { id: user.id, email: user.email, phone: user.phone }, profile })
    } catch {
      return err(401, 'Session expired — please login again')
    }
  }

  // ── Get Orders ──
  if (action === 'get_orders') {
    const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
    if (!token) return err(401, 'Not logged in')
    try {
      const user    = await sbAuth('/user', null, token)
      const profile = await syncCustomerProfile(user)
      const orders  = profile ? await getCustomerOrders(profile.id) : []
      return ok({ success: true, orders })
    } catch {
      return err(401, 'Session expired — please login again')
    }
  }

  // ── Google OAuth — initiate ──
  if (action === 'google_oauth') {
    const redirectTo = process.env.NEXT_PUBLIC_SITE_URL
      ? `${process.env.NEXT_PUBLIC_SITE_URL}/api/auth/google-callback`
      : 'https://pahadiroots.com/api/auth/google-callback'
    const url = `${SUPABASE_URL}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(redirectTo)}`
    return ok({ url })
  }

  // ── Google Callback (token exchange) ──
  if (action === 'google_callback') {
    const { access_token, refresh_token } = body
    if (!access_token) return err(400, 'No access_token provided')
    try {
      const user = await sbAuth('/user', null, access_token)
      const profile = await syncCustomerProfile(user)
      return ok({
        success: true, access_token, refresh_token: refresh_token || null,
        user: { id: user.id, email: user.email, phone: user.phone || null }, profile,
      })
    } catch (e: any) {
      return err(401, 'Google login failed: ' + (e.message || 'Unknown error'))
    }
  }

  // ── Link Email ──
  if (action === 'link_email') {
    const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
    const { email, password } = body
    if (!token)              return err(401, 'Not logged in')
    if (!email || !password) return err(400, 'Email and password required')
    try {
      const user = await sbAuth('/user', null, token)
      await sbAdmin('PUT', `/auth/v1/admin/users/${user.id}`, { email, password })
      const profile = await syncCustomerProfile(user)
      if (profile) await sbAdmin('PATCH', `/rest/v1/customers?id=eq.${profile.id}`, { email })
      return ok({ success: true, message: 'Email linked successfully' })
    } catch (e: any) {
      return err(e.status || 400, e.message || 'Failed to link email')
    }
  }

  // ── Link Phone ──
  if (action === 'link_phone') {
    const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
    const { phone } = body
    if (!token) return err(401, 'Not logged in')
    if (!phone) return err(400, 'Phone required')
    try {
      const normalised = phone.startsWith('+') ? phone : '+91' + phone.replace(/\D/g, '').slice(-10)
      const user = await sbAuth('/user', null, token)
      await sbAdmin('PUT', `/auth/v1/admin/users/${user.id}`, { phone: normalised })
      const profile = await syncCustomerProfile(user)
      if (profile) await sbAdmin('PATCH', `/rest/v1/customers?id=eq.${profile.id}`, { phone: normalised })
      return ok({ success: true, message: 'Phone linked successfully' })
    } catch (e: any) {
      return err(e.status || 400, e.message || 'Failed to link phone')
    }
  }

  // ── Update Profile ──
  if (action === 'update_profile') {
    const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
    if (!token) return err(401, 'Not logged in')
    const { first_name, last_name, address_line1, city, state, postal_code, saved_addresses } = body
    try {
      const user    = await sbAuth('/user', null, token)
      const profile = await syncCustomerProfile(user)
      if (!profile) return err(404, 'Profile not found')
      const updates: any = {}
      if (first_name      !== undefined) updates.first_name      = first_name
      if (last_name       !== undefined) updates.last_name       = last_name
      if (address_line1   !== undefined) updates.address_line1   = address_line1
      if (city            !== undefined) updates.city            = city
      if (state           !== undefined) updates.state           = state
      if (postal_code     !== undefined) updates.postal_code     = postal_code
      if (saved_addresses !== undefined) updates.saved_addresses = typeof saved_addresses === 'string' ? saved_addresses : JSON.stringify(saved_addresses)
      await sbAdmin('PATCH', `/rest/v1/customers?id=eq.${profile.id}`, updates)
      return ok({ success: true, profile: { ...profile, ...updates } })
    } catch (e: any) {
      return err(e.status || 500, e.message || 'Update failed')
    }
  }

  // ── Logout ──
  if (action === 'logout') {
    const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
    if (token) { try { await sbAuth('/logout', {}, token) } catch {} }
    return ok({ success: true })
  }

  // ── Forgot Password ──
  if (action === 'forgot_password') {
    const { email } = body
    if (!email) return err(400, 'Email required')
    const RESEND_KEY = process.env.RESEND_API_KEY
    const SITE_URL   = process.env.NEXT_PUBLIC_SITE_URL || 'https://pahadiroots.com'
    if (!RESEND_KEY) {
      console.error('[forgot_password] RESEND_API_KEY not set')
      return err(500, 'Email service not configured')
    }
    try {
      const genRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` },
        body: JSON.stringify({ type: 'recovery', email, options: { redirect_to: `${SITE_URL}/reset-password` } }),
      })
      const genText = await genRes.text()
      let genData: any = {}
      try { genData = JSON.parse(genText) } catch {}
      if (!genRes.ok) { console.warn('[forgot_password] generate_link failed:', genRes.status); return ok({ success: true }) }
      const finalResetUrl = genData.action_link || (genData.properties?.action_link) || (genData.data?.action_link) || ''
      if (!finalResetUrl) return err(500, 'Could not generate reset link — please try again')
      const resendRes = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_KEY}` },
        body: JSON.stringify({
          from: '5 Pahadi Roots <noreply@pahadiroots.com>', to: [email],
          subject: '🔑 Reset Your Password — 5 Pahadi Roots',
          html: `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f5f0e8;font-family:Arial,sans-serif"><div style="max-width:520px;margin:32px auto;padding:0 16px"><div style="background:linear-gradient(135deg,#1a3a1e,#2d6a4f);border-radius:16px 16px 0 0;padding:36px 24px;text-align:center"><div style="font-size:40px;margin-bottom:8px">🌿</div><div style="font-size:24px;font-weight:900;color:#fff;font-family:Georgia,serif">5 Pahadi Roots</div></div><div style="background:#fff;border-radius:0 0 16px 16px;padding:40px 32px"><h2 style="font-family:Georgia,serif;color:#1a3a1e;margin:0 0 8px">Reset Your Password</h2><p style="color:#666;font-size:15px">Click the button below to set a new password.</p><div style="text-align:center;margin:32px 0"><a href="${finalResetUrl}" style="display:inline-block;background:linear-gradient(135deg,#1a5c2a,#2d6a4f);color:#fff;padding:18px 48px;border-radius:12px;text-decoration:none;font-weight:800;font-size:17px">🔑 Reset Password</a></div><p style="color:#aaa;font-size:12px;text-align:center">Need help? <a href="https://wa.me/919899984895" style="color:#2d6a4f">WhatsApp us</a></p></div></div></body></html>`,
        }),
      })
      if (!resendRes.ok) { const t = await resendRes.text(); console.error('[forgot_password] Resend failed:', resendRes.status, t); return err(500, 'Could not send email — please try again') }
      return ok({ success: true })
    } catch (e: any) {
      return err(500, 'Something went wrong — please try again')
    }
  }

  // ── Reset Password ──
  if (action === 'reset_password') {
    const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
    const { password } = body
    if (!token)   return err(401, 'Invalid or expired reset link')
    if (!password || password.length < 6) return err(400, 'Password must be at least 6 characters')
    try {
      const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON, 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ password }),
      })
      const data = await res.json()
      if (!res.ok) throw { status: res.status, message: data.msg || data.message || 'Reset failed' }
      return ok({ success: true })
    } catch (e: any) {
      return err(e.status || 400, e.message || 'Reset failed — link expired')
    }
  }

  // ── Change Password ──
  if (action === 'change_password') {
    const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
    const { new_password } = body
    if (!token) return err(401, 'Not logged in')
    if (!new_password || new_password.length < 6) return err(400, 'Password min 6 characters')
    try {
      const user = await sbAuth('/user', null, token)
      await sbAdmin('PUT', `/auth/v1/admin/users/${user.id}`, { password: new_password })
      return ok({ success: true })
    } catch (e: any) {
      return err(e.status || 400, e.message || 'Password update failed')
    }
  }

  // ── Create Return ──
  if (action === 'create_return') {
    const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
    if (!token) return err(401, 'Not logged in')
    const { order_id, order_number, customer_name, reason, description, refund_amount, selected_items, is_partial } = body
    if (!order_id || !reason) return err(400, 'order_id and reason required')
    try {
      const user = await sbAuth('/user', null, token)
      const profile = await syncCustomerProfile(user)
      if (!profile) return err(401, 'Profile not found')
      const orders = await sbAdmin('GET', `/rest/v1/orders?id=eq.${order_id}&customer_id=eq.${profile.id}&select=id,order_status,order_number,total_amount`)
      if (!orders || !orders.length) return err(403, 'Order not found or does not belong to you')
      const order = orders[0]
      if (!['delivered', 'returned'].includes(order.order_status)) {
        return err(400, `Returns are only accepted for delivered orders. Current status: ${order.order_status}`)
      }
      const existing = await sbAdmin('GET', `/rest/v1/returns?order_id=eq.${order_id}&select=id,status`).catch(() => [])
      if (existing && existing.length > 0) {
        return err(400, `A return request already exists for this order (status: ${existing[0].status}).`)
      }
      const returnRecord = await sbAdmin('POST', '/rest/v1/returns', {
        order_id: Number(order_id), order_number: order_number || order.order_number,
        customer_name: customer_name || null, reason,
        description: description ? description : (is_partial && selected_items?.length) ? `Partial return: ${selected_items.map((i: any) => i.name).join(', ')}` : null,
        refund_amount: refund_amount ? parseFloat(refund_amount) : null,
        status: 'requested', restock: true,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      })
      return ok({ success: true, return: returnRecord })
    } catch (e: any) {
      return err(e.status || 500, e.message || 'Return request failed')
    }
  }

  return err(400, `Unknown action: ${action}`)
}
