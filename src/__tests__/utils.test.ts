/**
 * utils.test.ts
 * Tests for pure utility functions: calcGST, asNumber, formatPrice, etc.
 */

import { describe, it, expect } from 'vitest'
import {
  calcGST,
  splitGST,
  asNumber,
  formatPrice,
  formatDate,
  savingsPercent,
  slugify,
  cn,
  parseJsonArray,
  truncate,
  formatPhone,
  whatsappURL,
  isEnabled,
  catSlug,
  generateUUID,
} from '@/lib/utils'

// ─── calcGST ──────────────────────────────────────────────────────────────────

describe('calcGST', () => {
  it('computes GST for a single item at 5% rate (inclusive)', () => {
    // price=100, gstRate=5, qty=1 → GST = 100*1*5/(100+5) = 500/105 ≈ 4.76 → rounds to 5
    expect(calcGST(100, 5, 1)).toBe(5)
  })

  it('computes GST for a single item at 12% rate', () => {
    // price=112, gstRate=12, qty=1 → 112*12/112 = 12
    expect(calcGST(112, 12, 1)).toBe(12)
  })

  it('scales with quantity — formula is round(price*qty*rate/(100+rate))', () => {
    // calcGST computes round(price*qty*rate/(100+rate)) in a single pass.
    // Do not compare to single*3 — rounding happens once on the full qty, not per unit.
    // price=100, qty=3, rate=5 → round(100*3*5/105) = round(14.28) = 14
    expect(calcGST(100, 5, 3)).toBe(14)
    // Proportional: larger qty always produces >= single-unit result
    expect(calcGST(100, 5, 2)).toBeGreaterThanOrEqual(calcGST(100, 5, 1))
    expect(calcGST(100, 5, 3)).toBeGreaterThanOrEqual(calcGST(100, 5, 2))
  })

  it('returns 0 for 0% GST rate', () => {
    expect(calcGST(500, 0, 2)).toBe(0)
  })

  it('defaults qty to 1 when omitted', () => {
    expect(calcGST(100, 18)).toBe(calcGST(100, 18, 1))
  })

  it('rounds to nearest integer — no fractional paise', () => {
    // price=99, rate=5, qty=1 → 99*5/105 = 4.714... → rounds to 5
    const result = calcGST(99, 5, 1)
    expect(Number.isInteger(result)).toBe(true)
  })

  it('handles higher-priced items accurately at 18%', () => {
    // price=1180, rate=18, qty=1 → 1180*18/118 = 180
    expect(calcGST(1180, 18, 1)).toBe(180)
  })
})

// ─── splitGST ────────────────────────────────────────────────────────────────

describe('splitGST', () => {
  it('splits even GST amount equally into CGST + SGST (intra-state)', () => {
    // 200 paise → CGST=100, SGST=100
    const result = splitGST(200)
    expect(result.cgst).toBe(100)
    expect(result.sgst).toBe(100)
    expect(result.igst).toBe(0)
    expect(result.cgst + result.sgst).toBe(200) // total preserved
  })

  it('handles odd-paise GST without double-rounding (floor+remainder pattern)', () => {
    // 5 paise (odd) → floor(5/2)=2 CGST, 5-2=3 SGST — not 3+3=6
    const result = splitGST(5)
    expect(result.cgst).toBe(2)
    expect(result.sgst).toBe(3)
    expect(result.igst).toBe(0)
    expect(result.cgst + result.sgst).toBe(5) // total always preserved
  })

  it('returns IGST only for inter-state transactions', () => {
    const result = splitGST(500, true)
    expect(result.igst).toBe(500)
    expect(result.cgst).toBe(0)
    expect(result.sgst).toBe(0)
  })

  it('returns zero-split for 0 GST amount', () => {
    const result = splitGST(0)
    expect(result.cgst).toBe(0)
    expect(result.sgst).toBe(0)
    expect(result.igst).toBe(0)
  })

  it('defaults to intra-state when interState param is omitted', () => {
    const result = splitGST(100)
    expect(result.igst).toBe(0)
    expect(result.cgst + result.sgst).toBe(100)
  })
})

// ─── asNumber ─────────────────────────────────────────────────────────────────

describe('asNumber', () => {
  it('parses a valid numeric string', () => {
    expect(asNumber('799', 0)).toBe(799)
  })

  it('returns defaultValue for undefined', () => {
    expect(asNumber(undefined, 99)).toBe(99)
  })

  it('returns defaultValue for empty string', () => {
    expect(asNumber('', 50)).toBe(50)
  })

  it('returns defaultValue for non-numeric string', () => {
    expect(asNumber('abc', 42)).toBe(42)
  })

  it('parses decimal values', () => {
    expect(asNumber('5.5', 0)).toBe(5.5)
  })

  it('parses zero correctly', () => {
    expect(asNumber('0', 99)).toBe(0)
  })
})

