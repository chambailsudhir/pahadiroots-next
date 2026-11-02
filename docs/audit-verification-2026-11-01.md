# Independent verification — Pahadi Roots audit (82 findings)

Verifier: Claude Fable 5.1, working from `docs/verification-brief` (the brief written for this check).
Checked: 1 Nov 2026, 18:10–18:20 UTC, against production `https://www.pahadiroots.com`
(Vercel deployment `dpl_5VcvKegAhRpH8Ft6qrrQGomWPYu2`, commit `fd297b6`, READY) and the repository at the same commit.
Read-only throughout: no order, no payment, no setting or database write, no push to `main` other than this report.

## Summary

| Group | Confirmed | Disagree | Cannot verify |
|---|---|---|---|
| A. Homepage (34) | 30 | 4 | 0 |
| B. Code audit (14) | 14 | 0 | 0 |
| C. Small items (16) | 16 | 0 | 0 |
| D. Found while fixing (18) | 18 | 0 | 0 |
| **Total (82)** | **78** | **4** | **0** |

The five items the tracker lists as open (HOME-003, HOME-020, C-10, C-12, L-18) are described accurately and stay open. HOME-009 (cookie banner, owner decision before 14 May 2027) is described accurately.

## Disagreements (most severe first)

### 1. HOME-030 — two backup tables are granted to `anon` (low severity)
Tracker: "Verified OK: every backup/archive table has row security on and `anon` cannot read."
Found: `product_claims_backup_20261101` and `product_claims_backup_20261101b` (5 rows each, created 1 Nov 2026) have `anon`/`authenticated` SELECT, INSERT, UPDATE, DELETE grants. The other 12 backup/archive tables have no grant.
Row security is on with zero policies, so the grant yields nothing: `GET /rest/v1/product_claims_backup_20261101?select=*` with the anon key returns `[] 200` (compare `orders_archive`: `401 permission denied`). The table name is discoverable but no data leaks.
Fix: `revoke all on public.product_claims_backup_20261101, public.product_claims_backup_20261101b from anon, authenticated;` (or drop the two tables once the claims migration is confirmed). See also "Outside the 82" item 1.

### 2. HOME-014 — icon-style emoji remain on /checkout and /cart (low severity)
Tracker: "Fixed: emoji replaced by SVG icons on checkout, cart, account" (PR 52).
Found in `document.body.innerText`: /checkout — address-type chips `🏠 Home`, `🏢 Office`, `👨‍👩‍👦 Parents`, `👫 Friends`, `📍 Others`, and `🚚 FREE` in the shipping line; /cart — `🔐 SSL Encrypted`. These are icon-style uses, not emoji inside sentences. /account: 0 emoji. Header on / and /checkout: 0 emoji, 13/13 SVGs `aria-hidden`.
Fix: map these seven through `AdminIcon`/`Icon` (`home`, `building`, `users`, `pin`, `truck`, `lock` already exist in `Icon.tsx`).

### 3. HOME-024 — products repeat between Bestsellers and the region cards (low severity; wording)
Tracker: "Fixed: no product appears in two sections; New Arrivals hidden when it would repeat."
Found: New Arrivals is correctly hidden (0 sections). But "Our Finest Offerings" (6 cards) and the "Explore by region" Himachal panel (3 cards) share three products: Himachali Pahari Cow Ghee, Himalayan Spiti Valley Multiflora Honey, Himalayan Wild Manali Honey. With a 5-product catalogue this is unavoidable if region cards show that region's products.
Fix: tracker wording only — "Bestsellers and New Arrivals never repeat; region cards intentionally show the region's own products."

