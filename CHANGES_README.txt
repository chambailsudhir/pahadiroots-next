FIX: Header's own dark-mode icon was never actually hidden on mobile
(the missing half of Fix 11, Round 2)

File changed:
  src/components/layout/Header.tsx

What was wrong (found by diffing your latest zip against the intended
fix):
  The dark-mode toggle was correctly ADDED to the mobile menu drawer
  (MobileMenu.tsx already had it, and globals.css already had its
  styling) — but the header's own original copy of that same toggle was
  never actually hidden on mobile. Round 2 of the header-overflow fix only
  shipped half of itself: the "add it to the drawer" half landed, the
  "hide the header's duplicate" half didn't. That's exactly why the icon
  was still visible next to Account in your screenshot — not a new bug,
  just an incomplete previous fix.

Fix:
  Added `.old-dark-btn` to the existing ≤900px media query in Header.tsx
  that already hides Search and Cart on mobile (both already redundant
  with MobileBottomNav). Now all three — Search, Cart, and the dark-mode
  toggle — are hidden on mobile, leaving just Wishlist + Account in the
  header, with the dark-mode toggle now reachable only via the mobile
  menu drawer ("More"), as intended.

Verification:
  - npx tsc --noEmit -> 0 errors
  - npx eslint (Header.tsx) -> 0 errors
  - npx vitest run (full suite) -> 104 files / 1247 tests passed, 5 skipped
    (unchanged), 0 regressions

Drop-in instructions:
  Replace src/components/layout/Header.tsx in your repo with the file in
  this zip. No other files touched.
