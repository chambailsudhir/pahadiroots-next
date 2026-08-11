# Three Bugs: Product Names, Photo Upload Error, Photo Storage/WhatsApp

## Files changed (2, both `pahadiroots-next-main`)

```
pahadiroots-next-main/
├── src/app/api/orders/route.ts
└── src/app/api/orders/[id]/return/upload-url/route.ts
```

## Issue 1 — "Product × 1" instead of real names

**Root cause, confirmed with certainty (checked the actual DB function
source, not guessed):** the order-creation database function
(`create_order_with_items`) never wrote `product_name_snapshot` or
`variant_value_snapshot` when inserting `order_items` — not for this one
order, for **every single order ever placed** (93/93 checked). The
`|| 'Product'` fallback in the display code wasn't a rare edge case, it
was firing 100% of the time.

**Fixed:**
- The database function now looks up the real product/variant name at
  order-creation time, for every future order.
- Backfilled existing orders where possible — but about half the
  historical rows are protected by a genuine ledger-immutability trigger
  (delivered orders are locked from editing, a real accounting-integrity
  control, correctly left alone rather than worked around).
- For those locked historical rows, `/api/orders/route.ts` now falls back
  to the *live* product/variant name via a join, so every order displays
  correctly regardless of when it was placed.

## Issue 2 — "Storage sign error: NoSuchKey" on photo upload

**Root cause, confirmed against Supabase's own documentation (not
guessed):** two separate bugs, both copied from `pahadi-admin`'s existing
(also-broken) upload code:
1. Wrong endpoint order — used `/object/sign/upload/...`, the correct
   endpoint is `/object/upload/sign/...`.
2. Wrong response shape assumed — the code expected `{ signedURL, token }`
   as two separate fields; the real API returns a single `{ url: "...?token=..." }`
   field with the token already embedded.

This strongly suggests `pahadi-admin`'s own signed-upload code path has
never actually worked in production — the real product images visible in
storage all appear to have gone through a *different*, working
(server-proxied) upload path instead. Worth a quick check on that side
too, separately from this fix.

**Fixed** in the new customer-facing upload route only (this was a
brand-new endpoint from this session, so no historical data was affected).

## Issue 3 — where photos are saved / how WhatsApp share works

Answering directly, now that the upload itself is fixed:

- **Storage**: Supabase Storage, in the same `pahadi-images` bucket
  product photos already use, under a `returns/<order_id>/` folder. Public
  URLs (e.g. `https://<project>.supabase.co/storage/v1/object/public/pahadi-images/returns/124/...jpg`)
  get saved into `returns.photo_urls` in the database and shown as
  thumbnails in the admin return-review screen.
- **WhatsApp share**: after a customer submits a return/replacement
  request, a "Share details on WhatsApp" button appears. It opens
  `wa.me/<your configured number>` with a pre-filled message containing
  the order number, reason, and the photo links — the customer taps once
  to send it as a normal WhatsApp message to your business number. This
  is a *secondary* channel on top of the formal request (which is already
  saved and visible in the admin returns page) — it exists so customers
  who prefer WhatsApp can loop your support in immediately, for faster
  human follow-up, not as the only record of the request.
