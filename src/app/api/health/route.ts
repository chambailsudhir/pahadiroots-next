import { NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'

// ─────────────────────────────────────────────────────────────────────────────
// /api/health — infrastructure reachability check
//
// Returns 200 when all systems are reachable; 503 with a JSON body detailing
// which component(s) failed.  Designed to be polled by UptimeRobot, Vercel
// Analytics, or any uptime service every 1–5 minutes.
//
// Checks:
//   • Supabase DB — lightweight SELECT 1 via service client
//   • Upstash KV  — PING via REST API (only when env vars are present)
//
// Response shape:
//   { status: 'ok' | 'degraded', db: 'ok' | 'error', kv: 'ok' | 'unconfigured' | 'error', latency_ms: number }
//
// Security: does NOT return raw error messages in production (no DB internals
// leaked to public internet).  Vercel logs capture the full error server-side.
// ─────────────────────────────────────────────────────────────────────────────

const TIMEOUT_MS = 4000

async function checkDb(): Promise<{ ok: boolean; latencyMs: number }> {
  const start = Date.now()
  try {
    const db = getServiceClient()
    const { error } = await Promise.race([
      db.from('site_settings').select('key').limit(1),
      new Promise<{ error: Error }>((_res, rej) =>
        setTimeout(() => rej(new Error('DB timeout')), TIMEOUT_MS)
      ),
    ])
    if (error) throw error
    return { ok: true, latencyMs: Date.now() - start }
  } catch (err) {
    console.error('[health] DB check failed:', err instanceof Error ? err.message : err)
    return { ok: false, latencyMs: Date.now() - start }
  }
}

async function checkKv(): Promise<{ ok: boolean | null; latencyMs: number }> {
  const kvUrl   = process.env.UPSTASH_REDIS_REST_URL
  const kvToken = process.env.UPSTASH_REDIS_REST_TOKEN

  if (!kvUrl || !kvToken) {
    // Not configured — warn in production, treat as non-fatal
    if (process.env.NODE_ENV === 'production') {
      console.warn('[health] Upstash KV not configured — rate limiting is disabled. Set UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN.')
    }
    return { ok: null, latencyMs: 0 } // null = unconfigured
  }

  const start = Date.now()
  try {
    const res = await fetch(`${kvUrl}/ping`, {
      headers: { Authorization: `Bearer ${kvToken}` },
      signal:  AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!res.ok) throw new Error(`KV responded ${res.status}`)
    return { ok: true, latencyMs: Date.now() - start }
  } catch (err) {
    console.error('[health] KV check failed:', err instanceof Error ? err.message : err)
    return { ok: false, latencyMs: Date.now() - start }
  }
}

export const dynamic = 'force-dynamic'  // never cache health responses

export async function GET() {
  const [db, kv] = await Promise.all([checkDb(), checkKv()])

  const allOk    = db.ok && kv.ok !== false   // kv.ok=null (unconfigured) is non-fatal
  const status   = allOk ? 'ok' : 'degraded'
  const httpCode = allOk ? 200 : 503

  return NextResponse.json(
    {
      status,
      db:         db.ok ? 'ok' : 'error',
      kv:         kv.ok === null ? 'unconfigured' : kv.ok ? 'ok' : 'error',
      latency_ms: { db: db.latencyMs, kv: kv.latencyMs },
      timestamp:  new Date().toISOString(),
      // Hint in development so engineers know what to fix
      ...(process.env.NODE_ENV !== 'production' && !allOk
        ? { hint: 'Check Supabase / Upstash env vars and network access.' }
        : {}),
    },
    { status: httpCode }
  )
}
