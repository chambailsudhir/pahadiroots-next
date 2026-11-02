# Customer-account audit — 2 Nov 2026 (live testing with dedicated test users)

Scope: `/account` and everything it touches (sign-in/up/reset, profile, addresses, orders, tracking, wishlist,
notifications, privacy/delete, checkout hand-off). Method: real browser sessions as three dedicated test
customers (A, B, C — `audit.{a,b,c}.20261102@example.com`), two real COD test orders on the ₹2 "Test"
product, direct API probes, and correlation with Supabase (auth/postgres logs, schema, RLS) and Vercel runtime logs.
No real customer row was read or changed.

## 1. Fixed in this branch (`fix/account-audit-2026-11`)

| ID | Evidence (live) | Fix |
|---|---|---|
| ACC-033 | `DELETE /api/account/delete` → 500 for every account. Auth log: `DELETE … violates foreign key constraint "customers_auth_user_id_fkey" (23503)` | The anonymising PATCH wrote the non-existent column `postal_code` (real: `pincode`); the error was swallowed by `.catch(() => null)`, so `customers.auth_user_id` stayed set. Steps are now fatal + verified and run **before** the irreversible auth delete; wishlist / saved addresses / abandoned carts are erased too |
| ACC-023 | Delete needed only `{confirm:"DELETE"}` | Re-auth: current password (email accounts) or sign-in < 15 min (Google-only). Failures are `403` + `code`, never `401` |
| ACC-032 | `POST /api/v1/orders` → 503 after ~32 s (`ORDER_CREATE_TIMEOUT`) **while the order was committed a moment later** | Budget measured from request start (default 34 s, env `ORDER_CREATE_BUDGET_MS`); on timeout the order is looked up by idempotency key and returned as success; only a real miss is a 503 |
| ACC-035 | Both test orders: `customers.phone` NULL **and** no `phone` in `orders.shipping_address` → `/track` "Order not found" for a valid order; no number for the courier | `createOrder` snapshots the normalised phone in `p_shipping_address.phone` (the fallback `/api/v1/orders/track` already reads). Account row is still never rewritten (S1-002 intact) |
| ACC-039 | API accepted blank name, `5123456789` as mobile, `Atlantis` as state; **pincode never saved** (client sent `postal_code`, API allow-list is `pincode`) | Server-side validation (profile + address rows, legacy rows stay editable); `postal_code` alias; client reads/writes `pincode`; data export fixed |
| ACC-029 | Sign-up "min 6" vs change-password "8+upper+number+special"; server only checked length | One policy (`validate.password`) enforced server-side for sign-up, change, reset; show/hide toggle + hint on sign-up |
| ACC-036 | Wrong *current* password → API 401 → UI signed the user out | `400 {code:"wrong_current_password"}` |
| ACC-037 | After password change/logout the old token → `403 session_not_found` → surfaced as **500** | `sbAuth('/user')` maps revoked-session responses to 401 |
| ACC-034 (residual) | Login limiter is per-IP only | Added per-account limit (10 / 15 min) |
| ACC-038 | "In Transit" tile counted *Confirmed* orders; `out_for_delivery`/`processing` in no tile; "Total Spent" included failed/refunded; "Total Paid" on unpaid COD | Tile renamed **Active**; `get_customer_order_stats` fixed (`db_migration_v15…sql`, **already applied to prod**); COD label; Invoice action on order detail; "1 order" |
| ACC-040 | Account-page Logout left `pr_checkout_profile` (name/phone/address) in localStorage | `clearClientPII()` on logout and after deletion |
| ACC-041 | Export omitted loyalty/wishlist/prefs/returns; "once per 24 h" not enforced (in-process limiter) | Added those sections; per-account shared limiter |
| ACC-027/028 | No consent notice at sign-up; "Join 10K+ …" with 20 customers | Terms/Privacy notice; claim removed |
| ACC-025 | Every e-mail sign-up → HTTP 500 "Error sending confirmation email" (Supabase Auth SMTP `535 Authentication credentials invalid`) | Sign-up now falls back to the same mechanism password-reset already uses (admin `generate_link` + our Resend sender) **only when Supabase reports it could not send its own mail**; alert-level log tells ops the SMTP credentials are bad. A healthy SMTP setup is untouched. The credentials themselves still need fixing in the dashboard (§2) |
| ACC-050 | No self-serve cancellation anywhere (UI or API) | `POST /api/orders/[id]/cancel` + "Cancel order" dialog on the order page. COD orders that are `pending`/`confirmed` only (policy: before dispatch, no fee); owner-scoped conditional update (single winner); the DB already releases stock and reverses the journal on the status change; the route adds coupon release + `reverse_loyalty_for_order` (**new, db_migration_v16, applied to prod, tested in a rolled-back transaction**) + customer/admin e-mails. Prepaid or already-packed orders get a WhatsApp prompt instead. Policy text updated |
| ACC-045 | Account page said "Earn 1 coin per ₹1" and "100 bonus coins" (hard-coded) while the real settings are `loyalty_points_per_rupee = 0.01` and `referral_bonus_points = 100` | Copy now comes from the real settings via `/api/v1/loyalty` (`earn_per_rupee`, `referral_bonus`): "Earn 1 coin for every ₹100 you spend". *(Earlier I called this ~100 % cashback — wrong; it is a 1 % earn rate.)* |
| ACC-032 follow-up | After a timed-out order the loyalty award and the confirmation / admin e-mails never ran | The post-order steps are one function used by both paths; the recovery path runs it once, guarded by an `order_events` marker (`post_order_finalized`), and the loyalty RPCs are idempotent per order |
| ACC-044 | Account screens had no headings; track form labels not associated; tabs/alerts without ARIA; placeholder `PR-2024-0001` | `role=heading`, `htmlFor`, `role=tablist/tab/alert/status`, `ORD-2026-00123` |

