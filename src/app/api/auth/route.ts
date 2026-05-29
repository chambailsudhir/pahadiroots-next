// ═══════════════════════════════════════════════════════════════
// 5 Pahadi Roots — Customer Auth API (Next.js App Router)
//
// CHANGES (security audit):
//  ✅ In-process rate limiter — protects OTP, login, change_password
//  ✅ httpOnly cookies written on every login action (verify_otp,
//     email_login, email_signup, refresh_token, google_callback)
//  ✅ change_password now requires current_password verification
//  ✅ `any` removed — typed helpers throughout
// ═══════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server'
import { COOKIE_TOKEN, COOKIE_REFRESH } from '@/lib/auth/cookies'

const SUPABASE_URL  = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_KEY!
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

const IS_PROD = process.env.NODE_ENV === 'production'

// ── Response helpers ─────────────────────────────────────────
function ok(data: unknown)                 { return NextResponse.json(data, { status: 200 }) }
function fail(status: number, msg: string) { return NextResponse.json({ error: msg }, { status }) }
// Legacy alias — keeps all existing `err(...)` calls working
const err = fail

// ── httpOnly cookie writer ────────────────────────────────────
// Called after every successful login to move tokens off localStorage
function withAuthCookies(res: NextResponse, accessToken: string, refreshToken?: string | null): NextResponse {
  const base = { httpOnly: true, secure: IS_PROD, sameSite: 'strict' as const, path: '/' }
  res.cookies.set(COOKIE_TOKEN,   accessToken,  { ...base, maxAge: 60 * 60 })
  if (refreshToken) {
    res.cookies.set(COOKIE_REFRESH, refreshToken, { ...base, maxAge: 60 * 60 * 24 * 30 })
  }
  return res
}

// ── Distributed rate limiter ──────────────────────────────────
// Primary:  Upstash KV REST API (works across all Vercel instances/regions).
//           Set UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN in Vercel
//           env vars (Vercel Dashboard → Storage → KV → Connect, or
//           create a free Upstash account at upstash.com).
//           Uses a sliding INCR + EXPIRE pipeline — no npm package needed.
// Fallback: in-process Map used only when KV is not configured (local dev).
//           ⚠️  In-process fallback is NOT reliable across Vercel instances;
//           configure KV for production.
type RateEntry = { count: number; reset: number }
const rateLimitMap = new Map<string, RateEntry>()

async function rateLimit(key: string, maxHits = 5, windowMs = 60_000): Promise<boolean> {
  const kvUrl   = process.env.UPSTASH_REDIS_REST_URL
  const kvToken = process.env.UPSTASH_REDIS_REST_TOKEN

  if (kvUrl && kvToken) {
    // ── Upstash KV: INCR + EXPIRE pipeline ────────────────────
    try {
      const rlKey     = `rl:${key}`
      const windowSec = Math.ceil(windowMs / 1000)
      const res = await fetch(`${kvUrl}/pipeline`, {
        method:  'POST',
        headers: { Authorization: `Bearer ${kvToken}`, 'Content-Type': 'application/json' },
        body:    JSON.stringify([
          ['INCR',   rlKey],
          ['EXPIRE', rlKey, windowSec, 'NX'],  // NX = only set expiry on first write
        ]),
        signal: AbortSignal.timeout(1500),  // never stall auth for more than 1.5 s
      })
      if (res.ok) {
        const result = await res.json() as [[string, number], [string, number]]
        const count  = result[0][1]  // INCR return value
        return count <= maxHits      // true = allowed, false = blocked
      }
      // KV returned an unexpected status — log and fall through to in-process
      console.warn('[rateLimit] Upstash returned non-OK status:', res.status)
    } catch (e) {
      // KV unreachable (timeout / network) — fall through to in-process limiter
      console.warn('[rateLimit] Upstash unreachable, falling back to in-process limiter:', e)
    }
  }

  // ── In-process fallback (local dev / KV not yet configured) ─
  const now   = Date.now()
  const entry = rateLimitMap.get(key)
  if (!entry || now > entry.reset) {
    rateLimitMap.set(key, { count: 1, reset: now + windowMs })
    return true
  }
  if (entry.count >= maxHits) return false
  entry.count++
  return true
}

