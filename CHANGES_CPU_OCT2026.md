# Fluid Active CPU reduction — Oct 2026

Trigger: Vercel warning "75% of free-tier Fluid Active CPU (4 h)". Usage page:
pahadiroots-next = 92.7% of CPU; middleware = 42.3%, functions = 57.7%.

## Storefront (pahadiroots-next)
| # | File | Change | Why |
|---|------|--------|-----|
| 1 | src/proxy.ts | `config.matcher` narrowed: pages only (minus /api, /auth, /_next, /maintenance, static-asset extensions, router prefetch) + mutating /api/v1 routes only (GET-only / self-limited routes and analytics/track excluded) | Old matcher invoked the proxy for every /public asset, prefetch, beacon and GET API call |
| 2 | src/app/page.tsx | `force-dynamic` → `revalidate = 300` (ISR); uses `getSiteSettings({ strict: true })` | Every hit (bots included) ran a full SSR. Failed fetches now throw, so Next keeps the last good HTML instead of caching a degraded page |
| 3 | src/lib/getSiteSettings.ts | `getSiteSettings({ strict })` option (default behaviour unchanged) | Needed by #2 |
| 4 | src/components/ProfilePrefetcher.tsx | No `/api/auth/session` call unless a user is persisted in the client store AND the profile cache is stale | Was one function invocation per page load per visitor |
| 5 | src/lib/analytics/track.ts | No beacon for `navigator.webdriver` / bot user-agents | JS-executing crawlers triggered proxy + function per page |
| 6 | Header, CartDrawer, CartSummary, CartUIComponents, SearchOverlay, account/order-success links | `prefetch={false}` on links to dynamic/client routes (/checkout, /cart, /account, /wishlist, /track, /payment, /search) | Sitewide header links prefetched on every page |
| 7 | src/__tests__/proxyMatcher.test.ts, cpuReduction.test.tsx | New regression tests | |

## Admin (pahadi-admin)
- src/middleware.js: HMAC CryptoKey cached per instance (was re-imported every /admin request). Auth behaviour unchanged.
- src/__tests__/middlewareTokenVerify.test.js: covers the real verify path (valid / forged / expired / rotated secret).

## Not changed (deliberately)
- ISR windows of 60 s on /products, /collections/[slug], /new-arrivals, /regions (price/stock freshness).
- Admin middleware matcher (it is the auth guard; prefetch is not skipped there).

## Verify after deploy
Vercel → Usage → Fluid Active CPU → "Type" tab: middleware share should collapse; daily bars should drop well below the current 3–5 min/day.

## Follow-up: stability when Supabase stalls (Oct 15, 2026)
Functions moved to bom1 (vercel.json `regions`). The free-tier Supabase compute still stalls for 5–12 s even
under tiny load, which made the cart read-endpoints time out (4 s) and return 500.

- `src/lib/api/lastGood.ts` (new): bounded, per-instance "last good value" store.
- `cart-settings`, `coupon-hints`, `cart-upsells`: on failure, serve the last good value (200, `X-Data-Stale: 1`,
  logged as a `*_served_stale` warning) instead of 500. Max age: 15 min / 60 min / 30 min. When a last-good copy
  exists the DB timeout drops from 4 s to 2 s so customers don't wait for a stalled DB. A cold instance with nothing
  remembered still returns 500 exactly as before, so uptime monitors still see real outages.
- Display data only: `/api/v1/orders`, `/payments` and the Razorpay webhook re-read settings fresh and recompute totals.
- Tests: `src/__tests__/lastGoodFallback.test.ts`.
