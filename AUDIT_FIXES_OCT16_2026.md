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

## 5. COOKIE CONSENT + GA4 E-COMMERCE (new)
Consent (DPDP Act 2023 / GDPR):
- First visit: bottom banner "Reject non-essential | Accept analytics | Choose" (Reject and Accept identical size/weight). Nothing optional runs before a choice.
- Analytics OFF by default; choice stored first-party (`hv_consent`, versioned, expires after 12 months, re-asked if CONSENT_VERSION in lib/consent.ts is bumped).
- Google Consent Mode v2: all signals "denied" by default; ad_* always denied (no ads used). The Google tag (GA4 `G-` or GTM `GTM-`) is NOT downloaded
  until the visitor accepts. The GTM <noscript> iframe was removed (it would load GTM for everyone).
- Withdrawing consent: stops events, deletes _ga*/_gid cookies, deletes the in-house visitor id (`pr_vid`).
- Footer "Cookie Settings" (all footers) reopens the dialog. Privacy Policy cookie section rewritten to match — HAVE IT REVIEWED by your adviser.
- The in-house analytics (admin dashboard) now also needs consent, so it only counts visitors who accepted.
GA4 events (recommended names, currency INR, value = what the customer pays incl. GST, no personal data ever):
- view_item, add_to_cart, remove_from_cart, add_to_wishlist, view_cart, begin_checkout, add_payment_info, search, purchase.
- purchase: sent from the verified order-success page only, once per order (transaction_id + sessionStorage guard), with tax, shipping, items.
- item_id = catalogue product id everywhere; pack size in item_variant.
NOT done on purpose: view_item_list / select_item / view_promotion (need list-impression tracking; say if you want them), Google Ads/Meta pixels.

## Verify after deploy (needs a real GA4 id set in Admin -> SEO -> Google Tag ID)
1. Fresh/private window: banner shows; DevTools Network has NO request to googletagmanager.com; no `_ga` cookie.
2. Click Reject: banner gone, still no GA request. Footer -> Cookie Settings -> accept: gtag.js loads, `_ga` cookie appears.
3. GA4 -> Admin -> DebugView (or Realtime): add a product to cart -> `add_to_cart`; place a test order -> exactly one `purchase` with transaction_id.
4. Cookie Settings -> untick analytics -> Save: `_ga*` cookies and `pr_vid` are gone.
5. Reload after accepting: no banner, tag loads automatically.

## Tests (merged tree, my sandbox)
tsc clean · ESLint 0 errors · vitest 1787 passed / 7 skipped, 0 failed. `next build` not run here (no Google Fonts access) — first Vercel build is the proof.
