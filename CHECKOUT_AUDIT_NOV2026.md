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
