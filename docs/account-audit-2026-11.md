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

## 6. Line-by-line audit of the account area (scope A) — 2 Nov 2026, evening

Six read-only reviewers each read their slice of the code **in full** (auth & session · profile / addresses / privacy · orders / cancel /
returns / tracking · wishlist / coins / referral / pincode · account-page frontend · database security). Findings below are what they
reported; **only the ones marked "verified" were reproduced or re-read by me**. No row of real customer data was read.

### 6.1 Fixed in this PR — ACC-060 (verified on production before the fix)
`POST /api/auth {action:'email_signup', email:<an existing customer>}` returned that customer's **profile** (name, phone, address,
pincode, loyalty coins, wishlist) to an **anonymous** caller. Cause: the sign-up route synced the throw-away user Supabase returns for an
existing address, and `syncCustomerProfile` adopted any customer row with a matching e-mail (with a "first row" fallback). Reproduced with
the test account `audit.a…@example.com`. (The attempt to re-point the row at the fake id was stopped by the `customers_auth_user_id_fkey`
foreign key — no record was damaged.)
* Sign-up (both paths) no longer reads, creates or returns a customer row unless Supabase returned a **session**; the answer is the same
  `{success, verification_sent}` for every address.
* `syncCustomerProfile` adopts an e-mail-matched row only for a **confirmed** e-mail, never from another live auth user, exact
  (case-insensitive) match only, no `rows[0]` fallback.
* Tests: `authRoute.signupNoProfileLeak`, extended `syncCustomerProfilePhoneMergeLeak.security`, updated `authRoute.signupMailFallback`.

### 6.2 Reported and NOT yet fixed (by area; "verified" = I reproduced or re-read it)
* **Guest checkout attaches the order to an existing customer with the same phone** (orders reviewer: *high*; **verified** by my own test
  order, which reused customer 72 and its stale e-mail). The order shows in that customer's account, can use up their COD quota, and the
  confirmation page returns their name.
* **Login CSRF / session fixation** through `/auth/google-callback#access_token=…` (auth reviewer: *high*, code-read, not reproduced).
* **COD coin redemption race** — parallel orders can reuse the same coins; a failed post-commit deduction keeps the discount
  (loyalty reviewer: *high*, code-read).
* **Frontend:** saving an address on the Addresses tab does not update the list and the next save overwrites it; the Coins tab shows a
  skeleton forever on the second visit (frontend reviewer: *high*, code-read).
* ~15 *medium* items (wishlist leaks to the next user on a shared device, referral controls bypassable with a "shell" referrer, reset
  password without recovery proof, per-account rate limits that let a stranger lock a victim out, account deletion keeps data in
  reviews / returns / subscribers and wipes the address of in-flight orders, default grants in `public` for new tables, `site_settings`
  public-read is a deny-list, `subscribers` insert open to any signed-in customer, …) and ~45 *low* items (accessibility contrast on
  states the earlier scan did not reach, focus traps, error handling, missing constraints, polish).
* Database layer: **no critical or high** finding — RLS is on for all 104 tables, no money / points / stock function is callable by
  anon or authenticated.

## 7. Proof of phone ownership via WhatsApp (feature-flagged, ships OFF)

Problem (section 6): a customer could save any mobile number with no proof, and `customers.normalized_phone` is UNIQUE, so a squatter blocks the real owner. SMS OTP is unavailable at zero cost (TRAI/DLT), so ownership is proven with an **inbound** WhatsApp message instead; receiving user-initiated messages through the WhatsApp Cloud API is free and we never reply.

* **Flow:** `POST /api/v1/phone-verify/start {phone}` stores an HMAC of a 6-digit code (10 min, one open code per customer, 5 starts/hour) and returns a `wa.me/<shop number>?text=VERIFY <code>` link. The customer sends it; Meta calls `/api/webhooks/whatsapp`; after the `X-Hub-Signature-256` check the sender number (`91` + 10 digits) and the code must both match an open verification, which is consumed atomically and passed to `claim_verified_phone()`. `GET /api/v1/phone-verify/status` is polled by the account page; `GET /api/v1/phone-verify/enabled` tells the UI whether to show the button.
* **Squatters:** `claim_verified_phone` (db_migration_v25) gives the number to the proven owner and sets `phone = NULL` on any other REGISTERED, UNVERIFIED row holding it. It never touches a verified holder, and never a guest row (guest rows keep their phone so guest orders stay trackable); if a guest row holds the number the claim is refused (`phone_in_use`) and needs a manual merge.
* **Hygiene:** changing or clearing the phone in `/api/profile` clears `phone_verified_at` (and a DB trigger does the same for any other writer). `toPublicProfile` exposes only the boolean `phone_verified`.
* **Flag:** ON only if `WHATSAPP_VERIFY_NUMBER`, `WHATSAPP_APP_SECRET` and `WHATSAPP_VERIFY_TOKEN` are all set AND `site_settings.phone_verification_enabled` is not `false`. Otherwise the UI is hidden and start/status/webhook answer 404.
* **Still open:** verified numbers are not yet *required* for anything (referral, COD limits, order attach); merging guest rows into the proven owner; a nightly cleanup of old `phone_verifications` rows.

