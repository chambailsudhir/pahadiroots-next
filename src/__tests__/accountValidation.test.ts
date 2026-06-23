/**
 * accountValidation.test.ts
 *
 * Tests for pure functions in:
 *   • src/lib/account/validation.ts  — validate.*, validatePassword, validateAddress, etc.
 *   • src/lib/account/utils.ts       — getSavedAddresses, getInitials,
 *                                      getOrderStatusMessage, getPaymentLabel,
 *                                      getCourierTrackingUrl
 *
 * All functions are pure / synchronous (no DB, no fetch) — standard unit tests.
 */

import { describe, it, expect } from 'vitest'
import {
  validate,
  validateProfileName,
  validateAddress,
  validateNewAddress,
  validatePhone,
  validatePassword,
} from '@/lib/account/validation'
import {
  getSavedAddresses,
  getInitials,
  getOrderStatusMessage,
  getPaymentLabel,
  getCourierTrackingUrl,
} from '@/lib/account/utils'

// ─── validate.phone ───────────────────────────────────────────────────────────

describe('validate.phone', () => {
  it('accepts a valid 10-digit mobile starting with 6', () => {
    expect(validate.phone('6789012345')).toBe(true)
  })

  it('accepts a valid 10-digit mobile starting with 9', () => {
    expect(validate.phone('9876543210')).toBe(true)
  })

  it('strips non-digit chars before validating', () => {
    // '+91 98765 43210' strips to '919876543210' (12 digits) — correctly rejected.
    // The stripping behaviour is for formats like '98765 43210' (spaces in a 10-digit number).
    expect(validate.phone('98765 43210')).toBe(true)   // strips to '9876543210' — valid
    expect(validate.phone('+91 98765 43210')).toBe(false) // strips to '919876543210' — 12 digits, rejected
  })

  it('rejects number starting with 5 (not 6–9)', () => {
    expect(validate.phone('5123456789')).toBe(false)
  })

  it('rejects short number (9 digits)', () => {
    expect(validate.phone('987654321')).toBe(false)
  })

  it('rejects long number (11 digits)', () => {
    expect(validate.phone('98765432101')).toBe(false)
  })

  it('rejects empty string', () => {
    expect(validate.phone('')).toBe(false)
  })
})

// ─── validate.pincode ─────────────────────────────────────────────────────────

describe('validate.pincode', () => {
  it('accepts a valid 6-digit pincode', () => {
    expect(validate.pincode('110001')).toBe(true)
  })

  it('rejects 5-digit input', () => {
    expect(validate.pincode('11000')).toBe(false)
  })

  it('rejects 7-digit input', () => {
    expect(validate.pincode('1100011')).toBe(false)
  })

  it('rejects pincode with letters', () => {
    expect(validate.pincode('11000A')).toBe(false)
  })

  it('accepts pincode with leading spaces (trims before validating)', () => {
    expect(validate.pincode(' 110001')).toBe(true)
  })
})

// ─── validate.name ────────────────────────────────────────────────────────────

describe('validate.name', () => {
  it('accepts name with 2+ characters', () => {
    expect(validate.name('Priya')).toBe(true)
  })

  it('rejects single-character name', () => {
    expect(validate.name('A')).toBe(false)
  })

  it('rejects empty string', () => {
    expect(validate.name('')).toBe(false)
  })

  it('rejects whitespace-only string (trims before length check)', () => {
    expect(validate.name('   ')).toBe(false)
  })
})

// ─── validate.password ────────────────────────────────────────────────────────

