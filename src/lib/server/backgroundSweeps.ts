// ─────────────────────────────────────────────────────────────────────────────
// lib/server/backgroundSweeps.ts
//
// Nov 2026 audit (OPS-001): Vercel's free plan runs cron jobs once a day, but two sweeps are designed to run every few minutes:
//   • expire-pending-orders — releases stock held by an unpaid online order after ~30 min (and confirms a payment whose webhook was lost)
//   • retry-failed-emails   — re-sends confirmation e-mails that failed
// Once a day, an abandoned prepaid checkout kept its stock locked for ~24 h.
//
// Instead of needing an external scheduler (and a secret copied into it), the shop sweeps itself: whenever someone places an order
// or starts a payment, at most once every SWEEP_INTERVAL_SEC the server — AFTER it has answered the customer — calls the two
// existing, secured cron endpoints with the server's own CRON_SECRET (which never leaves the server). Idle store = nothing to
// sweep and nobody waiting for stock. Both endpoints are idempotent and single-winner, so overlapping with Vercel's daily call, a
// second instance or a manual run is harmless. Never throws and never delays the customer's response.
// ─────────────────────────────────────────────────────────────────────────────
import 'server-only'
import { checkRateLimitKvStrict } from '@/lib/api/rateLimitKv'
import { logger } from '@/lib/logger'

export const SWEEP_INTERVAL_SEC = 600
export const SWEEP_PATHS = ['/api/v1/cron/expire-pending-orders', '/api/v1/cron/retry-failed-emails'] as const

export interface SweepDeps {
  fetchImpl?: typeof fetch
  gate?:      (key: string, limit: number, windowSec: number) => Promise<'allowed' | 'blocked' | 'unavailable'>
  env?:       { CRON_SECRET?: string }
}

/**
 * Run the sweeps if one is due. Call it INSIDE Next's after() so the customer's response is never delayed:
 *     after(() => runBackgroundSweepsIfDue(new URL(req.url).origin))
 * `origin` is this deployment's own origin. Returns whether a sweep ran (false = throttled, unconfigured or limiter unavailable).
 */
export async function runBackgroundSweepsIfDue(origin: string, deps: SweepDeps = {}): Promise<boolean> {
  try {
    const secret = (deps.env ?? process.env).CRON_SECRET
    if (!secret || !/^https?:\/\//.test(origin)) return false
    const gate = deps.gate ?? checkRateLimitKvStrict
    // limit 1 per window: the first caller in each window wins, everyone else is 'blocked' (or the limiter is unavailable → skip)
    if (await gate('mw:sweep:background', 1, SWEEP_INTERVAL_SEC) !== 'allowed') return false

    // In PARALLEL (Nov 2026 verification): one after the other, the expiry sweep (up to ~25 s) ran first inside the order request's
    // after() phase, and the e-mail retry was usually cut off by the 40 s function limit — while this window's gate was already
    // spent, so failed confirmations waited for the next window or the daily cron.
    const doFetch = deps.fetchImpl ?? fetch
    await Promise.allSettled(SWEEP_PATHS.map(async path => {
      try {
        const res = await doFetch(origin + path, {
          headers: { Authorization: `Bearer ${secret}` },
          signal:  AbortSignal.timeout(25_000),
        })
        if (!res.ok) logger.warn('background sweep returned non-2xx', { action: 'sweeps.background', path, status: res.status })
      } catch (e) {
        logger.warn('background sweep failed', { action: 'sweeps.background', path, error: e instanceof Error ? e.message : String(e) })
      }
    }))
    return true
  } catch {
    return false   // a sweep problem must never affect an order
  }
}
