import { describe, it, expect } from 'vitest'
import { returnWindowStart, REPLACEMENT_TRANSIT_DAYS } from '@/lib/account/constants'

describe('returnWindowStart', () => {
  const day = 86_400_000
  it('is the delivery date when there is no replacement', () => {
    expect(returnWindowStart('2026-11-01T00:00:00Z')).toBe(Date.parse('2026-11-01T00:00:00Z'))
  })
  it('is the replacement shipment + transit days when that is later than the delivery', () => {
    expect(returnWindowStart('2026-10-01T00:00:00Z', '2026-11-01T00:00:00Z')).toBe(Date.parse('2026-11-01T00:00:00Z') + REPLACEMENT_TRANSIT_DAYS * day)
  })
  it('never starts before the original delivery', () => {
    expect(returnWindowStart('2026-11-10T00:00:00Z', '2026-11-01T00:00:00Z')).toBe(Date.parse('2026-11-10T00:00:00Z') > Date.parse('2026-11-01T00:00:00Z') + REPLACEMENT_TRANSIT_DAYS * day ? Date.parse('2026-11-10T00:00:00Z') : Date.parse('2026-11-01T00:00:00Z') + REPLACEMENT_TRANSIT_DAYS * day)
  })
  it('null when nothing is known / junk dates', () => {
    expect(returnWindowStart(null)).toBeNull()
    expect(returnWindowStart('nonsense', 'also nonsense')).toBeNull()
  })
})
