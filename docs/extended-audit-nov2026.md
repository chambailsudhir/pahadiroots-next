# Extended audit — what was checked, what was found, what is still open (2 Nov 2026)

Scope: design/UX, copywriting and brand, SEO and structured data, keyboard / screen-reader behaviour, phone behaviour, performance under a
slow phone connection and repeated load, and a security review. Everything below was measured on the live site or read in the code;
nothing is a guess. "Fixed" means a pull request exists (see the PR list at the end), not that it is live.

## Coverage — honest limits
| Area | How it was checked | Limit |
|---|---|---|
| SEO / structured data | Every URL in the sitemap crawled (33): title, description, canonical, robots, OG, H1 count, image alt, JSON-LD parsed | No Search Console / ranking data |
| Copy / brand | Visible text of all 33 pages scanned for brand variants, contact details, placeholders, health claims, policy numbers | A spell-check by a human editor was not done; legal reading of claims is for counsel |
| Design / UX | Real Chromium screenshots (phone 390px + desktop 1366px) of home, product, empty collection, cart, checkout | Not a real iPhone/Android device |
| Keyboard / screen reader | Keyboard-only run: skip link, tab order, focus rings, cart drawer trap / Escape / focus return; accessibility tree + axe scans | **No NVDA / JAWS / VoiceOver session** — needs a person |
| Phone behaviour | Emulated phone: input font sizes, tap targets, shrunken viewport for the on-screen keyboard | **A real on-screen keyboard cannot be emulated** |
| Performance | Slow-4G + 4x slower CPU phone profile (LCP, CLS, TBT); cache headers; 40 requests at 8 concurrent on cacheable pages | **Not a capacity / load test** — that needs a staging copy and explicit approval |
| Security | Headers, TLS, cookies, exposed files, source maps, HTTP methods, DNS email auth; code review of all 37 API routes, raw-HTML rendering, redirects, database-filter construction | **Not a penetration test** — no active exploitation, brute-forcing or fuzzing was done against production |

## Found and fixed (PRs)
* **One-time coupons were not one-time.** A guest could re-use a `user_limit=1` coupon again and again (their use is stored with no customer id and the check looked by customer id); the delivery address was never compared. Now person **or** address, fail-closed at order time. → PR #74
* **Cart page scrolled sideways on phones** (stepper wider than the screen by 18–128px; the last step was clipped). → PR #73
* **"Loading your saved details…" never cleared for guests** and was announced to screen readers as a live status. → PR #75
* **Empty collections**: 7 of 10 had no products yet were in the sitemap and showed "No products found / Clear filters" with no filter set. Now noindex, out of the sitemap, "coming soon" message. → PR #75
* **iPhone input zoom**: all 22 visible form fields used 14px text, so Safari zoomed the page on every tap (checkout address, coupon, tracking, contact, chat). 16px on phones. → this PR

## Verified OK
* Every sitemap page: exactly one H1, canonical, social tags, valid JSON-LD (Organization, WebSite, Product with offers/shipping/returns, BreadcrumbList, FAQPage, BlogPosting); no duplicate titles/descriptions; unknown URLs return a real 404 + noindex; HTTP→HTTPS and apex→www redirects; no ratings in structured data (there are no real reviews).
* Security headers (HSTS preload, frame deny, nosniff, referrer, permissions), TLS 1.3, only one non-sensitive cookie, no exposed `.env`/`.git`/source maps, TRACE/PUT/DELETE refused, no CORS opened. Strict script policy on checkout/account.
* Code review: all 37 API routes have CSRF + session, a secret, a signature, or are read-only public data; database filters are built from validated ids / encoded values and ownership-scoped; admin HTML is sanitised before it is rendered; no open redirects; no `eval`.
* Keyboard: skip link works; focus rings visible; the cart drawer is a labelled modal dialog that traps focus, closes on Escape and returns focus to the Cart button.
* Speed on a slow phone: product, cart and checkout pages load acceptably; cached pages answer in ~0.2 s (p95 ~1 s) with 100% edge-cache hits.

## Still open — needs the owner (not code)
1. **`hello@pahadiroots.com` may not receive any mail.** Two independent DNS resolvers return **no MX record** for `pahadiroots.com` (DNS is at GoDaddy). The address is printed in the footer, the privacy policy (data-deletion requests), the returns policy (damage claims within 48 h) and the contact page. Send a test email to it from a Gmail account today. If it bounces, add mail hosting (or forwarding) and its MX record in the GoDaddy DNS. Order emails are unaffected (they are signed through Resend; DKIM/SPF/DMARC are set correctly, DMARC is `p=reject`).
2. **Customer testimonials on the cart page look invented.** "Priya M., Delhi", "Rahul S., Mumbai", "Anita K., Bangalore" are hard-coded text in `src/hooks/useCartPage.ts` (one praises rice, which is not sold); the reviews table has no matching rows. Showing invented reviews risks breaching India's consumer-protection rules on fake reviews. Replace with real reviews or remove the block — not changed here because only you know whether they are genuine.
3. **Marketing claims for counsel:** "100% natural" (68 mentions), "lab tested", "no preservatives", "certified"; the blog says raw honey's "antimicrobial properties are well-documented" and is "beneficial for … overall vitality"; the home hero says "Pure Himalayan Vitality". Product pages carry the proper "not medical advice" disclaimer. FSSAI's advertising/claims rules are the thing to check.
4. **7 empty collections + the J&K region page** are still linked in the menu. Hide them until stocked, or keep them as "coming soon" pages (they are now noindex).
5. **Health-check version** (`/api/health`) reports `1fd231d`, which is not the deployed commit — it is a hand-set value. Harmless, but monitoring that relies on it will mislead.
6. Shipping policy lists "order processing 1–2 business days" **and** "dispatch within 2 business days" in separate rows; most pages say only "dispatched within 2 business days". Clarify whether they overlap.
7. Order `ORD-2026-00108` (₹499) is confirmed with payment still pending — check Razorpay order `order_TU5IDJReKvroM1`.

## Open — engineering, lower priority
* **Collection pages take ~5.4 s to show the main image on a slow phone**; the first product image is not prioritised. `/products` and `/collections/*` are not edge-cached (p50 ~0.8 s, p95 ~2 s, every request is a cache miss) — fine today, the first thing to strain in a traffic spike.
* The floating chat avatar covers part of the home page's "Free Shipping" line and a product thumbnail on phones.
* Automated accessibility scan still flags: a few low-contrast text spots (cart sub-line, checkout trust cards, policy/contact pages) and button names that do not exactly match their visible text (mobile "More" button, chat bubble, size buttons).
* Product page: ten image-gallery buttons are separate Tab stops (about 22 stops from the skip link to "Add to Cart"); a single roving-focus group would cut that.
* Address "Area / landmark" has no `autocomplete`; fields have no `enterkeyhint`.
* Announcement banner's pause button overlaps the scrolling text on phones.

## Not covered (needs a person or a staging copy)
Real-device testing (iOS/Android keyboards), a screen-reader walkthrough, capacity/load testing, a penetration test by a qualified tester, a human copy edit, and a legal review.
