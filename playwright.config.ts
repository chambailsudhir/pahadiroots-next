import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright E2E configuration — pahadiroots-next
 *
 * Coverage domains:
 *   1. Cart state management (add, remove, undo, qty, clear)
 *   2. CartDrawer  (open/close, ghost-item flush on checkout)
 *   3. Coupon flow (apply, error, revalidation on subtotal change)
 *   4. Upsell flow (fetch, add, dedup)
 *   5. Checkout navigation guards (min-order gate, empty-cart redirect)
 *   6. Accessibility smoke (visible focus rings, ARIA landmarks)
 *   7. Persistence (localStorage round-trip, hydration, migration)
 *
 * Network: all Supabase + Razorpay + Resend calls are intercepted via
 * route() mocks so tests run fully offline and deterministically.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['html', { outputFolder: 'playwright-report' }], ['list']],

  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000',
    trace:   'on-first-retry',
    // Intercept all external API calls — tests must not hit live Supabase/Razorpay.
    // Individual tests add route() handlers; this header catches anything missed.
    extraHTTPHeaders: { 'x-playwright': '1' },
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-safari', use: { ...devices['iPhone 13'] } },
  ],

  // Start Next.js dev server automatically if not already running.
  // In CI, PLAYWRIGHT_BASE_URL points to the preview deployment.
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: 'npm run dev',
        url:     'http://localhost:3000',
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
})