// ─── isEnabled ───────────────────────────────────────────────────────────────

describe('isEnabled', () => {
  it('returns false when value is the string "false"', () => {
    expect(isEnabled('false')).toBe(false)
  })

  it('returns true when value is "true"', () => {
    expect(isEnabled('true')).toBe(true)
  })

  it('returns true for any non-"false" string (e.g. "1", "yes")', () => {
    expect(isEnabled('1')).toBe(true)
    expect(isEnabled('yes')).toBe(true)
  })

  it('treats "False", " FALSE " and "0" as off (hand-edited / differently-cased DB values)', () => {
    expect(isEnabled('False')).toBe(false)
    expect(isEnabled(' FALSE ')).toBe(false)
    expect(isEnabled('0')).toBe(false)
  })

  it('returns the defaultValue when value is undefined — defaults to true', () => {
    expect(isEnabled(undefined)).toBe(true)
    expect(isEnabled(undefined, false)).toBe(false)
  })
})

// ─── formatPrice ──────────────────────────────────────────────────────────────

describe('formatPrice', () => {
  it('prefixes with ₹', () => {
    expect(formatPrice(100).startsWith('₹')).toBe(true)
  })

  it('rounds fractional values before formatting', () => {
    // Should not show decimals
    const result = formatPrice(99.6)
    expect(result).toBe('₹100')
  })

  it('formats 0 correctly', () => {
    expect(formatPrice(0)).toBe('₹0')
  })

  it('formats large values (Indian number system)', () => {
    // 1,00,000 in Indian system
    const result = formatPrice(100000)
    expect(result).toContain('₹')
    expect(result).toContain('1')
  })
})

// ─── savingsPercent ───────────────────────────────────────────────────────────

describe('savingsPercent', () => {
  it('returns 0 when mrp equals price', () => {
    expect(savingsPercent(100, 100)).toBe(0)
  })

  it('returns 0 when mrp is 0 (no data)', () => {
    expect(savingsPercent(0, 80)).toBe(0)
  })

  it('calculates correct % discount', () => {
    // mrp=200, price=150 → 25% off
    expect(savingsPercent(200, 150)).toBe(25)
  })

  it('rounds to nearest integer', () => {
    // mrp=300, price=200 → 33.33...% → rounds to 33
    expect(savingsPercent(300, 200)).toBe(33)
  })

  it('returns 0 when price is higher than mrp (never negative)', () => {
    // price > mrp — shouldn't happen in prod but function must not return negative
    expect(savingsPercent(100, 120)).toBe(0)
  })
})

// ─── slugify ──────────────────────────────────────────────────────────────────

describe('slugify', () => {
  it('lowercases and hyphenates', () => {
    expect(slugify('Himalayan Wild Honey')).toBe('himalayan-wild-honey')
  })

  it('removes special characters', () => {
    expect(slugify('Ghee (A2)')).toMatch(/^[a-z0-9-]+$/)
  })

  it('collapses multiple spaces into a single hyphen', () => {
    expect(slugify('a  b')).toBe('a-b')
  })

  it('trims leading and trailing whitespace', () => {
    expect(slugify('  honey  ')).toBe('honey')
  })

  it('collapses consecutive hyphens into one', () => {
    // e.g. "wild--honey" after special char removal should become "wild-honey"
    const result = slugify('wild--honey')
    expect(result).toBe('wild-honey')
  })
})

// ─── truncate ────────────────────────────────────────────────────────────────

describe('truncate', () => {
  it('returns the original string when shorter than maxLen', () => {
    expect(truncate('hello', 10)).toBe('hello')
  })

  it('returns the original string when exactly maxLen', () => {
    expect(truncate('hello', 5)).toBe('hello')
  })

  it('truncates and appends ellipsis when longer than maxLen', () => {
    const result = truncate('Himalayan Wild Honey', 10)
    expect(result.endsWith('…')).toBe(true)
    expect(result.length).toBeLessThanOrEqual(11) // 10 chars + ellipsis char
  })

  it('trims trailing whitespace before appending ellipsis', () => {
    // 'hello ' truncated at 6 → 'hello' (trimEnd) + '…'
    const result = truncate('hello world', 6)
    expect(result).toBe('hello…')
  })

  it('handles empty string — returns empty (no ellipsis needed)', () => {
    expect(truncate('', 5)).toBe('')
  })
})

// ─── formatPhone ─────────────────────────────────────────────────────────────

