FINAL CORRECTION — Explore By Region

Replace/add ONLY these paths:

1) src/components/homepage/ExploreByRegion.tsx
2) src/components/homepage/ExploreByRegion.module.css
3) public/explore-region-art/story-mountain.png
4) public/explore-region-art/story-pine.png
5) public/explore-region-art/product-mountains.png
6) public/explore-region-art/next-botanical.png

DO NOT replace globals.css.

Important fix in this version:
The Himachal/region panel uses the REGION_META `panelBg` value as a CSS `background`, not `backgroundColor`. REGION_META contains CSS gradients such as `linear-gradient(...)`; using backgroundColor silently invalidates the value and leaves the panel cream, which makes the white text/artwork disappear.

This version keeps the editorial layout and transparent artwork assets from the reference demo.
