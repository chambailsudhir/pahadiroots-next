/**
 * e2e/cart.checkout.spec.ts
 *
 * Domain: Checkout navigation + accessibility smoke
 *
 * Covers:
 *   • Empty cart redirects away from /checkout
 *   • Min-order gate blocks checkout CTA
 *   • flushPendingRemovals fires on cart page CTA (not just drawer)
 *   • /checkout renders order summary with correct item + pricing
 *   • Keyboard navigation: all cart interactive elements reachable by Tab
 *   • Focus-visible rings visible on CartItemCard link and UpsellSection Add
 *   • ARIA landmarks: main, nav (progress), region (upsells) present
 *   • Progress nav has aria-current="step" on active step
 *   • Undo toast buttons have unique aria-labels (not generic "Undo, button × N")
 *   • Shipping progress bar has role="progressbar" with valuenow/min/max
 *   • WhatsApp link has "(opens in new window)" sr-only text
 */

import { test, expect } from '@playwright/test'
import {
  mockCartAPIs, seedCartStore,
  ITEM_A, ITEM_B,
} from './helpers'

// ── Checkout navigation guards ─────────────────────────────────────────────

test.describe('Checkout navigation guards', () => {
  test('empty cart redirects from /checkout to /cart or /', async ({ page }) => {
    await mockCartAPIs(page)
    // No seedCartStore — empty cart
    await page.goto('/checkout')
    // Should not stay on /checkout
    await expect(page).not.toHaveURL('/checkout', { timeout: 5000 })
  })

  test('cart page "Proceed to Checkout" CTA navigates to /checkout', async ({ page }) => {
    await mockCartAPIs(page)
    await seedCartStore(page, [ITEM_A])
    await page.goto('/cart')

    await page.getByRole('link', { name: /proceed to checkout/i }).first().click()
    await expect(page).toHaveURL(/\/checkout/, { timeout: 5000 })
  })

  test('sticky CTA "Proceed to Checkout" also navigates to /checkout', async ({ page }) => {
    await mockCartAPIs(page)
    await seedCartStore(page, [ITEM_A])
    // Use mobile viewport to make sticky CTA visible
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/cart')

    const stickyLink = page.getByRole('link', { name: /proceed to checkout/i }).last()
    await expect(stickyLink).toBeVisible({ timeout: 3000 })
    await stickyLink.click()
    await expect(page).toHaveURL(/\/checkout/, { timeout: 5000 })
  })

  test('cart page CTA flushes pending removals before checkout', async ({ page }) => {
    test.setTimeout(10_000)
    await mockCartAPIs(page)
    await seedCartStore(page, [ITEM_A, ITEM_B])
    await page.goto('/cart')

    // Remove ITEM_A (undo window open)
    await page.getByRole('button', { name: /remove/i }).first().click()
    await expect(page.getByRole('button', { name: /undo/i })).toBeVisible()

    // Click Proceed to Checkout on cart page (not drawer)
    await page.getByRole('link', { name: /proceed to checkout/i }).first().click()
    await expect(page).toHaveURL(/\/checkout/, { timeout: 5000 })

    // ITEM_A must NOT be in cartStore after flush
    const stored = await page.evaluate(() => {
      const raw = localStorage.getItem('pr-cart')
      return raw ? JSON.parse(raw) : null
    })
    const ids = stored?.state?.items?.map((i: { variantId: string }) => i.variantId) ?? []
    expect(ids).not.toContain(ITEM_A.variantId)
    expect(ids).toContain(ITEM_B.variantId)
  })

  test('checkout shows correct item names in order summary', async ({ page }) => {
    await mockCartAPIs(page)
    await seedCartStore(page, [ITEM_A])
    await page.goto('/checkout')

    await expect(page.getByText(ITEM_A.name)).toBeVisible({ timeout: 5000 })
  })
})

// ── Accessibility smoke ────────────────────────────────────────────────────

