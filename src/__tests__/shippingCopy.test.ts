/**
 * F-02 / F-05 — shipping + COD wording must come from the live admin settings, never from
 * hand-typed text that can disagree with what checkout actually charges.
 */
import { describe, it, expect } from 'vitest'
import {
  getShippingPolicy, freeShippingPhrase, freeShippingSub, shippingPolicySentence, reconcileShippingCopy,
} from '@/lib/shippingCopy'
import { isCodEnabled } from '@/lib/siteSettingsHelpers'

const live = { free_shipping_min: '0', flat_shipping_charge: '99' }   // the real production values
const threshold = { free_shipping_min: '799', flat_shipping_charge: '99' }

describe('getShippingPolicy', () => {
  it('treats the REAL value 0 as 0 (the cart used to turn it into 500)', () => {
    expect(getShippingPolicy(live)).toEqual({ freeMin: 0, flat: 99, freeForAll: true })
  })
  it('a positive threshold with a flat charge is a real threshold', () => {
    expect(getShippingPolicy(threshold)).toEqual({ freeMin: 799, flat: 99, freeForAll: false })
  })
  it('a zero flat charge also means everything ships free', () => {
    expect(getShippingPolicy({ free_shipping_min: '500', flat_shipping_charge: '0' }).freeForAll).toBe(true)
  })
  it('falls back to the shared defaults only when blank/missing', () => {
    expect(getShippingPolicy({}).freeMin).toBe(0)
    expect(getShippingPolicy({ free_shipping_min: '' }).freeMin).toBe(0)
    expect(getShippingPolicy({ free_shipping_min: 'abc' }).freeMin).toBe(0)
  })
})

describe('phrases', () => {
  it('free for all', () => {
    expect(freeShippingPhrase(live)).toBe('Free shipping on all orders')
    expect(freeShippingSub(live)).toBe('On all orders')
  })
  it('threshold', () => {
    expect(freeShippingPhrase(threshold)).toBe('Free shipping on orders above ₹799')
    expect(freeShippingSub(threshold)).toBe('On orders above ₹799')
    expect(shippingPolicySentence(threshold)).toContain('Flat ₹99 on orders below ₹799')
  })
})

describe('reconcileShippingCopy — rewrites stale hand-typed claims to the live rule', () => {
  it.each([
    ['Free shipping above ₹799', 'Free shipping on all orders'],
    ['🚚 Free shipping · On orders above ₹500 — Pan India', '🚚 Free shipping on all orders — Pan India'],
    ['free delivery on orders over Rs. 500', 'free shipping on all orders'],
    ['FREE SHIPPING ABOVE INR 999', 'FREE SHIPPING ON ALL ORDERS'],
    ['Pure honey. Free shipping above ₹799 across India.', 'Pure honey. Free shipping on all orders across India.'],
  ])('%s', (input, expected) => {
    expect(reconcileShippingCopy(input, live)).toBe(expected)
  })

  it('rewrites to the live threshold when one is configured', () => {
    expect(reconcileShippingCopy('Free shipping above ₹500', threshold)).toBe('Free shipping on orders above ₹799')
  })

  it('hand-typed "on all orders" follows the setting too (e.g. the SEO meta description)', () => {
    const seo = 'Direct from mountain farmers. Free shipping on all orders.'
    expect(reconcileShippingCopy(seo, live)).toBe(seo)   // rule is "all orders" → unchanged
    expect(reconcileShippingCopy(seo, threshold)).toBe('Direct from mountain farmers. Free shipping on orders above ₹799.')
  })

  it('leaves unrelated text alone', () => {
    for (const t of ['Use WELCOME50 ₹50 off above ₹500', 'Free shipping, no minimum', 'Free shipping on all orders', 'Honey ₹799']) {
      expect(reconcileShippingCopy(t, live)).toBe(t)
    }
  })

  it('expands tokens', () => {
    expect(reconcileShippingCopy('{{free_shipping}}', threshold)).toBe('Free shipping on orders above ₹799')
    expect(reconcileShippingCopy('min {{free_shipping_min}}, flat {{flat_shipping_charge}}', threshold)).toBe('min ₹799, flat ₹99')
  })
})

describe('isCodEnabled — one definition for client and server', () => {
  it.each([
    ['true', true], ['TRUE', true], ['1', true], ['on', true],
    ['false', false], ['False', false], ['0', false], ['off', false], ['no', false],
  ])('cod_enabled=%s → %s', (v, expected) => {
    expect(isCodEnabled({ cod_enabled: v })).toBe(expected)
  })
  it('unset or blank → DISABLED (matches the server default), never silently on', () => {
    expect(isCodEnabled({})).toBe(false)
    expect(isCodEnabled({ cod_enabled: null })).toBe(false)
  })
})
