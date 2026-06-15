/**
 * htmlEscape.test.ts
 *
 * Tests for the esc() HTML entity escaper in lib/server/htmlEscape.ts.
 *
 * Context
 * ───────
 * esc() is called on every user-supplied field (name, address, order number,
 * payment ID) before interpolation into HTML email bodies in both
 * payments/route.ts (Razorpay confirmation) and orders/route.ts (COD).
 *
 * A bypass in any of the five critical HTML characters (&, <, >, ", ')
 * would allow a user with a crafted name/address to inject arbitrary HTML
 * or JavaScript into the email body.
 *
 * These tests verify:
 *   1. All five critical characters are escaped correctly
 *   2. Safe characters are NOT escaped (no over-escaping)
 *   3. null / undefined / non-string inputs are handled safely
 *   4. Multiple occurrences in one string all get escaped
 *   5. Mixed safe + unsafe string produces correct output
 */

import { describe, it, expect, vi } from 'vitest'

// htmlEscape.ts has `import 'server-only'` — mock it so tests run in non-Next.js env
vi.mock('server-only', () => ({}))

import { esc } from '@/lib/server/htmlEscape'

describe('esc — HTML entity escaping', () => {

  // ── Core character escapes ──────────────────────────────────────────────────

  it('escapes & to &amp;', () => {
    expect(esc('Tom & Jerry')).toBe('Tom &amp; Jerry')
  })

  it('escapes < to &lt; (XSS vector)', () => {
    expect(esc('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;')
  })

  it('escapes > to &gt;', () => {
    expect(esc('a > b')).toBe('a &gt; b')
  })

  it('escapes " to &quot; (attribute injection)', () => {
    expect(esc('"quoted"')).toBe('&quot;quoted&quot;')
  })

  it("escapes ' to &#x27; (attribute injection)", () => {
    expect(esc("it's me")).toBe("it&#x27;s me")
  })

  // ── Safe characters are NOT escaped ────────────────────────────────────────

  it('does not escape plain alphanumeric text', () => {
    expect(esc('Ramesh Kumar')).toBe('Ramesh Kumar')
  })

  it('does not escape numbers', () => {
    expect(esc('PR1A2B3C4D')).toBe('PR1A2B3C4D')
  })

  it('does not escape spaces, commas, periods', () => {
    expect(esc('12 Pahadi Lane, Shimla 171001.')).toBe('12 Pahadi Lane, Shimla 171001.')
  })

  it('does not escape ₹ or unicode characters', () => {
    expect(esc('Total: ₹1,000')).toBe('Total: ₹1,000')
  })

  // ── Multiple occurrences ────────────────────────────────────────────────────

  it('escapes all occurrences of & in a string', () => {
    expect(esc('A & B & C')).toBe('A &amp; B &amp; C')
  })

  it('escapes all occurrences of < in a string', () => {
    expect(esc('a < b < c')).toBe('a &lt; b &lt; c')
  })

  // ── Mixed safe + unsafe ─────────────────────────────────────────────────────

  it('handles a typical XSS payload in a name field', () => {
    // Simulates a user who enters their name as: <img src=x onerror=alert(1)>
    const input  = '<img src=x onerror=alert(1)>'
    const result = esc(input)
    expect(result).not.toContain('<')
    expect(result).not.toContain('>')
    expect(result).toBe('&lt;img src=x onerror=alert(1)&gt;')
  })

  it('handles a script injection in an address field', () => {
    const input  = '"><script>document.cookie</script>'
    const result = esc(input)
    expect(result).not.toContain('<')
    expect(result).not.toContain('>')
    expect(result).not.toContain('"')
  })

  // ── Null / undefined / non-string inputs ────────────────────────────────────

  it('returns empty string for null', () => {
    expect(esc(null)).toBe('')
  })

  it('returns empty string for undefined', () => {
    expect(esc(undefined)).toBe('')
  })

  it('converts numbers to string before escaping', () => {
    expect(esc(42)).toBe('42')
  })

  it('converts boolean to string', () => {
    expect(esc(true)).toBe('true')
  })

  it('converts an object to its toString() before escaping', () => {
    // Objects toString to '[object Object]' — no injection risk but must not throw
    expect(() => esc({})).not.toThrow()
    const result = esc({})
    expect(typeof result).toBe('string')
  })

  // ── Empty string ─────────────────────────────────────────────────────────────

  it('returns empty string for empty input', () => {
    expect(esc('')).toBe('')
  })
})
