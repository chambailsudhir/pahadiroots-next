FIX: Mobile hero banner still cropping baked-in text on the left/right edge

File changed:
  src/components/homepage/HeroBanner.tsx

What was wrong (confirmed via your screenshot + live Supabase data):
  An earlier fix in this audit made the hero container's shape follow a
  1.87:1 aspect ratio on mobile (matching the "typical" ratio these banner
  images are shot at), which fixed the earlier severe top/bottom crop.
  But 1.87:1 is a typical/average value, not each individual image's EXACT
  ratio. That earlier fix gets the container's shape CLOSE to right, but
  "close" still leaves object-fit:cover free to crop a little off
  whichever side is still slightly mismatched.

  For most slides that's invisible — the cropped sliver is just
  background. But for a self-contained banner graphic (the admin left
  Eyebrow/Headline/Subtext all blank because the text and logo are baked
  directly into the photo itself), that same small crop slices straight
  into real text with nothing to reflow around it. Confirmed live in
  Supabase: the exact banner in your screenshot (hero_slide_1) has every
  overlay field blank — hero_slide_1_title, _sub, _coupon_offer, _coupon_code
  all empty — meaning "HimVeda / Himachali Pahari Cow Ghee..." is baked
  into the photo, not text this component draws.

Fix:
  Only for these baked-in-text slides (no overlay content set), the image
  now switches to object-fit:contain on mobile — the one object-fit value
  that can never crop into the image, regardless of how far off 1.87:1 the
  real file is. A themed gradient sits behind it, so any resulting sliver
  of letterboxing reads as an intentional edge, not blank space. Slides
  WITH real overlay content (this component's own Eyebrow/Headline/
  Subtext, not baked into the photo) keep object-fit:cover exactly as
  before — a small side-crop there only trims background, never text.
  Desktop is completely unaffected either way.

Verification:
  - npx tsc --noEmit -> 0 errors
  - npx eslint (HeroBanner.tsx) -> 0 errors
  - npx vitest run (full suite) -> 104 files / 1247 tests passed, 5 skipped
    (unchanged), 0 regressions — including the existing HeroBanner.test.tsx
    suite (22 tests)

Drop-in instructions:
  Replace src/components/homepage/HeroBanner.tsx in your repo with the
  file in this zip. No other files touched.