### 4. HOME-011 — tracker is stale: three floating controls, not two (informational)
Tracker: "Fixed: exactly two floating controls (#pr-ai-fab, .stt-btn); WhatsApp inside the panel."
Found at 1440×900 after scrolling: `#pr-ai-fab` (1362,702), `#pr-wa` (1366,770), `.stt-btn` (1376,834) — three, in a tidy column, and `.pr-wa-link` is also inside the panel header. This is the result of PR 54 (merged 18:05 UTC today, on the owner's request) which post-dates the tracker.
Fix: update the tracker row to "Decision: WhatsApp button restored on desktop (PR 54); mobile keeps it in the bottom nav."

## Cannot verify
None. (HOME-020's switch text was not re-read in the dashboard UI; the organisation plan was confirmed as `free` via the management API, which is what makes the switch unavailable.)

## Outside the 82 (new observations)

1. **38 internal tables are readable-in-principle by `anon`** — RLS on, zero policies, but SELECT (and in most cases INSERT/UPDATE/DELETE) granted: `team_members`, `rate_limit_counters`, `inventory`, `inventory_ledger`, `vendors`, `warehouses`, `analytics_events`, `ai_chat_messages`, `wishlist`, `stock_notifications`, `gst_audit_log`, etc. Today RLS blocks every row (`[] 200`), so this is defence-in-depth, medium priority: a single future `create policy ... using (true)` or a disabled RLS would expose them. Suggested: `revoke all on <table> from anon, authenticated` for tables the browser never touches, plus the Supabase "RLS enabled no policy" advisor check in CI.
2. **A product named "Test" (₹2, category Herbs & Spices) is live** in Bestsellers card 2, in the ItemList structured data sent to Google, in `/api/v1/search-catalog`, and is the only product under the "Herbs & Spices" filter. Severity: medium (customer-visible and indexable). Owner action: unpublish or delete it.
3. **/account logs two `eval` CSP violations** from `_next/static/immutable/chunks/2n6co8bnb26xf.js` and `0cjtb4b2aenrp.js` (strict CSP has no `unsafe-eval` on /account). The brief notes this as a known library probe inside try/catch; page works. Low; worth identifying the chunk's dependency so it can be dropped.
4. **Console 401s on /checkout (×2) and /account (×1)** for a logged-out visitor (session probe). Harmless, but noisy for anyone debugging. Low.
5. **Closed cart drawer** (`translate-x-full`, width 448) sits at x=1434 on a 1440 px viewport, 6 px inside the edge; it is `inert` and not visible. Cosmetic; low.
6. **Lint: 12 warnings, 0 errors** (not failing CI).

## Method

- Tools: Node 22.22.0, Lighthouse 13.6.0 with Chromium 1243 (`/opt/pw-browsers`), Playwright Chromium 153.0.8010.12, axe-core (latest npm), curl 8, Supabase management API (SQL + unified logs), Vercel API.
- Lighthouse: 6 mobile, performance-only runs, 18:12–18:15 UTC, same URL, interleaved. Runner is a shared container, so TBT varied widely.

| Metric | Median | Range |
|---|---|---|
| Performance score | 82 | 66–90 |
| LCP | 3,154 ms | 2,571–3,480 |
| TBT | 916 ms | 260–1,725 |
| CLS | 0 | 0–0.011 |
| FCP | ~1,090 ms | 1,054–1,119 |
| Image bytes | 254 KB (22 requests) | 253–254 |
| `uses-responsive-images` / `uses-optimized-images` savings | 0 KB / 0 KB | — |

- Repository: `npx tsc --noEmit` exit 0; `npm run lint` 0 errors / 12 warnings; `vitest` 227 files, 2,347 tests passed, 7 skipped; `npm audit --omit=dev --audit-level=high` 0 high (8: 3 low, 5 moderate); `npm audit` 0 high (27: 3 low, 24 moderate).
- Homepage fetched 20× (18:13 UTC): 20/20 HTTP 200 containing "Our Finest Offerings"; TTFB 0.17–1.98 s (one 1.98 s outlier); Bestsellers card order identical in all 5 compared responses.
- Supabase: org `chambailsudhir's Org` plan `free`; project `ACTIVE_HEALTHY`, Postgres 17.6. Edge logs, last 24 h, `/rest/v1/*`: 10,282 requests, p50 641 ms, mean 1,004 ms, p95 3,512 ms, 2,473 over 1 s, 243 over 5 s, max 338 s.

## Checklist

Verdict key: **C** Confirmed, **D** Disagree.

### A. Homepage findings

| ID | Verdict | Evidence |
|---|---|---|
| HOME-001 | C | HTML: 4 `.trust-icon` cells (🌿 🌄 🤝 🚚); 2 `href="/lab-reports"` links. |
| HOME-002 | C | 0 `type="email"` inputs; no `LeadCapturePopup`/`NewsletterBar`/`action: 'subscribe'` code (comments only); `/api/v1/subscribe/confirm` → 404. |
| HOME-003 | C (open) | LCP median 3,154 ms (> 2.5 s); CLS 0; hero `<link rel="preload" as="image" fetchPriority="high">` present; gtag loads after interaction/5 s (dataLayer shows gtm.load only after wait). TBT median 916 ms on this runner (range 260–1,725) — the "< 300 ms" part could not be reproduced here; two runs did show 260–265 ms. |
| HOME-004 | C | 8 widths: `.hhero-pause` never intersects `a.hhero-cta1`; smallest gap 14 px at 320 px. |
| HOME-005 | C | `scrollWidth − clientWidth` = 0 at 320/340/360/375/390/412/414/768. |
| HOME-006 | C | `a.hhero-cta1` at 1440 px: background rgb(224,182,74), color rgb(13,36,16) (3 instances). |
| HOME-007 | C | `.mega-trigger` on Tab 7: outline solid 2 px rgb(26,107,32). |
| HOME-008 | C | axe wcag2a/2aa/21aa/22aa: 0 violations at 1440×900 and 390×800. |
| HOME-009 | C | `cookie_consent_mode` not set in `site_settings` (region mode); `src/lib/consentRegion.ts:4,10` documents 14 May 2027. |
| HOME-010 | C | reduced motion: `.ticker-track` animationName none; `.ticker-pause` toggles playState paused, aria-pressed true; 4 of 8 items `aria-hidden="true"`. |
| HOME-011 | **D** | Three fixed controls (`#pr-ai-fab`, `#pr-wa`, `.stt-btn`) since PR 54; `.pr-wa-link` also in panel header. Tracker predates PR 54. |
| HOME-012 | C | `document.fonts`: playfair 400–900 normal+italic, lato 400/700/900 (5 faces, 2 families); 0 googleapis/gstatic requests; no `next/font/google` in src (test only). |
| HOME-013 | C | `nav[aria-label="Primary"]` has no "Payment"; footer `a[href="/payment"]` "Payment Methods". |
| HOME-014 | **D** | Header: 0 emoji, 13/13 SVG aria-hidden; cards SVG. But /checkout address chips 🏠🏢👨‍👩‍👦👫📍, `🚚 FREE`; /cart `🔐 SSL Encrypted` are icon-style emoji. |
| HOME-015 | C | "HimVeda by Pahadi Roots" ×22 in HTML; all 9 sampled titles end with it; og:image on same domain. (Logo link text is "Himalayan Natural Store" — the logo image alt, unchanged.) |
| HOME-016 | C | 0 `.hhero-from` / "From ₹"; slide 1 "Honey, Born in the Mountains of Manali." |
| HOME-017 | C | `og:image` = `/og-default.jpg`, 1200×630 JPEG, 56,513 bytes. |
| HOME-018 | C | JSON-LD: Organization, WebSite, ItemList with 6 items (name, url, price, `schema.org/InStock`). |
| HOME-019 | C | Titles: "Himalayan Honey — Farm-Direct… \| HimVeda…", "Honey Lab Test Reports \| …", "Blog \| …", "Explore Himalayan Regions \| …", "Contact Us \| …" — brand once, no repeats. |
| HOME-020 | C (open) | Org plan `free` (management API); leaked-password protection is a Pro feature, so the item correctly stays open. |
| HOME-021 | C | "4.9" appears 14× — all inside SVG path data (`…4.500c2 0 3.700 1.100 4.900…`); "10,000" 0×. |
| HOME-022 | C | `/lab-reports`: `<meta name="robots" content="index, follow">`; listed in sitemap. |
| HOME-023 | C | 6 runs: responsive-image and optimized-image savings 0 KB; image bytes 253–254 KB (22 requests). |
| HOME-024 | **D** | New Arrivals hidden (0); but 3 products appear in both Bestsellers and the Himachal region panel. Catalogue has 5 real products. |
| HOME-025 | C | `<header class="sticky top-0 z-30">` and `<nav aria-label="Primary">` present. |
| HOME-026 | C | 6 `aria-label="Add to cart: <name>"`, all unique. |
| HOME-027 | C | No `x-powered-by`; `cross-origin-opener-policy: same-origin-allow-popups` on / and /checkout; `'unsafe-eval'` only in /checkout script-src (absent on / and /account). |
| HOME-028 | C | 34 sitemap URLs with 8 distinct `lastmod` values (Mar–Nov 2026); `/products/seabuckthorn` → 308 `/products/sea-buckthorn`. |
| HOME-029 | C | Slide 2 `h1.hhero-h` "A Golden Tradition from the Land of Gods"; same in `site_settings.hero_slide_2_title`. |
| HOME-030 | **D** | 14 backup/archive tables: all RLS on; 12 with no anon grant; `product_claims_backup_20261101`/`…b` grant anon SELECT/INSERT/UPDATE/DELETE (RLS returns `[]`). |
| HOME-031 | C | 20/20 responses contain "Our Finest Offerings"; `BestSellers.tsx:28,37` retry once + fresh re-read when empty. |
| HOME-032 | C | After click: `["event","add_to_cart",{currency:"INR",value:350,items:[{item_id:"1",item_name:"Himalayan Wild Manali Honey",price:350,quantity:1}]}]`. |
| HOME-033 | C | `div[role="region"][tabindex="0"][aria-label="Himalayan range map (scrollable)"]`. |
| HOME-034 | C | axe color-contrast on `.old-cart-btn`: none (rgb(26,26,26) on rgb(200,146,10), 13 px/800). |

### B. Code-audit findings

| ID | Verdict | Evidence |
|---|---|---|
| C-1 | C | Same card order in 5 loads (hash identical); `shuffleProducts` absent from src; `rankForHomepage` in `normalizeProduct.ts:200`. |
| C-2 | C | 6 products in HTML/JSON-LD; first chip click → 1 GET `/api/v1/search-catalog` (200, 6 products), three further chips → 0 requests. |
| C-3 | C | Quick view: focus → `.qv-close`; 15 Tabs cycle inside `role="dialog"`; Esc removes sheet and focus returns to the Quick view button; `QuickViewModal.a11y.test.tsx` passes. |
| C-4 | C | `ProductCard.tsx:60–64` non-finite price → 0 and card hidden; `:78` "In Stock" above 5, "Only N left" at ≤ 5; `ProductCard.guards.test.tsx` passes. |
| C-5 | C | `Footer.tsx` starts with a comment, no `'use client'`; `serverFootersNoHandlers.test.ts` passes. |
| C-6 | C | `ExploreByRegion.tsx:4,122` `next/image`; remaining `<img>` are decorative art with width/height/lazy. |
| C-7 | C | `orders/route.ts:167–180` `getFreshSiteSettings()` → 503 when closed; `payments/route.ts:123` same read in `Promise.all`. |
| C-8 | C | Closed: panel `visibility:hidden`, 6 inner focusables unreachable; open: `role="dialog"`, `aria-label`, fab `aria-expanded="true"`; Esc closes, focus → `#pr-ai-fab`. |
| C-9 | C | `919000000000` appears once, in a comment only; `AbortController` + 30,000 ms (`ai-assistant.js:793–794`); `textarea#pr-ti maxlength="1000"`. |
| C-10 | C (open) | POST /api/chat: no token 403; valid token 200 with body `{candidates:[{content:{parts:[{text}]},finishReason}]}` only (`aiGuard.ts:143–160` strips everything else, keeps ≤ 5 grounding sources); `sec-fetch-site: cross-site` 403. No CAPTCHA, as stated. |
| C-11 | C | `actions/route.ts:5` + `analytics/track/route.ts:21,72` use `checkRateLimitKv`; metadata ≤ 2,000 chars, batch ≤ 20; `session_id "abc"` → 400 "Invalid abandoned cart payload" (`schemas/index.ts:152` `{16,100}`); converted cart not reopened (`actions/route.ts:193–196`, `actionsRoute.abandonedCart.test.ts`). |
| C-12 | C (open by design) | / script-src has `'unsafe-inline'`, no nonce; /checkout and /account have `'nonce-…'` + 3 sha256 hashes, no `'unsafe-inline'`; 0 violations on /checkout; /account logs 2 `eval` violations from Next chunks (known library probe, page works). |
| C-13 | C | Autoplay moves `scrollLeft` 436→666 in 4 s unfocused; after Tab onto a tile it stays at 0 for 4 s. |
| C-14 | C | `CategoryTiles.tsx:22` `img.complete && img.naturalWidth > 0` → reveal on mount. |

### C. Small items

| ID | Verdict | Evidence |
|---|---|---|
| P3-01 | C | `page.tsx:53,157` `getSiteSettings({ strict: true })`; region section wrapped in try/catch (`:267`). |
| P3-02 | C | `HeroBanner.tsx:127–132` play/pause via refs; `:325` `src` only for current/neighbour; `:331` `preload` auto only for current. |
| P3-03 | C | `sitemap.ts:15` `PAGE = 1000`, `.range(from,to)` on all four queries; `sitemap.test.ts` present and passing. |
| P3-04 | C | 2 `.cgrid-arrow` buttons, both `type="button"` (code and DOM). |
| P3-05 | C | `pills` in `regionMeta.ts` only in comments; `sectionRef` absent from `ExploreByRegion.tsx`. |
| P3-06 | C | No `NewsletterBar*` or `LeadCapture*` files under src. |
| P3-07 | C | `TAG_ID_RE` defined once (`consent.ts:49`); `layout.tsx:24,189` uses `consentBootstrapInputs`. |
| P3-08 | C | `PageViewTracker.tsx:17–19` dedupes on `pathname`, sends `pathname`. |
| P3-09 | C | `story/Reveal.tsx:29–30` returns early when already in viewport (component is used on the story page, not the homepage). |
| P3-10 | C | Home/End switch tabs on both tablists; "Made here" links → `/search?q=Himachali%20Pahari%20Cow%20Ghee` etc. |
| P3-11 | C | `MegaMenu.tsx:45–48` scroll listener added/removed with open state; `:58` Esc → `triggerRef.focus()`; `:69` `type="button" aria-controls="mega-menu-panel"`. |
| P3-12 | C | `MobileMenu.tsx:89–91` restores previous `body.style.overflow`; `:117` `role="dialog" aria-label="Main menu"`. |
| P3-13 | C | `Header.tsx:190` `try { await performHeaderLogout() } finally { setLoggingOut(false) }`. |
| P3-14 | C | `AnnouncementBar.tsx:38–40` separator rendered inside the conditional stat item. |
| P3-15 | C | `HeroBanner.tsx:168` timer cleared on unmount; `plainAlt`/`:38` strips `*`; no `*` in any hero heading in the DOM. |
| P3-16 | C | `normalizeProduct.ts:179–193` whitelist `HOME_CARD_FIELDS`/`HOME_CARD_VARIANT_FIELDS`; homepage HTML has 0 `cost_price`, `fully_loaded_cost`, `_images`, `blog_autopilot_day`. |

### D. Found while fixing

| ID | Verdict | Evidence |
|---|---|---|
| L-01 | C | No `onMouse`/`onClick` in `Footer*.tsx`; `serverFootersNoHandlers.test.ts` passes. |
| L-02 | C | No `next/font/google` import; 5 files in `src/fonts/`; `fontsSelfHosted.test.ts` passes. |
| L-03 | C | `fonts.googleapis` only in comments (`globals.css:10`, `layout.tsx:208`). |
| L-04 | C | `pricingService.ts`, `orderService.ts`, `inventoryService.ts`: no `server-only`; production deployment READY. |
| L-05 | C | `BestSellers.tsx:24–37` retry once, forced fresh re-read when empty, before `return null`. |
| L-06 | C | `storeData.ts:194–228` `|| []` on every part; `storeDataPartial.test.ts` passes. |
| L-07 | C (mitigated) | `vercel.json`/`vercel.pro.json` maxDuration 40 for orders and payments; `payments/route.ts:123–126` `Promise.all` of settings + two limits. |
| L-08 | C | /blog, /regions, /contact, /our-stories, /search, /track, /wishlist: brand once, at the end. |
| L-09 | C | `clientSettings.ts` allow-list + `clientSettings.test.ts`; `blog_autopilot_day` absent from page HTML. |
| L-10 | C | 0 occurrences of `cost_price`/`fully_loaded_cost` in homepage HTML. |
| L-11 | C | `save_abandoned_cart` with `"abc"` → 400. |
| L-12 | C | `/products/seabuckthorn` → 308 → `/products/sea-buckthorn`. |
| L-13 | C | `TickerPause.tsx:24` `<Icon name={paused ? 'play' : 'pause'}>`; no text glyphs. |
| L-14 | C | `.trust-icon` cells contain the owner emoji as text (🌿 🌄 🤝 🚚), no SVG; `trust_2_icon` = 🌄 in settings. |
| L-15 | C | /cart green card: 6 cert + 5 step icons rgb(240,217,140) on green; screenshot `scratchpad/browser/cart.png`. |
| L-16 | C | 0 high in `npm audit --omit=dev --audit-level=high` and `npm audit` (moderate/low only). |
| L-17 | C | Both configs `buildCommand: node scripts/wait-for-db.cjs && next build`; `:47` exits 1 if DB never answers; `waitForDb.test.ts` passes. |
| L-18 | C (open) | Plan `free`; `/rest/v1/*` last 24 h p50 641 ms, p95 3.5 s, 243 requests > 5 s, max 338 s. |

## Resolution (2 Nov 2026)

Everything this report disagreed with or flagged has been acted on:

- HOME-030 / outside-the-82 item 1: `anon`/`authenticated` grants revoked on all 38 RLS-without-policy tables (database change, recorded in the tracker).
- HOME-014 and item 2 (icon-style emoji): checkout, cart and product-page emoji replaced with the SVG icon set — PRs 59, 61, 62.
- HOME-011 / HOME-024: tracker rows reworded.
- Item 3 (eval on /account): Node `crypto` removed from the client bundle, Zod set jitless — 0 violations live — PR 59.
- Item 4 (401s for guests): checkout and account no longer call account-only APIs without a persisted user — PR 59.
- The three items that were open for the fixer: C-10 now has a proof-of-work challenge (Turnstile-ready), C-12's nonce policy covers every per-request route, and HOME-003's Lighthouse mobile LCP median is 2.43 s (five runs, range 2.43–2.88 s) after hidden hero slides, the Why artwork and the italic font stopped loading before the hero — PRs 63, 64, 65.
- Still with the owner: the "Test" product, the Supabase Pro upgrade (HOME-020, L-18) and the cookie-banner date (HOME-009).
