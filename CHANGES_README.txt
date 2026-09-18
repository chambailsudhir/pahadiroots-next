Hero Mobile Fix — Changes Summary
Project: pahadiroots-next (HimVeda by Pahadi Roots storefront)
Date: September 18, 2026
Trigger: Screenshot showing hero prev/next arrows sitting off-center on mobile
Scope: This is a supplementary fix on top of the mobile-fix-v2 batch (bottom
nav / horizontal-pan report). This package contains ONLY the 2 files touched
here — drop into the same repo alongside (not instead of) mobile-fix-v2.

================================================================================
VERIFICATION OF THE PRIOR REPORT (done before touching anything new)
================================================================================
Before making any change, the mobile-fix-v2 report's claims were independently
re-verified against your actual uploaded source (not re-trusted from the
report text):
  - src/app/globals.css: html/body overflow-x:hidden fix present ✅
  - CartDrawer.tsx: confirmed the drawer panel really does stay permanently
    mounted (only the .overlay div is conditional on isOpen), fixed/right-0/
    top-0/max-w-md(448px)/translate-x-full when closed — matches the root
    cause described ✅
  - MobileBottomNav.tsx: z-index 35, confirmed CartDrawer=40, SearchOverlay=50
    (Tailwind z-50) both sit above it, header=30 sits below it ✅
  - /account and /checkout: confirmed each has its own real fixed bottom bar
    (.mobTabs, .ck-mob-bar) and MobileBottomNav correctly returns null on
    both route prefixes ✅
  - MobileFilterBar.tsx: trigger button's bottom offset correctly lifted to
    clear the new nav bar at the same 900px breakpoint ✅
  - npx tsc --noEmit → 0 errors (matches report)
  - npx eslint on all changed/new files → 0 errors, 1 pre-existing unrelated
    warning (matches report)
  - npx vitest run → 103 test files, 1206 tests passed, 5 pre-existing skips,
    0 failures (matches report exactly)
Conclusion: the report was accurate. No corrections needed to that batch.

================================================================================
NEW ISSUE FOUND (your screenshot) — ROOT CAUSE
================================================================================
File: src/components/homepage/HeroBanner.tsx

The prev/next arrow buttons use `top: calc(50% - 35px)` and a fixed 46px
size. That offset/size was tuned for the tall 82vh DESKTOP hero. The
mobile-fix-v2 batch (correctly) shrinks that same container to an
~1.87:1 aspect-ratio banner on mobile — as short as ~200-230px tall on a
typical phone. Against a container that short, a fixed -35px vertical
offset is a large fraction of the total height, so the arrows land
visibly above center instead of beside the content — exactly the
misplaced/oversized look circled in your screenshot.

FIX: added `.hhero-arrow` / `.hhero-arrow-prev` / `.hhero-arrow-next`
classes and a max-width:768px override (matching the breakpoint already
used for the aspect-ratio fix) that true-centers the arrows and shrinks
them to 36px on mobile. `!important` is required for the same reason as
the existing #home-hero-banner override in this file: these are inline
styles, which otherwise always win over an external/media-query rule.

================================================================================
MISSING FEATURE FOUND AND ADDED (not reported, found during mobile audit)
================================================================================
File: src/components/homepage/HeroBanner.tsx

The hero carousel had no swipe-to-navigate gesture on mobile — touch was
only wired to pause autoplay (onTouchStart/onTouchEnd), never to change
slides. Every mainstream mobile storefront/app carousel supports this;
its absence here meant phone users could only advance slides via the
(previously misplaced) 46px arrow buttons or wait for autoplay.

FIX: added touchStartX tracking (a ref, not state, to avoid a re-render
per touchstart) and a 40px swipe threshold (matches Swiper's own
default) on touchend to call next()/prev(). touchAction: 'pan-y' is set
on the container so the browser still allows normal vertical page
scrolling while horizontal swipes are handled in JS.

================================================================================
NOT YET BUILT — FLAGGED FOR YOUR DECISION
================================================================================
Audited the mobile PDP (src/app/products/[slug]/) and confirmed there is
no sticky "Add to Cart" bar pinned to the bottom on mobile — the only
Add to Cart button is wherever AddToCartSection.tsx falls inline on the
page. This is standard on enterprise mobile storefronts (keeps the
primary CTA reachable on long product pages) but is a real UI/design
decision (placement, what it shows, interaction with the new bottom nav
bar's z-index stack), not a one-line bug fix — left unbuilt pending your
go-ahead.

Also confirmed (separately, pahadi-admin repo): there are ZERO @media
queries anywhere in that codebase — it is not "one missed responsive
bug," it has no mobile/responsive layer at all. Left untouched as before;
flagging in case mobile support for the admin panel itself is wanted at
some point.

================================================================================
FILES IN THIS PACKAGE
================================================================================
src/components/homepage/HeroBanner.tsx   — arrow position fix + swipe support
src/__tests__/HeroBanner.test.tsx        — 7 new tests covering both changes
                                            (left-swipe, right-swipe/wrap,
                                            sub-threshold swipe ignored,
                                            single-slide no-crash, Next/
                                            Previous arrow clicks + wrap,
                                            arrows absent on single slide)

================================================================================
VERIFICATION OF THIS CHANGE
================================================================================
  - npx tsc --noEmit                              → 0 errors
  - npx eslint (both changed files)                → 0 errors, 0 warnings
  - npx vitest run HeroBanner.test.tsx             → 22/22 passed (15 existing
                                                      + 7 new)
  - npx vitest run (full suite)                    → 103 test files, 1213
                                                      tests passed, 5
                                                      pre-existing skips,
                                                      0 failures, 0 regressions
  - npm run build                                  → could NOT be completed in
                                                      this sandbox: Turbopack's
                                                      next/font tries to fetch
                                                      Lato + Playfair Display
                                                      from fonts.googleapis.com
                                                      at build time, and this
                                                      sandbox's network egress
                                                      allowlist doesn't include
                                                      that domain (same class
                                                      of sandbox-only
                                                      limitation as the missing
                                                      Supabase key noted in the
                                                      prior report — not a code
                                                      issue, and not expected
                                                      to occur on Vercel, but
                                                      stated plainly rather than
                                                      assumed).

Status: Not yet deployed — code is verified (short of the build step above)
and packaged, awaiting your go-ahead.
