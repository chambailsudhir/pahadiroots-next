FIX: Two missed mobile PDP (product detail page) features

Files changed:
  src/components/product/AddToCartSection.tsx
  src/components/product/ProductGallery.tsx
  src/app/products/[slug]/pdp.css

────────────────────────────────────────────────────────
Fix 1 — No sticky mobile Add to Cart / Buy Now bar
────────────────────────────────────────────────────────
What was wrong:
  Checkout and /account already have their own sticky mobile bars (that's
  why MobileBottomNav returns null on those two routes). The PDP never got
  one. On a phone, once you scroll past the buy box into the description,
  reviews, or related-products sections, Add to Cart / Buy Now scroll
  completely out of view — you have to scroll all the way back up to buy.

Fix:
  Added an IntersectionObserver on the existing buy box (AddToCartSection.tsx)
  that shows a new fixed-position mobile bar (.pdp-mob-bar in pdp.css) with
  price + Add to Cart + Buy Now once the real buy box scrolls above the
  viewport, and hides it again when it's back in view. Sits above the global
  mobile bottom nav (56px + safe-area offset), same pattern as the earlier
  MobileFilterBar reposition fix. Guarded for environments without
  IntersectionObserver (falls back to just not showing the bar, no crash).

────────────────────────────────────────────────────────
Fix 2 — No swipe gesture on the product image gallery
────────────────────────────────────────────────────────
What was wrong:
  ProductGallery.tsx had prev/next arrow buttons and tap-thumbnail
  switching, but no touch/swipe handling at all — the gesture mobile
  shoppers reach for first on a product gallery.

Fix:
  Added touchstart/touchend tracking on the main image container. A
  horizontal swipe past a 40px threshold (and clearly more horizontal than
  vertical, so it doesn't fight page-scroll) advances to the next/previous
  image via the gallery's existing prev()/next() functions. A swipe no
  longer also triggers the zoom-lightbox click that fires on tap.

────────────────────────────────────────────────────────
Verification
────────────────────────────────────────────────────────
  - npx tsc --noEmit -> 0 errors
  - npx eslint (both changed files) -> 0 errors
  - npx vitest run (full suite) -> 103 files / 1213 tests passed, 5 skipped
    (unchanged), 0 regressions

Drop-in instructions:
  Replace the three files above in your repo with the ones in this zip.
  No other files touched.