describe('validate.password', () => {
  const VALID = 'Secure@123'

  it('minLength: true for 8+ chars', () => {
    expect(validate.password.minLength('abcdefgh')).toBe(true)
  })

  it('minLength: false for 7 chars', () => {
    expect(validate.password.minLength('abcdefg')).toBe(false)
  })

  it('hasUpper: true when uppercase present', () => {
    expect(validate.password.hasUpper('Hello')).toBe(true)
  })

  it('hasUpper: false when no uppercase', () => {
    expect(validate.password.hasUpper('hello')).toBe(false)
  })

  it('hasNumber: true when digit present', () => {
    expect(validate.password.hasNumber('abc1')).toBe(true)
  })

  it('hasNumber: false when no digit', () => {
    expect(validate.password.hasNumber('abcABC')).toBe(false)
  })

  it('hasSpecial: true when special char present', () => {
    expect(validate.password.hasSpecial('abc@')).toBe(true)
  })

  it('hasSpecial: false when no special char', () => {
    expect(validate.password.hasSpecial('abcABC1')).toBe(false)
  })

  it('isValid: true for a strong password', () => {
    expect(validate.password.isValid(VALID)).toBe(true)
  })

  it('isValid: false when missing uppercase', () => {
    expect(validate.password.isValid('secure@123')).toBe(false)
  })

  it('isValid: false when missing number', () => {
    expect(validate.password.isValid('Secure@abc')).toBe(false)
  })

  it('isValid: false when missing special char', () => {
    expect(validate.password.isValid('Secure123')).toBe(false)
  })

  it('score: 0 for empty string', () => {
    expect(validate.password.score('')).toBe(0)
  })

  it('score: 4 for a fully valid password', () => {
    expect(validate.password.score(VALID)).toBe(4)
  })

  it('score: 2 for a password with only length + uppercase', () => {
    expect(validate.password.score('Abcdefgh')).toBe(2)
  })
})

// ─── validateProfileName ──────────────────────────────────────────────────────

describe('validateProfileName', () => {
  it('returns no errors for a valid name', () => {
    expect(validateProfileName('Rahul')).toEqual({})
  })

  it('errors when name is empty', () => {
    const e = validateProfileName('')
    expect(e.fname).toMatch(/required/i)
  })

  it('errors when name is only whitespace', () => {
    const e = validateProfileName('   ')
    expect(e.fname).toMatch(/required/i)
  })

  it('errors when name is a single character', () => {
    const e = validateProfileName('A')
    expect(e.fname).toMatch(/2 characters/i)
  })
})

// ─── validateAddress ──────────────────────────────────────────────────────────

describe('validateAddress', () => {
  const VALID = { addr: '12 Main Street', city: 'Delhi', state: 'Delhi', pin: '110001' }

  it('returns no errors for a valid address', () => {
    expect(validateAddress(VALID)).toEqual({})
  })

  it('errors when addr is empty', () => {
    const e = validateAddress({ ...VALID, addr: '' })
    expect(e.addr).toMatch(/required/i)
  })

  it('errors when addr is too short (< 5 chars)', () => {
    const e = validateAddress({ ...VALID, addr: '12 M' })
    expect(e.addr).toBeTruthy()
  })

  it('errors when city is empty', () => {
    const e = validateAddress({ ...VALID, city: '' })
    expect(e.city).toBeTruthy()
  })

  it('errors when state is empty (not selected)', () => {
    const e = validateAddress({ ...VALID, state: '' })
    expect(e.state).toBeTruthy()
  })

  it('errors when pin is empty', () => {
    const e = validateAddress({ ...VALID, pin: '' })
    expect(e.pin).toMatch(/required/i)
  })

  it('errors when pin is not 6 digits', () => {
    const e = validateAddress({ ...VALID, pin: '1234' })
    expect(e.pin).toMatch(/6-digit/i)
  })
})

// ─── validatePhone ────────────────────────────────────────────────────────────

describe('validatePhone', () => {
  it('returns no errors for valid phone', () => {
    expect(validatePhone('9876543210')).toEqual({})
  })

  it('errors when phone is empty', () => {
    const e = validatePhone('')
    expect(e.phone).toMatch(/required/i)
  })

  it('errors when phone is invalid', () => {
    const e = validatePhone('1234567890') // starts with 1
    expect(e.phone).toMatch(/valid/i)
  })
})

