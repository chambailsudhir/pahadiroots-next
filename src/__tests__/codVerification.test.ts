import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('server-only', () => ({}))
import { decideCodRisk, makeCodRiskGate, hashCodToken, hashCodCode, newCodCode, DEFAULT_VERIFY_ABOVE } from '@/lib/server/codVerification'
import { CheckoutRejectedError } from '@/lib/errors/checkoutErrors'

beforeEach(() => { vi.stubEnv('SUPABASE_SERVICE_KEY', 'svc-test') })

describe('decideCodRisk (owner rules, Nov 2026)', () => {
  const s = {} as Record<string, string | undefined>
  it('a returning customer under the limit orders without any extra step', () => {
    expect(decideCodRisk({ settings: s, codTotal: 900, deliveredCount: 2, rtoCount: 0 })).toBe('ok')
  })
  it('a FIRST order needs the code', () => {
    expect(decideCodRisk({ settings: s, codTotal: 300, deliveredCount: 0, rtoCount: 0 })).toBe('verify')
  })
  it(`a COD total above ₹${DEFAULT_VERIFY_ABOVE} needs the code, at or below does not`, () => {
    expect(decideCodRisk({ settings: s, codTotal: DEFAULT_VERIFY_ABOVE + 1, deliveredCount: 3, rtoCount: 0 })).toBe('verify')
    expect(decideCodRisk({ settings: s, codTotal: DEFAULT_VERIFY_ABOVE, deliveredCount: 3, rtoCount: 0 })).toBe('ok')
  })
  it('a phone with an earlier COD refusal cannot use COD at all', () => {
    expect(decideCodRisk({ settings: s, codTotal: 200, deliveredCount: 5, rtoCount: 1 })).toBe('blocked')
  })
  it('owner settings: verification off, a custom limit, the RTO block off', () => {
    expect(decideCodRisk({ settings: { cod_verification_enabled: 'false' }, codTotal: 5000, deliveredCount: 0, rtoCount: 0 })).toBe('ok')
    expect(decideCodRisk({ settings: { cod_verify_above: '3000' }, codTotal: 2000, deliveredCount: 1, rtoCount: 0 })).toBe('ok')
    expect(decideCodRisk({ settings: { cod_block_after_rto: 'false' }, codTotal: 200, deliveredCount: 1, rtoCount: 2 })).toBe('ok')
    expect(decideCodRisk({ settings: { cod_verify_above: 'junk' }, codTotal: 1600, deliveredCount: 1, rtoCount: 0 })).toBe('verify')
  })
})

describe('codes and tokens', () => {
  it('codes are 6 digits; hashes are bound to phone and e-mail (case-insensitive e-mail)', () => {
    for (let i = 0; i < 50; i++) expect(newCodCode()).toMatch(/^\d{6}$/)
    expect(hashCodCode('123456', '9876543210', 'A@B.com')).toBe(hashCodCode('123456', '9876543210', 'a@b.com'))
    expect(hashCodCode('123456', '9876543210', 'a@b.com')).not.toBe(hashCodCode('123456', '9876543211', 'a@b.com'))
  })
})