// Prune stale in-process entries every 5 minutes (dev only — no-op in production with KV)
setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of rateLimitMap) {
    if (now > entry.reset) rateLimitMap.delete(key)
  }
}, 5 * 60_000)

async function sbAuth(path: string, body: Record<string, unknown> | null = null, token?: string) {
  const url = `${SUPABASE_URL}/auth/v1${path}`
  const headers: Record<string, string> = {
    'Content-Type':  'application/json',
    'apikey':        SUPABASE_ANON,
    'Authorization': token ? `Bearer ${token}` : `Bearer ${SUPABASE_ANON}`,
  }
  const res = await fetch(url, {
    method: body !== null ? 'POST' : 'GET',
    headers,
    body:   body !== null ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(8_000),
  })
  const text = await res.text()
  const data = text ? JSON.parse(text) : {}
  if (!res.ok) throw { status: res.status, message: data.msg || data.error_description || data.message || 'Auth error' }
  return data
}

async function sbAdmin(method: string, path: string, body: Record<string, unknown> | null = null) {
  const url = `${SUPABASE_URL}${path}`
  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type':  'application/json',
      'apikey':        SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Prefer':        'return=representation',
    },
    body:   body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(8_000),
  })
  const text = await res.text()
  if (!res.ok) throw { status: res.status, message: text }
  return text ? JSON.parse(text) : null
}

type CustomerRow = Record<string, unknown>
type OrderRow    = Record<string, unknown>
type ItemRow     = { order_id: unknown; quantity: number; price_at_time: number; products?: { name?: string; emoji?: string; image_url?: string } }
type ReturnRow   = { order_id: unknown; id: unknown; status: string; reason?: string; created_at?: string; updated_at?: string }

async function syncCustomerProfile(user: { id: string; phone?: string; email?: string; user_metadata?: Record<string, string> }) {
  const phone = user.phone || ''
  const email = user.email || ''
  try {
    const orParts = [`auth_user_id.eq.${user.id}`]
    if (phone) orParts.push(`phone.eq.${encodeURIComponent(phone)}`)
    if (email) orParts.push(`email.eq.${encodeURIComponent(email)}`)

    const rows = await sbAdmin(
      'GET',
      `/rest/v1/customers?or=(${orParts.join(',')})&select=*&limit=3`
    ).catch(() => null) as CustomerRow[] | null

    if (rows && rows.length > 0) {
      let match = rows.find(r => r.auth_user_id === user.id)
        || rows.find(r => phone && r.phone === phone)
        || rows[0]

      if (match.auth_user_id !== user.id) {
        const patch: Record<string, unknown> = { auth_user_id: user.id }
        if (phone && !match.phone) patch.phone = phone
        await sbAdmin('PATCH', `/rest/v1/customers?id=eq.${match.id}`, patch).catch((e: unknown) => {
          console.warn('[syncCustomerProfile] patch failed — proceeding with stale match:', e)
        })
        match = { ...match, ...patch }
      }
      return match
    }

    const fullName  = user.user_metadata?.full_name || ''
    const nameParts = fullName.trim().split(' ')
    const newCustomer = await sbAdmin('POST', '/rest/v1/customers', {
      auth_user_id: user.id,
      first_name:   nameParts[0] || (email ? email.split('@')[0] : 'Customer'),
      last_name:    nameParts.slice(1).join(' ') || null,
      phone:        phone || null,
      email:        email || null,
    }) as CustomerRow[] | null
    return newCustomer && newCustomer[0] ? newCustomer[0] : null
  } catch (e: unknown) {
    console.warn('[syncCustomerProfile] failed:', e)
    return null
  }
}

