FIX (round 2): Mobile header overflow — still cutting off after the first fix

Files changed:
  src/components/layout/Header.tsx
  src/components/layout/MobileMenu.tsx
  src/app/globals.css

What was wrong (confirmed via your follow-up screenshot):
  The previous fix hid Search, Cart, and the hamburger menu button on
  mobile (all exact duplicates of MobileBottomNav icons), dropping the
  header's right-side cluster from 6 icons to 3: Wishlist, Account, and
  the dark-mode toggle. That wasn't quite enough — on a real phone width,
  those 3 icons plus the logo block were STILL right at the edge of
  overflowing, and your new screenshot showed the dark-mode toggle itself
  now getting clipped at the right edge instead.

Fix:
  Unlike Search/Cart/hamburger, the dark-mode toggle had no equivalent
  anywhere else in the mobile UI — hiding it outright would have silently
  removed the feature on phones. Instead, it now lives in the mobile menu
  drawer (MobileMenu.tsx, opened via MobileBottomNav's "More" or the
  header's own menu access), styled to match the drawer's existing nav
  links. The header's copy is hidden on mobile (same 900px breakpoint as
  the earlier three). That leaves just Wishlist + Account in the header's
  mobile row — comfortably fits next to the logo with real margin this
  time, not a knife's-edge fit.

Verification:
  - npx tsc --noEmit -> 0 errors
  - npx eslint (both changed files) -> 0 errors
  - npx vitest run (full suite) -> 104 files / 1247 tests passed, 5 skipped
    (unchanged), 0 regressions — including the existing
    mobileMenuRegions.test.ts suite

Drop-in instructions:
  Replace all three files above in your repo with the ones in this zip.
  No other files touched. (globals.css is included because only one small
  CSS rule was added for the new drawer toggle's styling — everything else
  in that file is untouched from your current repo.)
