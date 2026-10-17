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

// ── PDP audit P1-1 regression: '>' inside a quoted attribute must not end the tag ──────────
describe('sanitizeHtml — quoted-attribute bypasses (PDP audit P1-1)', () => {
  const noHandler = (out: string) => expect(out.toLowerCase()).not.toMatch(/\bon[a-z]+\s*=/)

  it('drops onerror when a quoted attribute contains ">"', () => {
    const out = sanitizeHtml('<img src="/x" alt=">" onerror="alert(1)">')
    noHandler(out)
    expect(out).not.toContain('alert(1)')
    expect(out).toContain('src="/x"')
  })

  it('drops onclick when a quoted title contains ">"', () => {
    const out = sanitizeHtml('<a href="/x" title=">" onclick="alert(1)">hi</a>')
    noHandler(out)
    expect(out).not.toContain('alert(1)')
    expect(out).toContain('>hi</a>')
  })

  it('handles single quotes, unquoted values and mixed case handlers', () => {
    noHandler(sanitizeHtml("<img alt='>' OnError='alert(1)' src=/x>"))
    noHandler(sanitizeHtml('<img src=/x onerror=alert(1)>'))
    noHandler(sanitizeHtml('<p ONMOUSEOVER="alert(1)">x</p>'))
  })

  it('does not let an attribute value escape its quotes in the output', () => {
    const out = sanitizeHtml('<a href="/x" title=\'" onmouseover="alert(1)\'>t</a>')
    // The hostile text must stay INSIDE the (escaped) title value: exactly two attributes, no quote breaks out.
    expect(out).toBe('<a href="/x" title="&quot; onmouseover=&quot;alert(1)">t</a>')
    expect(out.match(/"/g)?.length).toBe(4)
  })

  it('catches entity-encoded and whitespace-split javascript: URLs', () => {
    expect(sanitizeHtml('<a href="java&#115;cript:alert(1)">x</a>')).toBe('<a>x</a>')
    expect(sanitizeHtml('<a href="&#106;avascript:alert(1)">x</a>')).toBe('<a>x</a>')
    expect(sanitizeHtml('<a href="jav&#x09;ascript:alert(1)">x</a>')).toBe('<a>x</a>')
    expect(sanitizeHtml('<a href=" \tjavascript:alert(1)">x</a>')).toBe('<a>x</a>')
    expect(sanitizeHtml('<a href="javascript&colon;alert(1)">x</a>')).toBe('<a>x</a>')
  })

  it('rejects protocol-relative URLs and data: images', () => {
    expect(sanitizeHtml('<a href="//evil.example/x">x</a>')).toBe('<a>x</a>')
    expect(sanitizeHtml('<img src="//evil.example/t.png">')).toBe('<img>')
    expect(sanitizeHtml('<img src="data:image/svg+xml;base64,AAAA">')).toBe('<img>')
  })

  it('drops svg/math/template/noscript with their content, and comments', () => {
    expect(sanitizeHtml('a<svg onload=alert(1)><circle/></svg>b')).toBe('ab')
    expect(sanitizeHtml('a<math><mi>x</mi></math>b')).toBe('ab')
    expect(sanitizeHtml('a<!-- <script>alert(1)</script> -->b')).toBe('ab')
  })

  it('neutralises nested/obfuscated tag tricks', () => {
    const out = sanitizeHtml('<scr<script>ipt>alert(1)</scr</script>ipt>')
    expect(out).not.toMatch(/<script/i)
    expect(out).not.toMatch(/<[a-z]+[^>]*on[a-z]+=/i)
  })

  it('escapes a stray "<" instead of passing a half tag through', () => {
    expect(sanitizeHtml('5 < 6 and <b>bold</b>')).toBe('5 &lt; 6 and <b>bold</b>')
    expect(sanitizeHtml('<img src="x" onerror="alert(1)"')).not.toContain('<img')
  })

  it('target=_blank always gets rel=noopener noreferrer', () => {
    expect(sanitizeHtml('<a href="https://a.test" target="_blank">x</a>'))
      .toBe('<a href="https://a.test" target="_blank" rel="noopener noreferrer">x</a>')
  })

  it('no longer mangles ordinary text that contains "data:" or "javascript:" words', () => {
    expect(sanitizeHtml('<p>Nutrition data: see label</p>')).toBe('<p>Nutrition data: see label</p>')
  })

  it('is idempotent on hostile input', () => {
    const once = sanitizeHtml('<img src="/x" alt=">" onerror="alert(1)"><a href="java&#115;cript:1" title=">">x</a>')
    expect(sanitizeHtml(once)).toBe(once)
  })
})
