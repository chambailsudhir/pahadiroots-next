/**
 * e2e/regionsResponsive.spec.ts
 *
 * Domain: /regions and /regions/[slug] responsive layout
 *
 * Covers bugs #22, #23, #24 — visual/computed-style regression checks that
 * genuinely require a real browser (jsdom doesn't evaluate @media queries at
 * all, so these can't be covered by the Vitest unit suite; see the
 * companion regionsResponsiveCss.test.ts, which instead guards the CSS
 * source text itself).
 *
 * ⚠️ COULD NOT BE RUN IN THE SANDBOX THIS WAS WRITTEN IN:
 *   1. Playwright's browser binaries download from cdn.playwright.dev,
 *      which isn't on that sandbox's network egress allowlist.
 *   2. /regions and /regions/[slug] are Server Components that fetch
 *      directly from Supabase during SSR — that happens in the Next.js
 *      server process, not the browser, so Playwright's page.route()
 *      interception (used elsewhere in this suite, e.g. mockCartAPIs())
 *      can't reach it. Rendering these pages at all requires a real
 *      Next.js dev server with real NEXT_PUBLIC_SUPABASE_* env vars.
 *
 * This file is written and ready to run in your own environment (local dev
 * or CI, wherever `npm run e2e` already works for the cart specs) — run
 * `npx playwright install chromium` once if you haven't, then
 * `npx playwright test e2e/regionsResponsive.spec.ts`.
 */

import { test, expect } from '@playwright/test'

test.describe('/regions — responsive hero/shell padding (bug #23)', () => {
  test('horizontal padding shrinks to 20px at mobile widths (≤640px)', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 })
    await page.goto('/regions')

    const hero = page.locator('.regions-hero')
    await expect(hero).toBeVisible()
    const heroPadding = await hero.evaluate(el => getComputedStyle(el).paddingLeft)
    expect(heroPadding).toBe('20px')

    const shells = page.locator('.regions-shell')
    const firstShellPadding = await shells.first().evaluate(el => getComputedStyle(el).paddingLeft)
    expect(firstShellPadding).toBe('20px')
  })

  test('horizontal padding is the full 48px at desktop widths (>640px) — proves the ' +
       'mobile override doesn\'t leak into desktop', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto('/regions')

    const hero = page.locator('.regions-hero')
    const heroPadding = await hero.evaluate(el => getComputedStyle(el).paddingLeft)
    expect(heroPadding).toBe('48px')
  })
})

test.describe('/regions/[slug] — responsive hero/shell padding (bug #24)', () => {
  test('horizontal padding shrinks to 20px at mobile widths (≤640px)', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 })
    // Any valid, currently-active state slug in your DB — adjust if 'hp' isn't seeded.
    await page.goto('/regions/hp')

    const heroContent = page.locator('.region-hero-content')
    await expect(heroContent).toBeVisible()
    const heroPadding = await heroContent.evaluate(el => getComputedStyle(el).paddingLeft)
    expect(heroPadding).toBe('20px')

    const shell = page.locator('.region-shell')
    const shellPadding = await shell.evaluate(el => getComputedStyle(el).paddingLeft)
    expect(shellPadding).toBe('20px')
  })

  test('horizontal padding is the full 40px/48px at desktop widths (>640px)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto('/regions/hp')

    const shell = page.locator('.region-shell')
    const shellPadding = await shell.evaluate(el => getComputedStyle(el).paddingLeft)
    expect(shellPadding).toBe('40px')
  })
})

test.describe('Homepage — .pr-shdr split-panel responsiveness (bug #22)', () => {
  test('stacks to a single column at mobile widths (≤640px)', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 })
    await page.goto('/')

    const panel = page.locator('.pr-shdr')
    await expect(panel).toBeVisible()
    const columns = await panel.evaluate(el => getComputedStyle(el).gridTemplateColumns)
    // A single-column grid reports one track, e.g. "343px" — not two.
    expect(columns.trim().split(/\s+/).length).toBe(1)
  })

  test('shrinks (but does not stack) at tablet widths (641-900px) — the softer ' +
       'gap this fix closed, vs. the harder 640px stack', async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 900 })
    await page.goto('/')

    const panel = page.locator('.pr-shdr')
    const height = await panel.evaluate(el => getComputedStyle(el).height)
    expect(height).toBe('380px')
  })

  test('keeps the full 54/46 split and 450px height at desktop widths (>900px)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto('/')

    const panel = page.locator('.pr-shdr')
    const height = await panel.evaluate(el => getComputedStyle(el).height)
    expect(height).toBe('450px')
    const columns = await panel.evaluate(el => getComputedStyle(el).gridTemplateColumns)
    expect(columns.trim().split(/\s+/).length).toBe(2)
  })
})
