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
* **CART-001 GST after coupon** — `gstTotal` is computed on pre-coupon line prices and stored as the order tax. Whether the coupon reduces taxable value is a tax decision for the CA; changing it alters accounting. Decide, then change `calcPriceSummary` AND the invoice together.
* **COD preselected / COD WhatsApp popup** — business experiments, not defects.
* Cart-nav `aria-label` "Open cart, N items" (label-in-name) — focus-return code selects `button[aria-label^="Open cart"]`; needs a coordinated change.
* Supabase dashboard-only: enable leaked-password protection; move `vector` extension out of `public` (needs a dependency check first).
