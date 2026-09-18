FIX: Blog "More Stories" thumbnail oversized image download (minor)

File changed:
  src/app/blog/[slug]/page.tsx

What was wrong:
  The "More Stories" thumbnails at the bottom of a blog post used a flat
  next/image `sizes="280px"` regardless of how many columns actually render.
  .bp-more-grid shows 3 columns above 900px viewport width and 2 columns at
  or below it — so on mobile/tablet the browser could fetch an image sized
  for a wider slot than it actually displays in. Same root cause class as
  the earlier product-grid image-sizing fix, just on the blog page.

Fix:
  Changed `sizes="280px"` to `sizes="(max-width:900px) 50vw, 320px"` to
  match the grid's real breakpoints.

Verification:
  - npx tsc --noEmit -> 0 errors
  - npx eslint (blog page) -> 0 errors
  - npx vitest run (full suite) -> 103 files / 1213 tests passed, 5 skipped
    (unchanged from before this fix), 0 regressions

Drop-in instructions:
  Replace src/app/blog/[slug]/page.tsx in your repo with the file in this
  zip. No other files touched.
