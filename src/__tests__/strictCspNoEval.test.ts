import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// Verification pass (1 Nov 2026): /account, which runs under the strict nonce CSP (no 'unsafe-eval'), reported two eval
// violations. Both came from the client bundle:
//  1. orderService.ts (imported by the account page) did `import crypto from 'crypto'`, which pulls Node's crypto polyfill
//     (crypto-browserify → asn1.js → vm-browserify, ~500 KB) into the browser bundle; asn1.js compiles via eval.
//  2. Zod 4 probes `Function("")` at first use to decide whether it may JIT-compile; the probe itself is a violation.
const src = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8')

describe('strict CSP: nothing in the client bundle needs eval', () => {
  it('orderService does not import the Node crypto module (it is shared with the account page)', () => {
    const code = src('lib/services/orderService.ts')
    expect(code).not.toMatch(/from ['"](node:)?crypto['"]/)
    expect(code).toContain('globalThis.crypto.randomUUID()')
  })

  it('zod runs jitless so it never probes Function("")', () => {
    for (const p of ['lib/services/profileService.ts', 'lib/schemas/index.ts']) {
      expect(src(p)).toContain('z.config({ jitless: true })')
    }
  })

  it('no client-reachable lib module imports node crypto', () => {
    // Modules under lib/ that client components import. Server-only modules live under lib/server, lib/api or app/api.
    for (const p of ['lib/services/profileService.ts', 'lib/services/orderService.ts', 'lib/services/pricingService.ts', 'lib/services/inventoryService.ts', 'lib/utils.ts', 'lib/consent.ts']) {
      expect(src(p), p).not.toMatch(/from ['"](node:)?crypto['"]/)
    }
  })
})

describe('guests do not call account-only APIs (they 401 and bill an invocation)', () => {
  it('checkout gates /api/profile and /api/v1/loyalty on a persisted user', () => {
    const code = src('hooks/useCheckoutPage.ts')
    const loyalty = code.indexOf("fetch('/api/v1/loyalty', { signal: ac.signal })")
    const profile = code.indexOf("fetch('/api/profile', { signal: ctrl.signal })")
    expect(loyalty).toBeGreaterThan(0)
    expect(profile).toBeGreaterThan(0)
    expect(code.slice(loyalty - 400, loyalty)).toContain('useUserStore.getState().user')
    expect(code.slice(profile - 200, profile)).toContain('useUserStore.getState().user')
  })

  it('the account page treats a browser with no persisted user as a guest without a network call', () => {
    const code = src('app/account/hooks/useAuth.ts')
    const gate = code.indexOf("if (!useUserStore.getState().user) { setAuthState('guest'); return }")
    const fetchAt = code.indexOf('await fetchProfile()')
    expect(gate).toBeGreaterThan(0)
    expect(gate).toBeLessThan(fetchAt)
  })
})
