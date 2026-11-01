import { createClient } from '@supabase/supabase-js'

const supabaseUrl  = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

// AUD-001/002/003: without a timeout, a Supabase outage (Cloudflare 522) leaves every server
// render hanging until the platform kills it (observed: 63-92s hangs, 300s function timeouts).
// Fail fast instead so ISR can keep serving the last good page and error.tsx can show a retry.
// Server-side only: browser clients keep default behaviour (uploads/auth must not be cut short).
const SERVER_DB_TIMEOUT_MS = 8000

const fetchWithTimeout: typeof fetch = (input, init) => {
  const timeout = AbortSignal.timeout(SERVER_DB_TIMEOUT_MS)
  const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout
  return fetch(input, { ...init, signal })
}

// Public anon client — used for all READ operations on the main site
// RLS ensures only public data is accessible
export const supabase = createClient(supabaseUrl, supabaseAnon, {
  auth: { persistSession: true, autoRefreshToken: true },
  ...(typeof window === 'undefined' ? { global: { fetch: fetchWithTimeout } } : {}),
})

// Server-side service client — ONLY used in /api/v1/* routes, never in components
// This function throws if called from client context (no service key in NEXT_PUBLIC_*)
export function getServiceClient() {
  const serviceKey = process.env.SUPABASE_SERVICE_KEY
  if (!serviceKey) throw new Error('SUPABASE_SERVICE_KEY not set — server-only operation')
  return createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: fetchWithTimeout },
  })
}
