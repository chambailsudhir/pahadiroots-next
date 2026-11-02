import { describe, it, expect } from 'vitest'
import { isDeliverablePin, pinMatchesState, pinProblem } from '@/lib/pinState'
import { addressSchema } from '@/lib/schemas'

const base = { name: 'QA Tester', phone: '9876543210', flat: '1 Test Road', city: 'Kangra', area: '' }

describe('isDeliverablePin (CHK-001)', () => {
  it.each(['000000', '999999', '900001', '12345', '1234567', 'abcdef', ''])('rejects %s', (p) => {
    expect(isDeliverablePin(p)).toBe(false)
  })
  it.each(['110001', '176082', '248001', '560001', '799001'])('accepts %s', (p) => {
    expect(isDeliverablePin(p)).toBe(true)
  })
})

describe('pinMatchesState', () => {
  it('rejects the audited Delhi PIN + Himachal Pradesh pairing', () => {
    expect(pinMatchesState('110001', 'Himachal Pradesh')).toBe(false)
  })
  it.each([
    ['176082', 'Himachal Pradesh'],
    ['110001', 'Delhi'],
    ['201301', 'Uttar Pradesh'],   // Noida
    ['201301', 'Delhi'],           // NCR customers often pick Delhi — tolerated
    ['248001', 'Uttarakhand'],
    ['244001', 'Uttar Pradesh'],   // Moradabad (24x is shared with Uttarakhand)
    ['160017', 'Chandigarh'],
    ['160017', 'Punjab'],
    ['134109', 'Haryana'],         // Panchkula
    ['194101', 'Ladakh'],
    ['737101', 'Sikkim'],
    ['744101', 'Andaman & Nicobar Islands'],
    ['682001', 'Lakshadweep'],
    ['673310', 'Puducherry'],      // Mahe enclave
    ['533464', 'Puducherry'],      // Yanam enclave
    ['396230', 'Dadra & Nagar Haveli and Daman & Diu'],
    ['403001', 'Goa'],
    ['799001', 'Tripura'],
    ['560001', 'Karnataka'],
  ])('allows %s in %s', (p, s) => {
    expect(pinMatchesState(p, s)).toBe(true)
  })
  it.each([
    ['560001', 'Delhi'],
    ['400001', 'Gujarat'],
    ['700001', 'Punjab'],
    ['302001', 'Kerala'],
  ])('rejects %s in %s', (p, s) => {
    expect(pinMatchesState(p, s)).toBe(false)
  })
  it('is case/space tolerant and never blocks on blank state or unknown prefix', () => {
    expect(pinMatchesState('176082', '  himachal   pradesh ')).toBe(true)
    expect(pinMatchesState('176082', '')).toBe(true)
    expect(pinMatchesState('291001', 'Kerala')).toBe(true) // 29x is unallocated → not blocked on state
  })
})

describe('pinProblem', () => {
  it('returns null for a good pair and a clear message otherwise', () => {
    expect(pinProblem('176082', 'Himachal Pradesh')).toBeNull()
    expect(pinProblem('000000', 'Himachal Pradesh')).toMatch(/valid 6-digit/)
    expect(pinProblem('110001', 'Himachal Pradesh')).toMatch(/does not look like it belongs to Himachal Pradesh/)
  })
})

describe('addressSchema enforces the PIN rules on the server', () => {
  it('accepts a consistent address', () => {
    expect(addressSchema.safeParse({ ...base, state: 'Himachal Pradesh', pincode: '176082' }).success).toBe(true)
  })
  it.each([['000000', 'Himachal Pradesh'], ['999999', 'Himachal Pradesh'], ['110001', 'Himachal Pradesh']])(
    'rejects PIN %s with state %s', (pincode, state) => {
      const r = addressSchema.safeParse({ ...base, state, pincode })
      expect(r.success).toBe(false)
      if (!r.success) expect(r.error.issues[0].path).toEqual(['pincode'])
    })
})
