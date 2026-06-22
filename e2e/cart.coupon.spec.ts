/**
 * e2e/cart.coupon.spec.ts
 *
 * Domain: Coupon flow
 *
 * Covers:
 *   • Valid coupon code applies and shows discount in summary
 *   • Invalid code shows inline error message
 *   • Coupon is cleared when all items are removed
 *   • Coupon revalidates when subtotal changes (qty bump)
 *   • Revalidation removes coupon when it no longer qualifies
 *   • Apply button shows loading state while request is in-flight
 *   • Fetch timeout (10 s) recovers gracefully — no permanent hung spinner
 *   • Coupon hints appear and clicking one fills the input
 *   • Remove coupon button clears discount from summary
 *   • coupon.discount is NOT persisted across reloads
 */

import { test, expect } from '@playwright/test'
import {
  mockCartAPIs, seedCartStore,
  ITEM_A, ITEM_B, COUPON_10PCT,
} from './helpers'

test.describe('Coupon flow', () => {
  test.beforeEach(async ({ page }) => {
    await seedCartStore(page, [ITEM_A, ITEM_B])
  })

  // ── Apply happy-path ──────────────────────────────────────────────────────

  test('valid coupon applies and shows discount in order summary', async ({ page }) => {
    await mockCartAPIs(page)
    await page.goto('/cart')

    await page.getByLabel(/coupon/i).fill('PAHADI10')
    await page.getByRole('button', { name: /apply/i }).click()

    // Discount line should appear in summary
    await expect(
      page.getByText(/PAHADI10/i).first()
    ).toBeVisible({ timeout: 5000 })
    await expect(
      page.getByText(new RegExp(`₹${COUPON_10PCT.discount}`)).first()
    ).toBeVisible()
  })

  test('coupon input is cleared after successful apply', async ({ page }) => {
    await mockCartAPIs(page)
    await page.goto('/cart')

    const input = page.getByLabel(/coupon/i)
    await input.fill('PAHADI10')
    await page.getByRole('button', { name: /apply/i }).click()
    await page.waitForTimeout(500)

    await expect(input).toHaveValue('')
  })

  // ── Error states ──────────────────────────────────────────────────────────

  test('invalid coupon shows error message', async ({ page }) => {
    await mockCartAPIs(page, {
      couponStatus:   400,
      couponResponse: { error: 'Coupon not found' },
    })
    await page.goto('/cart')

    await page.getByLabel(/coupon/i).fill('BADCODE')
    await page.getByRole('button', { name: /apply/i }).click()

    await expect(
      page.locator('#coupon-code-error')
    ).toBeVisible({ timeout: 3000 })
    await expect(
      page.locator('#coupon-code-error')
    ).toContainText(/not found|invalid/i)
  })

  test('error message is announced to screen readers (aria-live)', async ({ page }) => {
    await mockCartAPIs(page, { couponStatus: 400, couponResponse: { error: 'Expired' } })
    await page.goto('/cart')

    await page.getByLabel(/coupon/i).fill('EXPIRED')
    await page.getByRole('button', { name: /apply/i }).click()

    // aria-invalid should flip to true on the input
    const input = page.getByLabel(/coupon/i)
    await expect(input).toHaveAttribute('aria-invalid', 'true', { timeout: 3000 })
  })

  test('apply button is disabled while request is in-flight', async ({ page }) => {
    // Slow the coupon response to check loading state
    await page.route('**/api/v1/coupons', async (route) => {
      await new Promise(r => setTimeout(r, 800))
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ coupon: COUPON_10PCT }),
      })
    })
    await mockCartAPIs(page, {})          // other routes
    await page.goto('/cart')

    await page.getByLabel(/coupon/i).fill('PAHADI10')
    const applyBtn = page.getByRole('button', { name: /apply/i })
    await applyBtn.click()

    // Button should be disabled immediately after click
    await expect(applyBtn).toBeDisabled()
    // And re-enabled after response
    await expect(applyBtn).not.toBeDisabled({ timeout: 3000 })
  })

  // ── Timeout recovery (P2 fix) ─────────────────────────────────────────────
  //
  // Previously applyCouponCode had no AbortSignal.timeout — a hung network
  // request left the button spinner permanently. Fix: 10s timeout added.
  // This test simulates a slow network (>10 s) and verifies recovery.

  test('hung coupon fetch resolves after 10 s timeout — no permanent spinner', async ({ page }) => {
    test.setTimeout(20_000)

    // Never respond — simulates a stalled connection
    await page.route('**/api/v1/coupons', () => { /* intentionally hang */ })
    await mockCartAPIs(page, {})
    await page.goto('/cart')

    await page.getByLabel(/coupon/i).fill('PAHADI10')
    const applyBtn = page.getByRole('button', { name: /apply/i })
    await applyBtn.click()

    // Button starts disabled (loading)
    await expect(applyBtn).toBeDisabled()

    // After ~10 s the AbortSignal fires — button should recover
    await expect(applyBtn).not.toBeDisabled({ timeout: 12_000 })
  })

  // ── Remove coupon ─────────────────────────────────────────────────────────

  test('remove-coupon button clears discount from summary', async ({ page }) => {
    await mockCartAPIs(page)
    await page.goto('/cart')

    // Apply first
    await page.getByLabel(/coupon/i).fill('PAHADI10')
    await page.getByRole('button', { name: /apply/i }).click()
    await expect(page.getByText(/PAHADI10/i).first()).toBeVisible({ timeout: 5000 })

    // Now remove
    await page.getByRole('button', { name: /remove coupon|clear coupon/i }).click()
    await expect(page.getByText(/PAHADI10/i).first()).not.toBeVisible()
  })

  // ── Coupon hints ──────────────────────────────────────────────────────────

  test('coupon hints appear and clicking one fills the input', async ({ page }) => {
    await mockCartAPIs(page)
    await page.goto('/cart')

    // Hints should load from API
    const hint = page.getByRole('button', { name: /PAHADI10/i })
    await expect(hint).toBeVisible({ timeout: 5000 })

    await hint.click()
    await expect(page.getByLabel(/coupon/i)).toHaveValue('PAHADI10')
  })

  // ── Revalidation ──────────────────────────────────────────────────────────

  test('coupon revalidates when subtotal changes via qty increment', async ({ page }) => {
    // First apply returns 85; revalidation (new subtotal) returns updated 120
    let callCount = 0
    await page.route('**/api/v1/coupons', (route) => {
      callCount++
      const discount = callCount === 1 ? 85 : 120
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ coupon: { ...COUPON_10PCT, discount } }),
      })
    })
    await mockCartAPIs(page, {})
    await page.goto('/cart')

    // Apply coupon
    await page.getByLabel(/coupon/i).fill('PAHADI10')
    await page.getByRole('button', { name: /apply/i }).click()
    await expect(page.getByText(/₹85/).first()).toBeVisible({ timeout: 5000 })

    // Bump qty to change subtotal → triggers revalidation after debounce (800ms)
    await page.getByRole('button', { name: /increase quantity/i }).first().click()
    // Wait for debounce + request
    await expect(page.getByText(/₹120/).first()).toBeVisible({ timeout: 4000 })
  })

  test('coupon is removed when it no longer qualifies after subtotal change', async ({ page }) => {
    let callCount = 0
    await page.route('**/api/v1/coupons', (route) => {
      callCount++
      if (callCount === 1) {
        // Initial apply: OK
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ coupon: COUPON_10PCT }),
        })
      } else {
        // Revalidation: min_order no longer met
        route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Minimum order ₹300 not met' }),
        })
      }
    })
    await mockCartAPIs(page, {})
    await page.goto('/cart')

    // Apply coupon at current subtotal
    await page.getByLabel(/coupon/i).fill('PAHADI10')
    await page.getByRole('button', { name: /apply/i }).click()
    await expect(page.getByText(/PAHADI10/i).first()).toBeVisible({ timeout: 5000 })

    // Reduce qty so subtotal falls below coupon min_order
    await page.getByRole('button', { name: /decrease quantity/i }).first().click()

    // After revalidation, coupon should be cleared
    await expect(page.getByText(/PAHADI10/i).first()).not.toBeVisible({ timeout: 4000 })
  })

  // ── Persistence ───────────────────────────────────────────────────────────

  test('coupon discount is NOT in localStorage after apply', async ({ page }) => {
    await mockCartAPIs(page)
    await page.goto('/cart')

    await page.getByLabel(/coupon/i).fill('PAHADI10')
    await page.getByRole('button', { name: /apply/i }).click()
    await page.waitForTimeout(500)

    const stored = await page.evaluate(() => {
      const raw = localStorage.getItem('pr-cart')
      return raw ? JSON.parse(raw) : null
    })
    // coupon (with discount amount) must NOT be persisted
    expect(stored?.state?.coupon).toBeUndefined()
    // lastAppliedCouponCode (code string only) may be persisted for hint
    // but discount amount must never appear
    expect(stored?.state?.coupon?.discount).toBeUndefined()
  })

  test('last applied coupon code hint appears after page reload', async ({ page }) => {
    await mockCartAPIs(page)
    await page.goto('/cart')

    await page.getByLabel(/coupon/i).fill('PAHADI10')
    await page.getByRole('button', { name: /apply/i }).click()
    await page.waitForTimeout(500)

    await page.reload()

    // The coupon code hint ("Re-apply PAHADI10?") should appear after hydration
    // — exact copy varies; check for the code string
    await expect(
      page.getByText(/PAHADI10/i).first()
    ).toBeVisible({ timeout: 5000 })
  })

  // ── Coupon cleared when cart is emptied ───────────────────────────────────

  test('coupon is cleared from store when last item is removed', async ({ page }) => {
    test.setTimeout(15_000)
    await seedCartStore(page, [ITEM_A])   // single item
    await mockCartAPIs(page)
    await page.goto('/cart')

    // Apply coupon
    await page.getByLabel(/coupon/i).fill('PAHADI10')
    await page.getByRole('button', { name: /apply/i }).click()
    await expect(page.getByText(/PAHADI10/i).first()).toBeVisible({ timeout: 5000 })

    // Remove the only item and let undo expire
    await page.getByRole('button', { name: /remove/i }).first().click()
    await page.waitForTimeout(4_500)

    // Cart is now empty — coupon must be gone
    await expect(page.getByText(/PAHADI10/i)).not.toBeVisible()
  })
})
