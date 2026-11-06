/**
 * Nov 2026 front-end verification (F-5 / L1 / L3 / L6 / ACC-001c): the exact colour pairs and CSS rules the fixes rely on,
 * read from the real source files so a later "small tweak" cannot silently regress them.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
// Source with line comments, block comments and JSX comment braces removed, so a comment that cites the OLD colour does not count as a use.
const code = (src: string) => src.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"])\/\/.*$/gm, '$1')

function lum(hex: string): number {
  const h = hex.replace('#', '')
  const f = h.length === 3 ? h.split('').map(c => c + c).join('') : h
  const [r, g, b] = [0, 2, 4].map(i => {
    const v = parseInt(f.slice(i, i + 2), 16) / 255
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
export function contrast(a: string, b: string): number {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}
function cssColour(css: string, selector: string): string {
  const esc = selector.replace(/[.:\-]/g, m => '\\' + m)
  const m = new RegExp(esc + '\\s*\\{[^}]*?(?<![-\\w])color:\\s*(#[0-9a-fA-F]{3,6})').exec(css)
  if (!m) throw new Error('no colour for ' + selector)
  return m[1]
}

const cartCss  = read('src/components/cart/CartUIComponents.module.css')
const globals  = read('src/app/globals.css')
const pdpCss   = read('src/app/products/[slug]/pdp.css')
// Nov 2026 (F-3): the sort bar / grid moved into client components so the pages can be ISR-cached.
const collPage = read('src/components/collections/CollectionListingClient.tsx')
const prodPage = read('src/components/product/ProductListingClient.tsx')
const regionCss = read('src/components/homepage/ExploreByRegion.module.css')
const fabJs    = read('public/js/ai-assistant.js')

describe('F-5 text contrast on the money pages (WCAG AA 4.5:1)', () => {
  it('.ecTagline (empty cart / checkout) on white', () => {
    const fg = cssColour(cartCss, '.ecTagline')
    expect(fg).not.toBe('#c9a240')
    expect(contrast(fg, '#ffffff')).toBeGreaterThanOrEqual(4.5)
  })
  it('--tx3 (used by .punt/.pwas/.prc product-card text) on the cream --pm-cream and on white', () => {
    const tx3 = /--tx3:\s*(#[0-9a-fA-F]{3,6})/.exec(globals)![1]
    const cream = /--pm-cream:\s*(#[0-9a-fA-F]{3,6})/.exec(globals)![1]
    expect(cream.toLowerCase()).toBe('#f5f0e8')
    expect(contrast(tx3, cream)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(tx3, '#ffffff')).toBeGreaterThanOrEqual(4.5)
  })
  it('collection page: no #7a7a7a grey; the sort-bar grey passes on the #f9f4ec page background', () => {
    expect(code(collPage)).not.toMatch(/#7a7a7a/i)
    const grey = /fontSize: '13px', color: '(#[0-9a-fA-F]{6})', margin: 0 \}\}>\s*\{count(?:Text)?\}/.exec(collPage)![1]
    expect(contrast(grey, '#f9f4ec')).toBeGreaterThanOrEqual(4.5)
  })
  it('collection page: the active sort pill is white text on a gold that passes', () => {
    expect(code(collPage)).not.toMatch(/#c8920a/i)
    const bg = /background: sort === opt\.value \? '(#[0-9a-fA-F]{6})'/.exec(collPage)![1]
    expect(contrast('#ffffff', bg)).toBeGreaterThanOrEqual(4.5)
  })
  it('products page: no #7a7a7a grey and no gold-on-white #c8920a text/pill', () => {
    expect(code(prodPage)).not.toMatch(/#7a7a7a/i)
    expect(code(prodPage)).not.toMatch(/#c8920a/i)
    for (const hex of prodPage.matchAll(/color: '(#[0-9a-fA-F]{6})', fontWeight: (?:600|700)/g)) {
      if (hex[1].toLowerCase() === '#ffffff' || hex[1].toLowerCase() === '#fff') continue
      // light text (e.g. the gold 'Just In' badge) sits on the dark-green hero band, not on the page background
      if (contrast(hex[1], '#1a3a1e') >= 4.5) continue
      expect(contrast(hex[1], '#f9f4ec'), hex[1]).toBeGreaterThanOrEqual(4.5)
    }
  })
  it('the chosen replacement tokens themselves', () => {
    expect(contrast('#8a6508', '#ffffff')).toBeGreaterThanOrEqual(4.5) // dark brand gold
    expect(contrast('#5a5448', '#f9f4ec')).toBeGreaterThanOrEqual(4.5) // warm grey on page cream
    expect(contrast('#666666', '#f5f0e8')).toBeGreaterThanOrEqual(4.5) // new --tx3 on card cream
    // and the ones we replaced really failed
    expect(contrast('#c9a240', '#ffffff')).toBeLessThan(4.5)
    expect(contrast('#7a7a7a', '#f9f4ec')).toBeLessThan(4.5)
    expect(contrast('#ffffff', '#c8920a')).toBeLessThan(4.5)
  })
})

describe('ACC-001c: PDP struck-through variant MRP (11px)', () => {
  it('.pdp-vc-orig passes 4.5:1 on white and on the darkest stop of the active-card gradient', () => {
    const fg = cssColour(pdpCss, '.pdp-vc-orig')
    expect(fg.toLowerCase()).not.toBe('#6b6b6b')
    expect(contrast(fg, '#ffffff')).toBeGreaterThanOrEqual(4.5)
    expect(contrast(fg, '#e8f5e9')).toBeGreaterThanOrEqual(4.5)
  })
})

describe('L1: region product card cart button is a >= 24x24 target at 320px', () => {
  it('.cardCart declares min-width/min-height >= 24px and does not flex-shrink', () => {
    const rule = /\.cardCart\s*\{([^}]*)\}/.exec(regionCss)![1]
    const minW = /min-width:\s*(\d+)px/.exec(rule)
    const minH = /min-height:\s*(\d+)px/.exec(rule)
    expect(minW && Number(minW[1])).toBeGreaterThanOrEqual(24)
    expect(minH && Number(minH[1])).toBeGreaterThanOrEqual(24)
    expect(rule).toMatch(/flex-shrink:\s*0/)
  })
})

describe('L3: chat FAB is 46px on phones', () => {
  it('the max-width:600px #pr-ai-fab rule comes AFTER the base #pr-ai-fab rule (same specificity: source order wins)', () => {
    const base  = fabJs.indexOf('#pr-ai-fab {\n    position:fixed;')
    const media = fabJs.indexOf('@media(max-width:600px) { #pr-ai-fab { width:46px; height:46px;')
    expect(base).toBeGreaterThan(-1)
    expect(media).toBeGreaterThan(-1)
    expect(media).toBeGreaterThan(base)
    // and the base rule really is the 56px one, so without the ordering fix phones would get 56px
    expect(fabJs.slice(base, media)).toMatch(/width:56px; height:56px/)
  })
})

describe('L6: collection count grammar', () => {
  it('says "1 product", not "1 products"', () => {
    expect(collPage).not.toMatch(/\{count(?:Text)?\} products •/)
    expect(collPage).toMatch(/\{count(?:Text)?\} \{count === 1 \? 'product' : 'products'\} •/)
  })
})

describe('L5: newsletter CSS is gone with the newsletter blocks', () => {
  it('globals.css has no .f-newsletter / .f-nl-* rules', () => {
    expect(globals).not.toMatch(/\.f-newsletter|\.f-nl-/)
  })
  it('order-success has no .oc-newsletter / .oc-nl-* rules', () => {
    expect(read('src/app/order-success/page.tsx')).not.toMatch(/\.oc-newsletter|\.oc-nl-/)
  })
  it('Footer.tsx no longer claims FooterA is a client component with a newsletter form', () => {
    const footer = read('src/components/layout/Footer.tsx')
    expect(footer).not.toMatch(/own 'use client' for the newsletter form/)
    expect(read('src/components/layout/FooterA.tsx')).not.toMatch(/^'use client'/m)
  })
})
