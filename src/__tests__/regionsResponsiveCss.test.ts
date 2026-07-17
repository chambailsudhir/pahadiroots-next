/**
 * regionsResponsiveCss.test.ts
 *
 * Covers the CSS-only fixes for bugs #22, #23, #24 in src/app/globals.css,
 * src/app/regions/page.tsx, and src/app/regions/[slug]/page.tsx.
 *
 * IMPORTANT — what this test can and cannot prove:
 * jsdom does not evaluate @media queries at all (confirmed limitation — it
 * has no viewport/layout engine), so a real computed-style assertion at a
 * given viewport width requires an actual browser. This project has
 * Playwright set up for exactly that (see e2e/regionsResponsive.spec.ts),
 * but Playwright's browser binaries download from cdn.playwright.dev, which
 * isn't reachable from this sandbox's network allowlist, and the /regions
 * pages fetch data server-side directly from Supabase during SSR (not via
 * a browser-interceptable API route), so there's no credentials-free way to
 * even boot the page here.
 *
 * What THIS test verifies instead, without needing a browser: that the
 * exact media-query rules exist in the source CSS with the right selectors,
 * breakpoints, and property values. It's a regression guard — if someone
 * later deletes or mis-edits these rules, this test fails immediately even
 * without a browser. It does NOT prove the rules render correctly in an
 * actual layout; e2e/regionsResponsive.spec.ts is what proves that, and it
 * needs to be run somewhere with browser binaries + real Supabase access
 * (i.e. your own machine or CI).
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const globalsCss = readFileSync(join(__dirname, '../app/globals.css'), 'utf-8')
const regionsPageSrc = readFileSync(join(__dirname, '../app/regions/page.tsx'), 'utf-8')
const regionDetailPageSrc = readFileSync(join(__dirname, '../app/regions/[slug]/page.tsx'), 'utf-8')

describe('bug #22 — .pr-shdr responsive breakpoints', () => {
  it('has a 640px breakpoint that stacks the split panel to a single column', () => {
    const rule = globalsCss.match(/@media\(max-width:640px\)\s*{[^}]*\.pr-shdr[^}]*}/)
    expect(rule, 'no 640px rule targeting .pr-shdr found').toBeTruthy()
    expect(rule![0]).toMatch(/grid-template-columns:\s*1fr\s*!important/)
    expect(rule![0]).toMatch(/height:\s*auto\s*!important/)
  })

  it('has a 900px (tablet) breakpoint that shrinks the fixed height instead of ' +
     'leaving the 54/46 split at its full 450px height all the way down from desktop', () => {
    const line = globalsCss.split('\n').find(l => l.includes('@media(max-width:900px)') && l.includes('.pr-shdr'))
    expect(line, 'no 900px media query line targeting .pr-shdr found').toBeTruthy()
    expect(line).toMatch(/height:\s*380px\s*!important/)
  })

  it('base .pr-shdr rule is unchanged (54/46 split, 450px) — the fix is additive breakpoints, not a rewrite', () => {
    expect(globalsCss).toMatch(/\.pr-shdr\s*{\s*display:\s*grid;\s*grid-template-columns:\s*54%\s*46%;\s*height:\s*450px/)
  })
})

describe('bug #23 — /regions listing hero + shell mobile padding', () => {
  it('hero and shell wrappers carry the classNames the mobile override targets', () => {
    expect(regionsPageSrc).toMatch(/className="regions-hero"/)
    // Both the states-count and cards-grid wrappers should carry it — check count, not just presence.
    const shellMatches = regionsPageSrc.match(/className="regions-shell"/g) || []
    expect(shellMatches.length).toBe(2)
  })

  it('has a 640px override reducing horizontal padding on .regions-hero and .regions-shell', () => {
    const mediaBlock = regionsPageSrc.match(/@media\(max-width:640px\)\s*{[\s\S]*?}\s*`}<\/style>/)
    expect(mediaBlock, 'no 640px media block found in regions/page.tsx').toBeTruthy()
    expect(mediaBlock![0]).toMatch(/\.regions-hero\s*{\s*padding-left:\s*20px\s*!important;\s*padding-right:\s*20px\s*!important/)
    expect(mediaBlock![0]).toMatch(/\.regions-shell\s*{\s*padding-left:\s*20px\s*!important;\s*padding-right:\s*20px\s*!important/)
  })
})

describe('bug #24 — /regions/[slug] detail page hero + shell mobile padding', () => {
  it('hero-content and shell wrappers carry the classNames the mobile override targets', () => {
    expect(regionDetailPageSrc).toMatch(/className="region-hero-content"/)
    expect(regionDetailPageSrc).toMatch(/className="region-shell"/)
  })

  it('has a 640px override reducing horizontal padding on .region-hero-content and .region-shell', () => {
    const mediaBlock = regionDetailPageSrc.match(/@media\(max-width:640px\)\s*{[\s\S]*?}\s*`}<\/style>/)
    expect(mediaBlock, 'no 640px media block found in regions/[slug]/page.tsx').toBeTruthy()
    expect(mediaBlock![0]).toMatch(/\.region-hero-content\s*{\s*padding-left:\s*20px\s*!important;\s*padding-right:\s*20px\s*!important/)
    expect(mediaBlock![0]).toMatch(/\.region-shell\s*{\s*padding-left:\s*20px\s*!important;\s*padding-right:\s*20px\s*!important/)
  })
})
