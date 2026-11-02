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
