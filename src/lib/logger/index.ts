// ─────────────────────────────────────────────────────────────────────────────
// lib/logger/index.ts — Structured Logger
//
// Dev:  pretty console output with context
// Prod: JSON lines (stdout) — ready for Vercel Log Drain, Datadog, Logtail
//
// Drop-in Sentry path: swap captureError() body with Sentry.captureException()
// when @sentry/nextjs is added — no other call-sites need to change.
//
// OBSERVABILITY FIXES in this version:
//
// BUG 16a — APP_VERSION was 'dev' with no Vercel git SHA fallback.
//   Next.js server-side code can read VERCEL_GIT_COMMIT_SHA (not a NEXT_PUBLIC_
//   var, so it's not exposed to the browser). Added full fallback chain:
//   NEXT_PUBLIC_APP_VERSION → APP_VERSION → VERCEL_GIT_COMMIT_SHA (7 chars) → 'dev'
//
// BUG 16b — No metric() or trackLatency() — added both.
//   logger.metric(name, value, unit, ctx?) emits a structured JSON line with
//   level:"metric" that log aggregators can filter into dashboards without any
//   additional APM product. Noop in dev so tests stay clean.
//
//   trackLatency(operationName) → done(ctx?) tracks wall-clock ms for any
//   async operation. Call at entry, call done() at exit. Emits a latency_ms
//   metric line. Usage:
//     const done = trackLatency('orders.create')
//     const order = await createOrder(...)
//     done({ order_id: order.id })
//
// BUG 16c — captureError() had no alert flag.
//   Now accepts alert?: true in context. When set the JSON line includes
//   "alert": true so a Logtail alert rule / Datadog monitor / Vercel Log Drain
//   filter can page ops without requiring a full Sentry integration.
//   Use for: payment failures, loyalty RPC errors, webhook processing failures,
//   dead-letter email exhaustion, missing env var detection.
// ─────────────────────────────────────────────────────────────────────────────

type LogLevel  = 'debug' | 'info' | 'warn' | 'error'
type LogContext = Record<string, unknown>

const IS_PROD    = process.env.NODE_ENV === 'production'
const IS_BROWSER = typeof window !== 'undefined'

// BUG FIX 16a: full fallback chain for version string
const APP_VERSION =
  process.env.NEXT_PUBLIC_APP_VERSION ??
  process.env.APP_VERSION ??
  process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ??
  'dev'

function emit(level: LogLevel, message: string, context?: LogContext) {
  if (IS_PROD) {
    const entry = JSON.stringify({
      ts:      new Date().toISOString(),
      level,
      message,
      app:     'pahadiroots',
      version: APP_VERSION,
      env:     IS_BROWSER ? 'browser' : 'server',
      ...context,
    })
    if (level === 'error' || level === 'warn') console.error(entry)
    else console.log(entry)
  } else {
    const prefix = {
      debug: '🔍 [DEBUG]',
      info:  'ℹ️  [INFO] ',
      warn:  '⚠️  [WARN] ',
      error: '🔴 [ERROR]',
    }[level]
    const fn = level === 'error' ? console.error
             : level === 'warn'  ? console.warn
             : console.log
    fn(`${prefix} ${message}`, context ?? '')
  }
}

// ── Public API ────────────────────────────────────────────────

export const logger = {
  debug: (msg: string, ctx?: LogContext) => { if (!IS_PROD) emit('debug', msg, ctx) },
  info:  (msg: string, ctx?: LogContext) => emit('info',  msg, ctx),
  warn:  (msg: string, ctx?: LogContext) => emit('warn',  msg, ctx),
  error: (msg: string, ctx?: LogContext) => emit('error', msg, ctx),

  /**
   * BUG FIX 16b: emit a named metric as a structured log line.
   * Prod-only (noop in dev — keeps test output clean).
   * Any log aggregator that filters JSON fields can build dashboards from these
   * lines without extra instrumentation.
   *
   * Example:
   *   logger.metric('order.create.latency_ms', 342, 'ms', { order_id })
   *   logger.metric('email.dlq.dead', 1, 'count', { type: 'order_confirmation' })
   */
  metric: (name: string, value: number, unit: string, ctx?: LogContext) => {
    if (!IS_PROD) return
    const entry = JSON.stringify({
      ts:      new Date().toISOString(),
      level:   'metric',
      name,
      value,
      unit,
      app:     'pahadiroots',
      version: APP_VERSION,
      env:     IS_BROWSER ? 'browser' : 'server',
      ...ctx,
    })
    console.log(entry)
  },
}

