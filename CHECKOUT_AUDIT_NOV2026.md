# Checkout audit — 2 Nov 2026 (fixes in this branch)

| ID | Fix |
|---|---|
| CHK-001 | `lib/pinState.ts`: PIN must be 6 digits starting 1–8 and consistent with the chosen state (lenient at borders). Enforced server-side in `addressSchema` (COD + Razorpay share it) and in the checkout form / `useCheckoutPage`. Account address validator tightened to the same first-digit rule. |
| SEC-001 | `products.is_active=false` was ignored everywhere (storefront, sitemap, merchant feed, cart validation, createOrder, inventory). All now honour it (NULL = active). Production "Test" product archived (see `db_migration_v15…sql`). |
| CONF-001 | Order-success: removed the dead (handler-less) newsletter form; unverified-order copy no longer assumes an email was given. |
| ACC-001 | Variant buttons: accessible name now contains the visible text (WCAG 2.5.3); review-carousel dots are real 24×24 targets (2.5.8); contrast raised on struck MRP, prefill status, track page. |
| INT-001 | AI assistant hidden on /checkout and /payment (client-route aware); WhatsApp support button stays. |
| CART-002 | Coupon banner says "orders of ₹N or more" (the rule is subtotal ≥ min). |
| Misc | `/track-order` → `/track` redirect; track placeholder no longer shows an outdated year; privacy policy + checkout note disclose unfinished-checkout capture (PRIV-001 — legal wording needs counsel review). |

## Deliberately NOT changed
* **WhatsApp popup after a COD order** — left as is (owner: no change). It is a supplementary `wa.me` link opened after the order is already saved; browsers may block it, which is harmless.
* **Supabase dashboard-only items** (leaked-password protection, moving the `vector` extension) — free plan / needs a dependency check; left.
* No WhatsApp/SMS sender exists in the code. Customers with no e-mail address get only the on-screen confirmation page. E-mail stays optional at checkout (owner call).

## Found while reading production data (ops, not code)
* `ORD-2026-00108` (Razorpay order `order_TU5IDJReKvroM1`, ₹499, 25 Aug): `confirmed` but payment `pending`; no `payments` row, no payment event, and **no webhook for that Razorpay order id was ever logged** — so nothing in our data shows it was paid. It was moved pending→confirmed 11 minutes after creation by something other than the verify/webhook path. Confirm in the Razorpay dashboard before shipping or cancelling.
* Three ₹2 COD orders were placed today on the "Test" product (test customer) — one 6 seconds *after* it was switched off in admin, which is exactly the `is_active` bug fixed here. `…00140` and `…00141` were still open and were cancelled through the normal status change (stock/journal triggers ran); `…00142` was already cancelled.
* `failed_emails`: rows are QA addresses at `example.com` (Resend rejects them). A permanently-invalid recipient is retried like a transient failure until the attempt cap — harmless, but noisy.

## Still unverified (cannot be done safely on production)
Declined / cancelled / UPI-pending payments, a deliberately duplicated webhook, and the e-mail rendering have not been *run* — they were read line by line and are covered by unit tests (`webhookRazorpay`, `paymentOrderRoutes`, `recordCapturedPayment`, `idempotencyReuse`, …). Run them in `pahadiroots-test` with Razorpay test keys.

## GST on coupons and coins — what was checked, what is decided
Public sources only (no access to Amazon / Myntra / BigBasket's own systems), so treat this as the common marketplace layout, not a certified opinion.
* **Seller coupon / prepaid discount → reduces taxable value.** CGST s.15(3)(a): a discount given at or before supply and shown on the invoice is excluded from the value of supply. Sample Amazon and Myntra invoices follow gross → discount → *taxable value* → tax on the net.
* **Loyalty coins / wallet / credit / vouchers → payment, not a discount.** Redeemed coins are consideration for the supply, so GST stays on the full value (the Karnataka High Court treated vouchers as money-like instruments; wallet balances work the same way). This is what the code already did.
* **New:** the invoice now prints the **Taxable value (after discounts)** line (`computeOrderInvoice().taxableValue`: subtotal − coupon − prepaid − tax), on the order page, the account order page and the printable invoice. It is not stated when coins were redeemed but their value is unknown.
* Orders placed before the 2 Nov change had GST computed on the pre-coupon value; their stored tax is shown as-is (never re-derived), so for those few coupon orders the taxable line is "payable goods − stored tax".
* Shipping (free today) and the COD fee are not part of this taxable line. Your CA should still confirm the above before the next GST return.

## One-time coupons: one person / one address, one time only (reported by the owner, 2 Nov)
**Symptom:** the cart showed `WELCOME50 — saving ₹50` for a customer who had already used it.
**Findings**
1. The cart page's coupon check receives only the cart total, so it cannot know who is shopping; the "already used" rule only ran later.
2. **A guest could re-use a one-time coupon indefinitely.** A guest's use is stored in `coupon_usage` with `customer_id` NULL (a typed phone number is not proof of identity — audit S1-002), and the guest check looked for rows *by customer_id*, so it could never find an earlier guest use. Only signed-in accounts were really limited.
3. The **delivery address** was never compared at all.
(`WELCOME50` is `user_limit = 1`; its single recorded use is a cancelled COD order from Sep. The old `MYPAHADI` repeats are all from 6 Mar, before the per-customer limit existed.)

**Fix** (`lib/couponHistory.ts`, `lib/addressMatch.ts`)
* A coupon with a per-customer limit counts as used when an earlier use belongs to the **same person** (verified account, or any customer row sharing the phone/e-mail) **or** the **same address** (same PIN code + an address line that reads as the same place). History is rebuilt from the **order** behind each use, so it works for guests.
* `createOrder` (authoritative) refuses with "You have already used this coupon" / "This coupon has already been used for this delivery address"; it **fails closed** if the history cannot be read. `first_order_only` coupons also refuse a household that already ordered. The atomic per-account check in `claim_coupon_use` is unchanged.
* The coupon pre-check (`/api/v1/coupons`) now identifies the signed-in customer from the session (read-only), so the **cart page refuses it up front for logged-in customers**. For a guest nothing is known on the cart, so checkout re-checks as soon as a valid mobile and address are entered (debounced), and the cart banner says "One-time offer per customer and delivery address — confirmed at checkout." A rate limit or server error no longer strips a valid coupon.
* Address matching tolerates re-typing ("12 Main Rd" = "Flat No. 12, Main Road") but not a different house/flat number, so neighbours are not blocked; it is a deterrent, not an identity check.

**Known limits:** someone can still use a genuinely different delivery address *and* a different phone/e-mail; a guest race (two simultaneous checkouts) is not atomic (the per-account RPC is). A DB-level fix (record guest identity in `claim_coupon_use`) would close the race — owner decision.
