# Pahadi Roots homepage audit — tracker

82 findings: 64 from the audit (5 P1, 36 P2, 23 P3) + 18 found while fixing. Status as of 1 Nov 2026 (checked against the live site and this repository). Spreadsheet version: `docs/audit-tracker.xlsx`.

| Status | Count |
|---|---|
| Fixed | 69 |
| Verified OK | 1 |
| Decision | 5 |
| Mitigated | 2 |
| Open - owner action | 2 |
| Open - by design | 1 |
| Open - not fixed | 2 |
| **Total** | **82** |

## Open items

- **HOME-003** (Open - not fixed): Mobile Core Web Vitals (CLS 0.25, TBT 1,340 ms, LCP 5.1 s in the first audit) — CLS now 0; blocking time ~150-240 ms (was 396); score 92. Lighthouse LCP still ~2.9-3.0 s vs 2.5 s target (real-device test ~2.5 s). Only remaining lever is deferring below-the-fold HTML, rejected for SEO risk. Real-user Web Vitals now reported to GA4
- **HOME-020** (Open - owner action): Supabase leaked-password protection off — Needs the Supabase Pro plan (project is on Free). Meanwhile set minimum length 8 and strongest requirement in Authentication > Sign In / Providers > Email
- **C-10** (Open - not fixed): Chat API: forgeable origin, shared daily cap, full upstream payload — Done: session token, Sec-Fetch-Site check, per-IP + global caps, text-only response, narrower scope. Not done: a real CAPTCHA (Turnstile) - needs a Cloudflare account/keys
- **C-12** (Open - by design): CSP allowed unsafe-eval/unsafe-inline on every route — unsafe-eval limited to checkout. Strict nonce policy (no unsafe-inline) now on /checkout and /account. Other pages keep unsafe-inline on purpose: nonces would make every page dynamic (slower, depends on the database)
- **L-18** (Open - owner action): Supabase database slow/timing out (Free plan, shared compute): causes failed payments, hidden sections, failed deploys — Upgrade Supabase to Pro and increase compute size (Project Settings > Compute and Disk). Code-side mitigations in place (L-05..L-07, L-17)

## All findings

