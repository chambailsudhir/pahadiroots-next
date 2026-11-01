import { describe, it, expect } from 'vitest'
import { bestValueVariantId, sizeToBaseUnits } from '@/lib/variantValueTag'

describe('sizeToBaseUnits', () => {
  it('parses g, kg, ml, l', () => {
    expect(sizeToBaseUnits('250g')).toBe(250)
    expect(sizeToBaseUnits('1 kg')).toBe(1000)
    expect(sizeToBaseUnits('500ml')).toBe(500)
    expect(sizeToBaseUnits('1L')).toBe(1000)
  })
  it('returns null for unknown formats', () => {
    expect(sizeToBaseUnits('Pack of 2')).toBeNull()
    expect(sizeToBaseUnits(undefined)).toBeNull()
  })
})

describe('bestValueVariantId', () => {
  it('does not tag the live Manali honey pricing (500g/1kg are within 0.1% per gram)', () => {
    const v = [
      { id: 1, size: '250g', price: 350 },
      { id: 2, size: '500g', price: 699 },
      { id: 3, size: '1kg', price: 1399 },
    ]
    expect(bestValueVariantId(v)).toBeNull()
  })
  it('tags the lowest unit price when the saving is >= 3%', () => {
    const v = [
      { id: 1, size: '250g', price: 400 },
      { id: 2, size: '500g', price: 760 },
      { id: 3, size: '1kg', price: 1400 },
    ]
    expect(bestValueVariantId(v)).toBe(3)
  })
  it('never tags a single variant or unparseable sizes', () => {
    expect(bestValueVariantId([{ id: 1, size: '500g', price: 800 }])).toBeNull()
    expect(bestValueVariantId([{ id: 1, size: 'A', price: 1 }, { id: 2, size: 'B', price: 1 }])).toBeNull()
  })
  it('ignores out-of-stock variants', () => {
    const v = [
      { id: 1, size: '250g', price: 400, available_stock: 5 },
      { id: 2, size: '1kg', price: 1000, available_stock: 0 },
    ]
    expect(bestValueVariantId(v)).toBeNull()
  })
})