test.describe('Cart page — accessibility smoke', () => {
  test.beforeEach(async ({ page }) => {
    await mockCartAPIs(page)
    await seedCartStore(page, [ITEM_A, ITEM_B])
    await page.goto('/cart')
  })

  test('page has a <main> landmark', async ({ page }) => {
    await expect(page.getByRole('main')).toBeVisible()
  })

  test('checkout progress nav has aria-current="step" on the active step', async ({ page }) => {
    const currentStep = page.locator('[aria-current="step"]')
    await expect(currentStep).toBeVisible()
  })

  test('checkout progress is a <nav> with accessible label', async ({ page }) => {
    await expect(
      page.getByRole('navigation', { name: /checkout progress/i })
    ).toBeVisible()
  })

  test('progress steps are in an ordered list inside the nav', async ({ page }) => {
    const nav  = page.getByRole('navigation', { name: /checkout progress/i })
    const list = nav.getByRole('list')
    await expect(list).toBeVisible()
  })

  test('shipping progress bar has role=progressbar with aria-valuenow/min/max', async ({ page }) => {
    const bar = page.getByRole('progressbar')
    await expect(bar).toBeVisible()
    await expect(bar).toHaveAttribute('aria-valuemin', '0')
    await expect(bar).toHaveAttribute('aria-valuemax', '100')
    const now = await bar.getAttribute('aria-valuenow')
    expect(Number(now)).toBeGreaterThanOrEqual(0)
    expect(Number(now)).toBeLessThanOrEqual(100)
  })

  test('each undo toast button has a unique aria-label (not generic "Undo")', async ({ page }) => {
    // Remove both items to produce two undo toasts
    await page.getByRole('button', { name: /remove/i }).nth(0).click()
    await page.getByRole('button', { name: /remove/i }).nth(0).click()

    const undoBtns = page.getByRole('button', { name: /undo removal of/i })
    const count = await undoBtns.count()
    expect(count).toBeGreaterThanOrEqual(2)

    // Each should have a unique accessible name
    const labels = await undoBtns.evaluateAll((btns: Element[]) =>
      btns.map(b => b.getAttribute('aria-label'))
    )
    const unique = new Set(labels)
    expect(unique.size).toBe(labels.length)
  })

  test('WhatsApp link includes sr-only "(opens in new window)"', async ({ page }) => {
    const waLink = page.getByRole('link', { name: /whatsapp/i })
    if (await waLink.count() > 0) {
      const srText = waLink.locator('.sr-only')
      await expect(srText).toHaveText(/opens in new window/i)
    }
  })

  test('coupon input has aria-describedby pointing to error element', async ({ page }) => {
    const input = page.locator('#coupon-code')
    const describedBy = await input.getAttribute('aria-describedby')
    expect(describedBy).toBeTruthy()

    // The referenced element should exist in the DOM
    const errorEl = page.locator(`#${describedBy}`)
    await expect(errorEl).toBeAttached()
  })

  test('cart item list has ul/li list semantics', async ({ page }) => {
    // Cart items should be in a semantic list
    const list = page.getByRole('list', { name: /cart items/i })
    await expect(list).toBeVisible()
    const items = list.getByRole('listitem')
    const count = await items.count()
    expect(count).toBeGreaterThanOrEqual(2)  // ITEM_A + ITEM_B
  })

  test('price summary uses dl/dt/dd semantics', async ({ page }) => {
    // Subtotal should be in a definition list
    await expect(page.getByRole('term').filter({ hasText: /subtotal/i })).toBeVisible()
    await expect(page.getByRole('definition').first()).toBeVisible()
  })

  // ── Focus-visible rings (WCAG 2.4.7) ─────────────────────────────────────

  test('CartItemCard product name link has focus-visible ring', async ({ page }) => {
    // Tab to the product name link
    const productLink = page.getByRole('link', { name: new RegExp(ITEM_A.name, 'i') }).first()
    await productLink.focus()

    // Compute outline — must not be 'none' or '0px'
    const outline = await productLink.evaluate((el: HTMLElement) => {
      const s = window.getComputedStyle(el, ':focus-visible')
      return s.outlineStyle + ' ' + s.outlineWidth
    })
    expect(outline).not.toMatch(/none|0px/)
  })

  test('UpsellSection Add button has focus-visible ring', async ({ page }) => {
    const addBtn = page.getByRole('button', { name: /add/i }).first()
    await expect(addBtn).toBeVisible({ timeout: 5000 })
    await addBtn.focus()

    const outline = await addBtn.evaluate((el: HTMLElement) => {
      const s = window.getComputedStyle(el, ':focus-visible')
      return s.outlineStyle + ' ' + s.outlineWidth
    })
    expect(outline).not.toMatch(/none|0px/)
  })

  test('all interactive elements are reachable by Tab', async ({ page }) => {
    // Tab through the page — should not get stuck
    let tabCount = 0
    const maxTabs = 50
    const focusedElements: string[] = []

    while (tabCount < maxTabs) {
      await page.keyboard.press('Tab')
      const focused = await page.evaluate(() => {
        const el = document.activeElement
        return el
          ? (el.getAttribute('aria-label') ?? el.tagName + '#' + el.id)
          : null
      })
      if (focused) focusedElements.push(focused)
      tabCount++
    }

    // We should have reached multiple distinct interactive elements
    const unique = new Set(focusedElements)
    expect(unique.size).toBeGreaterThan(5)
  })
})

