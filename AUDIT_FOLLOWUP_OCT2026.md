# Audit follow up, October 2026

Second pass over the storefront after `CHECKOUT_AUDIT_FIXES.md`, checked against the **live
database**, not just the code. Pairs with the admin repo's `AUDIT_FOLLOWUP_OCT2026.md` and the
migrations `050` to `053` in `pahadi-admin/supabase/migrations`.

## Fixed

| # | Problem | Fix |
|---|---------|-----|
| 1 | **Product 1 (Manali Honey) could not be bought.** Variant and product ids are separate sequences, and product 1 owns a variant whose id is also 1. The code read `variantId === productId` as "this product has no variants", so the I3 pre flight rejected the honey on every attempt, and its stock was reserved / restored against the wrong table. | `src/lib/lineKinds.ts` decides from the database whether a line is a real variant, a bare product, or a stale foreign variant. The kind is passed explicitly through `createOrder`, `inventoryService` and `cartValidation`. Rows rebuilt from `order_items` are always variants (the column is a NOT NULL foreign key). |
| 2 | **A paid order could die.** `create_payment` ignored the result of saving the Razorpay order id. If that write failed, verify rejected the payment, the webhook held it, and the expiry sweep released the order. | `storeRazorpayOrderId()` retries once, then fails before the customer can pay. The misleading "webhook recovers this" comment is corrected. |
| 3 | Webhook treated a database read error as "unknown order", returned 200, and Razorpay never retried. | Only PostgREST `PGRST116` (no rows) is final; any other error returns 500 so Razorpay retries. |
| 4 | Expiry sweep handled one page of 50 orders per run (a hard daily cap on a daily cron). | Pages through every stale order within a 22 s budget, oldest first. |
| 5 | An expired unpaid order kept its coupon consumed, so the customer's retry failed with "already used". | Sweep calls `release_coupon_for_order` (migration 053). What was released is recorded on the event. |
| 6 | Review count and average came from only the latest 10 reviews (page and JSON LD). | `computeReviewStats()` over all approved ratings; the list stays at 10. |
| 7 | `/new-arrivals?category=<valid category with no new arrivals>` silently showed everything. Copy said "restocked" though restocks are not considered. | Category resolved against all categories; copy corrected. |
| 8 | Wishlist pages were blank / an empty grid when every saved product was removed. | Explanatory message with a way forward. |
| 9 | `.env.example` was missing, and `SETUP.md` omitted the server side `RAZORPAY_KEY_ID`. | `.env.example` generated from the real `process.env` reads; `SETUP.md` fixed. |
| 10 | `retry-failed-emails` cron said it was scheduled but was not. | Added to `vercel.json` (daily); `vercelCrons.test.ts` keeps routes and schedule in sync. |

## Known and left alone on purpose

* A released coupon is not automatically re applied if a payment lands after expiry (rare). The
  `pending_order_expired` event stores the released coupon so ops can reinstate it.
* The sweep is daily (Vercel Hobby). An abandoned order can hold stock for up to about a day.
* A genuinely variant less product cannot be persisted: `order_items.variant_id` is a NOT NULL
  foreign key. No live product lacks variants.
* Dead settings keys `reviews_enabled`, `show_blog_section`, `show_newsletter_bar`,
  `new_arrivals_enabled`, `catalogue_visible` exist in `site_settings` but nothing reads them.
* `product(s).initial_stock` stays publicly readable; the product page urgency bar uses it.

## Verification

`tsc` clean, ESLint 0 errors (6 existing warnings), 1581 tests passing. `next build` could not be
run in the sandbox (no access to Google Fonts); run it before deploying.
