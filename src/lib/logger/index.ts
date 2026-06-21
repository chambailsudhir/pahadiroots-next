// ─────────────────────────────────────────────────────────────
// Structured Logger
//
// Dev:  pretty console output with context
// Prod: JSON lines (stdout) — ready for Vercel log drain,
//       Datadog, Logtail, or any structured log ingestion
//
// Drop-in Sentry replacement path:
//   Just swap captureError() body with Sentry.captureException()
//   when you add @sentry/nextjs — no other changes needed.
// ─────────────────────────────────────────────────────────────

type LogLevel = 'debug' | 'info' | 'warn' | 'error'
type LogContext = Record<string, unknown>

const IS_PROD     = process.env.NODE_ENV === 'production'
const IS_BROWSER  = typeof window !== 'undefined'
const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? 'dev'

function emit(level: LogLevel, message: string, context?: LogContext) {
  if (IS_PROD) {
    // Structured JSON — parseable by any log aggregator
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
    // Dev: readable colored output
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
}

/**
 * Capture an unexpected error with full context.
 * Swap body with Sentry.captureException(err, { extra: context })
 * when Sentry is added — no call-sites need to change.
 */
export function captureError(
  err: unknown,
  context: LogContext & { action?: string } = {},
) {
  const message = err instanceof Error ? err.message : String(err)
  const stack   = err instanceof Error ? err.stack   : undefined
  logger.error(message, { ...context, stack })
}
