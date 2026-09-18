MOBILE OVERFLOW + BOTTOM NAV FIX — v2 (re-checked, 2 more bugs caught + fixed)
================================================================================

ORIGINAL 2 FIXES (unchanged from v1)
--------------------------------------
1. html { overflow-x:hidden; width:100%; position:relative } added —
   fixes the page pan/blank-space bug (CartDrawer's off-canvas fixed
   panel was inflating the mobile layout viewport; only <body> had
   overflow-x:hidden before, not <html>).
2. New MobileBottomNav.tsx — Home / Search / Cart / Chat / More bar +
   IntersectionObserver-driven scroll-to-top button, matching the
   mypahadidukan.com reference.

2 NEW BUGS FOUND ON RE-CHECK (this pass) — both fixed
---------------------------------------------------------
3. Z-INDEX COLLISION: the new bottom nav was z-index:900. CartDrawer,
   SearchOverlay and MobileFilterBar's own overlay all sit at
   z-index 40-50 — meaning opening the cart or search on mobile would
   have rendered UNDER the new nav bar, with the bar's icons painted
   over the drawer/overlay content. Fixed: bottom nav is now z-index:35
   (just above the header/content, safely below every drawer/modal in
   the app — the lowest of which is 40).

4. DOUBLE BOTTOM BAR: /account already has its own contextual mobile
   tab bar (Orders/Wishlist/etc, account.module.css .mobTabs) and
   /checkout has its own sticky mobile CTA bar (price + Place Order,
   checkout.css .ck-mob-bar). The new global nav would have rendered
   on top of both, stacking two fixed bottom bars on the same screen.
   Fixed: MobileBottomNav.tsx now returns null on any /account or
   /checkout route, matching how large sites suppress generic chrome
   during focused/contextual flows.

5. FLOATING BUTTON OVERLAP: the product-listing page's "Filters"
   trigger button (MobileFilterBar.tsx, a floating pill at bottom:18px)
   now sits inside the new bottom nav bar's 56px footprint on mobile.
   Fixed: on the same 900px breakpoint the nav bar uses, the filter
   trigger is lifted to bottom: calc(56px + safe-area + 14px) so it
   floats clear above the bar instead of overlapping it.

FILES CHANGED (drop-in replace at these exact paths)
--------------------------------------------------------
src/app/globals.css                        (html/body overflow fix,
                                             .mbn/.stt-btn styles,
                                             z-index corrected to 35/34)
src/app/layout.tsx                         (renders MobileBottomNav +
                                             scroll sentinel div)
src/components/product/MobileFilterBar.tsx (filter button lifted above
                                             the new bottom nav)

FILES ADDED
------------
src/components/layout/MobileBottomNav.tsx  (route-aware — hides itself
                                             on /account and /checkout)

VERIFICATION DONE (this pass)
---------------------------------
- npx tsc --noEmit                -> clean, 0 errors
- npx eslint (all changed/new)    -> 0 errors, 1 pre-existing unrelated
                                      warning left untouched
- npx vitest run (full suite)     -> 103 test files, 1206 tests passed,
                                      5 pre-existing skips, 0 failures,
                                      0 regressions
- npm run build                   -> compiles + TypeScript passes;
                                      static generation runs through
                                      40+/54 pages in this sandbox (the
                                      /regions failure past that point
                                      is only a missing real Supabase
                                      key here, unrelated to this code)
- Manual line-by-line re-audit of every `position: fixed` + z-index in
  the codebase, specifically to catch stacking conflicts with the new
  bar — this is what surfaced bugs #3, #4 and #5 above.

NOT TOUCHED
------------
pahadi-admin: checked, no overflow-x rule on html/body there either,
but it's an internal desktop-only tool with no mobile complaint —
left alone. Say the word if you want the same defensive rule added.