describe('formatPhone', () => {
  it('formats a 10-digit Indian number with +91 prefix', () => {
    expect(formatPhone('9876543210')).toBe('+91 98765 43210')
  })

  it('strips non-digit characters before formatting', () => {
    // Input with spaces/dashes
    expect(formatPhone('98765-43210')).toBe('+91 98765 43210')
  })

  it('returns original string for non-10-digit input', () => {
    // 8-digit or 11-digit — cannot be formatted as Indian mobile
    expect(formatPhone('12345678')).toBe('12345678')
    expect(formatPhone('98765432100')).toBe('98765432100') // 11 digits → passthrough
  })
})

// ─── whatsappURL ─────────────────────────────────────────────────────────────

describe('whatsappURL', () => {
  it('constructs a valid wa.me URL with +91 prefix stripped', () => {
    const url = whatsappURL('+919876543210', 'Hello')
    expect(url).toContain('wa.me/919876543210')
  })

  it('URL-encodes the message text', () => {
    const url = whatsappURL('9876543210', 'Order #123')
    expect(url).toContain(encodeURIComponent('Order #123'))
  })

  it('strips spaces from phone number', () => {
    const url = whatsappURL('+91 98765 43210', 'Hi')
    expect(url).toContain('wa.me/919876543210')
  })
})

// ─── catSlug ─────────────────────────────────────────────────────────────────

describe('catSlug', () => {
  it('returns slug when provided', () => {
    expect(catSlug({ slug: 'honey', name: 'Honey', id: 1 })).toBe('honey')
  })

  it('falls back to slugified name when slug is absent', () => {
    expect(catSlug({ slug: null, name: 'Wild Honey', id: 2 })).toBe('wild-honey')
  })

  it('falls back to slugified name when slug is empty string', () => {
    expect(catSlug({ slug: '', name: 'Himalayan Tea', id: 3 })).toBe('himalayan-tea')
  })

  it('falls back to slugified name when slug is whitespace-only', () => {
    // .trim() on whitespace → '' → falsy → falls through to name
    expect(catSlug({ slug: '   ', name: 'Ghee', id: 4 })).toBe('ghee')
  })

  it('falls back to String(id) when both slug and name are absent', () => {
    expect(catSlug({ slug: null, name: null, id: 42 })).toBe('42')
  })

  it('falls back to String(id) when slug is empty and name slugifies to empty', () => {
    // slugify strips non-word chars except hyphens; a name of only parentheses
    // → '' after stripping, so catSlug falls through to String(id).
    // Note: '---' slugifies to '-' (hyphens are kept), so we use '((())) !!!'
    // which strips to '' → falls back to id.
    expect(catSlug({ slug: '', name: '((())) !!!', id: 99 })).toBe('99')
  })
})

// ─── generateUUID ─────────────────────────────────────────────────────────────

describe('generateUUID', () => {
  it('returns a string in UUID v4 format', () => {
    const uuid = generateUUID()
    expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })

  it('generates unique values on successive calls', () => {
    const a = generateUUID()
    const b = generateUUID()
    expect(a).not.toBe(b)
  })
})

// ─── formatDate ──────────────────────────────────────────────────────────────

describe('formatDate', () => {
  it('formats an ISO date string into a human-readable Indian locale date', () => {
    // We don't assert a fixed string (locale output varies by environment),
    // but the result must contain a 4-digit year and be a non-empty string.
    const result = formatDate('2024-03-15T00:00:00Z')
    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(0)
    expect(result).toMatch(/2024/)
  })

  it('handles date-only strings', () => {
    const result = formatDate('2023-01-01')
    expect(result).toMatch(/2023/)
  })
})

// ─── cn (class merge) ─────────────────────────────────────────────────────────

describe('cn', () => {
  it('joins multiple class strings with a space', () => {
    expect(cn('a', 'b', 'c')).toBe('a b c')
  })

  it('filters out falsy values', () => {
    expect(cn('a', undefined, null, false, 'b')).toBe('a b')
  })

  it('returns empty string when all args are falsy', () => {
    expect(cn(undefined, null, false)).toBe('')
  })

  it('returns single class when only one is truthy', () => {
    expect(cn(undefined, 'only')).toBe('only')
  })
})

// ─── parseJsonArray ───────────────────────────────────────────────────────────

describe('parseJsonArray', () => {
  it('returns the parsed array for a valid JSON array string', () => {
    expect(parseJsonArray('["a","b","c"]')).toEqual(['a', 'b', 'c'])
  })

  it('returns empty array for null input', () => {
    expect(parseJsonArray(null)).toEqual([])
  })

  it('returns empty array for empty string', () => {
    expect(parseJsonArray('')).toEqual([])
  })

  it('returns empty array for invalid JSON', () => {
    expect(parseJsonArray('not-json')).toEqual([])
  })

  it('returns empty array when parsed value is not an array (e.g. object)', () => {
    expect(parseJsonArray('{"key":"val"}')).toEqual([])
  })

  it('returns empty array when parsed value is a primitive', () => {
    expect(parseJsonArray('42')).toEqual([])
  })
})
