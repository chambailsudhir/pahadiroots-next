/**
 * ourPromisePages.test.ts
 *
 * Owner request (Oct 2026): "From the Himalayas. With Nothing to Hide." (Our Promise) must appear on every relevant
 * page, and the old "Our Promise — Why HimVeda by Pahadi Roots" block must be gone from every page.
 *   • The old block only lived on the product page (an inline component with its own 2 pillars).
 *   • The new section is the homepage component, shared (components/homepage/WhySection.tsx).
 * Source-level guard, same style as other tests in this repo.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const SRC = join(__dirname, '..')
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8')
// Strip comments so documentation of the removal does not trip the checks.
const code = (s: string) => s.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const PAGES_WITH_PROMISE = [
  'app/page.tsx',                    // homepage (already had it)
  'app/products/[slug]/page.tsx',    // product detail
  'app/products/page.tsx',           // shop / browse
  'app/new-arrivals/page.tsx',
  'app/collections/[slug]/page.tsx', // category pages
  'app/regions/page.tsx',
  'app/regions/[slug]/page.tsx',
]

describe('"From the Himalayas. With Nothing to Hide." is on every relevant page', () => {
  it.each(PAGES_WITH_PROMISE)('%s imports and renders the shared promise section', (rel) => {
    const c = code(read(rel))
    expect(c).toMatch(/from '@\/components\/homepage\/WhySection'/)
    expect(c).toMatch(/<(OurPromiseSection|WhySection)\b[^>]*\/>/)
  })

  it('the shared section still carries the headline', () => {
    expect(read('components/homepage/WhySection.tsx')).toContain('From the Himalayas. With Nothing to Hide.')
  })

  it('transactional / account pages do NOT get it (cart, checkout, payment, account, track, order-success)', () => {
    for (const rel of ['app/cart/page.tsx', 'app/checkout/page.tsx', 'app/payment/page.tsx', 'app/track/page.tsx', 'app/order-success/page.tsx']) {
      expect(code(read(rel))).not.toMatch(/components\/homepage\/WhySection/)
    }
  })
})

describe('the old "Why HimVeda by Pahadi Roots" block is gone from every page', () => {
  function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name)
      if (statSync(p).isDirectory()) { if (name !== '__tests__' && name !== 'node_modules') walk(p, out) }
      else if (/\.(tsx?|css)$/.test(name)) out.push(p)
    }
    return out
  }
  const files = walk(SRC)

  it('no source file renders the heading "Why HimVeda by Pahadi Roots"', () => {
    const offenders = files.filter(f => /\.tsx?$/.test(f) && code(readFileSync(f, 'utf8')).includes('Why HimVeda by Pahadi Roots'))
    expect(offenders).toEqual([])
  })

  it('the product page no longer defines or renders the old inline section', () => {
    const c = code(read('app/products/[slug]/page.tsx'))
    expect(c).not.toMatch(/function WhySection\b/)
    expect(c).not.toMatch(/pdp-why-(title|chip|pillar|grid|bg|inner|num|pt|pd|sub)\b/)
    expect(c).not.toContain('Lab Tested Purity')
  })

  it('its CSS is gone too (the honey "why different" cards keep their own pdp-why-diff-* styles)', () => {
    const css = read('app/products/[slug]/pdp.css')
    expect(css).not.toMatch(/\.pdp-why-(bg|inner|chip|title|sub|grid|pillar|num|pt|pd)\b/)
    expect(css).toMatch(/\.pdp-why-diff-card/)
  })
})
