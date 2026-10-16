// ─────────────────────────────────────────────────────────────────────────────
// lib/api/aiGuard.ts
//
// Oct 2026 audit (P0): /api/chat and /api/transcribe forward browser-supplied
// content to paid model APIs (Gemini, then Claude). They had no origin check, no
// rate limit and no size cap, and /api/chat even let the caller choose the system
// prompt and generation settings — an open proxy to our API keys. The page-level
// limiter in proxy.ts never covered them (it only matches /api/v1/*).
//
// This module is the single gate both routes pass through BEFORE any paid call:
//   1. same-origin only (Origin/Referer host must equal our own Host)
//   2. hard body-size cap (Content-Length, then the real byte length)
//   3. per-IP burst limit + per-IP hourly limit
//   4. global daily ceiling = a hard cost cap, whatever an attacker does
// Limits fail OPEN if the limiter backend is down (same policy as every other
// route-level limiter in this codebase, see rateLimitKv.ts) — the daily ceiling and
// the model provider's own quota are then the backstop.
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server'
import { checkRateLimitKv } from '@/lib/api/rateLimitKv'

export interface AiGuardOptions {
  /** Short name used in limiter keys + log lines. */
  name: string
  maxBodyBytes: number
  perMinute: number
  perHour: number
  /** Global ceiling across ALL visitors per UTC-rolling 24 h — the cost cap. */
  perDayGlobal: number
}

export function getClientIp(req: NextRequest): string {
  // Vercel overwrites x-forwarded-for with the real client address.
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
}

/**
 * Browsers always send Origin on a cross-origin or same-origin POST made with fetch(),
 * and Referer otherwise. We require one of them and require its host to equal ours.
 * This is a speed bump against drive-by use from other websites, NOT authentication —
 * a script can forge headers — which is why the rate limits below exist.
 */
export function isSameOrigin(req: NextRequest): boolean {
  const self = req.headers.get('host')
  const raw = req.headers.get('origin') || req.headers.get('referer')
  if (!self || !raw) return false
  try {
    return new URL(raw).host === self
  } catch {
    return false
  }
}

function deny(status: number, error: string, extra?: Record<string, string>) {
  return NextResponse.json({ error }, { status, headers: extra })
}

/** Returns a ready-to-send error response when the request must be refused, else null. */
export async function guardAiRequest(req: NextRequest, o: AiGuardOptions): Promise<NextResponse | null> {
  if (!isSameOrigin(req)) return deny(403, 'Forbidden')

  const declared = Number(req.headers.get('content-length') || '0')
  if (Number.isFinite(declared) && declared > o.maxBodyBytes) return deny(413, 'Request too large')

  const ip = getClientIp(req)
  if (!await checkRateLimitKv(`mw:rl:ai_${o.name}_min:${ip}`, o.perMinute, 60)) {
    return deny(429, 'Too many requests — please wait a moment', { 'Retry-After': '60' })
  }
  if (!await checkRateLimitKv(`mw:rl:ai_${o.name}_hr:${ip}`, o.perHour, 3600)) {
    return deny(429, 'Too many requests — please try again later', { 'Retry-After': '3600' })
  }
  if (!await checkRateLimitKv(`mw:rl:ai_${o.name}_day:global`, o.perDayGlobal, 86400)) {
    return deny(503, 'This assistant is temporarily unavailable. Please try again later.')
  }
  return null
}

/** Reads + parses a JSON body, enforcing the byte cap on what was actually received. */
export async function readCappedJson(req: NextRequest, maxBytes: number): Promise<{ ok: true; body: any } | { ok: false; res: NextResponse }> {
  let text: string
  try {
    text = await req.text()
  } catch {
    return { ok: false, res: deny(400, 'Invalid body') }
  }
  if (Buffer.byteLength(text, 'utf8') > maxBytes) return { ok: false, res: deny(413, 'Request too large') }
  try {
    return { ok: true, body: JSON.parse(text) }
  } catch {
    return { ok: false, res: deny(400, 'Invalid JSON body') }
  }
}

// ── /api/chat input shaping ──────────────────────────────────────────────────
export const CHAT_LIMITS = {
  maxBodyBytes: 400_000,     // system prompt (~100 KB, built in the browser) + 12 short turns
  maxSystemChars: 250_000,
  maxTurns: 12,
  maxTurnChars: 8_000,      // a model reply (max 1024 tokens ≈ 4 k chars) is echoed back as history
} as const

export interface ChatTurn { role: 'user' | 'model'; parts: [{ text: string }] }

/** Keeps only role + text of each turn; null when the shape is unusable. */
export function sanitizeChatContents(raw: unknown): ChatTurn[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > CHAT_LIMITS.maxTurns) return null
  const out: ChatTurn[] = []
  for (const c of raw) {
    const text = (c as any)?.parts?.[0]?.text
    const role = (c as any)?.role
    if (typeof text !== 'string' || text.length === 0 || text.length > CHAT_LIMITS.maxTurnChars) return null
    if (role !== 'user' && role !== 'model') return null
    out.push({ role, parts: [{ text }] })
  }
  if (out[out.length - 1].role !== 'user') return null
  return out
}

export function sanitizeSystemText(raw: unknown): string | null {
  const t = (raw as any)?.parts?.[0]?.text
  if (typeof t !== 'string') return ''
  return t.length > CHAT_LIMITS.maxSystemChars ? null : t
}

// ── /api/transcribe input shaping ────────────────────────────────────────────
// Vercel Functions reject request bodies above 4.5 MB, so anything larger can never
// be a legitimate recording; base64 inflates by 4/3.
export const TRANSCRIBE_MAX_BODY_BYTES = 4_500_000
const AUDIO_MIME = /^audio\/(webm|ogg|mp4|mpeg|mp3|wav|x-wav|aac|x-m4a|m4a|flac)(;.*)?$/i
export function isAllowedAudioMime(m: unknown): m is string {
  return typeof m === 'string' && m.length < 100 && AUDIO_MIME.test(m.trim())
}