Tests: 60+ new/updated (`accountDeleteRoute.reauthAndErasure`, `authRoute.passwordPolicyAndLogin`,
`profileRoute.validation`, `ordersRouteTimeoutRecovery`, `serverUtils.sbAuthSessionGone`, createOrder phone snapshot…).
Suite: 2433 passed; `tsc` and `eslint` clean.

## 2. Still needs the owner (credentials / money / policy — not code)

| ID | Item |
|---|---|
| ACC-025 | Regenerate the mail provider's SMTP key and update **Supabase → Authentication → SMTP Settings**. Sign-up works without it now (fallback above), but Supabase's own mails (email-change, magic links) still use that SMTP |
| ACC-032 (root cause) | Supabase compute is Micro/Nano class (60 connections, 224 MB shared_buffers). REST reads take 2–5 s at the API layer while the SQL runs ~19 ms; order creation took 14–32 s. `vercel.json` already pins `bom1` (region is **not** the cause). Upgrade: **Supabase dashboard → Project Settings → Compute and Disk** (a billing decision; already noted as deferred in `orders/route.ts`). The code now survives slowness (recovery + post-order steps) but cannot make the database faster |
| ACC-031 | GA4 / Consent Mode is **deliberate policy**: `cookie_consent_mode` (Admin → Settings) = `region` → opt-in in EEA/UK/CH, opt-out in India until DPDP starts (see `lib/consent.ts`). To require opt-in everywhere set it to `always`. Counsel's call; no code change |
| ACC-002 / 001 | Test data in prod (119 orders / 20 customers, `/products/test` at ₹2 in the sitemap): clean before go-live |
| ACC-045 | Referral bonus is 100 coins each (₹100 each at ₹1/coin) — consider abuse controls (credit on delivery, one referral per phone/device) |

## 3. Claims made during the audit that live testing **disproved** (kept for transparency)