---

## 6. Verified-purchase product reviews + review-request e-mail (`db_migration_v23_reviews_verified_purchase.sql`)

**What was built** (modelled on Amazon / Flipkart / Myntra / Nykaa): a review can only be written by the customer who *received* the
product, is tied to the customer and the order ("Verified purchase"), is requested by e-mail a few days after delivery, and is moderated
before it shows.

* `submit_review` (`POST /api/v1/actions`) now takes `{product_id, order_id, rating, comment}`. The customer comes from the session
  (`syncCustomerProfile`), never the body; the order must be theirs, `delivered`, and contain the product (`order_items`); a second review
  of the same product by the same customer is `409 already_reviewed` (also enforced by a unique partial index). Rating is an integer 1-5,
  the comment is tag-stripped, trimmed and capped at 1000 characters, the public name is built server-side (`Priya S.`), the rate limit is
  shared per customer (20/hour), status stays `pending`. Response shape unchanged (`{success, message}`).
* `GET /api/v1/reviews/eligible?order_id=` (owner-scoped) lists an order's products with `already_reviewed`.
* Customer UI: **Rate & review** on a delivered order -> `/account/orders/[id]/review` (star radio group, optional text with counter).
* E-mail: `sendReviewRequests` (`lib/server/reviewRequests.ts`) runs as a non-fatal step of the existing `expire-pending-orders` cron
  (response gains `reviewRequests`, the number sent). Registered customers only, e-mail present, `notif_email_orders` not false, delivered
  between 60 days ago and `review_request_days` ago, at least one product not yet reviewed, 20 per run. Each order is claimed in
  `review_requests` *before* sending (single winner); a send that fails with no retry queued releases the claim.
* "Verified purchase" badge on the product page and homepage only when the row has `is_verified_purchase === true`. The flag is read by a
  separate best-effort query, so the pages keep working before the migration is applied; legacy reviews never show it.
* Erasure: deleting an account sets the customer's reviews to `Anonymous customer` and unlinks `customer_id` / `order_id`; rating and text
  stay (as on the big marketplaces). The step is skipped silently if the columns do not exist yet.

**Settings** (`site_settings`, inserted by the migration with `ON CONFLICT DO NOTHING`): `review_request_enabled` (`true`; set `false` to stop
the e-mails) and `review_request_days` (`7`, accepted 1-30).

**Owner's moderation flow:** a new review arrives with `status = 'pending'` (not visible anywhere). In the admin app's Reviews screen
approve it (`status = 'approved'`) - the product page and homepage pick it up (homepage cache is 5 minutes / `reviews` tag); reject or delete
otherwise. Nothing in the storefront approves a review automatically.

**Applying the migration:** column/table assumptions come from the repo, not the live schema - first confirm `reviews`, `customers.id`,
`orders.id` (bigint) and `site_settings(key, value)` on the live database, then run the file in the Supabase SQL editor (it is one
transaction and idempotent). Apply it *before* deploying: until then `submit_review` answers 503 and the cron's review step logs an alert.

## 7. Bug hunt round 2 (3 Nov 2026) — black-box findings

