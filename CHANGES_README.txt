FIX (round 2): Mobile hero — flat-colour letterbox bars showed as an
obvious green bar on some banners

File changed:
  src/components/homepage/HeroBanner.tsx

What was wrong (confirmed via your follow-up screenshot):
  The previous fix switched baked-in-text hero slides (no admin overlay
  text — the text is part of the photo itself) to object-fit:contain on
  mobile, so the image could never be cropped. That's correct as far as
  it goes, but the gap contain can leave around the image was filled with
  a flat dark-green gradient — and that only looks fine when a banner's
  real aspect ratio happens to be close to the container's 1.87:1
  assumption. Checked live in Supabase: Wild Honey and Sea Buckthorn are
  BOTH baked-in-text slides (identical code path, both have every overlay
  field blank), but Sea Buckthorn's actual photo sits close enough to
  1.87:1 that its gap was never visible, while Wild Honey's doesn't match
  as closely — leaving a real, visible top/bottom gap that the flat green
  fill turned into an obvious, broken-looking bar.

Fix:
  Replaced the flat-colour fallback with a blurred, scaled-up copy of the
  SAME image rendered behind the sharp one (Netflix/YouTube-style
  letterbox fill — the standard technique for exactly this problem). Any
  gap contain leaves, on any banner regardless of that banner's own real
  aspect ratio, now reads as a soft blurred continuation of the photo
  rather than a mismatched solid-colour bar. No per-banner tuning needed
  going forward — this works uniformly whether a future banner's ratio is
  close to 1.87:1 or far from it.

Verification:
  - npx tsc --noEmit -> 0 errors
  - npx eslint (HeroBanner.tsx) -> 0 errors
  - npx vitest run (full suite) -> 104 files / 1247 tests passed, 5 skipped
    (unchanged), 0 regressions — including the existing HeroBanner.test.tsx
    suite (22 tests)

Drop-in instructions:
  Replace src/components/homepage/HeroBanner.tsx in your repo with the
  file in this zip (this supersedes the previous hero-crop-fix zip — use
  this one instead, not both). No other files touched.
