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
* `ORD-2026-00108` (Razorpay, ₹499, created 25 Aug): `order_status=confirmed` but `payment_status=pending`. Check it in the Razorpay dashboard.
* Three ₹2 COD orders were placed today on the "Test" product — one 6 seconds *after* it was switched off in admin, which is exactly the `is_active` bug fixed here.
* `failed_emails`: rows are QA addresses at `example.com` (Resend rejects them). A permanently-invalid recipient is retried like a transient failure until the attempt cap — harmless, but noisy.

## Still unverified (cannot be done safely on production)
Declined / cancelled / UPI-pending payments, a deliberately duplicated webhook, and the e-mail rendering have not been *run* — they were read line by line and are covered by unit tests (`webhookRazorpay`, `paymentOrderRoutes`, `recordCapturedPayment`, `idempotencyReuse`, …). Run them in `pahadiroots-test` with Razorpay test keys.
