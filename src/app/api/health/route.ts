import { NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import { logger } from '@/lib/logger'

// /api/health — infrastructure reachability check
//
// OBSERVABILITY FIXES:
//
// BUG 17a — no `version` field in response.
//   Uptime monitors checking /api/health had no way to confirm which build was
//   live after a deployment. Added NEXT_PUBLIC_APP_VERSION (or git SHA fallback).
//
// BUG 17b — Razorpay config not checked.
//   A missing RAZORPAY_KEY_ID/SECRET caused checkout to fail for all customers
//   with a cryptic 500, but /api/health returned 200 giving ops no warning.
//   Added Razorpay config sanity check (no live API call — just env var presence).
//
// BUG 17c — KV "unconfigured" treated as 200+OK with no indication in body.
//   Now explicitly marks kv:"unconfigured" in the response JSON and logs a
//   structured warning so ops can see it without tailing raw logs.
//
// BUG 17d — no latency metrics.
//   DB and KV round-trip times are now emitted via logger.metric() so they
//   appear in log-aggregator dashboards without any additional APM product.

export const dynamic = 'force-dynamic'

const TIMEOUT_MS = 4000

const APP_VERSION =
  process.env.NEXT_PUBLIC_APP_VERSION ??
  process.env.APP_VERSION ??
  process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ??
  'dev'

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
    // BUG FIX 17c: structured warning in production so it shows in logs
    if (process.env.NODE_ENV === 'production') {
      console.warn('[health] Upstash KV not configured — rate limiting is disabled')
    }
    return { ok: null, latencyMs: 0 }
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

// BUG FIX 17b: Razorpay config sanity check
// No live API call — just verify the required env vars are present.
function checkRazorpay(): { ok: boolean; reason?: string } {
  const keyId      = process.env.RAZORPAY_KEY_ID?.trim()
  const keySecret  = process.env.RAZORPAY_KEY_SECRET?.trim()
  const webhookSec = process.env.RAZORPAY_WEBHOOK_SECRET?.trim()
  if (!keyId || !keySecret) {
    console.error('[health] Razorpay keys not configured — payments will fail')
    return { ok: false, reason: 'keys_missing' }
  }
  if (!webhookSec) {
    console.warn('[health] RAZORPAY_WEBHOOK_SECRET not configured — webhook verification disabled')
    return { ok: false, reason: 'webhook_secret_missing' }
  }
  return { ok: true }
}

export async function GET() {
  const startAll = Date.now()
  const [db, kv] = await Promise.all([checkDb(), checkKv()])
  const rzp      = checkRazorpay()

  // BUG FIX 17d: emit latency metrics for log-aggregator dashboards
  logger.metric('health.db.latency_ms',    db.latencyMs,          'ms')
  logger.metric('health.kv.latency_ms',    kv.latencyMs,          'ms')
  logger.metric('health.total.latency_ms', Date.now() - startAll, 'ms')

  const allOk    = db.ok && kv.ok !== false && rzp.ok
  const httpCode = allOk ? 200 : 503

  const kvWarning = kv.ok === null
    ? 'Rate limiting disabled — set UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN'
    : undefined

  return NextResponse.json(
    {
      status:     allOk ? 'ok' : 'degraded',
      // BUG FIX 17a: version field so uptime monitors confirm correct build is live
      version:    APP_VERSION,
      db:         db.ok ? 'ok' : 'error',
      kv:         kv.ok === null ? 'unconfigured' : kv.ok ? 'ok' : 'error',
      razorpay:   rzp.ok ? 'ok' : `error:${rzp.reason ?? 'config_missing'}`,
      latency_ms: { db: db.latencyMs, kv: kv.latencyMs, total: Date.now() - startAll },
      timestamp:  new Date().toISOString(),
      ...(kvWarning ? { kv_warning: kvWarning } : {}),
    },
    { status: httpCode }
  )
}
