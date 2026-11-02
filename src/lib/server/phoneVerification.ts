import 'server-only'

import { createHmac, timingSafeEqual } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import {
  fail, sbAuth, sbAdmin, getToken, tryRefresh, applyNewCookies, syncCustomerProfile,
  type RefreshResult,
} from '@/lib/api/serverUtils'
import { isEnabled } from '@/lib/siteSettingsHelpers'

/**
 * WhatsApp-inbound proof of phone ownership (db_migration_v25_phone_verification.sql). Shared by the start / status / enabled
 * routes and the Meta webhook. Costs nothing: the customer sends US a message (user-initiated messages are free to receive);
 * we never message anyone back.
 */

export const CODE_TTL_SECONDS = 10 * 60
export const MAX_ATTEMPTS     = 5
export const MOBILE_RE        = /^[6-9]\d{9}$/

/** Env needed to run the feature. All three must be set; the number is digits with country code (e.g. 919876543210). */
export function phoneVerifyEnv(): { number: string; appSecret: string; verifyToken: string } | null {
  const number      = (process.env.WHATSAPP_VERIFY_NUMBER ?? '').replace(/\D/g, '')
  const appSecret   = process.env.WHATSAPP_APP_SECRET ?? ''
  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN ?? ''
  if (!number || !appSecret || !verifyToken) return null
  return { number, appSecret, verifyToken }
}

let flagCache: { v: boolean; at: number } | null = null
const FLAG_TTL_MS = 15_000

/**
 * ON only when all three env vars are set AND site_settings.phone_verification_enabled !== 'false'. Env missing -> off without
 * touching the database. A failed settings read keeps the last known answer (default: on, since the env vars are the real gate).
 */
export async function isPhoneVerificationEnabled(): Promise<boolean> {
  if (!phoneVerifyEnv()) return false
  const now = Date.now()
  if (flagCache && now - flagCache.at < FLAG_TTL_MS) return flagCache.v
  let v = flagCache?.v ?? true
  try {
    const rows = await sbAdmin('GET', '/rest/v1/site_settings?key=eq.phone_verification_enabled&select=value&limit=1')
    const val: string | undefined = Array.isArray(rows) ? rows[0]?.value : undefined
    v = val === undefined || val === null ? true : isEnabled(String(val), true)
  } catch { /* keep last known */ }
  flagCache = { v, at: now }
  return v
}
export function _resetPhoneVerificationFlagCache() { flagCache = null }

export const notFound = () => NextResponse.json({ error: 'Not found' }, { status: 404 })

/** HMAC of the code, bound to the phone number so one hash cannot be replayed for another number. */
export function hashCode(code: string, phone10: string): string {
  const key = process.env.WHATSAPP_APP_SECRET ?? ''
  return createHmac('sha256', key).update(`pv1:${phone10}:${code}`).digest('hex')
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a), bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}

/** Meta signs the RAW body: `X-Hub-Signature-256: sha256=<hex hmac-sha256(app secret, body)>`. */
export function verifyMetaSignature(rawBody: string, header: string | null, appSecret: string): boolean {
  if (!header || !appSecret) return false
  const m = /^sha256=([0-9a-f]{64})$/i.exec(header.trim())
  if (!m) return false
  const expected = createHmac('sha256', appSecret).update(rawBody, 'utf8').digest('hex')
  return safeEqual(expected, m[1].toLowerCase())
}

export interface AuthedCustomer {
  userId:    string
  profile:   Record<string, unknown> & { id: number | string }
  refreshed: RefreshResult | null
}

/** Same session handling as /api/profile: cookie token, silent refresh, then the customer row. */
export async function authCustomer(req: NextRequest): Promise<AuthedCustomer | NextResponse> {
  let token = getToken(req)
  const refreshed = !token ? await tryRefresh(req) : null
  if (!token && !refreshed) return fail(401, 'Not logged in')
  if (refreshed) token = refreshed.token
  try {
    const user = await sbAuth('/user', null, token!)
    const profile = await syncCustomerProfile(user)
    if (!profile) return fail(404, 'Profile not found')
    return { userId: user.id as string, profile: profile as AuthedCustomer['profile'], refreshed }
  } catch (e) {
    const err = e as { status?: number; name?: string; message?: string }
    if (err.status === 401) return fail(401, 'Session expired — please login again')
    const transient = err.name === 'TimeoutError' || err.name === 'AbortError' || /timeout|fetch failed|network/i.test(err.message || '')
    return fail(transient ? 503 : 500, transient ? 'Service temporarily unavailable — please retry' : 'Request failed')
  }
}

/** JSON response with no-store and the refreshed session cookies, if any. */
export function authedJson(data: unknown, a: AuthedCustomer, status = 200): NextResponse {
  const res = NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } })
  if (a.refreshed) applyNewCookies(res, a.refreshed.token, a.refreshed.refresh)
  return res
}
