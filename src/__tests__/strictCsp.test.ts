import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildStrictCsp, layoutScriptHashes, sha256b64, STRICT_CSP_PATH, makeNonce } from '@/lib/strictCsp'
import { PREMIUM_BOOT_SCRIPT } from '@/lib/premiumMode'
import { ANALYTICS_URL_GUARD_SCRIPT } from '@/lib/analyticsGuard'
import { consentBootstrapScript, consentBootstrapInputs } from '@/lib/consent'

const scriptSrc = (csp: string) => csp.split('; ').find(d => d.startsWith('script-src'))!

describe('strict CSP for checkout and account', () => {
  it('applies to /checkout and /account (and below), not to look-alikes or other pages', () => {
    // Every route here is rendered per request, so the nonce reaches Next's inline scripts.
    for (const p of ['/checkout', '/checkout/pay', '/account', '/account/orders/1', '/regions/hp']) expect(STRICT_CSP_PATH.test(p), p).toBe(true)
    // ISR-cached pages keep the static policy. The listings became ISR in #146: under the nonce policy their prerendered
    // inline scripts were blocked in production and the pages never hydrated (Nov 2026 verification).
    for (const p of ['/', '/accountant', '/checkout-help', '/products', '/products/', '/collections/himalayan-honey', '/blog', '/lab-reports', '/new-arrivals', '/products/checkout', '/products/sea-buckthorn', '/blog/some-post', '/regions', '/collections', '/order-success', '/cart']) expect(STRICT_CSP_PATH.test(p), p).toBe(false)
  })

  it('every strict-CSP page is rendered per request (a prerendered page has no nonce and would not hydrate)', () => {
    const page = (rel: string) => readFileSync(join(process.cwd(), 'src/app', rel), 'utf8')
    const perRequest = (src: string) => /export const dynamic\s*=\s*['"]force-dynamic['"]/.test(src) || /await\s+searchParams/.test(src)
    expect(perRequest(page('checkout/page.tsx')), 'checkout').toBe(true)
    expect(perRequest(page('account/layout.tsx')), 'account').toBe(true)
    expect(perRequest(page('regions/[slug]/page.tsx')), 'regions/[slug]').toBe(true)
    // And the ISR listings must NOT be on the strict list while they stay ISR.
    for (const [rel, path] of [['products/page.tsx', '/products'], ['new-arrivals/page.tsx', '/new-arrivals'], ['blog/page.tsx', '/blog'], ['lab-reports/page.tsx', '/lab-reports'], ['collections/[slug]/page.tsx', '/collections/x']] as const) {
      if (!perRequest(page(rel))) expect(STRICT_CSP_PATH.test(path), path).toBe(false)
    }
  })

  it('has a nonce and hashes but NO unsafe-inline in script-src', () => {
    const nonce = makeNonce()
    const s = scriptSrc(buildStrictCsp({ pathname: '/account', nonce, google_tag_id: 'G-ABC123XYZ', cookie_consent_mode: 'region' }))
    expect(s).toContain(`'nonce-${nonce}'`)
    expect(s).toMatch(/'sha256-[A-Za-z0-9+/=]+'/)
    expect(s).not.toContain("'unsafe-inline'")
    expect(s).not.toContain("'unsafe-eval'")
  })

  it('keeps unsafe-eval and the Razorpay hosts on /checkout only (payments must keep working)', () => {
    const co = scriptSrc(buildStrictCsp({ pathname: '/checkout', nonce: 'n' }))
    expect(co).toContain("'unsafe-eval'"); expect(co).toContain('https://checkout.razorpay.com'); expect(co).not.toContain("'unsafe-inline'")
    expect(scriptSrc(buildStrictCsp({ pathname: '/account/orders', nonce: 'n' }))).not.toContain("'unsafe-eval'")
  })

  it('hashes exactly the three inline scripts the root layout renders — byte for byte', () => {
    const inputs = { google_tag_id: 'G-ABC123XYZ', cookie_consent_mode: 'always' }
    const { tagId, consentMode } = consentBootstrapInputs(inputs)
    const want = [PREMIUM_BOOT_SCRIPT, ANALYTICS_URL_GUARD_SCRIPT, consentBootstrapScript(tagId, consentMode)]
      .map(t => createHash('sha256').update(t, 'utf8').digest('base64'))
    expect(layoutScriptHashes(inputs)).toEqual(want)
    expect(sha256b64('x')).toBe(createHash('sha256').update('x').digest('base64'))
  })

  it('a different tag id or consent mode changes the consent-script hash (so the proxy must read the live values)', () => {
    const a = layoutScriptHashes({ google_tag_id: 'G-ABC123XYZ', cookie_consent_mode: 'region' })[2]
    expect(layoutScriptHashes({ google_tag_id: 'G-OTHER99999', cookie_consent_mode: 'region' })[2]).not.toBe(a)
    expect(layoutScriptHashes({ google_tag_id: 'G-ABC123XYZ', cookie_consent_mode: 'always' })[2]).not.toBe(a)
  })

  it('an invalid tag id is dropped exactly like the layout does (empty id, same hash as no id)', () => {
    expect(layoutScriptHashes({ google_tag_id: "x');alert(1);//", cookie_consent_mode: 'region' }))
      .toEqual(layoutScriptHashes({ google_tag_id: '', cookie_consent_mode: 'region' }))
  })

  it('keeps every other protection from the normal policy', () => {
    const csp = buildStrictCsp({ pathname: '/checkout', nonce: 'n' })
    for (const d of ["default-src 'self'", "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'", 'upgrade-insecure-requests']) expect(csp).toContain(d)
  })

  it('mints a different nonce every time', () => { expect(makeNonce()).not.toBe(makeNonce()) })
})
