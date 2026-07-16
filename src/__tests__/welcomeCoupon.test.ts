/**
 * welcomeCoupon.test.ts
 *
 * Covers the P1 audit fix: the newsletter signup ("Get 5% Off Your First
 * Order... check your inbox for your discount code") previously generated
 * no code and sent no email at all. generateWelcomeCouponCode() is the
 * deterministic code-derivation piece of the real fix in
 * api/v1/actions/route.ts's `subscribe` action.
 */

import { describe, it, expect } from 'vitest'
import { generateWelcomeCouponCode } from '@/lib/welcomeCoupon'

describe('generateWelcomeCouponCode', () => {
  it('produces a WELCOME5-prefixed code', () => {
    expect(generateWelcomeCouponCode('someone@example.com')).toMatch(/^WELCOME5-[0-9A-F]{6}$/)
  })

  it('is deterministic — the same email always yields the same code', () => {
    const a = generateWelcomeCouponCode('jane@example.com')
    const b = generateWelcomeCouponCode('jane@example.com')
    expect(a).toBe(b)
  })

  it('is case- and whitespace-insensitive on the email', () => {
    const a = generateWelcomeCouponCode('Jane@Example.com')
    const b = generateWelcomeCouponCode('  jane@example.com  ')
    expect(a).toBe(b)
  })

  it('produces different codes for different emails', () => {
    const a = generateWelcomeCouponCode('jane@example.com')
    const b = generateWelcomeCouponCode('john@example.com')
    expect(a).not.toBe(b)
  })
})
