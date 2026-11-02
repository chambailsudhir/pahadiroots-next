import { describe, it, expect } from 'vitest'
import { firstServerFieldError } from '@/lib/serverFieldError'

describe('firstServerFieldError', () => {
  it('reads zod flatten() output (the shape the API really sends) — never an object', () => {
    const msg = firstServerFieldError({ formErrors: [], fieldErrors: { address: ['Enter a valid 6-digit PIN code'] } })
    expect(msg).toBe('Enter a valid 6-digit PIN code')
    expect(typeof msg).toBe('string')
  })
  it('prefers field errors over form errors', () => {
    expect(firstServerFieldError({ formErrors: ['Invalid input'], fieldErrors: { phone: ['Invalid Indian mobile number'] } })).toBe('Invalid Indian mobile number')
  })
  it('falls back to form errors, then to a flat field map', () => {
    expect(firstServerFieldError({ formErrors: ['Bad request'], fieldErrors: {} })).toBe('Bad request')
    expect(firstServerFieldError({ 'address.pincode': ['Invalid 6-digit pincode'] })).toBe('Invalid 6-digit pincode')
  })
  it.each([undefined, null, 'x', 5, {}, { formErrors: [], fieldErrors: {} }, { fieldErrors: { a: [] } }, { fieldErrors: { a: [''] } }])(
    'returns undefined when there is no message (%j)', (d) => { expect(firstServerFieldError(d)).toBeUndefined() })
})
