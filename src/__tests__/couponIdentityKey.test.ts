import { describe, it, expect } from 'vitest'
import { couponIdentityKey } from '@/lib/server/couponClaim'

// db_migration_v32 / verification F-2: the claim carries a stable, non-reversible key for guests.
describe('couponIdentityKey', () => {
  it('is a sha-256 of the normalised 10-digit phone, stable across formats', () => {
    const a = couponIdentityKey('9876543210')
    expect(a).toMatch(/^ph:[0-9a-f]{64}$/)
    expect(couponIdentityKey('+91 98765 43210')).toBe(a)
    expect(couponIdentityKey('09876543210')).toBe(a)
    expect(a).not.toContain('9876543210')
  })
  it('is null when there is no usable phone', () => {
    expect(couponIdentityKey('')).toBeNull()
    expect(couponIdentityKey(null)).toBeNull()
    expect(couponIdentityKey('12345')).toBeNull()
  })
  it('differs between phones', () => {
    expect(couponIdentityKey('9876543210')).not.toBe(couponIdentityKey('9876543211'))
  })
})
