/**
 * pdpClaimsGuard.test.ts — keeps PDP claims the owner has said are untrue (or that the code cannot back) from
 * coming back. Source-level guard, same style as other tests in this repo.
 *
 * Owner answers (PDP audit follow-up):
 *   • Honey is strained BY HAND through a stainless-steel mesh sieve; no machine filtering  → never "never filtered".
 *   • "5% of every order funds…", "fair wages, always", "zero single-use plastic" are NOT true → removed.
 *   • Chambail International is both manufacturer and packer → shown on the PDP.
 * Lab-test wording must stay certificate-driven (no "every batch" / "with every order").
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const page = readFileSync(join(__dirname, '../app/products/[slug]/page.tsx'), 'utf8')
// Ignore comments so documentation of what was removed does not trip the guard.
const code = page.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')

describe('PDP claims the owner said are not true stay removed', () => {
  it.each([
    'zero single-use plastic',
    '5% of every order',
    'forest restoration',
    'village school',
    'fair wages',
  ])('no "%s" on the PDP', (phrase) => {
    expect(code.toLowerCase()).not.toContain(phrase.toLowerCase())
  })
})

describe('filtering is described truthfully (stainless-steel mesh sieve, by hand, no machine)', () => {
  it('never says "never filtered" / "or filtered" / "strained once for clarity"', () => {
    expect(code).not.toMatch(/never filtered|or filtered|strained once for clarity/i)
  })
  it('says hand-strained through a stainless-steel mesh sieve', () => {
    expect(code).toContain('strained by hand through a stainless-steel mesh sieve')
  })
})

describe('lab-test wording is certificate-driven', () => {
  it('no blanket "every batch" / "with every order" claim', () => {
    expect(code).not.toMatch(/every batch|certificate with every order/i)
  })
  it('no placeholder text', () => {
    expect(code).not.toMatch(/\[ADD VERIFIED|PLACEHOLDER|TODO|FIXME/)
  })
})

describe('manufacturer / packer line', () => {
  it('PDP shows "Manufactured & packed by" the confirmed legal entity', () => {
    expect(code).toContain('Manufactured & packed by')
    expect(code).toContain('MANUFACTURER_AND_PACKER')
    expect(readFileSync(join(__dirname, '../lib/legalEntity.ts'), 'utf8')).toContain("'Chambail International'")
  })
})