describe('makeCodRiskGate', () => {
  /**
   * Fake PostgREST: `phoneCustomers` = customer ids with this normalized_phone; `deliveredFor` / `rtoFor` = customer ids that
   * have a delivered / refused-COD order; `token` = state of the verification row ('fresh' | 'used_by_other' | 'used_by_me' | 'none').
   */
  const sbFor = (o: { phoneCustomers?: string[]; deliveredFor?: string[]; rtoFor?: string[]; token?: 'fresh' | 'used_by_other' | 'used_by_me' | 'none' } = {}) =>
    vi.fn(async (m: string, path: string, _body?: unknown) => {
      const ids = (/customer_id=in\.\(([^)]*)\)/.exec(path)?.[1] ?? '').split(',')
      if (path.startsWith('/rest/v1/customers?normalized_phone=')) return (o.phoneCustomers ?? []).map(id => ({ id }))
      if (path.includes('order_status=eq.delivered')) return ids.some(id => (o.deliveredFor ?? []).includes(id)) ? [{ id: 1 }] : []
      if (path.includes('order_status=eq.returned')) return ids.some(id => (o.rtoFor ?? []).includes(id)) ? [{ id: 1 }] : []
      if (path.includes('cod_verifications')) {
        const t = o.token ?? 'none'
        if (m === 'PATCH') return t === 'fresh' ? [{ id: 9 }] : []
        if (m === 'GET') return t === 'used_by_me' ? [{ id: 9 }] : []
      }
      return []
    })
  const ctx = { customerIds: ['42'], codTotal: 500, phone10: '9876543210', email: 'Asha@Example.com', orderKey: 'key-1' }

  it('a phone with a refused COD order → COD_NOT_AVAILABLE', async () => {
    const gate = makeCodRiskGate({ sb: sbFor({ phoneCustomers: ['42'], deliveredFor: ['42'], rtoFor: ['42'] }), settings: {} })
    await expect(gate(ctx)).rejects.toMatchObject({ code: 'COD_NOT_AVAILABLE' })
    await expect(gate(ctx)).rejects.toBeInstanceOf(CheckoutRejectedError)
  })
  it('R4A-1: a signed-in NEW account typing a blocked phone is still blocked (the phone is always looked up)', async () => {
    const sb = sbFor({ phoneCustomers: ['7'], rtoFor: ['7'] })
    await expect(makeCodRiskGate({ sb, settings: {} })({ ...ctx, customerIds: ['99'], authenticatedCustomerId: 99 }))
      .rejects.toMatchObject({ code: 'COD_NOT_AVAILABLE' })
  })
  it('R4A-2: a guest cannot borrow trust from an e-mail match — only the phone counts', async () => {
    // '55' matched by e-mail only (passed in customerIds) has a delivered order; the phone itself has none → verify
    const gate = makeCodRiskGate({ sb: sbFor({ phoneCustomers: [], deliveredFor: ['55'] }), settings: {} })
    await expect(gate({ ...ctx, customerIds: ['42', '55'] })).rejects.toMatchObject({ code: 'COD_VERIFICATION_REQUIRED' })
  })
  it('a returning customer (delivered order on this phone), small order → allowed, no token needed', async () => {
    const sb = sbFor({ phoneCustomers: ['42'], deliveredFor: ['42'] })
    await expect(makeCodRiskGate({ sb, settings: {} })(ctx)).resolves.toBeUndefined()
    expect(sb.mock.calls.some(c => String(c[1]).includes('cod_verifications'))).toBe(false)
  })
  it('a signed-in customer is trusted on their own account history (family phone allowed)', async () => {
    const sb = sbFor({ phoneCustomers: [], deliveredFor: ['99'] })
    await expect(makeCodRiskGate({ sb, settings: {} })({ ...ctx, customerIds: ['99'], authenticatedCustomerId: 99 })).resolves.toBeUndefined()
  })
  it('first order without a token → COD_VERIFICATION_REQUIRED', async () => {
    await expect(makeCodRiskGate({ sb: sbFor(), settings: {} })(ctx)).rejects.toMatchObject({ code: 'COD_VERIFICATION_REQUIRED' })
  })
  it('R4A-3: a fresh token is CLAIMED for this order, bound to the token hash, the phone AND the order e-mail', async () => {
    const sb = sbFor({ token: 'fresh' })
    await expect(makeCodRiskGate({ sb, settings: {}, token: 'tok-abc' })(ctx)).resolves.toBeUndefined()
    const patch = sb.mock.calls.find(c => c[0] === 'PATCH' && String(c[1]).includes('cod_verifications'))!
    const q = String(patch[1])
    expect(q).toContain(`token_hash=eq.${hashCodToken('tok-abc')}`)
    expect(q).toContain('phone10=eq.9876543210')
    expect(q).toContain('email=eq.asha%40example.com')
    expect(q).toContain('used_at=is.null')
    expect(patch[2]).toMatchObject({ used_for: 'key-1' })
  })
  it('R4A-3: a token already spent by ANOTHER order does not pass; the same order retrying may reuse its own claim', async () => {
    await expect(makeCodRiskGate({ sb: sbFor({ token: 'used_by_other' }), settings: {}, token: 't' })(ctx)).rejects.toMatchObject({ code: 'COD_VERIFICATION_REQUIRED' })
    await expect(makeCodRiskGate({ sb: sbFor({ token: 'used_by_me' }), settings: {}, token: 't' })(ctx)).resolves.toBeUndefined()
  })
  it('R4A-3: no order e-mail → a token cannot be accepted', async () => {
    await expect(makeCodRiskGate({ sb: sbFor({ token: 'fresh' }), settings: {}, token: 't' })({ ...ctx, email: null })).rejects.toMatchObject({ code: 'COD_VERIFICATION_REQUIRED' })
  })
  it('RTO means a COD order returned WITHOUT a delivery (a return after delivery does not count)', async () => {
    const sb = sbFor({ phoneCustomers: ['42'], deliveredFor: ['42'] })
    await makeCodRiskGate({ sb, settings: {} })(ctx)
    const q = sb.mock.calls.map(c => String(c[1])).find(p => p.includes('order_status=eq.returned'))!
    expect(q).toContain('delivered_at=is.null')
    expect(q).toContain('payment_method=in.(cod,whatsapp_cod)')
  })
})
