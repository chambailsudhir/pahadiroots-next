// ═══════════════════════════════════════════════════════════════
// HimVeda by Pahadi Roots — Customer Auth API (Next.js App Router)
//
// CHANGES (security audit):
//  ✅ In-process rate limiter — protects OTP, login, change_password
//  ✅ httpOnly cookies written on every login action (verify_otp,
//     email_login, email_signup, refresh_token, google_callback)
//  ✅ change_password now requires current_password verification
//  ✅ `any` removed — typed helpers throughout
//  ✅ AUDIT S2-009: unused identity-mutating actions (link_email, link_phone,
//     update_profile, send_otp, verify_otp) removed — they allowed unverified
//     email/phone changes from a stolen 1 h cookie and had no caller. They now
//     answer 410 (see DISABLED_ACTIONS). Profile edits go through the hardened
//     /api/profile. create_return (also uncalled) stays for now but ignores the
//     client-supplied customer_name/order_number.
//  ✅ AUDIT S2-001: reset_password prefers the recovery bearer token over the
//     session cookie and enforces the 8-character policy.
// ═══════════════════════════════════════════════════════════════

import { NextRequest, NextResponse, after } from 'next/server'
import { COOKIE_TOKEN, COOKIE_REFRESH, COOKIE_OAUTH_VERIFIER, OAUTH_VERIFIER_MAX_AGE_SEC } from '@/lib/auth/cookies'
import { generatePkceVerifier, pkceChallenge, isPlausibleVerifier } from '@/lib/auth/pkce'
import { isRecoveryToken } from '@/lib/auth/recoveryToken'
import { cleanEmail, cleanName, isPasswordString, LOGIN_PASSWORD_MAX } from '@/lib/auth/inputLimits'
import { checkRateLimitKv, peekRateLimitKv } from '@/lib/api/rateLimitKv'
import { syncCustomerProfile, toPublicProfile, checkCsrf } from '@/lib/api/serverUtils'
import { RETURN_STATUS_TO_DISPLAY, RETURN_REASON_CODES } from '@/lib/account/constants'
import { validate as validators } from '@/lib/account/validation'
import { sendTransactionalEmail } from '@/lib/server/email'
import { captureError } from '@/lib/logger'
import { esc } from '@/lib/server/htmlEscape'

const SUPABASE_URL  = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_KEY!
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

const IS_PROD = process.env.NODE_ENV === 'production'

// AUDIT S2-001: password policy for the recovery flow (client + server agree).
// Not exported: Next only allows route handlers/config as route-module exports.
const RESET_PASSWORD_MIN_LENGTH = 8

// ── Response helpers ─────────────────────────────────────────
function ok(data: unknown)                 { return NextResponse.json(data, { status: 200 }) }
function fail(status: number, msg: string) { return NextResponse.json({ error: msg }, { status }) }
// Legacy alias — keeps all existing `err(...)` calls working
const err = fail

// ── httpOnly cookie writer ────────────────────────────────────
// Called after every successful login to move tokens off localStorage.
//
// SEC-FIX: changed sameSite from 'strict' to 'lax' to match session/route.ts
// and google-callback/route.ts. 'strict' caused auth cookies to be omitted on
// top-level cross-site navigations (WhatsApp links, email links) — the session
// appeared broken depending on which login method the user chose. All four
// cookie-writing paths must agree on SameSite.
function withAuthCookies(res: NextResponse, accessToken: string, refreshToken?: string | null): NextResponse {
  const base = { httpOnly: true, secure: IS_PROD, sameSite: 'lax' as const, path: '/' }
  res.cookies.set(COOKIE_TOKEN,   accessToken,  { ...base, maxAge: 60 * 60 })
  if (refreshToken) {
    res.cookies.set(COOKIE_REFRESH, refreshToken, { ...base, maxAge: 60 * 60 * 24 * 30 })
  }
  return res
}

// ── httpOnly cookie clearer ───────────────────────────────────
// Expires both auth cookies in a response. Used by logout so the browser
// actually removes them — setting maxAge:0 is the only reliable way to clear
// an httpOnly cookie from a server route.
function clearAuthCookies(res: NextResponse): NextResponse {
  const base = { httpOnly: true, secure: IS_PROD, sameSite: 'lax' as const, path: '/' }
  res.cookies.set(COOKIE_TOKEN,   '', { ...base, maxAge: 0 })
  res.cookies.set(COOKIE_REFRESH, '', { ...base, maxAge: 0 })
  return res
}

// ── Rate limiter ──────────────────────────────────────────────
// AUDIT (auth-B #3): this route used to carry its own limiter that fell back to a per-instance in-process
// Map when Upstash was unconfigured/erroring — useless across serverless instances. It now delegates to the
// shared checkRateLimitKv (Upstash, then the Postgres rate_limit_check fallback; see rateLimitKv.ts).
// true = allowed, false = blocked.
async function rateLimit(key: string, maxHits = 5, windowMs = 60_000): Promise<boolean> {
  return checkRateLimitKv(`mw:rl:auth_${key}`, maxHits, Math.ceil(windowMs / 1000))
}

