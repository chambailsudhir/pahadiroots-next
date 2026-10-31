/**
 * next.config.js response headers (audit C-12 / HOME-027).
 *  - Exactly ONE Content-Security-Policy applies to any path (two would be merged by the browser and silently take
 *    the intersection, which could break checkout).
 *  - 'unsafe-eval' is sent ONLY for /checkout (Razorpay's checkout.js needs it) — not for the homepage or any other page.
 *  - The framework is not advertised via X-Powered-By.
 *  - The rest of the security headers still apply everywhere.
 */
import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { pathToRegexp } = require('next/dist/compiled/path-to-regexp') as { pathToRegexp: (p: string) => RegExp }
const config = require('../../next.config.js') as { poweredByHeader?: boolean; headers: () => Promise<{ source: string; headers: { key: string; value: string }[] }[]> }

const headersFor = async (path: string) => {
  const rules = (await config.headers()).filter(r => pathToRegexp(r.source).test(path))
  const flat = rules.flatMap(r => r.headers)
  return { flat, csp: flat.filter(h => h.key === 'Content-Security-Policy').map(h => h.value) }
}

describe('next.config.js headers', () => {
  it('hides the X-Powered-By header', () => { expect(config.poweredByHeader).toBe(false) })

  it.each(['/', '/products', '/products/sea-buckthorn', '/collections/himalayan-honey', '/cart', '/order-success', '/account/orders/1', '/api/v1/orders'])(
    'sends exactly one CSP for %s and it has NO unsafe-eval', async path => {
      const { csp } = await headersFor(path)
      expect(csp).toHaveLength(1)
      expect(csp[0]).not.toContain('unsafe-eval')
    })

  it.each(['/checkout', '/checkout/'])('keeps unsafe-eval (and Razorpay) on %s — payments must keep working', async path => {
    const { csp } = await headersFor(path)
    expect(csp).toHaveLength(1)
    expect(csp[0]).toContain("'unsafe-eval'")
    expect(csp[0]).toContain('https://checkout.razorpay.com')
  })

  it('the two policies differ ONLY by unsafe-eval', async () => {
    const home = (await headersFor('/')).csp[0], checkout = (await headersFor('/checkout')).csp[0]
    expect(checkout.replace("'unsafe-eval' ", '')).toBe(home)
  })

  it('still sends the other security headers on every route, including checkout', async () => {
    for (const path of ['/', '/checkout']) {
      const keys = (await headersFor(path)).flat.map(h => h.key)
      for (const k of ['Strict-Transport-Security', 'X-Frame-Options', 'X-Content-Type-Options', 'Referrer-Policy', 'Permissions-Policy', 'Content-Security-Policy'])
        expect(keys).toContain(k)
    }
  })

  it('keeps clickjacking and mixed-content protection in the policy', async () => {
    const csp = (await headersFor('/')).csp[0]
    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).toContain("object-src 'none'")
    expect(csp).toContain('upgrade-insecure-requests')
  })
})
