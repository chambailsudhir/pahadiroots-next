/**
 * proxy.ts — per-request strict CSP for /checkout and /account only.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

async function loadProxy() {
  vi.resetModules()
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon')
  return import('@/proxy')
}
const req = (path: string, method = 'GET') => new NextRequest(`https://pahadiroots.com${path}`, { method })
const settingsReply = (rows: { key: string; value: string }[]) => new Response(JSON.stringify(rows), { status: 200 })

// Routes by URL: the maintenance read asks for store_open, the CSP read asks for google_tag_id / cookie_consent_mode.
function stubFetch(csp: Response | Error) {
  const f = vi.fn(async (url: string) => {
    if (String(url).includes('store_open')) return new Response(JSON.stringify([{ value: 'true' }]), { status: 200 })
    if (csp instanceof Error) throw csp
    return csp.clone()
  })
  vi.stubGlobal('fetch', f)
  return f
}
const scriptSrc = (h: string | null) => (h ?? '').split('; ').find(d => d.startsWith('script-src')) ?? ''

describe('proxy strict CSP', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-01T10:00:00Z')) })
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals() })

  it('sends a nonce policy without unsafe-inline on /checkout, and the nonce reaches the render via request headers', async () => {
    stubFetch(settingsReply([{ key: 'google_tag_id', value: 'G-ABC123XYZ' }, { key: 'cookie_consent_mode', value: 'region' }]))
    const { proxy } = await loadProxy()
    const res = await proxy(req('/checkout'))
    const csp = res.headers.get('content-security-policy')
    const nonce = /'nonce-([^']+)'/.exec(scriptSrc(csp))?.[1]
    expect(nonce).toBeTruthy()
    expect(scriptSrc(csp)).not.toContain("'unsafe-inline'")
    expect(scriptSrc(csp)).toContain("'unsafe-eval'")                       // Razorpay
    // Next reads the policy from the REQUEST headers to stamp its own scripts with the nonce.
    expect(res.headers.get('x-middleware-request-content-security-policy')).toBe(csp)
    expect(res.headers.get('x-middleware-request-x-nonce')).toBe(nonce)
  })

  it('uses a different nonce for every request', async () => {
    stubFetch(settingsReply([]))
    const { proxy } = await loadProxy()
    const a = /'nonce-([^']+)'/.exec(scriptSrc((await proxy(req('/account'))).headers.get('content-security-policy')))![1]
    const b = /'nonce-([^']+)'/.exec(scriptSrc((await proxy(req('/account/orders/1'))).headers.get('content-security-policy')))![1]
    expect(a).not.toBe(b)
  })

  it('no unsafe-eval on /account (only checkout needs it)', async () => {
    stubFetch(settingsReply([]))
    const { proxy } = await loadProxy()
    expect(scriptSrc((await proxy(req('/account'))).headers.get('content-security-policy'))).not.toContain("'unsafe-eval'")
  })

  it('does not touch other pages (they keep the cacheable static policy)', async () => {
    const f = stubFetch(settingsReply([]))
    const { proxy } = await loadProxy()
    for (const p of ['/', '/products', '/accountant', '/order-success']) {
      const res = await proxy(req(p))
      expect(res.headers.get('content-security-policy')).toBeNull()
    }
    expect(f.mock.calls.some(c => String(c[0]).includes('cookie_consent_mode'))).toBe(false)
  })

  it('falls back to the normal policy (still works, never blocks our own scripts) if the settings cannot be read', async () => {
    stubFetch(new Error('network down'))
    const { proxy } = await loadProxy()
    const res = await proxy(req('/checkout'))
    const s = scriptSrc(res.headers.get('content-security-policy'))
    expect(s).toContain("'unsafe-inline'")
    expect(s).not.toContain('nonce-')
    expect(res.headers.get('x-middleware-request-x-nonce')).toBeNull()
  })

  it('reads the settings at most once a minute', async () => {
    const f = stubFetch(settingsReply([]))
    const { proxy } = await loadProxy()
    await proxy(req('/checkout')); await proxy(req('/account')); await proxy(req('/checkout'))
    expect(f.mock.calls.filter(c => String(c[0]).includes('cookie_consent_mode')).length).toBe(1)
  })
})
