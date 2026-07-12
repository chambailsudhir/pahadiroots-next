/**
 * sanitize.test.ts
 *
 * lib/server/sanitize.ts had ZERO test coverage before this file, despite
 * being the sole XSS-prevention layer for every dangerouslySetInnerHTML in
 * the app (blog content, PDP AI-generated fields, the announcement bar).
 * A regression here is a real security issue, not just a cosmetic bug.
 */

import { describe, it, expect } from 'vitest'
import { sanitize, sanitizeHtml } from '@/lib/server/sanitize'

describe('sanitize (plain-text stripping)', () => {
  it('strips all HTML tags', () => {
    expect(sanitize('<b>Hello</b> <script>alert(1)</script>World')).toBe('Hello alert(1)World')
  })

  it('trims whitespace', () => {
    expect(sanitize('  hello  ')).toBe('hello')
  })

  it('returns empty string for null/undefined without throwing', () => {
    expect(sanitize(null)).toBe('')
    expect(sanitize(undefined)).toBe('')
  })
})

describe('sanitizeHtml — script/style/dangerous-element removal', () => {
  it('removes <script> blocks entirely, including their content', () => {
    const out = sanitizeHtml('<p>Safe</p><script>alert("xss")</script><p>Also safe</p>')
    expect(out).not.toContain('script')
    expect(out).not.toContain('alert')
    expect(out).toContain('Safe')
    expect(out).toContain('Also safe')
  })

  it('removes <style>, <iframe>, <object>, <embed>, <form> blocks and their content', () => {
    const out = sanitizeHtml(
      '<style>body{display:none}</style><iframe src="evil.com"></iframe>' +
      '<object data="evil.swf"></object><embed src="evil"><form><input></form>'
    )
    expect(out).not.toContain('display:none')
    expect(out).not.toContain('evil.com')
    expect(out).not.toContain('evil.swf')
  })

  it('strips a self-closing dangerous tag with no closing tag (e.g. a lone <iframe/>)', () => {
    const out = sanitizeHtml('<p>Text</p><iframe src="evil.com" />')
    expect(out).not.toContain('evil.com')
  })
})

describe('sanitizeHtml — event handler removal', () => {
  it('strips onerror/onclick/onload and any other on* attribute', () => {
    const out = sanitizeHtml('<img src="x.jpg" onerror="alert(1)"><div onclick="steal()">text</div>')
    expect(out).not.toContain('onerror')
    expect(out).not.toContain('onclick')
    expect(out).not.toContain('alert(1)')
    expect(out).not.toContain('steal()')
  })
})

describe('sanitizeHtml — dangerous protocol removal', () => {
  it('neutralizes javascript: URLs in href', () => {
    const out = sanitizeHtml('<a href="javascript:alert(1)">click me</a>')
    expect(out).not.toContain('javascript:alert')
  })

  it('neutralizes data: URLs in src (a common XSS/phishing vector)', () => {
    const out = sanitizeHtml('<img src="data:text/html,<script>alert(1)</script>">')
    expect(out).not.toContain('data:text/html')
  })

  it('allows safe https:// links through unchanged', () => {
    const out = sanitizeHtml('<a href="https://pahadiroots.com">shop</a>')
    expect(out).toContain('https://pahadiroots.com')
  })

  it('allows relative links (starting with /) through', () => {
    const out = sanitizeHtml('<a href="/products/honey">honey</a>')
    expect(out).toContain('/products/honey')
  })
})

describe('sanitizeHtml — tag allowlist', () => {
  it('keeps allowlisted formatting tags (p, strong, ul/li, headings)', () => {
    const out = sanitizeHtml('<p>Para</p><strong>Bold</strong><ul><li>Item</li></ul><h2>Heading</h2>')
    expect(out).toContain('<p>Para</p>')
    expect(out).toContain('<strong>Bold</strong>')
    expect(out).toContain('<li>Item</li>')
    expect(out).toContain('<h2>Heading</h2>')
  })

  it('strips non-allowlisted tags but keeps their inner text', () => {
    const out = sanitizeHtml('<marquee>scrolling text</marquee><custom-el>content</custom-el>')
    expect(out).not.toContain('<marquee')
    expect(out).not.toContain('<custom-el')
    expect(out).toContain('scrolling text')
    expect(out).toContain('content')
  })

  it('strips disallowed attributes (class/style/id) from otherwise-allowed tags', () => {
    const out = sanitizeHtml('<p class="evil" style="color:red" id="x">text</p>')
    expect(out).not.toContain('class=')
    expect(out).not.toContain('style=')
    expect(out).toContain('text')
  })
})

describe('sanitizeHtml — edge cases', () => {
  it('returns empty string for null/undefined without throwing', () => {
    expect(sanitizeHtml(null)).toBe('')
    expect(sanitizeHtml(undefined)).toBe('')
  })

  it('handles plain text with no HTML at all', () => {
    expect(sanitizeHtml('just plain text')).toBe('just plain text')
  })

  it('is idempotent — sanitizing already-clean HTML twice produces the same result (important since layout.tsx caches and re-uses the settings object)', () => {
    const once  = sanitizeHtml('<p>Hello <strong>World</strong></p>')
    const twice = sanitizeHtml(once)
    expect(twice).toBe(once)
  })
})
