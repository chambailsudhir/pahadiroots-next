import { describe, it, expect } from 'vitest'
import { normalizeReferralCode, captureReferralFromSearch, readPendingReferral, clearPendingReferral, referralMessage, REF_STORAGE_KEY, REF_TTL_DAYS } from '@/lib/referral'

const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m } }

describe('referral helpers', () => {
  it('accepts only plain alphanumeric codes of 6-12 characters, upper-cased', () => {
    expect(normalizeReferralCode(' ab12cd34 ')).toBe('AB12CD34')
    for (const bad of ['', 'abc', 'a b c d e f', '<script>', "AB12CD34'; --", 'x'.repeat(13), null, undefined, 123]) expect(normalizeReferralCode(bad)).toBeNull()
  })
  it('remembers ?ref= from a friend\'s link and replaces an older one', () => {
    const s = mem()
    expect(captureReferralFromSearch('?utm=x&ref=aaaa1111', s, 1000)).toBe('AAAA1111')
    expect(captureReferralFromSearch('?ref=bbbb2222', s, 2000)).toBe('BBBB2222')
    expect(readPendingReferral(s, 3000)).toBe('BBBB2222')
  })
  it('ignores a missing or malformed ref and never overwrites a good code with junk', () => {
    const s = mem()
    captureReferralFromSearch('?ref=aaaa1111', s, 1)
    expect(captureReferralFromSearch('', s)).toBeNull()
    expect(captureReferralFromSearch('?ref=<b>', s)).toBeNull()
    expect(readPendingReferral(s, 2)).toBe('AAAA1111')
  })
  it(`forgets a code older than ${REF_TTL_DAYS} days`, () => {
    const s = mem()
    captureReferralFromSearch('?ref=aaaa1111', s, 0)
    expect(readPendingReferral(s, (REF_TTL_DAYS + 1) * 86_400_000)).toBeNull()
    expect(s.m.has(REF_STORAGE_KEY)).toBe(false)
  })
  it('survives corrupt storage and blocked storage', () => {
    const s = mem(); s.setItem(REF_STORAGE_KEY, '{not json')
    expect(readPendingReferral(s)).toBeNull()
    const blocked = { getItem() { throw new Error('denied') }, setItem() { throw new Error('denied') }, removeItem() { throw new Error('denied') } }
    expect(captureReferralFromSearch('?ref=aaaa1111', blocked)).toBeNull()
    expect(readPendingReferral(blocked)).toBeNull()
    expect(() => clearPendingReferral(blocked)).not.toThrow()
  })
  it('has customer wording for every reason the database can give, and a safe default', () => {
    for (const r of ['invalid_code', 'not_new_customer', 'already_applied', 'same_person', 'own_code', 'not_allowed']) expect(referralMessage(r).length).toBeGreaterThan(10)
    expect(referralMessage('something_new')).toMatch(/couldn't apply/)
  })
})