// ─── validatePassword ─────────────────────────────────────────────────────────

describe('validatePassword', () => {
  it('returns no errors for matching valid passwords', () => {
    expect(validatePassword('Secure@123', 'Secure@123')).toEqual({})
  })

  it('errors when new password is empty', () => {
    const e = validatePassword('', 'anything')
    expect(e.newp).toMatch(/required/i)
  })

  it('errors when password is too short', () => {
    const e = validatePassword('Ab@1', 'Ab@1')
    expect(e.newp).toMatch(/8 characters/i)
  })

  it('errors when passwords do not match', () => {
    const e = validatePassword('Secure@123', 'Different@123')
    expect(e.conf).toMatch(/match/i)
  })

  it('does NOT error on conf when newp itself is invalid', () => {
    // If newp is already invalid, conf mismatch is secondary — no conf error
    const e = validatePassword('weak', 'Different')
    expect(e.conf).toBeUndefined()
  })
})

// ─── getSavedAddresses ────────────────────────────────────────────────────────

describe('getSavedAddresses', () => {
  const validAddr = {
    id: 'uuid-1', label: 'Home', name: 'Priya',
    addr: '12 Main St', city: 'Delhi', state: 'Delhi', pin: '110001',
  }

  it('parses valid saved_addresses JSON', () => {
    const result = getSavedAddresses({ saved_addresses: JSON.stringify([validAddr]) })
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('uuid-1')
    expect(result[0].city).toBe('Delhi')
  })

  it('returns empty array for null profile', () => {
    expect(getSavedAddresses(null)).toEqual([])
  })

  it('returns empty array for undefined profile', () => {
    expect(getSavedAddresses(undefined)).toEqual([])
  })

  it('returns empty array when saved_addresses is null', () => {
    expect(getSavedAddresses({ saved_addresses: null })).toEqual([])
  })

  it('returns empty array for invalid JSON', () => {
    expect(getSavedAddresses({ saved_addresses: 'not-json' })).toEqual([])
  })

  it('returns empty array when JSON is a non-array (object)', () => {
    expect(getSavedAddresses({ saved_addresses: JSON.stringify({ id: 'x' }) })).toEqual([])
  })

  it('filters out entries without id', () => {
    const bad = { label: 'Home', addr: '12 Main St' }
    const result = getSavedAddresses({ saved_addresses: JSON.stringify([bad, validAddr]) })
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('uuid-1')
  })

  it('coerces missing optional fields to empty string', () => {
    const minimal = { id: 'uuid-2', addr: '5 Park Lane' }
    const result = getSavedAddresses({ saved_addresses: JSON.stringify([minimal]) })
    expect(result[0].city).toBe('')
    expect(result[0].label).toBe('')
    expect(result[0].pin).toBe('')
  })
})

// ─── getInitials ──────────────────────────────────────────────────────────────

describe('getInitials', () => {
  it('returns two uppercase initials for a two-word name', () => {
    expect(getInitials('Rahul Sharma')).toBe('RS')
  })

  it('returns first initial for single-word name', () => {
    expect(getInitials('Priya')).toBe('P')
  })

  it('uses first and LAST word for 3-word names', () => {
    expect(getInitials('Rahul Kumar Sharma')).toBe('RS')
  })

  it('returns ? for empty string', () => {
    expect(getInitials('')).toBe('?')
  })

  it('returns ? for whitespace-only string', () => {
    expect(getInitials('   ')).toBe('?')
  })

  it('handles extra whitespace between words', () => {
    expect(getInitials('Rahul   Sharma')).toBe('RS')
  })
})

// ─── getOrderStatusMessage ────────────────────────────────────────────────────

