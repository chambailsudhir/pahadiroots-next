# Storefront redesign — Phase 1 (Nov 2026)

Branch: `redesign/premium-ux`. Audit and proposal: the "Pahadi Roots Redesign Review" page shared with the owner.
Owner decisions applied here: keep every admin-active category listed, with a "not available yet" page when empty; keep the hero carousel; keep all homepage
sections; remove newsletter leftovers; one Help button for WhatsApp and the AI assistant.

## What changed

| Area | Change | Files |
|---|---|---|
| Empty categories | Owner decision: the admin "active" switch alone decides which categories are listed (homepage strip, menus, footer, shop filters), even before a category has products. The header/footer product-count filter in `layout.tsx` was removed. To hide a category, switch it off in admin. | `app/layout.tsx`, `lib/storeData.ts` |
| Empty collection pages | Still indexed as `noindex,follow`. Instead of "0 Products" and an empty sort bar: a short note, "Shop all products", a WhatsApp question pre-filled with the category name, and the products available now. | `components/collections/ComingLaterCollection.tsx`, `app/collections/[slug]/page.tsx` |
| Newsletter | The `subscribe` action was already gone. Removed the unused newsletter schema, the `newsletter_welcome` email type, the welcome-coupon generator and the `show_newsletter_bar` default. The fallback ticker no longer promises a welcome code. Privacy policy and account-deletion copy now describe back-in-stock alerts instead of a newsletter. Export and erasure of old subscriber records are kept (data-protection duty). New guard test fails if newsletter or subscription wording appears in any page or component. | `lib/schemas`, `lib/server/email.ts`, `lib/getSiteSettings.ts`, `types`, `app/policies/[type]/page.tsx`, `DangerZoneSection.tsx`, `__tests__/noNewsletterUi.test.ts` |
| Help | One Help entry point. Desktop: a floating Help button (back-to-top sits above it). Phones: the bottom nav's "Chat" became "Help"; no floating button except on checkout and the signed-in account area, which have no bottom nav. The sheet has three pre-filled WhatsApp messages (product, order, delivery), "Ask Pahadi_AI" and "Track an order". The AI widget's own launcher and WhatsApp button are hidden; while the chat is open its launcher shows in Help's spot as the close button. Back-to-top is no longer shown on phones. | `components/layout/HelpLauncher.tsx`, `MobileBottomNav.tsx`, `store/uiStore.ts`, `app/layout.tsx`, `globals.css` |
| Product page (phones) | Highlights card moved below the buy box. On phones: square photo frame, compact breadcrumb and thumbnails, and the tagline, share row and delivery note follow Add to Cart. Gallery arrows are ivory and forest instead of red. Measured on the live Manali honey page at 390×844 by applying the same change: price 949px → 675px, bottom of Add to Cart ~1,900px → ~1,016px. The existing sticky buy bar covers the rest. | `app/products/[slug]/page.tsx`, `pdp.css`, `ProductGallery.tsx` |
| Scroll reveals | Sections are never invisible while waiting to scroll into view; only a short slide plays. | `story.module.css`, `OurStory.module.css` |
| Design tokens | `--pr-*` colour, radius and motion tokens and `.pr-btn` buttons added to `globals.css` for new and restyled components. | `globals.css` |

## Verification

- `vitest`: 3,551 passed (new tests: populated categories, coming-later state, Help launcher, no-newsletter guard; bottom nav tests updated).
- `tsc --noEmit` clean. `eslint`: no new warnings.
- `next build` compile phase succeeds (same check as CI).
- Layout changes were checked by applying the same DOM and CSS changes to the live pages in Chromium at 360, 375, 390, 414 and 1440px. Vercel previews are disabled for this project and no server keys are available here, so the full app was not run end to end.

## Not in this phase

Design-system migration of existing components, homepage restyle, cart and checkout restyle, tracking timeline, recently viewed, and the sandbox purchase test (needs Razorpay test keys and a non-production Supabase project).
