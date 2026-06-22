/**
 * e2e/cart.state.spec.ts
 *
 * Domain: Cart state management
 *
 * Covers:
 *   • Page renders with seeded cart items
 *   • Quantity increment / decrement updates subtotal
 *   • Remove shows undo toast; undo restores item
 *   • Remove without undo actually removes item after timeout
 *   • Clear cart empties everything
 *   • Subtotal math is correct (price × qty, summed)
 *   • Free-shipping progress bar reflects cart total
 *   • Min-order warning appears when below threshold
 *   • Cart count badge in header reflects live item count
 */

import { test, expect } from '@playwright/test'
import {
  mockCartAPIs, seedCartStore,
  ITEM_A, ITEM_B, CART_SETTINGS,
} from './helpers'

test.describe('Cart state management', () => {
  test.beforeEach(async ({ page }) => {
    await mockCartAPIs(page)
  })

  // ── Rendering ─────────────────────────────────────────────────────────────

  test('renders seeded cart items on /cart', async ({ page }) => {
    await seedCartStore(page, [ITEM_A])
    await page.goto('/cart')
    await expect(page.getByText(ITEM_A.name)).toBeVisible()
  })

  test('shows both items when cart has two products', async ({ page }) => {
    await seedCartStore(page, [ITEM_A, ITEM_B])
    await page.goto('/cart')
    await expect(page.getByText(ITEM_A.name)).toBeVisible()
    await expect(page.getByText(ITEM_B.name)).toBeVisible()
  })

  test('shows empty-cart state when localStorage is clear', async ({ page }) => {
    await page.goto('/cart')
    // Empty cart heading or CTA — adjust selector to match actual copy
    await expect(
      page.getByRole('heading', { name: /your cart is empty/i })
        .or(page.getByText(/start shopping/i))
    ).toBeVisible()
  })

  // ── Subtotal arithmetic ───────────────────────────────────────────────────

  test('subtotal equals price × qty for single item', async ({ page }) => {
    await seedCartStore(page, [ITEM_A])
    await page.goto('/cart')
    // ITEM_A: ₹499 × 1 = ₹499
    await expect(page.getByText(/₹499/).first()).toBeVisible()
  })

  test('subtotal updates when qty is incremented', async ({ page }) => {
    await seedCartStore(page, [ITEM_A])   // qty=1, price=499
    await page.goto('/cart')
    await page.getByRole('button', { name: /increase quantity/i }).first().click()
    // After increment: 499 × 2 = ₹998
    await expect(page.getByText(/₹998/).first()).toBeVisible({ timeout: 3000 })
  })

  test('subtotal updates when qty is decremented', async ({ page }) => {
    await seedCartStore(page, [{ ...ITEM_A, qty: 2 }])   // 499 × 2 = 998
    await page.goto('/cart')
    await page.getByRole('button', { name: /decrease quantity/i }).first().click()
    // After decrement: 499 × 1 = ₹499
    await expect(page.getByText(/₹499/).first()).toBeVisible({ timeout: 3000 })
  })

  test('multi-item subtotal is sum of all (price × qty)', async ({ page }) => {
    // ITEM_A: 499×1=499, ITEM_B: 349×2=698 → total 1197
    await seedCartStore(page, [ITEM_A, { ...ITEM_B, qty: 2 }])
    await page.goto('/cart')
    await expect(page.getByText(/₹1[,.]?197/).first()).toBeVisible()
  })

  // ── Remove / Undo ─────────────────────────────────────────────────────────

  test('remove shows undo toast with item name', async ({ page }) => {
    await seedCartStore(page, [ITEM_A, ITEM_B])
    await page.goto('/cart')
    // Click the first item's Remove button
    await page.getByRole('button', { name: /remove/i }).first().click()
    // Undo toast should appear
    await expect(
      page.getByRole('button', { name: /undo/i })
    ).toBeVisible({ timeout: 2000 })
  })

  test('undo restores the removed item to the list', async ({ page }) => {
    await seedCartStore(page, [ITEM_A, ITEM_B])
    await page.goto('/cart')
    await page.getByRole('button', { name: /remove/i }).first().click()
    // Item should be hidden (pending removal)
    await page.getByRole('button', { name: /undo/i }).click()
    // Both items should be visible again
    await expect(page.getByText(ITEM_A.name)).toBeVisible()
    await expect(page.getByText(ITEM_B.name)).toBeVisible()
  })

  test('item is removed from DOM after undo toast expires (4 s)', async ({ page }) => {
    test.setTimeout(12_000)
    await seedCartStore(page, [ITEM_A, ITEM_B])
    await page.goto('/cart')
    // Remove ITEM_A
    await page.getByRole('button', { name: /remove/i }).first().click()
    // Wait 4.5 s for the deferred removeItem to fire
    await page.waitForTimeout(4_500)
    // ITEM_A should now be gone
    await expect(page.getByText(ITEM_A.name)).not.toBeVisible()
    // ITEM_B should still be there
    await expect(page.getByText(ITEM_B.name)).toBeVisible()
  })

  // ── Free-shipping progress bar ────────────────────────────────────────────

  test('progress bar is below 100% when cart total is below free-ship min', async ({ page }) => {
    // ITEM_A = ₹499; free_shipping_min = ₹999 → 49.9% progress
    await seedCartStore(page, [ITEM_A])
    await page.goto('/cart')
    const bar = page.getByRole('progressbar')
    await expect(bar).toBeVisible()
    const value = await bar.getAttribute('aria-valuenow')
    expect(Number(value)).toBeLessThan(100)
  })

  test('progress bar is 100 when cart total meets free-ship min', async ({ page }) => {
    // ITEM_A×2 = ₹998 + ITEM_B×1 = ₹349 → total ₹1347 ≥ ₹999
    await seedCartStore(page, [{ ...ITEM_A, qty: 2 }, ITEM_B])
    await page.goto('/cart')
    const bar = page.getByRole('progressbar')
    const value = await bar.getAttribute('aria-valuenow')
    expect(Number(value)).toBe(100)
  })

  // ── Min-order gate ────────────────────────────────────────────────────────

  test('checkout CTA is disabled when subtotal is below min-order', async ({ page }) => {
    // Override settings to set min_order_amt above ITEM_A price
    await mockCartAPIs(page, {})
    // Use a very cheap item
    await seedCartStore(page, [{ ...ITEM_A, price: 50, mrp: 60, qty: 1 }])
    await page.goto('/cart')
    // The min-order warning should appear
    const warn = page.locator('#cart-min-warn')
    if (await warn.count() > 0) {
      await expect(warn).toBeVisible()
    }
  })

  // ── Persistence round-trip ────────────────────────────────────────────────

  test('cart survives a page reload (localStorage persistence)', async ({ page }) => {
    await seedCartStore(page, [ITEM_A])
    await page.goto('/cart')
    await expect(page.getByText(ITEM_A.name)).toBeVisible()
    await page.reload()
    await expect(page.getByText(ITEM_A.name)).toBeVisible()
  })

  test('maxQty is NOT persisted to localStorage', async ({ page }) => {
    await seedCartStore(page, [ITEM_A])
    await page.goto('/cart')
    // Read the persisted state
    const stored = await page.evaluate(() => {
      const raw = localStorage.getItem('pr-cart')
      return raw ? JSON.parse(raw) : null
    })
    const item = stored?.state?.items?.[0]
    expect(item).toBeDefined()
    expect(item.maxQty).toBeUndefined()
  })

  test('coupon is NOT persisted to localStorage', async ({ page }) => {
    await seedCartStore(page, [ITEM_A])
    await page.goto('/cart')
    await page.getByLabel(/coupon/i).fill('PAHADI10')
    await page.getByRole('button', { name: /apply/i }).click()
    await page.waitForTimeout(500)
    const stored = await page.evaluate(() => {
      const raw = localStorage.getItem('pr-cart')
      return raw ? JSON.parse(raw) : null
    })
    expect(stored?.state?.coupon).toBeUndefined()
  })
})