describe('getOrderStatusMessage', () => {
  it('returns delivered message', () => {
    expect(getOrderStatusMessage({ order_status: 'delivered' })).toContain('Delivered')
  })

  it('returns shipped message with estimated date when shipped_at is present', () => {
    const msg = getOrderStatusMessage({ order_status: 'shipped', shipped_at: '2024-01-01T00:00:00Z' })
    expect(msg).toContain('Shipped')
    expect(msg).toContain('delivery')
  })

  it('returns packed message', () => {
    expect(getOrderStatusMessage({ order_status: 'packed' })).toContain('packed')
  })

  it('returns processing message', () => {
    expect(getOrderStatusMessage({ order_status: 'processing' })).toContain('Processing')
  })

  it('returns confirmed message', () => {
    expect(getOrderStatusMessage({ order_status: 'confirmed' })).toContain('confirmed')
  })

  it('returns cancelled message', () => {
    expect(getOrderStatusMessage({ order_status: 'cancelled' })).toContain('cancelled')
  })

  it('prefers _displayStatus over order_status', () => {
    const msg = getOrderStatusMessage({ _displayStatus: 'delivered', order_status: 'processing' })
    expect(msg).toContain('Delivered')
  })

  it('returns empty string for unknown status', () => {
    expect(getOrderStatusMessage({ order_status: 'unknown_xyz' })).toBe('')
  })

  it('returns empty string when both fields are absent', () => {
    expect(getOrderStatusMessage({})).toBe('')
  })
})

// ─── getPaymentLabel ──────────────────────────────────────────────────────────

describe('getPaymentLabel', () => {
  it('returns COD label for "cod"', () => {
    const { label, type } = getPaymentLabel('cod')
    expect(label).toContain('COD')
    expect(type).toBe('cod')
  })

  it('returns COD label for "cash_on_delivery"', () => {
    expect(getPaymentLabel('cash_on_delivery').type).toBe('cod')
  })

  it('returns online label for "razorpay"', () => {
    const { label, type } = getPaymentLabel('razorpay')
    expect(label).toContain('Online')
    expect(type).toBe('online')
  })

  it('returns online label for "upi"', () => {
    expect(getPaymentLabel('upi').type).toBe('online')
  })

  it('returns unknown type for unrecognised method', () => {
    const { type } = getPaymentLabel('bitcoin')
    expect(type).toBe('unknown')
  })

  it('returns unknown type for null', () => {
    expect(getPaymentLabel(null).type).toBe('unknown')
  })

  it('returns unknown type for empty string', () => {
    expect(getPaymentLabel('').type).toBe('unknown')
  })

  it('is case-insensitive (normalises to lowercase)', () => {
    expect(getPaymentLabel('COD').type).toBe('cod')
    expect(getPaymentLabel('Razorpay').type).toBe('online')
  })
})

// ─── getCourierTrackingUrl ────────────────────────────────────────────────────

describe('getCourierTrackingUrl', () => {
  it('returns a known courier URL with tracking number substituted', () => {
    const url = getCourierTrackingUrl('Delhivery', 'TRACK123')
    expect(url).toContain('delhivery.com')
    expect(url).toContain('TRACK123')
  })

  it('is case-insensitive for courier name', () => {
    const url = getCourierTrackingUrl('BLUEDART', 'ABC456')
    expect(url).toContain('bluedart.com')
    expect(url).toContain('ABC456')
  })

  it('strips spaces in courier name before lookup', () => {
    const url = getCourierTrackingUrl('xpress bees', 'XB789')
    expect(url).toContain('xpressbees.com')
  })

  it('falls back to Google Search for unknown courier', () => {
    const url = getCourierTrackingUrl('SomeUnknownCourier', '12345')
    expect(url).toContain('google.com/search')
    expect(url).toContain('12345')
  })

  it('falls back to Google Search for null courier', () => {
    const url = getCourierTrackingUrl(null, 'TRACK999')
    expect(url).toContain('google.com/search')
  })

  it('URL-encodes the tracking number in the Google fallback', () => {
    const url = getCourierTrackingUrl(null, 'TRACK #999')
    expect(url).toContain(encodeURIComponent('TRACK #999'))
  })
})