| ID | Sev | Area | Finding | Status | What was done / why open | Ref |
|---|---|---|---|---|---|---|
| HOME-001 | P1 | Trust | Trust band hidden; no link to lab reports | Fixed | Trust items un-hidden in settings; lab-reports link in footer and "Why" section | PR #18 |
| HOME-002 | P1 | Lead capture | Newsletter / lead-capture section did nothing | Decision | Owner decision: no newsletter for now. Section, popup, signup endpoint and double opt-in removed (recoverable from git history) | PR #19, #21 |
| HOME-003 | P1 | Performance | Mobile Core Web Vitals (CLS 0.25, TBT 1,340 ms, LCP 5.1 s in the first audit) | Open - not fixed | CLS now 0; blocking time ~150-240 ms (was 396); score 92. Lighthouse LCP still ~2.9-3.0 s vs 2.5 s target (real-device test ~2.5 s). Only remaining lever is deferring below-the-fold HTML, rejected for SEO risk. Real-user Web Vitals now reported to GA4 | PR #22, #23, #24, #44 |
| HOME-004 | P1 | Hero | Pause button overlapped the main button on phones/tablets | Fixed | Controls repositioned; verified at 320-768 px | PR #18 |
| HOME-005 | P1 | Header | Header wider than the screen at 320-368 px (sideways scroll) | Fixed | One header definition, hidden icons on small screens; 0 px overflow at 320-768 | PR #18 |
| HOME-006 | P2 | Hero | Desktop hero button dark green on dark photo | Fixed | Gold button with dark text | PR #36 |
| HOME-007 | P2 | Accessibility | "Shop" menu had no keyboard focus ring | Fixed | Visible 2 px outline | PR #18 |
| HOME-008 | P2 | Accessibility | Contrast, unlabeled controls, hidden slides focusable, tiny dots | Fixed | axe (WCAG 2.2 AA) reports 0 violations on the live homepage | PR #18 |
| HOME-009 | P2 | Privacy | Analytics runs without a banner for Indian visitors | Decision | Kept region-based mode. Owner action: switch setting cookie_consent_mode to "always" before 14 May 2027 (DPDP date in code comment) | - |
| HOME-010 | P2 | Accessibility | Ticker: hover-only pause, read twice, ignores reduced motion | Fixed | Pause button, aria-hidden clone, reduced-motion rule | PR #18 |
| HOME-011 | P2 | Widgets | Four stacked floating widgets | Decision | WhatsApp moved into the chat panel (PR #34); the desktop floating button was restored at the owner's request (PR #54). Desktop: chat, WhatsApp and scroll-to-top in one column; mobile: WhatsApp in the bottom nav | PR #34, #54 |
| HOME-012 | P2 | Fonts | Four font families, 16 font requests | Fixed | Two self-hosted families (Playfair Display, Lato); no Google download at build or run time | PR #33 |
| HOME-013 | P2 | Navigation | "Payment" in the main nav | Fixed | Moved to footer | PR #18 |
| HOME-014 | P2 | Icons | Emoji used as UI icons | Fixed | SVG icon set on homepage, header, menus, cards, quick view, cart drawer, checkout, cart, account, order pages. Verification pass converted the last icon-style emoji (address-label chips, shipping and SSL badges, stepper tick, PIN-code pin). Emoji in sentences/toasts and owner-written content intentionally kept as text. Trust bar keeps owner emoji (line icons were too faint on dark green) | PR #34, #46, #52, #56 |
| HOME-015 | P2 | Brand | Three brand names | Decision | Checked: already consistent (HimVeda by Pahadi Roots) | - |
| HOME-016 | P2 | Hero | Hero order / no price on slides | Decision | Honey stays first. A "From ₹" line was built, then removed at the owner's request | PR #36, #47 |
| HOME-017 | P2 | SEO | Share image was a hero photo | Fixed | Branded 1200x630 default image; og_image setting updated (revert logged) | PR #30 |
| HOME-018 | P2 | SEO | Only Organization + WebSite structured data | Fixed | Homepage ItemList of featured products added | PR #30 |
| HOME-019 | P2 | SEO | Collection title "Himalayan Himalayan Honey" | Fixed | New title pattern, no repeated words; brand no longer repeated on ~9 pages | PR #18, #36 |
| HOME-020 | P2 | Security | Supabase leaked-password protection off | Open - owner action | Needs the Supabase Pro plan (project is on Free). Meanwhile set minimum length 8 and strongest requirement in Authentication > Sign In / Providers > Email | - |
| HOME-021 | P2 | Content | Hidden ticker item claimed "4.9/5, 10,000 customers" | Fixed | Item hidden/removed in settings | - |
| HOME-022 | P2 | SEO | /lab-reports was noindex | Fixed | Indexable and in the sitemap | PR #36 |
| HOME-023 | P2 | Images | ~184 KiB image savings; 20 tile images; 13 head preloads | Fixed | Right-sized tiles, trimmed srcset. Lighthouse image audit now 0 KB savings; image bytes 378 KB -> 239 KB | PR #24, #41 |
| HOME-024 | P2 | Content | Same products repeated in 3 sections | Fixed | New Arrivals hidden when it would repeat; deterministic ranking. Region cards intentionally show that region's own products, so with a 5-product catalogue they can overlap Bestsellers | PR #18, #29 |
| HOME-025 | P3 | Accessibility | No header landmark; unlabeled nav | Fixed | <header>, nav aria-label | PR #18 |
| HOME-026 | P3 | Accessibility | 10 identical "Add to Cart" names | Fixed | "Add to cart: <product>" | PR #18 |
| HOME-027 | P3 | Security | X-Powered-By, no COOP, CSP unsafe-* | Fixed | X-Powered-By removed; COOP same-origin-allow-popups; unsafe-eval limited to checkout; strict nonce CSP on checkout/account. unsafe-inline on other pages tracked as C-12 | PR #20, #36, #45 |
| HOME-028 | P3 | SEO | Sitemap dates = build time; "seabuckthorn" vs "Sea Buckthorn" | Fixed | Real dates, paged queries, legacy URL redirect | PR #30, #36 |
| HOME-029 | P3 | Content | Slide 2 title ALL CAPS | Fixed | Title case in settings (revert logged) | - |
| HOME-030 | P3 | Database | Backup tables in public schema | Fixed | All 14 have row-level security and no policies. Verification found two product_claims backups (1 Nov) created with Postgres default anon/authenticated grants (RLS still returned no rows); grants revoked on them and on 36 other internal tables that have RLS but no policy | verification 1 Nov 2026 |
| HOME-031 | P3 | Reliability | Homepage served stale / sections missing intermittently | Mitigated | Retries, fresh re-read on empty result, partial-catalogue guard. Root cause is the slow Supabase database (see L-18) | PR #25, #26, #46 |
| HOME-032 | P2 | Analytics | No GA4 add_to_cart from homepage cards | Fixed | Card and quick-view adds now tracked | PR #18 |
| HOME-033 | P2 | Accessibility | Range scroller not keyboard focusable | Fixed | tabindex, role, label | PR #18 |
| HOME-034 | P2 | Accessibility | Gold Cart button label failed contrast | Fixed | Dark text on gold | PR #18 |
| C-1 | P2 | Bestsellers | Cards reshuffled after hydration (layout shift) | Fixed | Fixed server-side ranking: in stock, bestseller, discount | PR #29 |
| C-2 | P2 | Performance | Whole catalogue serialised to the browser | Fixed | 6 cards server-rendered; full list fetched only when filters are used; card fields whitelisted | PR #22, #41 |
| C-3 | P2 | Quick view | No focus trap / return; dead "Notify Me" | Fixed | Focus trap, return, honest "Out of Stock" | PR #18 |
| C-4 | P2 | Cards | NaN price; "Only N left" at 6-20 units | Fixed | Unpriced products hidden; urgency only at 5 or fewer | PR #29 |
| C-5 | P2 | Performance | Footer forced into client bundle | Fixed | Server component | PR #18 |
| C-6 | P2 | Images | Raw <img> PNGs without dimensions in regions | Fixed | next/image with dimensions | PR #18 |
| C-7 | P2 | Security | Maintenance mode fails open / exempts API | Verified OK | Order and payment routes re-check store_open (verified in code); page gate fail-open is deliberate for availability | - |
| C-8 | P2 | Chat widget | Closed chat focusable, no dialog role, low contrast | Fixed | visibility hidden when closed, role=dialog, Esc, labels | PR #18 |
| C-9 | P2 | Chat widget | Placeholder WhatsApp number; z-index; no timeout/cap | Fixed | No placeholder; below cookie banner; 30 s timeout, 1000-char cap | PR #18, #36 |
| C-10 | P2 | Security | Chat API: forgeable origin, shared daily cap, full upstream payload | Open - not fixed | Done: session token, Sec-Fetch-Site check, per-IP + global caps, text-only response, narrower scope. Not done: a real CAPTCHA (Turnstile) - needs a Cloudflare account/keys | PR #28, #36 |
| C-11 | P2 | Security | In-memory rate limits; unbounded analytics; subscribe w/o double opt-in; cart overwrite | Fixed | Shared KV limiter, analytics input caps, cart drafts need a real session id and never reopen a converted cart (subscribe removed with newsletter) | PR #20, #38 |
| C-12 | P2 | Security | CSP allowed unsafe-eval/unsafe-inline on every route | Open - by design | unsafe-eval limited to checkout. Strict nonce policy (no unsafe-inline) now on /checkout and /account. Other pages keep unsafe-inline on purpose: nonces would make every page dynamic (slower, depends on the database) | PR #20, #45 |
| C-13 | P2 | Accessibility | Carousel not pausable by keyboard | Fixed | Pauses on focus | PR #18 |
| C-14 | P2 | Images | Cached tile images could stay invisible | Fixed | Ref + complete check | PR #18 |
| P3-01 | P3 | Homepage | Metadata read non-strict; buildStates swallows errors | Fixed | Strict read; region section fails soft by design | PR #18 |
| P3-02 | P3 | Hero | Videos ignore pause; all mount src | Fixed | Pause applies to video; src only near active slide | PR #35 |
| P3-03 | P3 | Sitemap | Unbounded queries (1,000-row truncation) | Fixed | Paged fetch | PR #30 |
| P3-04 | P3 | Category tiles | Arrows lacked type=button; imperative handlers | Fixed | type=button; focus pause | PR #35 |
| P3-05 | P3 | Regions | Panel remount; dead ref; dead pills data | Fixed | Dead code removed; remount kept on purpose (tab animation) | PR #35 |
| P3-06 | P3 | Dead code | NewsletterBar / LeadCapturePopup | Fixed | Deleted | PR #19, #21 |
| P3-07 | P3 | Analytics | Two different tag-id patterns | Fixed | One shared pattern | PR #35 |
| P3-08 | P3 | Analytics | Page-view dedupe key != sent value | Fixed | Dedupe on path | PR #35 |
| P3-09 | P3 | UI | Reveal content flashed then hid | Fixed | Visible content is never hidden | PR #35 |
| P3-10 | P3 | Accessibility | Region tabs lacked Home/End; one URL for all "Made here" | Fixed | Keys added; each item searches its product | PR #35 |
| P3-11 | P3 | Menu | Mega menu scroll listener, Esc focus, button attrs | Fixed | Listener only while open; focus returns; aria | PR #35 |
| P3-12 | P3 | Menu | Mobile menu cleared body scroll lock; dialog unlabeled | Fixed | Restores previous value; labelled | PR #35 |
| P3-13 | P3 | Header | Logout had no finally; cart badge shifts button | Fixed | try/finally; badge handled in icon rework | PR #35, #34 |
| P3-14 | P3 | Announcement bar | Double "\| \|" separator | Fixed | Separator belongs to its item | PR #35 |
| P3-15 | P3 | Hero | Touch timer never cleared; raw alt with asterisks in heading | Fixed | Timer cleared; clean text | PR #35 |
| P3-16 | P3 | Payload | _images gallery in every card payload | Fixed | Home cards whitelisted; heavy fields removed | PR #22 |
| L-01 | High | Build | Footer variant A passed event handlers from a Server Component: production builds failed when settings fell back to defaults | Fixed | Hover handled with CSS; regression test over all footer files | PR #27 |
| L-02 | High | Build | Google Fonts download at build time could fail a deploy | Fixed | Fonts self-hosted; build no longer calls Google | PR #33 |
| L-03 | Med | Checkout | Checkout CSS imported Google Fonts that our own security policy blocked | Fixed | Import removed; site fonts used | PR #33 |
| L-04 | High | Build | My own change (server-only on shared services) broke the production build | Fixed | Removed where the browser also imports; verified with a real build. Live site was never affected | PR #32 |
| L-05 | High | Homepage | Bestsellers vanished when the catalogue read came back empty | Fixed | Retry + fresh re-read before hiding | PR #25, #26 |
| L-06 | Med | Homepage | Partial catalogue crashed Bestsellers ("reading length") | Fixed | Missing parts treated as empty | PR #46 |
| L-07 | High | Payments | Online payment returned 504 under a slow database | Mitigated | Time budget 15 -> 40 s; settings and rate-limit reads run together. Root cause: slow database (L-18) | PR #46 |
| L-08 | Med | SEO | Brand repeated in page titles on ~9 pages | Fixed | Layout template adds the brand once | PR #36 |
| L-09 | Med | Privacy | ~150 settings (incl. admin-only) sent to every visitor | Fixed | Browser components receive only what they read | PR #24 |
| L-10 | Low | Privacy | Empty cost/internal product keys serialised to browsers | Fixed | Keys omitted from card data (values were already blanked) | PR #22 |
| L-11 | Med | Security | Abandoned-cart drafts: guessable ids; reopened paid carts | Fixed | Real-length id required; converted carts final | PR #38 |
| L-12 | Low | SEO | /products/seabuckthorn returned 404 | Fixed | Redirect to the real page | PR #36 |
| L-13 | Low | UI | Ticker pause button used text glyphs | Fixed | SVG icons | PR #46 |
| L-14 | Med | UI | My trust-bar line icons were too faint on dark green | Fixed | Owner emoji restored (feedback) | PR #47 |
| L-15 | Med | UI | Story-card icons dark on dark green (my mistake, caught in review) | Fixed | Light icons | PR #52 |
| L-16 | Med | Dependencies | 4 high dependency alerts (dev toolchain) | Fixed | Patched versions pinned; npm audit: 0 high (production audit 0 high) | PR #50 |
| L-17 | Med | Deploys | Builds depended on the database being up | Fixed | Pre-build wait (up to 3 min); fails on purpose if it never answers so the old site stays live | PR #50 |
| L-18 | High | Database | Supabase database slow/timing out (Free plan, shared compute): causes failed payments, hidden sections, failed deploys | Open - owner action | Upgrade Supabase to Pro and increase compute size (Project Settings > Compute and Disk). Code-side mitigations in place (L-05..L-07, L-17) | - |