Session tokens in localStorage (they are HttpOnly cookies) · mass-assignment on `/api/profile` (privileged
columns are ignored) · missing login rate limit (a first probe used a non-existent action name; `email_login` is
limited) · track-endpoint throttle (probe used a wrong path; per-IP and per-order limits exist) · Vercel
functions in the wrong region (deployment `regions: ["bom1"]`) · sign-in dialog without dialog semantics (the
inner box has `role=dialog`) · password eye buttons unnamed (they have `aria-label`) · notification toggles
without switch role (they have `role=switch`) · no deep links (`?tab=` works) · dual address store (the profile
API writes the normalised `saved_addresses` table; the JSON is transport only) · loyalty "~100 % cashback" (real earn rate is 1 %) · password reset "probably broken by the SMTP problem" (it uses Resend, not Supabase's mailer) · analytics consent default (deliberate, configurable policy).

## 4. Post-deploy verification checklist

1. Delete flow on a throwaway user: wrong password → 403 inline; correct → 200, `customers.auth_user_id` NULL,
   auth user gone, Clear-Site-Data header present.
2. Place a COD order as a signed-in user; `orders.shipping_address.phone` is set; `/track` finds it.
3. Profile → Save Address persists `customers.pincode`; Account → Addresses shows it.
4. Change password: wrong current → red inline error, **still signed in**.
5. `/account` tiles: a Confirmed order counts under **Active**.
6. Sign-up with a weak password is refused client- and server-side; consent line visible.
7. After SMTP is fixed: sign-up, confirmation and reset emails arrive.
8. IDOR matrix (A vs B: order, invoice, return upload, search) still 404 — unchanged by this branch.
9. Cancel: a confirmed COD order shows **Cancel order**; cancelling → status `cancelled`, stock restored, coupon released, coins reversed (`loyalty_transactions` type `adjustment`, note `Reversal:`), customer + admin e-mails. B cannot cancel A's order (404); a prepaid / packed order shows the WhatsApp prompt and the API answers 409.
10. Sign-up with SMTP still broken → account created unconfirmed + verification e-mail through Resend (use a real inbox); with SMTP fixed → Supabase's own mail, no fallback alert in the logs.
11. Loyalty page reads "Earn 1 coin for every ₹100 you spend" (matches `site_settings`).

---

## 5. Follow-up pass (second PR) — the "open, minor" list

Measured first, then fixed. Accessibility was scanned with axe-core 4.14 (WCAG 2.0/2.1/2.2 A+AA) over 22 page states
(logged-out gate, sign-in dialog, every account tab, order detail, /track × desktop + mobile).

| Item | Result |
|---|---|
| ACC-047 duplicate calls on login | **Fixed.** `GET /api/profile` is shared between the login pre-cache and the account page (`lib/profileRequest.ts`: in-flight sharing + 4 s reuse, invalidated on edit / logout). `PUT /api/wishlist` skips a list the server already confirmed (only a *successful* PUT is remembered, so a guest list is never lost) |
| ACC-043b two tabs overwrite addresses | **Fixed.** `GET /api/profile` returns a content fingerprint of the address list (`saved_addresses_etag`); saves send it back and a changed list answers `409 addresses_changed` instead of being overwritten. Older clients without the field keep the previous behaviour |
| ACC-021 pincode via a third party | **Fixed.** Same-origin `GET /api/v1/pincode/[pin]` (validated, 30-day cache, only 4 fields forwarded, failures are an uncached 502 → form falls back to manual entry). The host is removed from the CSP and the browser no longer sends customers' pincodes to it |
| ACC-017 contrast / target size | **Fixed.** axe found 209 contrast failures (light greys 1.9–3.6:1) on all 22 pages, 8 target-size failures, and an invalid ARIA structure (a link inside the mobile `tablist`). Every failing rule was recoloured with a shade verified ≥ 4.5:1 on each background it appears on; password-eye and "Forgot password?" now ≥ 24 px; the Wishlist link moved out of the tablist (`display: contents` wrapper keeps the layout). Re-scan result in the PR |
| ACC-018 mobile logged-out polish | Gate icon now centred (it was an `<svg>`, `display:block`, so `text-align` never applied). A signed-out visitor on `/account` had **no cart or menu at all** on mobile (bottom bar suppressed, header has no cart) → the bottom bar now shows there. Logo files' faint off-white background snapped to white (no more visible tile). The ticker's pause button overlapping text is by design (it sits on the bar's own colour) |
| ACC-016 / 019 | Wishlist and Privacy & Data are neutral (red now means only "Logout"); `/account` has a real page title ("My Account \| …") |
| ACC-020 analytics | Audited live: `page_view, view_item, add_to_cart, begin_checkout, add_to_wishlist` + web vitals; **no e-mail / phone / token / user-id sent to Google** (the one "phone-like" match was a GTM container hash). Account journey had **no** events → added `login`, `sign_up` and `account_action` (fixed vocabulary: reset requested, password changed, address saved, order cancelled, order tracked, data exported, account deleted); consent-gated, no personal data |

**Closed as by-design / not fixable safely here**

| Item | Why |
|---|---|
| ACC-006 `'unsafe-inline'` on static pages | Documented tradeoff in `lib/strictCsp.ts`: account / checkout (the sensitive pages) already get the strict per-request nonce policy; nonces on cached pages would make them dynamic and slow. Session cookies are HttpOnly, so script injection on a marketing page cannot read them |
| ACC-048 Best Sellers can vanish | Already retries and re-reads fresh. Failing loudly instead would risk a 500 on the home page during an outage — the real fix is the Supabase compute upgrade |
| ACC-009b "Others" vs "Other" label, 4- vs 5-step tracker | Cosmetic; both labels are accepted end to end |
| ACC-014 `vector` extension in `public` | Moving an extension can break embeddings / functions that reference it; needs a maintenance window and a test of the AI features |
| ACC-011 13 backup tables with order data | Needs a retention decision (and an export) before anything is dropped — not done |

**New finding (ACC-051)** — return-evidence photos are uploaded into the shared, **public** `pahadi-images` bucket
(100 MB limit; video / PDF allowed) under `returns/<order>/…`. The route validates every request (image only, ≤ 5 MB,
extension = type, path pinned) but Storage signed-upload URLs carry no per-URL limits, so the bucket-wide limits apply
to anyone holding a URL, and the photos (which can show a customer's home or parcel label) are world-readable by URL.
Fix = a dedicated **private** `return-evidence` bucket (5 MB, jpeg/png/webp) read through signed URLs — it needs a matching
change in the admin app, so it is left for the owner.

**Not tested** (and why): returns / refunds on a *delivered* order — moving a test order to `delivered` writes GST
journal entries into the real books; real-device Safari / Firefox / Android — only Chromium is available in this
environment (mobile *emulation* was used); e-mail content — no inbox.

### 5.1 ACC-052 — wishlist erased on page load (found by live verification, fixed)

* **What happened:** on a device whose local wishlist was empty (new phone, cleared storage, other browser), merely opening the
  home page while signed in sent `PUT /api/wishlist {"wishlist": []}`. A customer's saved list `[11,28]` became `[]`.
  Reproduced on a preview deployment before the fix.
* **Fix:** the browser now sends only *deltas* (`PATCH /api/wishlist {add, remove}`), which the server merges into the stored list
  with a conditional write (no lost updates; 409 if it keeps changing). `PUT` refuses to replace a non-empty list with an empty one
  unless `x-wishlist-clear: 1` is sent, which protects old cached clients. A guest's wishlist is uploaded as *adds* on sign-in.
* **Tests:** `wishlistRoute.merge.test.ts` (14), `userStore.wishlistSync.test.ts` (9).

### 5.2 Other findings recorded in the follow-up pass

* **Second `GET /api/profile` after login is inherent:** login does a full page reload, so the second request happens in a new
  document and cannot be shared with the first. The shared-request helper still dedupes within one document.
* **ACC-051 (owner decision):** return-evidence photos are stored in the shared *public* `pahadi-images` bucket (100 MB limit,
  video/PDF allowed). Fix needs a private bucket and an admin-app change.
* **Closed as by-design / not safe to change:** static-page CSP trade-off, Best Sellers cold-start (real fix = compute upgrade),
  cosmetic labels, `vector` extension schema, backup tables (needs a retention decision).

### 5.3 Referral programme + abuse controls (ACC-045 follow-up, `db_migration_v17_referral_controls.sql`)

* **Finding:** the account page promised "you and your friend earn 100 coins", but nothing recorded a referral or paid it
  (`customers.referred_by` was never set; no `referral` ledger row has ever existed). Nothing to abuse — and nothing worked.
* **Now:** `?ref=CODE` is remembered 30 days in the browser and applied once after sign-in (`ReferralCapture`), or typed in on the
  account page. Coins are paid by `process_referral_rewards()` (run by the expire-pending-orders sweep) — never at order time.
* **Rules** (modelled on Myntra / Nykaa / Amazon: pay after delivery + return window; a little tighter for a small shop).
  Adjustable without a deploy in `site_settings`: `referral_bonus_points` 100 · `referral_min_order` ₹499 · `referral_hold_days` 7 ·
  `referral_max_per_month` 3 · `referral_max_lifetime` 10 · `referral_expiry_days` 90. Fixed rules: new customers only (no order
  yet) · not your own code · one referrer per customer forever · not the referrer's phone / e-mail / delivery address · one delivery
  address can be rewarded once · returned / refunded / cancelled orders never pay · when the referrer's cap is reached the friend is
  still paid.
* **Verified:** nine scenarios run against the production database inside a rolled-back transaction (qualifying, inside return
  window, below minimum, returned, same address as referrer, address already rewarded, cap reached, idempotent re-run, attach
  checks). Nothing was left behind (0 referrals, 0 test customers). Tests: `referral.lib`, `referralRoute`,
  `ReferralCapture`.
* **Note:** rewards are released by a non-fatal step inside the existing `expire-pending-orders` sweep (daily Vercel cron, plus the
  self-sweep when orders are placed) because the Hobby plan allows only two crons. Release can lag by a little, never run early.
### 5.4 ACC-051 — return photos moved to a private bucket (fixed, `db_migration_v18_private_return_evidence_bucket.sql`)

* **Was:** return-evidence photos went into the shared **public** `pahadi-images` bucket (100 MB, video/PDF allowed), whose
  `storage.objects` policies also let anyone list every file name. A customer's damaged-item photo was readable by anyone who could
  guess or enumerate the path.
* **Now:** new **private** `return-evidence` bucket (no storage policy → service role only; 5 MB; JPEG/PNG/WebP, enforced by the
  bucket itself). The browser uploads to a signed URL, then sends the object **path** (not a URL) with the return; the API accepts only
  `returns/<this order>/…` paths, signs a 1-year read link for each (signing also proves the object exists) and stores that link in
  `returns.photo_urls`.
* **No admin-app change needed:** the admin panel renders `photo_urls` as plain links; a signed link works there unchanged. After a
  year (or if the admin wants permanent access) a fresh link can be signed server-side for the stored path.
* **Verified:** as an anonymous caller, `list` on the new bucket returns `[]`, `/object/public/…` returns 400 and an upload returns 403
  (the public bucket still lists). No return photos existed before (0 objects, 0 returns with photos), so nothing was migrated.
* **Also:** WhatsApp "share your request" no longer pastes photo URLs (it says how many photos are attached); thumbnails are local
  previews. Tests: `returnEvidence.test.ts`, SF-3 in `auditR2Storefront.test.ts`.

### 5.5 Production verification after the follow-up releases (2 Nov 2026)

* **Wishlist (ACC-052) on production:** server list `[11,28]`, empty local wishlist, home page only → **0 `PUT` requests**, list unchanged.
* **Referral on production (real browser):** `?ref=` visit as a guest remembered the code and sent nothing; after sign-in exactly one
  `POST /api/v1/referral` → `applied:true`; DB shows `referrals` row `pending` and `customers.referred_by` set; the code was forgotten
  and a second page view sent nothing. (Paying out needs a delivered order ≥ ₹499 + 7 days; that part is covered by the nine
  rolled-back database scenarios in 5.3, not run on production.)
* **Browsers** (production, real UI login + Addresses tab + pincode autofill + bad-pincode refusal + no horizontal overflow):
  WebKit desktop (Safari engine), WebKit iPhone 13 (iOS Safari engine), Chromium Pixel 7 (Android Chrome) and Firefox 155 all pass.
  These are engine / device emulations on Linux, **not** physical iPhones or Android phones. The only console noise is an in-flight
  profile prefetch aborted by the full page reload that follows login (harmless; WebKit words it "access control checks").
* **E-mail content** (production-rendered messages kept in `failed_emails`; the Gmail connector needed re-authentication, so no real
  inbox could be read): confirmation, cancellation and sign-up verification have no unresolved placeholders and correct links.
  **Finding:** the cancellation e-mail was an unstyled paragraph (no brand, no footer, no support contact) → now uses the shared brand
  frame (`lib/server/emailShell.ts`). DNS: DKIM (`resend._domainkey`) and SPF / bounce MX on `send.pahadiroots.com` exist and DMARC is
  `p=reject` with relaxed alignment, which the aligned DKIM signature satisfies. Every failed send in the table was Resend refusing
  the `example.com` test addresses — not a production fault.
* **Test data created by this pass** (delete before launch with the rest): auth user + customer `audit.f.20261102@example.com`
  (customer 71) and its `referrals` row.

### 5.6 Order e-mail showed ₹266.67 for the item but ₹267 as Subtotal (found in a real inbox screenshot)

* The confirmation printed the whole-rupee rounded figure as "Subtotal" and never showed the rounding (`orders.round_off = 0.33`), so the
  rows did not add up on the page. Now: Subtotal = sum of the item lines, an explicit "Round off +₹0.33" row when rounding is the only
  difference to the total, and every amount formatted with the same rules (`lib/emailMoney.ts`). A gap of ₹1 or more (e.g. redeemed coins,
  which this e-mail does not itemise) is not shown as rounding; the stored subtotal is used instead.
* The same screenshot confirmed delivery to the **Inbox** (not Spam) from `HimVeda by Pahadi Roots <noreply@pahadiroots.com>` with the
  branded layout, coins line, delivery window, address and WhatsApp footer.
