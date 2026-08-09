# Return/Replace Feature — Completed + Bugs Fixed

## ⚠️ First: the uploaded zip did NOT contain the in-progress work

I checked every file the session summary said was already edited
(`api/orders/route.ts`, `orderService.ts`, `account/constants.ts`,
`api/orders/[id]/return/route.ts`) against the actual zip contents.
**None of the claimed changes were present.** This zip predates that work —
either an older zip got uploaded, or the edits never made it to a saved file.

Good news: the "wrong edit" to `types/index.ts` the summary warned about
wasn't there either, so there was nothing to revert. I rebuilt the feature
from scratch below, cross-checked directly against `pahadi-admin`'s real
code (not just the summary's description of it).

## Files changed (9)

1. `src/lib/account/constants.ts`
2. `src/lib/services/orderService.ts`
3. `src/app/api/orders/route.ts`
4. `src/app/api/orders/[id]/return/route.ts`
5. `src/app/account/_sections/OrdersSection.tsx`
6. `src/app/account/_components/OrderCard.tsx`
7. `src/app/account/orders/[id]/page.tsx`
8. `src/app/account/hooks/useOrders.ts`
9. `src/app/account/styles/account.module.css`

All 9 syntax-checked clean with `esbuild`.

## What was built

- Customer picks which item (when order has >1 item), a return reason, and
  — for qualifying reasons only (damaged, wrong item, not as described,
  missing parts) — Refund or Replace.
- Server re-validates everything: the item actually belongs to that order
  (checked against `order_items`, not trusted from the client), and
  `resolution: 'replace'` is only accepted for the same 4 reason codes
  admin's own `canReplace()` allows (mirrors the DB's
  `returns_replace_reason_check` constraint from migration 041).
- `returns` table has **no `order_item_id` column** — confirmed against
  admin's actual insert code — so ownership is matched on
  `variant_id`/`product_id` instead.

## Bugs found and fixed along the way (not in the original plan)

1. **Idempotency check blocked returns forever after a refund.** Existed
   before this session's work — `status !== 'rejected'` treated a
   completed, *successful* refund as "still in progress," permanently
   blocking any future return on that item. Admin's own duplicate-check
   excludes both `'refunded'` and `'rejected'`; matched that.
2. **Same bug, worse, on the client.** `canReturn()` in `useOrders.ts` hid
   the Return button for the *entire order forever* after one refund —
   because `_displayStatus` intentionally stays `'return_refunded'`
   permanently as a historical record, and the button's gate was checking
   that instead of the order's actual fulfillment status. Fixed by gating
   on `order_status` directly.
3. **`'replaced'` status was invisible to the storefront.** Admin has
   supported a `'replaced'` terminal return status since migration 041, but
   none of the storefront's status maps (`BADGE_CLASS`, `STATUS_LABEL`,
   `STRIPE_CLASS`, `RETURN_STATUS_TO_DISPLAY`, `OrderCard.tsx`'s lookups)
   had a matching entry. A replacement order would have shown "Delivered"
   with no indication a replacement was ever issued.
4. **Idempotency check wasn't scoped per item**, which would have blocked
   multi-item orders from having independent returns on different items —
   caught before it could ship, since it's new code from this session.
5. Stale header comment said "7-day window"; code enforces 48 hours
   (`RETURNABLE_WINDOW_HOURS`) — corrected.

## Not done in this pass — needs your Supabase connection

I don't have DB access connected yet, so I couldn't verify:
- Migrations 019–043 are actually live in the deployed DB
- The ~32% COD reconciliation gap mentioned in the summary
- GST testing (pending item #1 in the summary)
- Whether `returns.replacement_variant_id`/`replacement_quantity` and the
  `returns_replace_reason_check` constraint actually exist as described

Connect Supabase (I surfaced the connector earlier) and I can verify/fix
these directly against the live schema instead of relying on code
inspection alone.
