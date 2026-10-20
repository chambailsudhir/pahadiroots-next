/**
 * storefrontClaimsGuard.test.ts — site-wide guard for claims the owner has said are NOT true.
 *
 * Owner answers (PDP audit follow-up, Oct 2026):
 *   • "5% of every order funds forest restoration / village schools", "fair wages, always", "zero single-use
 *     plastic": nothing we are doing like this → remove.
 *   • Honey is strained by hand through a stainless-steel mesh sieve, no machine → never "unfiltered".
 * "Fair trade" reads like a certification, which nothing in the codebase backs, so it is covered here as well.
 * Documentation comments are ignored; only code and visible strings are checked.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const SRC = join(__dirname, '..')
const strip = (s: string) => s.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) { if (name !== '__tests__' && name !== 'node_modules') walk(p, out) }
    else if (/\.tsx?$/.test(name)) out.push(p)
  }
  return out
}
const files = walk(SRC).map(f => ({ f, code: strip(readFileSync(f, 'utf8')) }))

const BANNED: [string, RegExp][] = [
  ['Eco Packaged badge',                 /Eco Packaged/i],
  ['"Minimal plastic"',                  /Minimal plastic/i],
  ['"zero single-use plastic"',          /single-use plastic/i],
  ['"Fair trade"',                       /fair[- ]trade/i],
  ['"fair wages"',                       /fair wages/i],
  ['"5% of every order" pledge',         /5% of every order/i],
  ['forest restoration pledge',          /forest restoration/i],
  ['village school pledge',              /village school/i],
  ['"raw and unfiltered"',               /raw (and|&amp;|&) unfiltered/i],
  ['"never filtered" / "never heated or filtered"', /never (heated or )?filtered/i],
]

describe('claims the owner said are untrue never appear in the storefront code', () => {
  it.each(BANNED)('%s', (_label, re) => {
    const offenders = files.filter(({ code }) => re.test(code)).map(({ f }) => f.replace(SRC, 'src'))
    expect(offenders).toEqual([])
  })
})

describe('replacements are in place', () => {
  const get = (rel: string) => strip(readFileSync(join(SRC, rel), 'utf8'))
  it('story section says hand-strained', () => {
    const c = get('components/story/WhereTheyBegin.tsx')
    expect(c).toContain('raw and hand-strained')
    expect(c).toContain('Raw and hand-strained')
  })
  it('cart sidebar badge and trust row use supported wording', () => {
    expect(get('components/cart/PahadiStoryCard.tsx')).toContain('Pan-India Delivery')
    expect(get('app/cart/page.tsx')).toContain("'Farmer Direct',       'No middlemen'")
  })
})
