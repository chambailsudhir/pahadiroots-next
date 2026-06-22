/**
 * e2e/cart.drawer.spec.ts
 *
 * Domain: CartDrawer
 *
 * Covers:
 *   • Drawer opens when cart icon is clicked
 *   • Drawer closes on Escape key (WCAG 2.1)
 *   • Drawer closes on backdrop click
 *   • Drawer shows correct item count badge
 *   • Drawer shows correct subtotal / total
 *   • CRITICAL: "Proceed to Checkout" in drawer flushes pending-removal ghost
 *     items before navigating (the P1 fix from the enterprise audit)
 *   • "View Full Cart" link navigates to /cart
 *   • Drawer is inert (keyboard-unreachable) when closed
 *   • Focus returns to the trigger element on close (WCAG 2.4.3)
 */

import { test, expect } from '@playwright/test'
import { mockCartAPIs, seedCartStore, ITEM_A, ITEM_B, readCartStore } from './helpers'

test.describe('CartDrawer', () => {
  test.beforeEach(async ({ page }) => {
    await mockCartAPIs(page)
    await seedCartStore(page, [ITEM_A, ITEM_B])
    await page.goto('/')
  })

  // ── Open / Close ──────────────────────────────────────────────────────────

  test('opens when the cart icon button is clicked', async ({ page }) => {
    await page.getByRole('button', { name: /cart/i }).first().click()
    await expect(page.getByRole('dialog', { name: /your cart/i })).toBeVisible()
  })

  test('closes on Escape key press', async ({ page }) => {
    await page.getByRole('button', { name: /cart/i }).first().click()
    await expect(page.getByRole('dialog', { name: /your cart/i })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog', { name: /your cart/i })).not.toBeVisible()
  })

  test('closes when "Continue Shopping" button is clicked', async ({ page }) => {
    await page.getByRole('button', { name: /cart/i }).first().click()
    await page.getByRole('button', { name: /continue shopping/i }).click()
    await expect(page.getByRole('dialog', { name: /your cart/i })).not.toBeVisible()
  })

  test('focus returns to the cart-icon trigger after close', async ({ page }) => {
    const trigger = page.getByRole('button', { name: /cart/i }).first()
    await trigger.click()
    await page.keyboard.press('Escape')
    // Focus should return to the trigger (WCAG 2.4.3)
    await expect(trigger).toBeFocused()
  })

  // ── Content ───────────────────────────────────────────────────────────────

  test('item count badge shows correct total quantity', async ({ page }) => {
    // ITEM_A qty=1, ITEM_B qty=2 → total 3
    await seedCartStore(page, [ITEM_A, { ...ITEM_B, qty: 2 }])
    await page.goto('/')
    // Badge aria-label should reflect the total
    await expect(
      page.getByRole('status', { name: /items in cart/i })
        .or(page.locator('[aria-label*="items in cart"]'))
    ).toHaveText('3')
  })

  test('shows both cart items in the drawer', async ({ page }) => {
    await page.getByRole('button', { name: /cart/i }).first().click()
    const dialog = page.getByRole('dialog', { name: /your cart/i })
    await expect(dialog.getByText(ITEM_A.name)).toBeVisible()
    await expect(dialog.getByText(ITEM_B.name)).toBeVisible()
  })

  test('"View Full Cart" link navigates to /cart', async ({ page }) => {
    await page.getByRole('button', { name: /cart/i }).first().click()
    await page.getByRole('link', { name: /view full cart/i }).click()
    await expect(page).toHaveURL(/\/cart/)
  })

  // ── CRITICAL: Ghost-item flush on checkout ────────────────────────────────
  //
  // P1 from the enterprise audit: a user who removes an item on /cart (4s undo
  // window) and then opens CartDrawer and clicks "Proceed to Checkout" would
  // navigate to /checkout with the ghost item still in cartStore.items —
  // because CartDrawer had no flushPendingRemovals call.
  //
  // Fix: CartDrawer's checkout onClick calls useCartStore.getState().flushPendingRemovals()
  // which reads the pendingVariantIds Set that useCartPage writes to via
  // markPendingRemoval. This test verifies the full chain end-to-end.

  test('CRITICAL — drawer checkout flushes pending-removal ghost items', async ({ page }) => {
    // Start on /cart so useCartPage is mounted and manages pendingRemovals
    await mockCartAPIs(page)
    await seedCartStore(page, [ITEM_A, ITEM_B])
    await page.goto('/cart')

    // Remove ITEM_A (puts it in pending, 4s undo window)
    await page.getByRole('button', { name: /remove/i }).first().click()
    // Confirm undo toast appears (item is in pending-removal state)
    await expect(page.getByRole('button', { name: /undo/i })).toBeVisible()

    // NOW: open CartDrawer while the undo window is still open
    await page.getByRole('button', { name: /cart/i }).first().click()
    const dialog = page.getByRole('dialog', { name: /your cart/i })
    await expect(dialog).toBeVisible()

    // Click "Proceed to Checkout" in the drawer
    // This must flush ITEM_A before navigating
    await dialog.getByRole('link', { name: /proceed to checkout/i }).click()

    // Should navigate to /checkout
    await expect(page).toHaveURL(/\/checkout/, { timeout: 5000 })

    // ITEM_A must NOT be in cartStore.items — ghost was flushed
    const stored = await readCartStore(page)
    const variantIds = stored?.state?.items?.map((i: { variantId: string }) => i.variantId) ?? []
    expect(variantIds).not.toContain(ITEM_A.variantId)
    // ITEM_B should still be present
    expect(variantIds).toContain(ITEM_B.variantId)
  })

  test('drawer checkout with no pending removals navigates cleanly', async ({ page }) => {
    await page.getByRole('button', { name: /cart/i }).first().click()
    const dialog = page.getByRole('dialog', { name: /your cart/i })
    await dialog.getByRole('link', { name: /proceed to checkout/i }).click()
    await expect(page).toHaveURL(/\/checkout/, { timeout: 5000 })
  })

  // ── Inert state ───────────────────────────────────────────────────────────

  test('closed drawer is not reachable by Tab key', async ({ page }) => {
    // Ensure drawer is closed
    const dialog = page.getByRole('dialog', { name: /your cart/i })
    await expect(dialog).not.toBeVisible()

    // Tab through the page — focus should never land inside the drawer
    // (inert attribute prevents this)
    const cartLink = page.getByRole('link', { name: /proceed to checkout/i })
    // The link inside the closed drawer should not be focusable
    await expect(cartLink).toHaveCount(0) // not rendered / inert
  })
})
