# Payments + Reconciliation Fix — Summary

## Code file (goes to `pahadiroots-next-main`, main site)

```
pahadiroots-next-main/
└── src/app/api/v1/payments/route.ts
```

**What changed:** `verify_payment` (the route that confirms an order right
after Razorpay checkout — the primary, fast confirmation path) now inserts
a row into `payments` on success. Previously only the async webhook did
this, and its `order_status = 'pending'` guard almost never passed because
`verify_payment` already flips that status moments earlier. Net effect:
`payments` was structurally empty regardless of real order volume —
confirmed live: 0 rows before this fix.

## DB migrations applied (tracked, with full audit trail)

| # | What |
|---|------|
| 044 | Backfilled 4 historical online-order `payments` rows (pre-dated the code fix above). Used a labeled synthetic reference (`BACKFILL-<order_number>`) instead of a misleading raw value, since 3 of the 4 had a Razorpay *order* ID stored where a *payment* ID should be. Full audit trail in `order_events`. |
| 045 | Backfilled a 5th missed order (its `payment_status` had changed to `'refunded'` so it didn't match migration 044's filter). Also fixed `validate_waterfall()` to include shipping charges and loyalty-point redemptions in expected revenue — both were silently excluded before. |
| 046 | Fixed an asymmetric refund calculation in `validate_waterfall()` — refunds were subtracted from expected revenue but never from captured amount, comparing net vs. gross. |
| 047 | Fixed a timing-mismatch bug: captured money was matched to the reconciliation window by payment/settlement date, while expected revenue was matched by order-creation date — two different timestamps that can be days apart. Now both sides are scoped to the exact same set of orders via a join, for any window size. |

## Verified result (live, after all 4 migrations)

| Window | Match |
|---|---|
| 7-day | 93.75% (one known test-data anomaly on a small base) |
| 30-day | 99.8% ✅ |
| 90-day (function default) | 99.87% ✅ |
| 365-day | Fails — pre-dates real launch; full of ₹1 test transactions and round-number seed orders from the site's first days, not a code issue |

## Not touched — flagged for your call, not guessed at

- **Legacy test/seed orders** (₹1 Razorpay test transactions, `payment_method=NULL` round-number orders from March) — these make any full-history reconciliation fail, but they're not real transactions, so no formula fix addresses them. Recommend marking them `is_deleted` once you're done using them for testing.
- **Order `ORD-2026-00094` and `ORDMRVZILJW4803`** — their `total_amount` doesn't match their own item/shipping/loyalty math by ₹50 and ₹10.67 respectively. Small, isolated, likely test-data artifacts — flagged rather than silently corrected.