/**
 * BUG FIX 16c: capture an unexpected error with full context.
 * Swap body with Sentry.captureException(err, { extra: context }) when
 * @sentry/nextjs is added — no call-sites need to change.
 *
 * The optional `alert: true` in context emits "alert": true in the JSON line
 * so a Logtail / Datadog alert rule can page ops without Sentry. Use for:
 *   • Payment verification failures
 *   • Webhook processing errors
 *   • Loyalty RPC errors that skip points on a paid order
 *   • Dead-letter email exhaustion (MAX_DLQ_ATTEMPTS reached)
 *   • Missing critical env vars (RAZORPAY_WEBHOOK_SECRET, KV credentials)
 */
export function captureError(
  err:     unknown,
  context: LogContext & { action?: string; alert?: boolean } = {},
) {
  const message = err instanceof Error ? err.message : String(err)
  const stack   = err instanceof Error ? err.stack   : undefined
  logger.error(message, { ...context, stack })
}

/**
 * BUG FIX 16b: track wall-clock latency for a named operation.
 * Returns a done(extraCtx?) callback; call at the end of the operation to
 * emit a metric line with the elapsed milliseconds.
 *
 * Example:
 *   const done = trackLatency('orders.create')
 *   const order = await createOrder(...)
 *   done({ order_id: order.id, method: 'cod' })
 *   // → emits { level:'metric', name:'orders.create.latency_ms', value:312, unit:'ms' }
 */
export function trackLatency(
  operationName: string,
): (extraCtx?: LogContext) => void {
  const start = Date.now()
  return (extraCtx?: LogContext) => {
    logger.metric(`${operationName}.latency_ms`, Date.now() - start, 'ms', extraCtx)
  }
}

// ── AUDIT G2 B1: request correlation id ──────────────────────────────────────
// Every API log line for one request should carry the same `requestId`, and the
// error response should echo it so a customer's screenshot can be matched to the
// log. Vercel already stamps `x-vercel-id` on every request; we reuse it (or an
// upstream `x-request-id`), falling back to a UUID so local/dev requests get one too.
type HeaderReader = { get(name: string): string | null } | null | undefined

export function getRequestId(headers: HeaderReader): string {
  const fromHeader = headers?.get('x-vercel-id') || headers?.get('x-request-id') || ''
  const clean = fromHeader.trim().slice(0, 128)
  if (clean && /^[A-Za-z0-9:_\-.]+$/.test(clean)) return clean
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

export type RequestLogger = typeof logger & { requestId: string }

/** A logger whose every line carries `requestId` (plus any fixed context such as `route`). */
export function requestLogger(requestId: string, base: LogContext = {}): RequestLogger {
  const ctx = { ...base, requestId }
  return {
    requestId,
    debug:  (m, c) => logger.debug(m, { ...ctx, ...c }),
    info:   (m, c) => logger.info(m,  { ...ctx, ...c }),
    warn:   (m, c) => logger.warn(m,  { ...ctx, ...c }),
    error:  (m, c) => logger.error(m, { ...ctx, ...c }),
    metric: (n, v, u, c) => logger.metric(n, v, u, { ...ctx, ...c }),
  }
}

/** Header name API responses use to echo the correlation id. */
export const REQUEST_ID_HEADER = 'x-request-id'

/** Sets the correlation header on a Response-like object and returns it (chainable). */
export function withRequestId<T extends { headers: { set(name: string, value: string): void } }>(res: T, requestId: string): T {
  res.headers.set(REQUEST_ID_HEADER, requestId)
  return res
}
