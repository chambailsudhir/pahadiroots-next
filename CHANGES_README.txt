FIX: Mobile header — account icon (and other icons) cut off at screen edge

File changed:
  src/components/layout/Header.tsx

What was wrong (confirmed from your screenshot):
  On a real phone, the header's right-side icon cluster (.old-nav-right)
  had SIX items crammed in: Search, Wishlist, Account, Dark-mode toggle,
  Cart, and a hamburger "mobile menu" button — sized for desktop, never
  trimmed down for mobile. On a ~390px-wide screen that's simply more
  content than the row has room for, once you also account for the logo
  block on the left.

  Before the earlier overflow-x fix (Fix 1, mobile audit), this overflow
  would have shown up as a horizontally-scrollable page — annoying, but at
  least everything was reachable by scrolling sideways. Fix 1 correctly
  added `overflow-x: hidden` on <html> (to stop CartDrawer's fixed
  positioning from creating a phantom scrollable area), but that same rule
  means ANY other horizontal overflow — including this header's — now gets
  silently clipped at the viewport edge instead of being scrollable. That's
  exactly the symptom in your screenshot: the account icon cut in half at
  the right edge, with the dark-mode and cart icons pushed entirely
  off-screen and invisible.

Root cause, precisely:
  Three of those six header icons are exact duplicates of icons already in
  MobileBottomNav (added earlier in this mobile audit) — Search, Cart, and
  the hamburger menu all call the identical store actions (openSearch,
  openCart, openMobileMenu) as MobileBottomNav's own Search/Cart/More
  buttons, and both components already switch to mobile mode at the exact
  same 900px breakpoint. The header was never updated to drop its now-
  redundant copies once the bottom nav took over that job.

Fix:
  At the existing 900px breakpoint (same one already used to hide the
  desktop nav-links), the header's Search button, Cart button, and mobile
  hamburger button are now hidden — each has an identical, already-visible
  equivalent in MobileBottomNav. Wishlist and Account stay in the header
  (no MobileBottomNav equivalent exists for either), and so does the
  dark-mode toggle (not duplicated anywhere). This drops the mobile
  header's right-side cluster from 6 icons to 2, comfortably fitting next
  to the logo with no overflow — no icon disappears from the app, since
  every hidden one has a working twin one tap away in the bottom nav.

Verification:
  - npx tsc --noEmit -> 0 errors
  - npx eslint (Header.tsx) -> 0 errors
  - npx vitest run (full suite) -> 104 files / 1247 tests passed, 5 skipped
    (unchanged), 0 regressions

Drop-in instructions:
  Replace src/components/layout/Header.tsx in your repo with the file in
  this zip. No other files touched.