* **Per-user API answers were cacheable by shared caches.** A header probe with a logged-in test user showed `/api/v1/loyalty` and
  `/api/v1/loyalty/history` (coin balance, referral code, full ledger) answering `Cache-Control: public, max-age=0, must-revalidate`
  (Next's default), and the same for every 401/405 of routes that answer through the shared `ok()` / `fail()` helpers. `public` lets a
  CDN or corporate proxy store them. Now the shared helpers (and the auth route's own helpers, and `/api/auth/session`) answer
  `private, no-store`; routes that are genuinely public build their own response and keep their own headers.
  Verified as already correct: `/api/profile`, `/api/orders*`, `/api/wishlist` (no-store), guest lookup / track (private, no-store).
* **`/api/v1/search-catalog` exposes internal catalogue columns** to anyone (`initial_stock`, `available_stock`, `sku_backup`,
  `hsn_code_id`, `state_id`, `sort_order`, …). No cost price or vendor data (checked the variant keys). Low severity; tracked.
* Cross-customer order access re-checked with another customer's ids: 404. CORS: no `Access-Control-Allow-Origin` on any route.
## 8. Deep bug hunt, round 2 (five read-only audits, findings verified in code before fixing)

**Fixed in this round (PR `fix/auth-round2`)**
- Password-reset e-mail: `redirect_to` was sent inside `options` (GoTrue ignores it) — now top level; `/reset-password` exempt from the maintenance gate.
- Logout now `scope=local` (logging out of one device no longer signs the customer out everywhere).
- Customer lookup is case-insensitive (guest checkout stores `Priya@Gmail.com`, GoTrue lowercases), value quoted; first-login insert race re-reads the winner's row instead of returning "profile not found".
- Returns: the replacement window check now runs AFTER the item is resolved from the DB (client `variant_id` could borrow another item's extended window) and refuses while the replacement is still in transit (negative elapsed time passed the `> 48 h` test); photo upload honours the replacement window and counts photos only on OPEN returns.
- Account deletion is refused while a return / replacement / refund is open (orders stay `delivered` while returns live in their own table).
- `/checkout` no longer serialises admin-only settings; `/policies/constructor` etc. 404; a blog DB blip no longer caches a 404 for a live article; ZWJ/ZWNJ allowed in names (Indic scripts); sold-out related card no longer adds a zero-quantity cart line.

**Verified/confirmed but NOT fixed here (need a design decision, live DB access or owner action)**
- Money path: Razorpay webhook side effects not re-drivable if the function is killed (10 s maxDuration); order abandoned in Razorpay modal holds coupon/coins/stock until the sweep; late payment after expiry recovers an order without re-claiming coupon/coins and no `expire_by` on the Razorpay order; `alreadyExists` retries skip coins/e-mail; COD has no per-IP/phone-verification abuse guard; stock decrement outside the create-order transaction; first-order-only coupon race; GST on COD fee/shipping and per-line rounding (CA decision). Needs `create_order_with_items` / `redeem_loyalty_points` / `release_coupon_for_order` source from the live DB.
- Auth: refresh-token cookies dropped on error paths (17 routes), account lockout design (stranger lockout), sign-up verification link never consumed, store user-id flip (auth uuid vs customers.id), CGNAT/IPv6 rate-limit buckets, strict-CSP scope.
- Platform: proxy per-navigation DB reads (no single-flight/failure TTL), `revalidate` invalidation too wide with `expire: 0`, listing pages dynamic (searchParams), YouTube iframe blocked by CSP `frame-src`, public search-catalog / RelatedCard blocklist instead of allow-list.
- Phone verification: claim outcome not shown to the customer, feature flag fails open on read error, `/status` polling unthrottled.

### 8.1 Follow-ups shipped after round 2
- Refresh-token cookies are queued by `tryRefresh` itself, so error responses also carry them (verified on production: a 400 response set both cookies).
- Razorpay webhook: 30 s budget, INR-only captures, and a retry re-drives the paid side effects when the `payment_verified` marker is missing (loyalty RPCs verified idempotent per order in the live DB).
- Failed-login lockout is per (account + network) with a 100/15 min per-account backstop; IPv6 collapses to /64 (`clientIpKey`).
- Account sidebar scrolls inside itself (verified on production at 1366x650).
- A signed-in customer's own abandoned online order (modal closed, then new key) is released before the new order's coupon / coin / stock checks (`releaseOwnAbandonedOnlineOrders`; Razorpay is asked first, so paid or in-flight orders are never released). Guests are not covered (no customer id before the order is created) — they still wait for the sweep.

### 8.2 Vercel Hobby usage (Nov 2026: deployment storage 9.15/10 GB, ISR writes 161K/200K, active CPU 2h39/4h)
- Preview deployments disabled on the project (every PR branch push used to build and store a preview); `ignoreCommand` in vercel.json / vercel.pro.json skips production builds for docs-, tests- and workflow-only commits.
- ISR windows: root layout 300 -> 1800 s (inherited by every page without its own export), `/regions` 60 -> 600 s, homepage 300 -> 900 s. Admin saves, sold-out / restock events still invalidate on demand.
- Proxy `store_open` / CSP-settings reads are single-flight with a 5 s failure TTL (less CPU per navigation).
- Owner action: Vercel dashboard -> Settings -> Deployment Retention (set e.g. 30 days for production, 7 for the rest) to free the existing ~9 GB; batch merges where possible, since every production merge is one more stored deployment.
