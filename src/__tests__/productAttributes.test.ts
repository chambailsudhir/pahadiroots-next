import { describe, it, expect } from 'vitest'
import { buildAttributeMap, formatShelfLife } from '@/lib/productAttributes'

describe('buildAttributeMap', () => {
  const defs = [
    { id: 1, name: 'Origin Region' }, { id: 4, name: 'Shelf Life' }, { id: 5, name: 'Packaging Type' }, { id: 6, name: 'Harvest Season' },
  ]
  it('joins values to attribute names and normalises keys', () => {
    const m = buildAttributeMap(defs, [
      { attribute_id: 4, value: '12 Months' }, { attribute_id: 5, value: ' Glass Jar ' }, { attribute_id: '6', value: 'Summer' },
    ])
    expect(m).toEqual({ shelf_life: '12 Months', packaging_type: 'Glass Jar', harvest_season: 'Summer' })
  })
  it('drops blank values and unknown attribute ids', () => {
    expect(buildAttributeMap(defs, [{ attribute_id: 4, value: '   ' }, { attribute_id: 99, value: 'x' }, { attribute_id: 5, value: null }])).toEqual({})
  })
  it('never throws on null/undefined input', () => {
    expect(buildAttributeMap(null, null)).toEqual({})
    expect(buildAttributeMap(defs, undefined)).toEqual({})
  })
})

describe('formatShelfLife (mirrors the admin DurationInput parser)', () => {
  it('formats number + unit', () => {
    expect(formatShelfLife('12 Months')).toBe('12 months')
    expect(formatShelfLife('90 days')).toBe('90 days')
    expect(formatShelfLife('2 Years')).toBe('2 years')
    expect(formatShelfLife('1 Month')).toBe('1 month')
  })
  it('treats a legacy bare number as days, like the admin form does', () => {
    expect(formatShelfLife('90')).toBe('90 days')
    expect(formatShelfLife('1')).toBe('1 day')
  })
  it('returns null (caller hides the line) for anything it cannot trust', () => {
    expect(formatShelfLife('')).toBeNull()
    expect(formatShelfLife(null)).toBeNull()
    expect(formatShelfLife('0 Days')).toBeNull()
    expect(formatShelfLife('about a year')).toBeNull()
    expect(formatShelfLife('[ADD VERIFIED SHELF LIFE]')).toBeNull()
  })
})
