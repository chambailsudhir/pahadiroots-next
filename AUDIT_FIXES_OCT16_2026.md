# Storefront fixes — rebased on your 16 Oct 2026 zip

Apply: copy every file listed in UPLOAD_FILES.txt over the repo (same paths), commit, push.
Upload package-lock.json together with package.json (vercel.json now runs `npm ci`).
Files your other session changed (footerQuickSelects, shippingCopy, collections/products/new-arrivals pages ...) were NOT touched,
except where both sessions edited the same file; those were merged (layout.tsx, FooterShared.tsx, regions/[slug]/page.tsx) and the one
real overlap (PDP "Zero middlemen" line) keeps YOUR session's wording.

## 1. Security
- Next.js 16.2.9 -> 16.4.1, postcss/brace-expansion pinned. `npm audit --omit=dev` clean.
- /api/chat and /api/transcribe gated by lib/api/aiGuard.ts (same-origin, per-IP + global daily limits, size caps, validated input,
  fixed model settings, timeouts, key out of URL). Ceilings: chat 3000/day, transcribe 600/day — change in the two route files.

## 2. Homepage freshness (keeps the ISR CPU saving)
- Admin product save refreshes "/"; an order that sells a variant out, and the expiry sweep, refresh the cards (one regeneration per event).

## 3. MRP / discounts (marketplace style)
- lib/pricing/linePricing.ts variantDisplayMrp: tax-inclusive MRP, shown only when above the selling price. Admin package adds per-size MRP.

## 4. Claims
- States stat derived from ACTIVE states only (hidden if unknown). Removed invented family count; contact FAQ no longer lists states.
- Region pills built from real products.

## 5. COOKIE CONSENT + GA4 E-COMMERCE (region-aware)
Why region-aware: India's DPDP notice-and-consent rules start on 14 May 2027 and an India-only shop is outside GDPR, which is why amazon.in /
myntra.com show no banner to Indian visitors. Global sites show it only where the law requires. Same here, and the owner can override it:
- Admin -> Settings -> "Cookie consent banner":  (a) EU/UK/Switzerland only [default; analytics ON by default in India]  (b) Everyone [analytics off until accepted]
  (c) Nobody [analytics always on; visitors can still opt out from the footer]. SWITCH TO (b) BEFORE 14 MAY 2027 (get your adviser's view).
- Country comes from Vercel's x-vercel-ip-country header, set by proxy.ts as the `hv_geo` cookie (eu|row|unk) — the page HTML stays identical and cacheable
  (ISR/CPU saving unaffected). Unknown country is treated as "ask" (safe side).
Where consent is required: banner (compact corner card on desktop, bottom sheet on phones) with "Reject non-essential | Accept analytics | Choose" — Reject and Accept
identical in size/weight; analytics OFF until accepted; Google tag not even downloaded; Consent Mode v2 denied by default; ad_* always denied.
Where it is not required (India by default): no banner, analytics on, Google tag loads normally; footer "Cookie Settings" lets any visitor opt out (respected everywhere).
Withdrawing: stops events, deletes _ga*/_gid cookies and the in-house visitor id. Choice stored 12 months (`hv_consent`, versioned).
The in-house analytics (admin dashboard) follows the same rule. Privacy Policy cookie section rewritten accordingly — HAVE IT REVIEWED by your adviser.
GA4 events (recommended names, INR, value = what the customer pays incl. GST, never personal data): view_item, add_to_cart, remove_from_cart, add_to_wishlist,
view_cart, begin_checkout, add_payment_info, search, purchase (order-success page only, once per order). item_id = catalogue product id; pack size in item_variant.
NOT done: view_item_list / select_item / view_promotion, Google Ads / Meta pixels.

## Verify after deploy (needs a real GA4 id in Admin -> SEO -> Google Tag ID)
1. From India (default mode): NO banner; gtag.js loads; GA4 Realtime shows you. Footer -> Cookie Settings -> untick analytics -> Save: `_ga*` cookies gone, no more events.
2. Admin -> Settings -> Cookie consent banner = "Everyone", save, hard-reload (cache ~1 min): banner appears; before clicking, Network has NO googletagmanager.com request.
3. Reject: still none. Accept: gtag.js loads, `_ga` appears. Reload: no banner, tag loads.
4. EU test: use a VPN/Vercel preview with header x-vercel-ip-country: DE -> banner shows in default mode.
5. GA4 DebugView: add to cart -> `add_to_cart`; place a test order -> exactly one `purchase` with transaction_id.

## Tests (merged tree, my sandbox)
tsc clean · ESLint 0 errors · vitest 1801 passed / 7 skipped, 0 failed. `next build` not run here (no Google Fonts access) — first Vercel build is the proof.