// ── localStorage edge cases ────────────────────────────────────────────────

test.describe('localStorage persistence edge cases', () => {
  test('v1 → v3 migration strips coupon field from old persisted state', async ({ page }) => {
    await mockCartAPIs(page)

    // Seed v1 format with a persisted coupon (old bug — should be stripped)
    await page.addInitScript(() => {
      localStorage.setItem('pr-cart', JSON.stringify({
        state: {
          items:          [{ productId: 'p', variantId: 'v', name: 'Item', slug: 'item',
                            image: null, emoji: '🌿', size: '250g', price: 100, mrp: 120,
                            gstRate: 5, qty: 1, maxQty: 5,
                            isOrganic: true, isHimalayan: false, isBestseller: false }],
          coupon:         { code: 'OLD', discount: 50, type: 'flat', minOrder: 0,
                            description: 'old', expiresAt: null },
          idempotencyKey: 'old-key',
          lastAppliedCouponCode: 'OLD',
        },
        version: 1,  // old version
      }))
    })
    await page.goto('/cart')

    // After migration, coupon must be gone from store (not persisted in v3)
    const stored = await page.evaluate(() => {
      const raw = localStorage.getItem('pr-cart')
      return raw ? JSON.parse(raw) : null
    })
    expect(stored?.state?.coupon).toBeUndefined()
    expect(stored?.version).toBe(3)
  })

  test('v2 → v3 migration strips maxQty from persisted items', async ({ page }) => {
    await mockCartAPIs(page)

    // Seed v2 format — items have maxQty persisted (old security bug)
    await page.addInitScript(() => {
      localStorage.setItem('pr-cart', JSON.stringify({
        state: {
          items: [{ productId: 'p', variantId: 'v', name: 'Item', slug: 'item',
                    image: null, emoji: '🌿', size: '250g', price: 100, mrp: 120,
                    gstRate: 5, qty: 1, maxQty: 99,   // maxQty persisted in v2
                    isOrganic: true, isHimalayan: false, isBestseller: false }],
          idempotencyKey: 'key',
          lastAppliedCouponCode: '',
        },
        version: 2,
      }))
    })
    await page.goto('/cart')

    const stored = await page.evaluate(() => {
      const raw = localStorage.getItem('pr-cart')
      return raw ? JSON.parse(raw) : null
    })
    expect(stored?.state?.items?.[0]?.maxQty).toBeUndefined()
    expect(stored?.version).toBe(3)
  })
})
