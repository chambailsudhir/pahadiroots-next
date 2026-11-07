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
  const sbFor = (opts: { delivered?: number; rto?: number; tokenRows?: number }) => vi.fn(async (_m: string, path: string) => {
    if (path.includes('order_status=eq.delivered')) return Array.from({ length: opts.delivered ?? 0 }, (_, i) => ({ id: i }))
    if (path.includes('order_status=eq.returned')) return Array.from({ length: opts.rto ?? 0 }, (_, i) => ({ id: i }))
    if (path.includes('cod_verifications')) return Array.from({ length: opts.tokenRows ?? 0 }, (_, i) => ({ id: i }))
    return []
  })
  const ctx = { customerIds: ['42'], codTotal: 500, phone10: '9876543210' }

  it('blocked → COD_NOT_AVAILABLE refusal', async () => {
    const gate = makeCodRiskGate({ sb: sbFor({ delivered: 1, rto: 1 }), settings: {} })
    await expect(gate(ctx)).rejects.toMatchObject({ code: 'COD_NOT_AVAILABLE' })
    await expect(gate(ctx)).rejects.toBeInstanceOf(CheckoutRejectedError)
  })
  it('first order without a token → COD_VERIFICATION_REQUIRED', async () => {
    const gate = makeCodRiskGate({ sb: sbFor({ delivered: 0 }), settings: {} })
    await expect(gate(ctx)).rejects.toMatchObject({ code: 'COD_VERIFICATION_REQUIRED' })
  })
  it('first order WITH a valid token for this phone → allowed; the lookup uses the token hash and the phone', async () => {
    const sb = sbFor({ delivered: 0, tokenRows: 1 })
    const gate = makeCodRiskGate({ sb, settings: {}, token: 'tok-abc' })
    await expect(gate(ctx)).resolves.toBeUndefined()
    const q = sb.mock.calls.map(c => String(c[1])).find(p => p.includes('cod_verifications'))!
    expect(q).toContain(`token_hash=eq.${hashCodToken('tok-abc')}`)
    expect(q).toContain('phone10=eq.9876543210')
  })
  it('a token that does not match (other phone / expired) → still required', async () => {
    const gate = makeCodRiskGate({ sb: sbFor({ delivered: 0, tokenRows: 0 }), settings: {}, token: 'tok-abc' })
    await expect(gate(ctx)).rejects.toMatchObject({ code: 'COD_VERIFICATION_REQUIRED' })
  })
  it('returning customer, small order → allowed without any lookup of tokens', async () => {
    const sb = sbFor({ delivered: 2 })
    await expect(makeCodRiskGate({ sb, settings: {} })(ctx)).resolves.toBeUndefined()
    expect(sb.mock.calls.some(c => String(c[1]).includes('cod_verifications'))).toBe(false)
  })
  it('RTO means a COD order returned WITHOUT a delivery (a return after delivery does not count)', async () => {
    const sb = sbFor({ delivered: 1 })
    await makeCodRiskGate({ sb, settings: {} })(ctx)
    const q = sb.mock.calls.map(c => String(c[1])).find(p => p.includes('order_status=eq.returned'))!
    expect(q).toContain('delivered_at=is.null')
    expect(q).toContain('payment_method=in.(cod,whatsapp_cod)')
  })
})
