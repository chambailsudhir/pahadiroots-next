FIX (round 3): Mobile hero — grey/blurred band still visible even after
the blurred-backdrop fix

File changed:
  src/components/homepage/HeroBanner.tsx

What was wrong (confirmed via your follow-up screenshot):
  Round 2 blurred the letterbox gap instead of filling it with a flat
  colour, so it no longer looked like a broken solid bar — but there was
  still a real, visible gap on Wild Honey, because the container's shape
  was still just a guessed 1.87:1 average across every banner, not that
  banner's own real proportions. Blur hides what fills a gap; it doesn't
  remove the fact that a gap exists.

Real fix this time:
  Stopped guessing one ratio for every banner. Each image's real aspect
  ratio is now measured the moment it finishes loading (naturalWidth /
  naturalHeight, via onLoad), stored per slide, and the hero container's
  shape on mobile now matches THAT slide's own measured ratio exactly
  (via a CSS custom property), not a fixed average. With the container's
  shape correct for the specific banner actually on screen, object-fit:
  contain fits it with zero or an imperceptible sub-pixel gap — no crop,
  no visible band. 1.87:1 remains only as the brief fallback shown for an
  instant before an image's own dimensions are known; the blurred backdrop
  from the previous fix stays in place purely as a safety net for that
  brief moment, not as the main fix anymore.

Verification:
  - npx tsc --noEmit -> 0 errors
  - npx eslint (HeroBanner.tsx) -> 0 errors
  - npx vitest run (full suite) -> 104 files / 1247 tests passed, 5 skipped
    (unchanged), 0 regressions — including the existing HeroBanner.test.tsx
    suite (22 tests)

Drop-in instructions:
  Replace src/components/homepage/HeroBanner.tsx in your repo with the
  file in this zip (supersedes both earlier hero-crop-fix zips — use only
  this one). No other files touched.
