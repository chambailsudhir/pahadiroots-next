Pahadi Roots – Explore Region artwork/layout fix

Replace:
src/components/homepage/ExploreByRegion.tsx
src/components/homepage/ExploreByRegion.module.css

Add/replace:
public/explore-region-art/story-mountain.png
public/explore-region-art/story-pine.png
public/explore-region-art/product-mountains.png
public/explore-region-art/next-botanical.png

DO NOT replace globals.css.

This version fixes the rectangular artwork backgrounds:
- Product mountain engraving has a transparent background and no blue photo strip.
- Next Region botanical engraving has a transparent background.
- Story mountain/pine engravings are transparent so the green panel background remains visible.
