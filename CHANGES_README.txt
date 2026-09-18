PAHADI ROOTS — MOBILE UI FIXES (from screenshots, Sept 18 2026)
==================================================================

ISSUE 1 — Quick View / wishlist heart overlapping on product cards (mobile)
-----------------------------------------------------------------
Root cause: the earlier a11y/touch fix that made the Quick View pill and
wishlist heart always-visible on touch devices (previously they only
appeared one at a time, on desktop hover) introduced a collision that
never existed before: on a narrow 2-column mobile card, the centered
"👁 Quick View" text pill is wide enough that it runs directly under the
heart circle fixed at bottom-right.

Fix: on devices with no real hover (`@media (hover: none)`), Quick View
collapses to an icon-only circle (same size/style as the heart) and docks
directly to its left with a clean 10px gap — both sit as a paired row,
bottom-right. Desktop keeps the original full pill with the "Quick View"
label, unchanged, since that only ever shows one control at a time on
hover.

Files changed:
- src/components/product/ProductCard.tsx  (wrapped the button's text in a
  <span className="piw-qv-label"> so it can be hidden at this breakpoint;
  aria-label on the button is untouched, so screen readers still announce
  "Quick view <product name>" regardless)
- src/app/globals.css  (new hover:none media block; desktop hover:hover
  block untouched)

ISSUE 2 — No way back/home from Checkout
-----------------------------------------------------------------
Root cause: the checkout page had no back-to-cart or continue-shopping
link anywhere in its own UI — only the global header logo (easy to miss
once scrolled past) led back to the store. This is a real dead-end
whenever Place Order is blocked (e.g. the "temporarily unavailable"
alert when both payment methods are off), since the customer had
nothing actionable to do on the page itself.

Fix:
1. The "Cart" breadcrumb step (already shown as ✓ done) is now a real
   link back to /cart — a standard checkout convention (completed steps
   are clickable to go back; "Confirmation" stays non-interactive since
   it isn't reachable yet).
2. When the "Checkout temporarily unavailable" alert shows, it now
   includes an explicit "← Back to Cart" link inline, so that specific
   dead-end state always has an escape route, not just a static warning.

Files changed:
- src/app/checkout/CheckoutClient.tsx  (Cart crumb → Link; alert → Link)
- src/app/checkout/checkout.css  (.ck-crumb--link, .ck-alert-link styles)

NOTE — separate from these two UI fixes: while checking the checkout
screenshot I found `cod_enabled` and `upi_enabled` are both `false` in
live site_settings right now, which is what actually triggers the
"temporarily unavailable" alert — confirmed intentional (payments off
during testing), so nothing was changed there.

VERIFICATION
- npx tsc --noEmit → clean, 0 errors
- npx eslint (both changed files) → 0 errors, 0 new warnings (1
  pre-existing unrelated warning in CheckoutClient.tsx, same as before
  this change)
- npx vitest run (full suite) → 103 test files, 1213 tests passed, 5
  pre-existing skips, 0 regressions
- npm run build → blocked in this sandbox only by outbound network
  policy rejecting the Google Fonts fetch (403) — same sandbox-only
  limitation noted in the earlier mobile-fix report, not a code issue

DROP-IN
Matches your exact repo folder structure — replace the four files above.
