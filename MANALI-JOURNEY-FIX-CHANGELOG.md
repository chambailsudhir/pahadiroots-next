# Manali Honey — Journey images fixed (were showing Spiti's photoset)

## The bug
`isHoneyPdp` gated the entire Journey section (photos + per-stage copy) and
was `true` for all three honey slugs — `himalayan-wild-honey`,
`himalayan-wild-manali-honey`, and `himalayan-spiti-valley-multiflora-honey`.
But the Journey block itself was hardcoded to one photoset: Spiti's hives,
Spiti's monastery, and copy that says outright "the high, arid valleys of
Spiti, Himachal Pradesh." So the Manali page was showing Spiti's story, not
its own.

I checked the other honey-gated sections on the same flag (stat trio, Why
It's Different, Know Your Source, How to Enjoy, Natural Variation, FAQ) —
those are all written generically ("Manali & Spiti", no exclusive claims),
so they're fine to keep sharing `isHoneyPdp`. Only the Journey timeline
needed to split apart.

## The fix
- Added `isSpitiHoneyPdp` and `isManaliHoneyPdp`, matched to the exact slug
  each one is really for.
- The existing Journey block (Spiti's photoset/copy) is now gated to
  `isSpitiHoneyPdp` instead of the shared flag.
- Added a **new**, separate Journey block for Manali, gated to
  `isManaliHoneyPdp`, using the photos you just sent.
- `himalayan-wild-honey` has no photoset of its own yet, so it now
  deliberately gets **no** Journey section — showing it Spiti's or Manali's
  images would just be the same bug again. It falls back to the plain
  "Himalayan Origin Story" card instead (see next point).
- The Origin card was also gated on the broad `isHoneyPdp`, so
  `himalayan-wild-honey` was losing that card too, with nothing put in its
  place. Narrowed that gate to `hasHoneyJourney` (Spiti or Manali only) so
  the card only disappears where a real Journey replaces it.

## Manali's new Journey (6 stages, `public/journey/manali-honey/`)
| File | Stage | From your upload |
|---|---|---|
| `01-origin.jpg` | Origin | `where_the_honey_begins_2.png` |
| `02-blooms.jpg` | The Blooms | `flora.jpeg` |
| `03-bees.jpg` | The Bees | `THE_FLOWERS_BEHIND_THE_HONEY_3.png` |
| `04-harvest.jpg` | The Harvest | `beekeeper_1.png` |
| `05-extraction.jpg` | The Extraction | `FROM_COMB_TO_JAR.png` |
| `06-jar.jpg` | The Bottle | `product_image_manali_honey.png` |

All resized/compressed to match the site's existing image weight (~270–450 KB
each, same range as the Spiti photoset already live).

## Not used in this fix — flagging separately
Two of your uploads — `front_product_page.png` and `Honey_product_2.png` —
are clean product-only jar shots (no journey narrative), which looks like
main product-gallery photography rather than Journey content. The product's
gallery images are pulled from Supabase storage per product (admin-managed),
not from this codebase, so I didn't wire them in — delivered separately as
`manali-candidate-gallery-images/` in case you want to upload them through
the admin panel.

## Delivered
- `pahadiroots-next-manali-journey-fix.zip` — folder-structure-preserving:
  `src/app/products/[slug]/page.tsx` (changed) +
  `public/journey/manali-honey/*.jpg` (new)
- `manali-candidate-gallery-images/` — the two product-only shots, not wired
  into code