async function getCustomerOrders(customerId: string) {
  try {
    const orders = await sbAdmin('GET',
      `/rest/v1/orders?customer_id=eq.${customerId}&order=created_at.desc&limit=20&select=id,order_number,total_amount,order_status,payment_status,payment_method,created_at,tracking_number,courier,shipped_at,delivered_at`
    ) as OrderRow[] | null
    if (!orders || !orders.length) return []

    const orderIds = orders.map(o => o.id)

    const [items, returns] = await Promise.all([
      sbAdmin('GET',
        `/rest/v1/order_items?order_id=in.(${orderIds.join(',')})&select=order_id,quantity,price_at_time,product_id,products(name,emoji,image_url)`
      ).catch(() => []) as Promise<ItemRow[]>,
      sbAdmin('GET',
        `/rest/v1/returns?order_id=in.(${orderIds.join(',')})&select=order_id,id,status,reason,created_at,updated_at`
      ).catch(() => []) as Promise<ReturnRow[]>,
    ])

    const returnMap: Record<string, ReturnRow> = {}
    ;(returns || []).forEach(r => { returnMap[String(r.order_id)] = r })

    const STATUS_MAP: Record<string, string> = {
      requested: 'return_requested', approved: 'return_approved',
      received: 'return_received', refunded: 'refunded',
      refund_initiated: 'refund_initiated', refund_completed: 'refund_completed',
      rejected: 'return_rejected',
    }

    return orders.map(o => {
      const ret = returnMap[String(o.id)]
      const displayStatus = ret ? (STATUS_MAP[ret.status] || 'return_requested') : String(o.order_status)
      return {
        ...o,
        _return: ret || null,
        _displayStatus: displayStatus,
        items: (items || [])
          .filter(i => String(i.order_id) === String(o.id))
          .map(i => ({
            qty:       i.quantity,
            price:     i.price_at_time,
            name:      i.products?.name      || 'Product',
            emoji:     i.products?.emoji     || '🌿',
            image_url: i.products?.image_url || null,
          }))
      }
    })
  } catch (e: unknown) {
    console.error('[getCustomerOrders] failed:', e)
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

  let body: Record<string, unknown> = {}
  try {
    body = await req.json()
  } catch {
    return err(400, 'Invalid JSON')
  }

  const { action } = body as { action?: string }

  // ── Keep-warm ping ──
  if (action === '_ping') return ok({ ok: true })

  // ── Rate limiting — applied to sensitive actions ──────────
  const RATE_LIMITED_ACTIONS = new Set([
    'send_otp', 'verify_otp', 'email_login', 'email_signup', 'change_password'
  ])
  if (RATE_LIMITED_ACTIONS.has(action || '')) {
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
              || req.headers.get('x-real-ip')
              || 'unknown'
    const rateLimitKey = `${action}:${ip}`
    if (!await rateLimit(rateLimitKey)) {
      return NextResponse.json(
        { error: 'Too many attempts. Please wait a minute before trying again.' },
        { status: 429, headers: { 'Retry-After': '60' } }
      )
    }
  }

  // ── OTP ──
  if (action === 'send_otp') {
    const { phone } = body as { phone?: string }
    if (!phone) return err(400, 'Phone required')
    const normalised = phone.startsWith('+') ? phone : '+91' + phone.replace(/\D/g, '').slice(-10)
    try {
      await sbAuth('/otp', { phone: normalised, channel: 'sms' })
      return ok({ success: true, message: 'OTP sent' })
    } catch (e: unknown) {
      const e2 = e as { status?: number; message?: string }
      const msg = e2.message || ''
      if (msg.toLowerCase().includes('unsupported') || msg.toLowerCase().includes('provider') || e2.status === 422) {
        return err(422, 'SMS_NOT_CONFIGURED')
      }
      return err(e2.status || 500, e2.message || 'Failed to send OTP')
    }
  }

  if (action === 'verify_otp') {
    const { phone, token } = body as { phone?: string; token?: string }
    if (!phone || !token) return err(400, 'Phone and OTP required')
    const normalised = (phone as string).startsWith('+') ? phone as string : '+91' + (phone as string).replace(/\D/g, '').slice(-10)
    try {
      const data = await sbAuth('/verify', { phone: normalised, token: token as string, type: 'sms' })
      const user = data.user || data
      if (!user || !user.id) return err(400, 'Verification failed')
      const profile = await syncCustomerProfile(user)
      // ✅ Set httpOnly cookies so tokens never touch localStorage
      const res = ok({
        success: true,
        user: { id: user.id, phone: user.phone || normalised, email: user.email || null }, profile,
      })
      return withAuthCookies(res as NextResponse, data.access_token, data.refresh_token)
    } catch (e: unknown) {
      const e2 = e as { status?: number; message?: string }
      return err(e2.status || 400, e2.message || 'Invalid OTP')
    }
  }

  // ── Email Signup — supports both old action name and new ──
  if (action === 'email_signup' || action === 'register_email') {
    const { email, password, full_name, name } = body as Record<string, string>
    const resolvedName = full_name || name || ''
    if (!email || !password) return err(400, 'Email and password required')
    if (password.length < 6)  return err(400, 'Password must be at least 6 characters')
    try {
      const data = await sbAuth('/signup', { email, password, data: { full_name: resolvedName } })
      const user = data.user || data
      if (!user || !user.id) return err(400, 'Signup failed — could not create user')
      const profile = await syncCustomerProfile(user)
      const res = ok({
        success: true,
        user: { id: user.id, email: user.email || email, phone: user.phone || null }, profile,
      })
      if (data.access_token) return withAuthCookies(res as NextResponse, data.access_token, data.refresh_token)
      return res
    } catch (e: unknown) {
      const e2 = e as { status?: number; message?: string }
      return err(e2.status || 400, e2.message || 'Signup failed')
    }
  }

  // ── Email Login — supports both old action name and new ──
  if (action === 'email_login' || action === 'login_email') {
    const { email, password } = body as { email?: string; password?: string }
    if (!email || !password) return err(400, 'Email and password required')
    try {
      const data = await sbAuth('/token?grant_type=password', { email: email as string, password: password as string })
      const user = data.user || data
      if (!user || !user.id) return err(401, 'Invalid email or password')
      const profile = await syncCustomerProfile(user)
      const res = ok({
        success: true,
        user: { id: user.id, email: user.email || email, phone: user.phone || null }, profile,
      })
      return withAuthCookies(res as NextResponse, data.access_token, data.refresh_token)
    } catch (e: unknown) {
      const e2 = e as { status?: number; message?: string }
      return err(e2.status || 401, e2.message || 'Invalid email or password')
    }
  }

  // ── Refresh Token ──
  if (action === 'refresh_token') {
    const { refresh_token } = body as { refresh_token?: string }
    if (!refresh_token) return err(400, 'refresh_token required')
    try {
      const data = await sbAuth('/token?grant_type=refresh_token', { refresh_token: refresh_token as string })
      const res = ok({ success: true })
      return withAuthCookies(res as NextResponse, data.access_token, data.refresh_token)
    } catch {
      return err(401, 'Session expired — please login again')
    }
  }

  // ── Get Profile (legacy — prefer GET /api/profile) ──
  if (action === 'get_profile') {
    const token = req.cookies.get('pr_token')?.value
              || (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
    if (!token) return err(401, 'Not logged in')
    try {
      const user    = await sbAuth('/user', null, token)
      const profile = await syncCustomerProfile(user)
      return ok({ success: true, user: { id: user.id, email: user.email, phone: user.phone }, profile })
    } catch {
      return err(401, 'Session expired — please login again')
    }
  }

  // ── Get Orders (legacy — prefer GET /api/orders) ──
  if (action === 'get_orders') {
    const token = req.cookies.get('pr_token')?.value
              || (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
    if (!token) return err(401, 'Not logged in')
    try {
      const user    = await sbAuth('/user', null, token)
      const profile = await syncCustomerProfile(user)
      const orders  = profile ? await getCustomerOrders(String(profile.id)) : []
      return ok({ success: true, orders })
    } catch {
      return err(401, 'Session expired — please login again')
    }
  }

  // ── Google OAuth — initiate ──
  if (action === 'google_oauth') {
    // Redirect to /auth/google-callback (a Next.js page) — more reliably deployed than an API route.
    // Also add this URL to your Supabase Google OAuth Authorized Redirect URLs.
    const redirectTo = process.env.NEXT_PUBLIC_SITE_URL
      ? `${process.env.NEXT_PUBLIC_SITE_URL}/auth/google-callback`
      : 'https://pahadiroots.com/auth/google-callback'
    const url = `${SUPABASE_URL}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(redirectTo)}`
    return ok({ url })
  }

  // ── Google Callback (token exchange) ──
  if (action === 'google_callback') {
    const { access_token, refresh_token } = body as { access_token?: string; refresh_token?: string }
    if (!access_token) return err(400, 'No access_token provided')
    try {
      const user = await sbAuth('/user', null, access_token as string)
      const profile = await syncCustomerProfile(user)
      const res = ok({
        success: true,
        user: { id: user.id, email: user.email, phone: user.phone || null }, profile,
      })
      return withAuthCookies(res as NextResponse, access_token as string, refresh_token)
    } catch (e: unknown) {
      const e2 = e as { message?: string }
      return err(401, 'Google login failed: ' + (e2.message || 'Unknown error'))
    }
  }

  // ── Link Email ──
  if (action === 'link_email') {
    const token = req.cookies.get('pr_token')?.value
              || (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
    const { email, password } = body as { email?: string; password?: string }
    if (!token)              return err(401, 'Not logged in')
    if (!email || !password) return err(400, 'Email and password required')
    try {
      const user = await sbAuth('/user', null, token)
      await sbAdmin('PUT', `/auth/v1/admin/users/${user.id}`, { email, password })
      const profile = await syncCustomerProfile(user)
      if (profile) await sbAdmin('PATCH', `/rest/v1/customers?id=eq.${profile.id}`, { email })
      return ok({ success: true, message: 'Email linked successfully' })
    } catch (e: unknown) {
      const e2 = e as { status?: number; message?: string }
      return err(e2.status || 400, e2.message || 'Failed to link email')
    }
  }

  // ── Link Phone ──
  if (action === 'link_phone') {
    const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
    const { phone } = body as { phone?: string }
    if (!token) return err(401, 'Not logged in')
    if (!phone) return err(400, 'Phone required')
    try {
      const normalised = phone.startsWith('+') ? phone : '+91' + phone.replace(/\D/g, '').slice(-10)
      const user = await sbAuth('/user', null, token)
      await sbAdmin('PUT', `/auth/v1/admin/users/${user.id}`, { phone: normalised })
      const profile = await syncCustomerProfile(user)
      if (profile) await sbAdmin('PATCH', `/rest/v1/customers?id=eq.${profile.id}`, { phone: normalised })
      return ok({ success: true, message: 'Phone linked successfully' })
    } catch (e: unknown) {
      const e2 = e as { status?: number; message?: string }
      return err(e2.status || 400, e2.message || 'Failed to link phone')
    }
  }

  // ── Update Profile ──
  if (action === 'update_profile') {
    const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
    if (!token) return err(401, 'Not logged in')
    const { first_name, last_name, address_line1, city, state, postal_code, phone: phoneUpdate, saved_addresses } = body as {
      first_name?: string; last_name?: string; address_line1?: string; city?: string
      state?: string; postal_code?: string; phone?: string; saved_addresses?: string
    }
    try {
      const user    = await sbAuth('/user', null, token)
      const profile = await syncCustomerProfile(user)
      if (!profile) return err(404, 'Profile not found')
      const updates: Record<string, unknown> = {}
      if (first_name      !== undefined) updates.first_name      = first_name
      if (last_name       !== undefined) updates.last_name       = last_name
      if (address_line1   !== undefined) updates.address_line1   = address_line1
      if (city            !== undefined) updates.city            = city
      if (state           !== undefined) updates.state           = state
      if (postal_code     !== undefined) updates.postal_code     = postal_code
      if (phoneUpdate     !== undefined) updates.phone           = phoneUpdate
      if (saved_addresses !== undefined) updates.saved_addresses = typeof saved_addresses === 'string' ? saved_addresses : JSON.stringify(saved_addresses)
      await sbAdmin('PATCH', `/rest/v1/customers?id=eq.${profile.id}`, updates)
      return ok({ success: true, profile: { ...profile, ...updates } })
    } catch (e: unknown) {
      const e2 = e as { status?: number; message?: string }
      return err(e2.status || 500, e2.message || 'Update failed')
    }
  }

  // ── Logout ──
  if (action === 'logout') {
    const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
    if (token) {
      try { await sbAuth('/logout', {}, token) }
      catch (e: unknown) { console.warn('[logout] Supabase session invalidation failed — local session still cleared:', e) }
    }
    return ok({ success: true })
  }

  // ── Forgot Password ──
  if (action === 'forgot_password') {
    const { email } = body as { email?: string }
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
      interface GenLinkResponse {
        action_link?: string
        properties?: { action_link?: string }
        data?: { action_link?: string }
        [key: string]: unknown
      }
      let genData: GenLinkResponse = {}
      try { genData = JSON.parse(genText) as GenLinkResponse }
      catch (e: unknown) { console.warn('[forgot_password] failed to parse generate_link response:', e) }
      if (!genRes.ok) { console.warn('[forgot_password] generate_link failed:', genRes.status); return ok({ success: true }) }
      const finalResetUrl = genData.action_link || genData.properties?.action_link || genData.data?.action_link || ''
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
    } catch (e: unknown) {
      const e2 = e as { status?: number; message?: string }
      return err(500, 'Something went wrong — please try again')
    }
  }

  // ── Reset Password ──
  if (action === 'reset_password') {
    const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
    const { password } = body as { password?: string }
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
    } catch (e: unknown) {
      const e2 = e as { status?: number; message?: string }
      return err(e2.status || 400, e2.message || 'Reset failed — link expired')
    }
  }

  // ── Change Password — requires current_password for verification ──
  if (action === 'change_password') {
    // Read token from httpOnly cookie first, fall back to Authorization header
    const token = req.cookies.get('pr_token')?.value
              || (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
    const { current_password, new_password } = body as { current_password?: string; new_password?: string }

    if (!token)            return err(401, 'Not logged in')
    if (!current_password) return err(400, 'Current password is required')
    if (!new_password || (new_password as string).length < 6) return err(400, 'New password must be at least 6 characters')
    if (current_password === new_password) return err(400, 'New password must be different from current password')

    try {
      // Step 1: verify identity — get user to find their email
      const user = await sbAuth('/user', null, token)
      if (!user?.email) return err(400, 'Cannot verify identity — no email on account')

      // Step 2: reauthenticate with current_password to prove ownership
      // This is the server-side equivalent of "verify current password"
      try {
        await sbAuth('/token?grant_type=password', {
          email:    user.email,
          password: current_password as string,
        })
      } catch {
        // Intentionally vague to avoid leaking whether account exists
        return err(401, 'Current password is incorrect')
      }

      // Step 3: update password via admin API (bypasses email confirmation)
      await sbAdmin('PUT', `/auth/v1/admin/users/${user.id}`, { password: new_password as string })
      return ok({ success: true, message: 'Password updated successfully' })
    } catch (e: unknown) {
      const e2 = e as { status?: number; message?: string }
      return err(e2.status || 400, e2.message || 'Password update failed')
    }
  }

  // ── Create Return ──
  if (action === 'create_return') {
    const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
    if (!token) return err(401, 'Not logged in')
    const { order_id, order_number, customer_name, reason, description, refund_amount, selected_items, is_partial } = body as {
      order_id?: string | number; order_number?: string; customer_name?: string; reason?: string
      description?: string; refund_amount?: string; selected_items?: Array<{ name?: string }>; is_partial?: boolean
    }
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
        description: description ? description : (is_partial && selected_items?.length) ? `Partial return: ${selected_items.map(i => i.name).join(', ')}` : null,
        refund_amount: refund_amount ? parseFloat(refund_amount) : null,
        status: 'requested', restock: true,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      })
      return ok({ success: true, return: returnRecord })
    } catch (e: unknown) {
      const e2 = e as { status?: number; message?: string }
      return err(e2.status || 500, e2.message || 'Return request failed')
    }
  }

  return err(400, `Unknown action: ${action}`)
}
