# Files to replace

Copy each file over the matching path in your repo (same relative paths as below).

| File | What changed |
|---|---|
| `src/app/globals.css` | `.coll-bg` recolored + gold hairline (Collections/BrandStory seam); added `.pgrid.bsGrid` rules (Bestsellers fixed to 2 rows) |
| `src/components/homepage/CategoryTiles.tsx` | Now uses `.coll-bg` instead of an inline near-duplicate background; unified gold accent (`#c8920a`/`#8a6508`) across chip + tile hover states |
| `src/components/homepage/BestSellersClient.tsx` | Grid class changed from `pgrid` to `pgrid bsGrid` |
| `src/components/story/story.module.css` | Added `scroll-snap` + `.rangeSnap` styles for the mobile Himalayan-range swipe |
| `src/components/story/HimalayanRange.tsx` | Added 7 invisible scroll-snap anchor points over the range image |

Known open issue, not fixable in code: the baked-in text on `himalayan-range.webp` shows "Indrasan 20,622 FT" — the correct figure is 20,410 ft. Fixing it requires regenerating that image file.