// Failed-login counter per account (see email_login). Only FAILED credential checks increment it.
const LOGIN_FAIL_MAX    = 10
const LOGIN_FAIL_WINDOW = 15 * 60
const loginFailKey = (email: string) => `mw:rl:auth_login_fail:${email.toLowerCase()}`

function isCredentialFailure(status: number | undefined): boolean {
  return status === 400 || status === 401 || status === 422
}

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

    // BUG FIX (architecture): was a locally-duplicated, inconsistent copy —
    // mapped 'refunded' with no prefix (colliding with orders.payment_status'
    // own 'refunded' value) and included 'refund_initiated'/'refund_completed',
    // which don't exist in admin's real 5-value returns.status lifecycle. Now
    // reuses the single shared map (see constants.ts RETURN_STATUS_TO_DISPLAY).
    return orders.map(o => {
      const ret = returnMap[String(o.id)]
      const displayStatus = ret
        ? (RETURN_STATUS_TO_DISPLAY[ret.status] || String(o.order_status))
        : String(o.order_status)
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

// ── Sign-up verification e-mail fallback (account audit, Nov 2026 — ACC-025) ────────────────────────────
// Supabase Auth sends the confirmation e-mail through the SMTP server configured in the Supabase dashboard.
// When those credentials are invalid (live evidence: SMTP `535 Authentication credentials invalid`) EVERY
// sign-up fails with 500 "Error sending confirmation email" and the user is rolled back. Password reset never
// had this problem because it already avoids Supabase's mailer (admin generate_link + our own Resend sender).
// Sign-up now does the same, but ONLY when Supabase reports that it could not send its own mail — so a healthy
// SMTP setup keeps working exactly as before, and the day the credentials are fixed this path simply stops firing.
function isSupabaseMailFailure(e: { status?: number; message?: string }): boolean {
  return (e.status ?? 0) >= 500 && /sending|smtp|e-?mail|mailer/i.test(e.message || '')
}

async function signupViaOwnMailer(email: string, password: string, fullName: string) {
  const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.pahadiroots.com'
  const FRIENDLY = 'We created your account but could not send the verification e-mail right now. Please try again in a few minutes, or continue with Google.'
  try {
    // type "signup" creates the (unconfirmed) user AND returns the verification link WITHOUT sending any mail.
    const genRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` },
      body:    JSON.stringify({ type: 'signup', email, password, data: { full_name: fullName }, redirect_to: `${SITE_URL}/account?verified=1` }),
      signal:  AbortSignal.timeout(8_000),
    })
    const gen = await genRes.json().catch(() => ({})) as {
      id?: string; email?: string; phone?: string; msg?: string; error_code?: string
      action_link?: string; properties?: { action_link?: string }
    }
    if (!genRes.ok) {
      if (/already|registered|exists/i.test(`${gen.msg ?? ''} ${gen.error_code ?? ''}`)) {
        return err(400, 'An account with this email already exists. Please login instead.')
      }
      captureError(new Error(`signup fallback: generate_link failed (${genRes.status})`), { action: 'auth.signup.fallback_generate_link', alert: true })
      return err(503, FRIENDLY)
    }
    const link = gen.action_link || gen.properties?.action_link || ''
    if (!gen.id || !link) {
      captureError(new Error('signup fallback: generate_link returned no user/link'), { action: 'auth.signup.fallback_no_link', alert: true })
      return err(503, FRIENDLY)
    }
    const profile = await syncCustomerProfile({ id: gen.id, email: gen.email || email, phone: gen.phone || undefined, user_metadata: { full_name: fullName } })

    const firstName = esc(fullName.split(' ')[0] || 'there')
    const safeLink  = link.replace(/"/g, '%22')
    const mail = await sendTransactionalEmail({
      type:    'signup_verification',
      to:      email,
      subject: 'Verify your email — HimVeda by Pahadi Roots',
      html:    `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f5f0e8;font-family:Arial,sans-serif"><div style="max-width:520px;margin:32px auto;padding:0 16px"><div style="background:linear-gradient(135deg,#1a3a1e,#2d6a4f);border-radius:16px 16px 0 0;padding:32px 24px;text-align:center"><div style="font-size:36px">🌿</div><div style="font-size:22px;font-weight:900;color:#fff;font-family:Georgia,serif">HimVeda by Pahadi Roots</div></div><div style="background:#fff;border-radius:0 0 16px 16px;padding:36px 32px"><h2 style="font-family:Georgia,serif;color:#1a3a1e;margin:0 0 12px">Welcome, ${firstName}!</h2><p style="color:#555;font-size:15px;line-height:1.6">Please confirm your email address to finish creating your account.</p><p style="text-align:center;margin:28px 0"><a href="${safeLink}" style="display:inline-block;background:linear-gradient(135deg,#1a5c2a,#2d6a4f);color:#fff;padding:14px 36px;border-radius:12px;text-decoration:none;font-weight:700;font-size:15px">Verify my email</a></p><p style="color:#888;font-size:13px;line-height:1.5">This link works once and expires soon. If you did not create an account, you can ignore this email.</p></div></div></body></html>`,
      context: { user_id: gen.id },
    })
    if (!mail.sent && !mail.deadLettered) {
      captureError(new Error('signup fallback: verification e-mail could not be sent or queued'), { action: 'auth.signup.fallback_email', alert: true, error: mail.error })
      return err(503, FRIENDLY)
    }
    return ok({
      success: true, verification_sent: true,
      user: { id: gen.id, email: gen.email || email, phone: gen.phone || null }, profile: toPublicProfile(profile),
    })
  } catch (e) {
    captureError(e, { action: 'auth.signup.fallback', alert: true })
    return err(503, FRIENDLY)
  }
}

export async function POST(req: NextRequest) {
  if (!SUPABASE_URL || !SUPABASE_KEY || !SUPABASE_ANON) {
    return err(500, 'Server misconfigured — check env vars')
  }

  // ── CSRF check — protects all state-mutating actions ─────────────────────
  // This route handles login, logout, change_password, reset_password,
  // create_return — all state-mutating. Without CSRF validation
  // a cross-origin page can trigger any of these actions on a logged-in user
  // (e.g. CSRF logout, CSRF profile update, CSRF return creation).
  // _ping is exempted (no state mutation, used by keep-warm scheduler).
  let body: Record<string, unknown> = {}
  try {
    body = await req.json()
  } catch {
    return err(400, 'Invalid JSON')
  }

  const { action } = body as { action?: string }

  // ── Keep-warm ping — skip CSRF (no state mutation, called by cron/warmup) ──
  if (action === '_ping') return ok({ ok: true })

  const csrfError = checkCsrf(req)
  if (csrfError) return csrfError

  // ── Rate limiting — applied to sensitive actions ──────────
  // AUDIT R2 SF-1: forgot_password was unlimited — anyone could e-mail-bomb a registered address
  // (and burn Resend quota / sender reputation). Account-linking actions get the same throttle.
  // AUDIT S2-009: these actions had NO caller in the storefront (grep) yet let any
  // session holder set an arbitrary email/phone/password on the Auth user via the
  // admin API with no re-auth or verification (persistent takeover, squatting),
  // or write unvalidated profile fields; send_otp / verify_otp had no per-phone
  // throttle (SMS bombing if SMS is ever enabled).
  // Their implementations are removed. Answering 410 (not 400 "Unknown action")
  // keeps any stale client's failure mode explicit. OWNER DECISION: re-add only
  // behind Supabase's own email/phone-change confirmation + recent re-auth.
  // create_return is kept (auth-gated, ownership-checked, refund_amount forced
  // null — AUDIT R2 SF-2 test pins it) but no longer stores client-chosen
  // customer_name/order_number. OWNER DECISION: remove it once the SF-2 guard
  // is retargeted at /api/orders/[id]/return.
  const DISABLED_ACTIONS = new Set([
    'link_email', 'link_phone', 'update_profile', 'send_otp', 'verify_otp',
  ])
  if (DISABLED_ACTIONS.has(action || '')) {
    return err(410, 'This action is no longer available')
  }

  const RATE_LIMITED_ACTIONS = new Set([
    'email_login', 'email_signup', 'change_password', 'forgot_password', 'reset_password', 'google_callback',
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

  // ── Email Signup — supports both old action name and new ──
  if (action === 'email_signup' || action === 'register_email') {
    // AUDIT (auth-B #4): values are untyped JSON — check type + length BEFORE any Supabase call (a
    // non-string full_name used to throw in signupViaOwnMailer after the user already existed).
    const email    = cleanEmail(body.email)
    const password = body.password
    const nameIn   = cleanName(body.full_name ?? body.name)
    if (!email || typeof password !== 'string' || !password) return err(400, 'Email and password required')
    if (nameIn === null) return err(400, 'Name must be text of at most 100 characters')
    if (password.length > 128) return err(400, 'Password is too long')
    const resolvedName = nameIn ?? ''
    // AUDIT ACC-029: one password policy for sign-up AND change-password (was 6 chars here vs
    // 8 + upper + number + special in the account UI; the server only ever checked length).
    if (!validators.password.isValid(password)) {
      return err(400, 'Password must be at least 8 characters and include an uppercase letter, a number and a special character')
    }
    try {
      const data = await sbAuth('/signup', { email, password, data: { full_name: resolvedName } })
      const user = data.user || data
      if (!user || !user.id) return err(400, 'Signup failed — could not create user')
      const profile = await syncCustomerProfile(user)
      const res = ok({
        success: true,
        user: { id: user.id, email: user.email || email, phone: user.phone || null }, profile: toPublicProfile(profile),
      })
      if (data.access_token) return withAuthCookies(res as NextResponse, data.access_token, data.refresh_token)
      return res
    } catch (e: unknown) {
      const e2 = e as { status?: number; message?: string }
      // ACC-025: Supabase could not send ITS e-mail (bad SMTP credentials) → alert ops, then use our own mailer.
      if (isSupabaseMailFailure(e2)) {
        captureError(new Error(`Supabase Auth could not send the sign-up e-mail (${e2.message}) — SMTP credentials in Supabase → Auth → SMTP are probably invalid; using the Resend fallback`), {
          action: 'auth.signup.supabase_smtp_failed', alert: true,
        })
        return signupViaOwnMailer(email, password, resolvedName)
      }
      return err(e2.status || 400, e2.message || 'Signup failed')
    }
  }

  // ── Email Login — supports both old action name and new ──
  if (action === 'email_login' || action === 'login_email') {
    const email    = cleanEmail(body.email)
    const password = body.password
    if (!email || !isPasswordString(password, LOGIN_PASSWORD_MAX)) return err(400, 'Email and password required')
    // AUDIT ACC-034 (residual) + auth-B #3: besides the per-IP limiter, a botnet could hammer ONE account
    // from many addresses. The per-account counter counts only FAILED credential checks (it used to be
    // consumed before the password was checked, so a stranger sending 10 bad logins for a victim's e-mail
    // locked the victim out). Generic wording — identical for real and non-existent accounts.
    if (await peekRateLimitKv(loginFailKey(email), LOGIN_FAIL_MAX)) {
      return NextResponse.json(
        { error: 'Too many attempts. Please wait a few minutes before trying again.' },
        { status: 429, headers: { 'Retry-After': '900' } },
      )
    }
    try {
      const data = await sbAuth('/token?grant_type=password', { email, password })
      const user = data.user || data
      if (!user || !user.id) return err(401, 'Invalid email or password')
      const profile = await syncCustomerProfile(user)
      const res = ok({
        success: true,
        user: { id: user.id, email: user.email || email, phone: user.phone || null }, profile: toPublicProfile(profile),
      })
      return withAuthCookies(res as NextResponse, data.access_token, data.refresh_token)
    } catch (e: unknown) {
      const e2 = e as { status?: number; message?: string }
      if (isCredentialFailure(e2.status)) {
        const allowed = await checkRateLimitKv(loginFailKey(email), LOGIN_FAIL_MAX, LOGIN_FAIL_WINDOW)
        if (!allowed) {
          return NextResponse.json(
            { error: 'Too many attempts. Please wait a few minutes before trying again.' },
            { status: 429, headers: { 'Retry-After': '900' } },
          )
        }
      }
      return err(e2.status || 401, e2.message || 'Invalid email or password')
    }
  }

  // ── Refresh Token ──
  if (action === 'refresh_token') {
    // SEC-FIX: refresh token must be read from the httpOnly cookie, not the
    // request body. Reading from the body requires the client to store it in
    // JS-accessible memory, which defeats the point of httpOnly cookies.
    const rt = req.cookies.get(COOKIE_REFRESH)?.value
    if (!rt) return err(401, 'No refresh token — please login again')
    try {
      const data = await sbAuth('/token?grant_type=refresh_token', { refresh_token: rt })
      const res = ok({ success: true })
      return withAuthCookies(res as NextResponse, data.access_token, data.refresh_token)
    } catch {
      return err(401, 'Session expired — please login again')
    }
  }

  // ── Get Profile (legacy — prefer GET /api/profile) ──
  if (action === 'get_profile') {
    const token = req.cookies.get(COOKIE_TOKEN)?.value
              || (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
    if (!token) return err(401, 'Not logged in')
    try {
      const user    = await sbAuth('/user', null, token)
      const profile = await syncCustomerProfile(user)
      return ok({ success: true, user: { id: user.id, email: user.email, phone: user.phone }, profile: toPublicProfile(profile) })
    } catch {
      return err(401, 'Session expired — please login again')
    }
  }

  // ── Get Orders (legacy — prefer GET /api/orders) ──
  if (action === 'get_orders') {
    const token = req.cookies.get(COOKIE_TOKEN)?.value
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

  // ── Google OAuth — initiate (PKCE, bound to this browser) ──
  if (action === 'google_oauth') {
    // Redirect to /auth/google-callback (a Next.js page) — more reliably deployed than an API route.
    // Also add this URL to your Supabase Google OAuth Authorized Redirect URLs.
    const redirectTo = process.env.NEXT_PUBLIC_SITE_URL
      ? `${process.env.NEXT_PUBLIC_SITE_URL}/auth/google-callback`
      : 'https://www.pahadiroots.com/auth/google-callback'
    // AUDIT (auth-B #1): the old implicit flow returned tokens in the URL hash, with nothing tying the
    // return to the browser that started the flow (login CSRF / session fixation). We now use PKCE: the
    // verifier lives only in an HttpOnly cookie of THIS browser, the challenge goes to GoTrue, and the
    // code that comes back is useless without that cookie. (GoTrue chooses PKCE by the presence of
    // code_challenge; no dashboard switch is involved.)
    const verifier  = generatePkceVerifier()
    const challenge = pkceChallenge(verifier)
    const url = `${SUPABASE_URL}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(redirectTo)}`
              + `&code_challenge=${encodeURIComponent(challenge)}&code_challenge_method=s256`
    const res = ok({ url }) as NextResponse
    res.cookies.set(COOKIE_OAUTH_VERIFIER, verifier, {
      httpOnly: true, secure: IS_PROD, sameSite: 'lax', path: '/', maxAge: OAUTH_VERIFIER_MAX_AGE_SEC,
    })
    return res
  }

  // ── Google Callback (PKCE code exchange) ──
  if (action === 'google_callback') {
    // The verifier cookie is single-use: whatever happens below, it is cleared in the response.
    const clearVerifier = (r: NextResponse) => {
      r.cookies.set(COOKIE_OAUTH_VERIFIER, '', { httpOnly: true, secure: IS_PROD, sameSite: 'lax', path: '/', maxAge: 0 })
      return r
    }
    // Tokens supplied by the client are NOT accepted any more (see google_oauth) — only a code that this
    // browser's verifier cookie can redeem.
    const code     = body.code
    const verifier = req.cookies.get(COOKIE_OAUTH_VERIFIER)?.value
    if (typeof code !== 'string' || !code || code.length > 2048) {
      return clearVerifier(err(400, 'No authorization code provided') as NextResponse)
    }
    if (!isPlausibleVerifier(verifier)) {
      return clearVerifier(err(400, 'Google sign-in expired or was started in another browser. Please try again.') as NextResponse)
    }
    try {
      const tokens = await sbAuth('/token?grant_type=pkce', { auth_code: code, code_verifier: verifier })
      if (!tokens?.access_token) return clearVerifier(err(401, 'Google login failed') as NextResponse)
      const user = tokens.user?.id ? tokens.user : await sbAuth('/user', null, tokens.access_token as string)
      const profile = await syncCustomerProfile(user)
      const res = ok({
        success: true,
        user: { id: user.id, email: user.email, phone: user.phone || null }, profile: toPublicProfile(profile),
      }) as NextResponse
      withAuthCookies(res, tokens.access_token as string, tokens.refresh_token)
      return clearVerifier(res)
    } catch (e: unknown) {
      const e2 = e as { message?: string }
      return clearVerifier(err(401, 'Google login failed: ' + (e2.message || 'Unknown error')) as NextResponse)
    }
  }

  // ── Logout ──
  if (action === 'logout') {
    const token = req.cookies.get(COOKIE_TOKEN)?.value
               || (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
    const rt = req.cookies.get(COOKIE_REFRESH)?.value
    // AUDIT (auth-B #6): the access-token cookie lives 1 h (and is simply ABSENT after that), while the
    // refresh token lives 30 days. Revoking only with the access token therefore did nothing once it had
    // expired — the refresh token stayed valid server-side. Revoke with the access token when we have one;
    // otherwise (or when it is rejected) mint a fresh access token from the refresh token and revoke with
    // that. /logout defaults to scope=global, which kills the refresh token too.
    let revoked = false
    if (token) {
      try { await sbAuth('/logout', {}, token); revoked = true }
      catch (e: unknown) { console.warn('[logout] Supabase session invalidation failed:', e) }
    }
    if (!revoked && rt) {
      try {
        const fresh = await sbAuth('/token?grant_type=refresh_token', { refresh_token: rt })
        if (fresh?.access_token) { await sbAuth('/logout', {}, fresh.access_token as string); revoked = true }
      } catch (e: unknown) {
        console.warn('[logout] could not revoke session via refresh token — local session still cleared:', e)
      }
    }
    // SEC-FIX: the previous implementation returned ok({ success: true }) without
    // clearing the httpOnly cookies. pr_token and pr_refresh remained in the browser
    // until they naturally expired (1 h / 30 days). Fix: expire both immediately.
    const res = ok({ success: true })
    return clearAuthCookies(res as NextResponse)
  }

  // ── Forgot Password ──
  if (action === 'forgot_password') {
    const email = cleanEmail(body.email)
    if (!email) return err(400, 'Email required')
    // AUDIT (auth-B #5): the answer must be IDENTICAL whether or not the address is registered, whether a
    // mail was sent, or whether sending failed — no status / timing / error difference. The work therefore
    // runs after the response (next/server `after`); failures are logged internally only. Outside a request
    // scope (unit tests) `after` throws and the work simply runs inline.
    const GENERIC = { success: true, message: 'If that email is registered, a reset link has been sent.' }

    // AUDIT (auth-B #3): quota per e-mail + IP (an attacker only burns their OWN quota, never the victim's)
    // plus a higher per-e-mail ceiling against distributed mail-bombing. A hit answers with the same generic
    // success and sends nothing.
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown'
    const target = email.toLowerCase()
    const withinIpQuota   = await rateLimit(`forgot_password_email_ip:${target}:${ip}`, 3, 60 * 60_000)
    const withinGlobalCap = await rateLimit(`forgot_password_email:${target}`, 10, 60 * 60_000)
    if (!withinIpQuota || !withinGlobalCap) return ok(GENERIC)

    const RESEND_KEY = process.env.RESEND_API_KEY
    const SITE_URL   = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.pahadiroots.com'
    const work = async () => {
      if (!RESEND_KEY) {
        captureError(new Error('RESEND_API_KEY not set — password reset e-mails cannot be sent'), { action: 'auth.forgot_password.no_resend_key', alert: true })
        return
      }
      try {
        // Timeouts on every fetch: a slow Supabase/Resend response must not hang until Vercel's limit.
        const genRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` },
          body: JSON.stringify({ type: 'recovery', email, options: { redirect_to: `${SITE_URL}/reset-password` } }),
          signal: AbortSignal.timeout(8_000),
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
        // 4xx = unknown address (or similar): nothing to send, and nothing to tell the caller.
        if (!genRes.ok) { console.warn('[forgot_password] generate_link failed:', genRes.status); return }
        const finalResetUrl = genData.action_link || genData.properties?.action_link || genData.data?.action_link || ''
        if (!finalResetUrl) { captureError(new Error('forgot_password: generate_link returned no link'), { action: 'auth.forgot_password.no_link', alert: true }); return }
        const resendRes = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_KEY}` },
          signal: AbortSignal.timeout(8_000),
          body: JSON.stringify({
            from: 'HimVeda by Pahadi Roots <noreply@pahadiroots.com>', to: [email],
            subject: '🔑 Reset Your Password — HimVeda by Pahadi Roots',
            html: `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f5f0e8;font-family:Arial,sans-serif"><div style="max-width:520px;margin:32px auto;padding:0 16px"><div style="background:linear-gradient(135deg,#1a3a1e,#2d6a4f);border-radius:16px 16px 0 0;padding:36px 24px;text-align:center"><div style="font-size:40px;margin-bottom:8px">🌿</div><div style="font-size:24px;font-weight:900;color:#fff;font-family:Georgia,serif">HimVeda by Pahadi Roots</div></div><div style="background:#fff;border-radius:0 0 16px 16px;padding:40px 32px"><h2 style="font-family:Georgia,serif;color:#1a3a1e;margin:0 0 8px">Reset Your Password</h2><p style="color:#666;font-size:15px">Click the button below to set a new password.</p><div style="text-align:center;margin:32px 0"><a href="${finalResetUrl}" style="display:inline-block;background:linear-gradient(135deg,#1a5c2a,#2d6a4f);color:#fff;padding:18px 48px;border-radius:12px;text-decoration:none;font-weight:800;font-size:17px">🔑 Reset Password</a></div><p style="color:#aaa;font-size:12px;text-align:center">Need help? <a href="https://wa.me/919899984895" style="color:#2d6a4f">WhatsApp us</a></p></div></div></body></html>`,
          }),
        })
        if (!resendRes.ok) {
          const t = await resendRes.text()
          captureError(new Error(`forgot_password: Resend failed (${resendRes.status})`), { action: 'auth.forgot_password.resend_failed', alert: true, detail: t.slice(0, 300) })
        }
      } catch (e: unknown) {
        captureError(e, { action: 'auth.forgot_password.unexpected', alert: true })
      }
    }
    try { after(work) } catch { await work() }
    return ok(GENERIC)
  }

  // ── Reset Password ──
  if (action === 'reset_password') {
    // AUDIT S2-001 / auth-B #2: the ONLY accepted credential is the recovery token from the e-mail link,
    // sent by /reset-password as `Authorization: Bearer <access_token>`. The session-cookie fallback is
    // gone, and the token must be a RECOVERY session (JWT `amr` = recovery) — an ordinary login session
    // (unattended browser, stolen cookie, any bearer from a normal login) can no longer set a password
    // without the current password; that is what change_password is for.
    const bearer = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim()
    const { password } = body as { password?: unknown }
    if (!bearer || !isRecoveryToken(bearer)) return err(401, 'Invalid or expired reset link')
    const token = bearer
    // AUDIT S2-001: 8-character minimum (matches /reset-password's client policy).
    if (typeof password !== 'string' || password.length < RESET_PASSWORD_MIN_LENGTH) {
      return err(400, `Password must be at least ${RESET_PASSWORD_MIN_LENGTH} characters`)
    }
    if (password.length > 128) return err(400, 'Password is too long')
    // AUDIT ACC-029: same policy as sign-up / change-password.
    if (!validators.password.isValid(password)) {
      return err(400, 'Password must be at least 8 characters and include an uppercase letter, a number and a special character')
    }
    try {
      // BUG FIX: no timeout — hung until Vercel's 15 s limit on slow Supabase.
      const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON, 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ password }),
        signal: AbortSignal.timeout(8_000),
      })
      const data = await res.json()
      if (!res.ok) throw { status: res.status, message: data.msg || data.message || 'Reset failed' }
      // After a reset every other session of the account (a thief's included) must die. Best effort — the
      // password is already changed; the customer simply signs in again with the new one.
      try { await sbAuth('/logout?scope=global', {}, token) }
      catch (e: unknown) { console.warn('[reset_password] could not revoke sessions after reset:', e) }
      return ok({ success: true })
    } catch (e: unknown) {
      const e2 = e as { status?: number; message?: string }
      return err(e2.status || 400, e2.message || 'Reset failed — link expired')
    }
  }

  // ── Change Password — requires current_password for verification ──
  if (action === 'change_password') {
    // Read token from httpOnly cookie first, fall back to Authorization header
    const token = req.cookies.get(COOKIE_TOKEN)?.value
              || (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
    const { current_password, new_password } = body as { current_password?: unknown; new_password?: unknown }

    if (!token)            return err(401, 'Not logged in')
    if (!isPasswordString(current_password, LOGIN_PASSWORD_MAX)) return err(400, 'Current password is required')
    if (typeof new_password !== 'string' || new_password.length > 128 || !validators.password.isValid(new_password)) {
      return err(400, 'New password must be at least 8 characters and include an uppercase letter, a number and a special character')
    }
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
          password: current_password,
        })
      } catch {
        // AUDIT ACC-036: this used to be a 401. The account UI (and every other client of this
        // API) treats 401 as "session expired" and signs the user out — so typing a wrong
        // CURRENT password logged the customer out of the page. The session is fine; the input
        // is wrong → 400 with a stable machine-readable code.
        return NextResponse.json({ error: 'Current password is incorrect', code: 'wrong_current_password' }, { status: 400 })
      }

      // Step 3: update password via admin API (bypasses email confirmation)
      await sbAdmin('PUT', `/auth/v1/admin/users/${user.id}`, { password: new_password })
      // AUDIT (auth-B #2): revoke every OTHER session of this account (a thief's included); this one stays.
      // Best effort — the password change itself already succeeded.
      try { await sbAuth('/logout?scope=others', {}, token) }
      catch (e: unknown) { console.warn('[change_password] could not revoke other sessions:', e) }
      return ok({ success: true, message: 'Password updated successfully' })
    } catch (e: unknown) {
      const e2 = e as { status?: number; message?: string }
      // BUG FIX [ERROR HANDLING]: e2.message from sbAdmin() exposes raw Supabase errors.
      console.error('[change_password]', e)
      const msg = process.env.NODE_ENV === 'production' ? 'Password update failed' : (e2.message || 'Password update failed')
      return err(e2.status || 400, msg)
    }
  }

  // ── Create Return ──
  // CROSS-REPO CONSISTENCY FIX: this is a second, independent return-creation
  // entry point (grep confirms no current UI calls action=create_return —
  // it's unreferenced dead code as of this session) but it's still a live,
  // reachable API route writing into the same shared `returns` table as
  // /api/orders/[id]/return/route.ts. It had its own THIRD reason vocabulary
  // ('Wrong item received', 'Damaged product', ...) — different from both the
  // old storefront sentences AND admin's real codes. Aligned to
  // RETURN_REASON_CODES (admin's actual vocabulary — confirmed this session
  // via the real pahadi-admin repo) so if this path is ever wired up, it
  // can't silently diverge a third way. Also brought its idempotency check
  // and delivered/window rules in line with the primary route, since leaving
  // two return-creation paths with different business rules is exactly the
  // kind of partial fix this pass is meant to close out.
  if (action === 'create_return') {
    const token = req.cookies.get(COOKIE_TOKEN)?.value
               || (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
    if (!token) return err(401, 'Not logged in')
    const {
      order_id, order_number, customer_name, reason, description,
      refund_amount, selected_items, is_partial,
    } = body as {
      order_id?: string | number; order_number?: string; customer_name?: string; reason?: string
      description?: string; refund_amount?: string; selected_items?: Array<{ name?: string }>; is_partial?: boolean
    }
    if (!order_id || !reason) return err(400, 'order_id and reason required')
    // AUDIT R2 SF-2: order_id is interpolated into REST filters below — it must be a plain id.
    if (!/^[0-9]+$/.test(String(order_id)) && !/^[0-9a-f-]{36}$/i.test(String(order_id))) return err(400, 'Invalid order_id')

    if (!RETURN_REASON_CODES.includes(reason as typeof RETURN_REASON_CODES[number])) {
      return err(400, `Invalid reason. Must be one of: ${RETURN_REASON_CODES.join(', ')}`)
    }

    // BUG FIX: description had no length cap and no HTML stripping — a multi-MB
    // "Other" description would be stored verbatim in the DB and echoed in the
    // admin panel.  Cap at 500 characters and strip HTML tags (same treatment as
    // /api/orders/[id]/return/route.ts).
    const safeDescription = description
      ? description.toString().slice(0, 500).trim().replace(/<[^>]*>/g, '')
      : undefined
    try {
      const user = await sbAuth('/user', null, token)
      const profile = await syncCustomerProfile(user)
      if (!profile) return err(401, 'Profile not found')
      const orders = await sbAdmin('GET', `/rest/v1/orders?id=eq.${order_id}&customer_id=eq.${profile.id}&select=id,order_status,order_number,total_amount,delivered_at,updated_at`)
      if (!orders || !orders.length) return err(403, 'Order not found or does not belong to you')
      const order = orders[0]
      // Only delivered orders can be returned — matches the primary return
      // route. ('returned' dropped from the accepted set: order_status never
      // actually becomes 'returned' as part of the normal return flow — see
      // PAHADI_ROOTS_SESSION_REPORT.md §2 — so accepting it here just let a
      // stale/manually-set order back into the return flow inconsistently.)
      if (order.order_status !== 'delivered') {
        return err(400, `Returns are only accepted for delivered orders. Current status: ${order.order_status}`)
      }
      // BUG FIX (policy accuracy — flagged by founder): matches the primary
      // return route now — 48 hours, not 7 days (see /policies/returns).
      const deliveredDate = order.delivered_at || order.updated_at
      if (deliveredDate) {
        const hoursSince = (Date.now() - new Date(deliveredDate).getTime()) / 3_600_000
        if (hoursSince > 48) {
          return err(400, 'Return window has closed (48 hours from delivery)')
        }
      }
      // Idempotency: only a non-rejected existing return blocks a new request
      // — matches the primary route (a rejected return shouldn't lock a
      // customer out of ever requesting again).
      const existing = await sbAdmin(
        'GET',
        `/rest/v1/returns?order_id=eq.${order_id}&select=id,status&order=created_at.desc&limit=1`,
      ).catch(() => [])
      if (existing && existing.length > 0 && existing[0].status !== 'rejected') {
        return err(400, `A return request already exists for this order (status: ${existing[0].status}).`)
      }
      // AUDIT S2-009: order_number and customer_name used to be taken from the
      // client and shown verbatim in admin (spoofable display data). They now
      // come from the order row / the authenticated profile; the client values
      // are accepted for backwards compatibility but ignored.
      void order_number; void customer_name
      const profileName = [profile.first_name, profile.last_name]
        .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
        .join(' ').trim()
      const returnRecord = await sbAdmin('POST', '/rest/v1/returns', {
        order_id: Number(order_id), order_number: order.order_number,
        customer_name: profileName || null, reason,
        description: safeDescription
          ? safeDescription
          : (is_partial && selected_items?.length)
            ? `Partial return: ${selected_items.map(i => i.name).join(', ')}`
            : null,
        // AUDIT R2 SF-2: a customer must never choose the refund amount. It was stored as sent (negative,
        // NaN, or far above the order) and could be pre-filled in the admin refund screen. The amount is
        // set by staff (admin enforces <= order total and a cumulative per-order cap).
        refund_amount: null,
        status: 'requested', restock: true,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      })
      return ok({ success: true, return: returnRecord })
    } catch (e: unknown) {
      const e2 = e as { status?: number; message?: string }
      // BUG FIX [ERROR HANDLING]: e2.message from sbAdmin() exposes raw Supabase errors.
      console.error('[create_return]', e)
      const msg = process.env.NODE_ENV === 'production' ? 'Return request failed' : (e2.message || 'Return request failed')
      return err(e2.status || 500, msg)
    }
  }

  // BUG FIX: the previous response was `Unknown action: ${action}` — it reflected
  // the raw action value (from req.json()) directly into the response body.
  // If action contained special characters they'd be echoed verbatim.  Since this
  // is JSON the XSS risk is minimal, but echoing unvalidated user input in error
  // messages is against defensive coding practice and can aid enumeration.
  return err(400, 'Unknown action')
}
