/**
 * e2e/helpers.ts — shared utilities for the cart E2E suite.
 *
 * Provides:
 *   • mockCartAPIs()  — intercepts all Supabase / cart API calls with stable
 *                       deterministic JSON so tests run fully offline.
 *   • seedCartStore() — writes a pre-populated cart directly to localStorage
 *                       so tests don't have to navigate through product pages.
 *   • clearCartStore() — wipes localStorage between tests.
 *   • FIXTURES        — typed test data shared across all spec files.
 */

import type { Page, Route } from '@playwright/test'

// ── Fixtures ─────────────────────────────────────────────────────────────────

export const PRODUCT_SLUG = 'test-himalayan-ghee'
export const PRODUCT_URL  = `/products/${PRODUCT_SLUG}`

export const ITEM_A = {
  productId: 'prod-a',
  variantId: 'var-a',
  name:      'Himalayan Ghee 250g',
  slug:      PRODUCT_SLUG,
  image:     null,
  emoji:     '🧈',
  size:      '250g',
  price:     499,
  mrp:       599,
  gstRate:   5,
  qty:       1,
  maxQty:    10,
  isOrganic:    true,
  isHimalayan:  true,
  isBestseller: false,
}

export const ITEM_B = {
  productId: 'prod-b',
  variantId: 'var-b',
  name:      'Wild Forest Honey 500g',
  slug:      'wild-forest-honey-500g',
  image:     null,
  emoji:     '🍯',
  size:      '500g',
  price:     349,
  mrp:       399,
  gstRate:   5,
  qty:       2,
  maxQty:    10,
  isOrganic:    true,
  isHimalayan:  false,
  isBestseller: true,
}

export const COUPON_10PCT = {
  code:          'PAHADI10',
  type:          'percent' as const,
  discount:      85,    // 10% of (499 + 698) = 119.7 → 120 rounded; use 85 for a round value
  minOrder:      300,
  description:   '10% off',
  expiresAt:     null,
}

export const CART_SETTINGS = {
  free_shipping_min:    999,
  min_order_amt:        200,
  cod_enabled:          true,
  razorpay_enabled:     true,
  cod_max:              5000,
  prepaid_discount_pct: 5,
}

export const UPSELL_ITEM = {
  id:          'var-c',
  productId:   'prod-c',
  name:        'Pahadi Turmeric 100g',
  slug:        'pahadi-turmeric-100g',
  image:       null,
  emoji:       '🌿',
  size:        '100g',
  price:       249,
  mrp:         299,
  gstRate:     5,
  maxQty:      10,
  isOrganic:    true,
  isHimalayan:  true,
  isBestseller: false,
  stockCount:   50,
}

// ── Cart store localStorage key & schema ─────────────────────────────────────

const STORE_KEY = 'pr-cart'

interface PersistedCart {
  state: {
    items:                 typeof ITEM_A[]
    idempotencyKey:        string
    lastAppliedCouponCode: string
  }
  version: number
}

export function buildPersistedCart(
  items: Partial<typeof ITEM_A>[] = [ITEM_A],
  extras: Partial<PersistedCart['state']> = {}
): string {
  const stripped = items.map(({ maxQty: _m, ...rest }) => rest)   // maxQty never persisted
  const state: PersistedCart = {
    state: {
      items: stripped as unknown as typeof ITEM_A[],
      idempotencyKey:        'idem-test-key',
      lastAppliedCouponCode: '',
      ...extras,
    },
    version: 3,
  }
  return JSON.stringify(state)
}

// ── Page helpers ──────────────────────────────────────────────────────────────

/**
 * Write a pre-seeded cart to localStorage before the page loads.
 * Call BEFORE page.goto() or via page.addInitScript().
 */
export async function seedCartStore(
  page: Page,
  items: Partial<typeof ITEM_A>[] = [ITEM_A],
  extras: Partial<PersistedCart['state']> = {}
) {
  const serialised = buildPersistedCart(items, extras)
  await page.addInitScript(
    ({ key, value }: { key: string; value: string }) => {
      localStorage.setItem(key, value)
    },
    { key: STORE_KEY, value: serialised }
  )
}

export async function clearCartStore(page: Page) {
  await page.evaluate((key) => localStorage.removeItem(key), STORE_KEY)
}

export async function readCartStore(page: Page): Promise<PersistedCart | null> {
  return page.evaluate((key) => {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : null
  }, STORE_KEY)
}

// ── API mocks ─────────────────────────────────────────────────────────────────

/**
 * Intercept all cart-domain API calls with deterministic fixtures.
 * Call at the start of each test (or in beforeEach).
 */
export async function mockCartAPIs(page: Page, overrides: {
  settingsStatus?: number
  couponResponse?: object
  couponStatus?:   number
  upsellItems?:    object[]
} = {}) {
  // Cart settings
  await page.route('**/api/v1/cart-settings', (route: Route) => {
    const status = overrides.settingsStatus ?? 200
    route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(status === 200 ? CART_SETTINGS : { error: 'unavailable' }),
    })
  })

  // Cart upsells
  await page.route('**/api/v1/cart-upsells**', (route: Route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items: overrides.upsellItems ?? [UPSELL_ITEM] }),
    })
  })

  // Coupon apply / revalidate
  await page.route('**/api/v1/coupons', (route: Route) => {
    const status = overrides.couponStatus ?? 200
    route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(
        status === 200
          ? (overrides.couponResponse ?? { coupon: COUPON_10PCT })
          : (overrides.couponResponse ?? { error: 'Coupon not found' })
      ),
    })
  })

  // Coupon hints
  await page.route('**/api/v1/coupon-hints', (route: Route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ hints: ['PAHADI10', 'SAVE50'] }),
    })
  })

  // Payments / orders — return success stub so checkout E2E doesn't hit Supabase
  await page.route('**/api/v1/payments', (route: Route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ orderId: 'order_test123', razorpayOrderId: 'rz_test123', amount: 49900 }),
    })
  })

  await page.route('**/api/v1/orders', (route: Route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ orderId: 'order_test123', status: 'pending' }),
    })
  })

  // Block any Supabase direct calls (should never happen in E2E)
  await page.route('**supabase.co/**', (route: Route) => {
    console.warn('[E2E] Unexpected direct Supabase call intercepted:', route.request().url())
    route.abort()
  })
}
