// ─────────────────────────────────────────────────────────────
// /api/auth/session — httpOnly cookie management
//
// Replaces localStorage token storage with server-set httpOnly cookies.
// XSS cannot read httpOnly cookies — this eliminates token theft via JS.
//
// GET  → { loggedIn: bool, hasRefresh: bool }  (no token exposed to client)
// POST → { action: 'set', access_token, refresh_token? } — write cookies
//        { action: 'clear' }                              — delete cookies
// ─────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server'

const IS_PROD = process.env.NODE_ENV === 'production'

export const COOKIE_TOKEN   = 'pr_token'
export const COOKIE_REFRESH = 'pr_refresh'

function cookieBase() {
  return {
    httpOnly: true,
    secure:   IS_PROD,
    sameSite: 'strict' as const,
    path:     '/',
  }
}

// ── GET — check if a session cookie exists (safe: never leaks token) ──
export async function GET(req: NextRequest) {
  const token   = req.cookies.get(COOKIE_TOKEN)?.value
  const refresh = req.cookies.get(COOKIE_REFRESH)?.value
  return NextResponse.json({ loggedIn: !!token, hasRefresh: !!refresh })
}

// ── POST — set or clear tokens ───────────────────────────────
export async function POST(req: NextRequest) {
  let body: { action?: string; access_token?: string; refresh_token?: string } = {}
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (body.action === 'set') {
    if (!body.access_token) return NextResponse.json({ error: 'access_token required' }, { status: 400 })
    const res = NextResponse.json({ ok: true })
    res.cookies.set(COOKIE_TOKEN,   body.access_token, { ...cookieBase(), maxAge: 60 * 60 })           // 1h
    if (body.refresh_token) {
      res.cookies.set(COOKIE_REFRESH, body.refresh_token, { ...cookieBase(), maxAge: 60 * 60 * 24 * 30 }) // 30d
    }
    return res
  }

  if (body.action === 'clear') {
    const res = NextResponse.json({ ok: true })
    res.cookies.set(COOKIE_TOKEN,   '', { ...cookieBase(), maxAge: 0 })
    res.cookies.set(COOKIE_REFRESH, '', { ...cookieBase(), maxAge: 0 })
    return res
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
