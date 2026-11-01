import { describe, it, expect } from 'vitest'
import { minifyCss } from '@/lib/minifyCss'

describe('minifyCss', () => {
  it('drops comments and collapses whitespace', () => {
    expect(minifyCss(`
      /* header */
      .a  { color: red ; margin: 0 }
      .b > .c , .d { padding: 4px 8px; }
    `)).toBe('.a{color:red;margin:0}.b>.c,.d{padding:4px 8px}')
  })
  it('keeps quoted strings and url() values exactly (spaces, comment-like text, semicolons)', () => {
    const css = `.x::before{content:"a  b /* not a comment */ ; c";background:url( "a b.png" )} .y{font-family:'Playfair Display',serif}`
    const out = minifyCss(css)
    expect(out).toContain('content:"a  b /* not a comment */ ; c"')
    expect(out).toContain('url( "a b.png" )')
    expect(out).toContain("font-family:'Playfair Display',serif")
  })
  it('keeps media queries and keyframes valid', () => {
    expect(minifyCss('@media (max-width: 640px) { .a { display: none } } @keyframes k { from { opacity: 0 } to { opacity: 1 } }'))
      .toBe('@media (max-width:640px){.a{display:none}}@keyframes k{from{opacity:0}to{opacity:1}}')
  })
  it('keeps the descendant/pseudo distinction (".a :hover" is not ".a:hover")', () => {
    expect(minifyCss('.a :hover { x: y }')).toBe('.a :hover{x:y}')
    expect(minifyCss('.a:hover { x: y }')).toBe('.a:hover{x:y}')
  })
  it('is idempotent and safe on empty input', () => {
    const once = minifyCss('.a { color: red ; }')
    expect(minifyCss(once)).toBe(once)
    expect(minifyCss('')).toBe('')
  })
})
