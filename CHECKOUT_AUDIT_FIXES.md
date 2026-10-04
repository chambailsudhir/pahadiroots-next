# Checkout audit fixes — P1–P3, CF1/CF2, I1–I3, C1, S1/S2

Drop the files in this zip over the repo (paths are repo-relative). Nothing is deleted.

## Deploy checklist
1. **Env**: `CRON_SECRET` must be set (the expiry cron fails closed without it). `RAZORPAY_KEY_ID/SECRET` already required.
2. **Cron**: `vercel.json` now has a `crons` entry running `/api/v1/cron/expire-pending-orders` every 10 min.
   Vercel **Hobby** rejects sub-daily crons — change the schedule to daily, or call the endpoint from an
   external scheduler with `Authorization: Bearer $CRON_SECRET`.
3. **Optional setting**: `pending_order_expiry_minutes` (site settings). Default 30, clamped to 20–1440.
4. **No SQL migration required.**
5. Razorpay account is assumed to **auto-capture**. If it does not, verify_payment returns 202 (handled: customer
   lands on the order page, which polls) until capture.

## What changed
- P1  verify_payment binds the payment to THIS order (stored `order_…` id, captured, INR, exact amount, fetched from
      Razorpay). /api/v1/orders is COD-only. Timing-safe signature compares (also fixes P6).
- P2  payment.failed only records the attempt. Shared `confirmOrderPayment` handles pending *and* failed orders
      (recovery re-reserves stock; never silently drops a paid order). Webhook returns 500 on processing failure (P4).
      Whoever wins the paid transition runs loyalty + e-mail (fixes O2).
- P3  A reused idempotency key must match the stored order (items, method, coins, status) else 409
      `IDEMPOTENCY_CONFLICT`. Client mints a new key when cart/price/method/coupon/coins change; a dismissed modal keeps it.
- CF1/CF2  /order-success only claims what the lookup API verified; purchase analytics fire once, for a verified
      confirmed order, with the server total. (CF3 label fix included.)
- I1  Expiry sweep releases abandoned online orders (asks Razorpay first; never releases on uncertainty).
- I2  order_items.variant_id stored exactly as reserved → restores always hit the right table.
- I3  A no-variant line for a product that has active variants is rejected; variants must belong to the named product.
      Product/variant ids restricted to `[A-Za-z0-9_-]` (PS1).
- C1  `/api/v1/cart/validate` + client revalidation on cart/checkout load and before payment.
- S1/S2  One `CheckoutStepper` (state derived from `current`) on cart, checkout and confirmation.
- Also: `restoreStock` no longer swallows RPC `{error}` results (silent stock leak).

## Known follow-ups (not in this change)
- Coupon use is not released when a pending order expires.
- Orders created before the I2 fix may have a product/variant mismatch; not repairable automatically.
- `retry-failed-emails` cron is documented as scheduled but is NOT in vercel.json (left alone on purpose).
- Verify `order_items.variant_id` accepts a product id for true no-variant products (live ids are BIGINT).
