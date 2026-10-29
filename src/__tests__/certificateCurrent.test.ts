import { describe, it, expect } from 'vitest'
import { isCurrentCertificate } from '@/lib/certificateCopy'

const NOW = new Date('2026-11-05T10:00:00Z')

describe('isCurrentCertificate — a file alone never backs a "Lab Tested" claim', () => {
  it('named lab + recent test date → current', () => {
    expect(isCurrentCertificate({ labName: 'FARE LABS Private Limited', testedOn: '2026-10-05' }, NOW)).toBe(true)
  })
  it('no lab name / blank lab name → not current', () => {
    expect(isCurrentCertificate({ labName: null, testedOn: '2026-10-05' }, NOW)).toBe(false)
    expect(isCurrentCertificate({ labName: '   ', testedOn: '2026-10-05' }, NOW)).toBe(false)
  })
  it('no / invalid / future test date → not current', () => {
    expect(isCurrentCertificate({ labName: 'L', testedOn: null }, NOW)).toBe(false)
    expect(isCurrentCertificate({ labName: 'L', testedOn: 'junk' }, NOW)).toBe(false)
    expect(isCurrentCertificate({ labName: 'L', testedOn: '2026-12-01' }, NOW)).toBe(false)
  })
  it('without an expiry, a test older than 24 months is stale (730 days)', () => {
    expect(isCurrentCertificate({ labName: 'L', testedOn: '2024-11-05' }, NOW)).toBe(true)   // exactly 730 days
    expect(isCurrentCertificate({ labName: 'L', testedOn: '2024-11-04' }, NOW)).toBe(false)  // 731 days
  })
  it('an explicit expiry overrides the age rule: valid until the expiry day, then not', () => {
    expect(isCurrentCertificate({ labName: 'L', testedOn: '2023-01-01', expiresOn: '2026-11-05' }, NOW)).toBe(true)
    expect(isCurrentCertificate({ labName: 'L', testedOn: '2023-01-01', expiresOn: '2026-11-04' }, NOW)).toBe(false)
    expect(isCurrentCertificate({ labName: 'L', testedOn: '2026-10-01', expiresOn: 'junk' }, NOW)).toBe(false)
  })
})
