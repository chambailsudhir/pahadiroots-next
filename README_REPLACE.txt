REPLACE THESE FILES

1. src/components/homepage/ExploreByRegion.tsx
2. src/components/homepage/ExploreByRegion.module.css

ADD/REPLACE THESE ARTWORK FILES

3. public/explore-region-art/story-mountain.png
4. public/explore-region-art/story-pine.png
5. public/explore-region-art/product-mountains.png
6. public/explore-region-art/next-botanical.png

IMPORTANT FIXES IN THIS VERSION
- Region panel uses `background`, not `backgroundColor`, so the existing gradient from regionMeta actually renders.
- Himachal panel therefore returns to the dark-green demo appearance.
- Product pills preserve their full labels (Apple & ACV, Pine Honey, etc.).
- Decorative artwork uses transparent PNGs so no cream/green rectangular image boxes appear around the line art.
- globals.css does NOT need to be replaced.
