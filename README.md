# Pahadi Roots — Next.js Site

Production-grade e-commerce site for Pahadi Roots. Next.js 14 + Supabase + Razorpay + Tailwind CSS.

## Setup

### 1. Clone and install

```bash
git clone https://github.com/chambailsudhir/pahadiroots-next
cd pahadiroots-next
npm install
```

### 2. Environment variables

```bash
cp .env.example .env.local
# Fill in all values in .env.local
```

### 3. Database migration

Run `db_migration.sql` in Supabase SQL Editor:
- Go to supabase.com → Your Project → SQL Editor
- Paste contents of `db_migration.sql` and run
- This creates: indexes, new tables (reviews, wishlist, webhook_logs, event_logs), RPC functions, RLS policies

### 4. Run locally

```bash
npm run dev
# Open http://localhost:3000
```

### 5. Deploy to Vercel

```bash
vercel --prod
# Or push to GitHub and connect repo in Vercel dashboard
```

Add all `.env.local` values as Vercel Environment Variables.

---

## Architecture

```
pahadiroots-next/          ← This repo (main site)
pahadi-admin/              ← Admin panel (separate repo, unchanged)

Both connect to same Supabase DB:
  Main site → anon key (public reads only)
  Admin     → service key (full access, password-protected)
  API routes → service key (server-side only)
```

## Key files

| File | Purpose |
|------|---------|
| `src/lib/getSiteSettings.ts` | Reads site_settings from Supabase — controls all section toggles |
| `src/middleware.ts` | Store open/closed check + API rate limiting |
| `src/lib/services/orderService.ts` | Order creation with state machine, idempotency, fraud checks |
| `src/lib/services/inventoryService.ts` | Atomic stock deduction (race condition safe) |
| `src/lib/services/pricingService.ts` | Server-side price calculation — never trust client totals |
| `src/lib/schemas/index.ts` | Zod validation for all API inputs |

## Admin → Site settings

The admin panel (`pahadi-admin`) controls the live site via `site_settings` table.
Changes take effect within 5 minutes (ISR revalidation).

| Admin Setting | Effect on Site |
|---------------|----------------|
| `store_open = false` | Site goes into maintenance mode instantly |
| `ann_hide = true` | Hides announcement bar |
| `ticker_hide = true` | Hides scrolling ticker |
| `show_trust_bar = false` | Hides trust badges strip |
| `show_best_sellers = false` | Hides best sellers section |
| `cod_enabled = false` | Disables COD at checkout |
| `prepaid_discount_pct = 5` | Shows 5% prepaid discount |
| `catalogue_visible = false` | Shows "coming soon" on all product pages |

## Pages

| Route | Rendering | Description |
|-------|-----------|-------------|
| `/` | SSG (5min) | Homepage |
| `/products` | SSG (5min) | All products with filters |
| `/products/[slug]` | ISR (1hr) | Product detail |
| `/collections/[slug]` | ISR (2hr) | Category page |
| `/regions/[slug]` | ISR (6hr) | State/region page |
| `/cart` | CSR | Cart |
| `/checkout` | CSR | Checkout |
| `/account` | CSR | Customer account |
| `/track` | CSR | Public order tracker |
| `/search` | CSR | Search results |

## Security checklist before launch

- [ ] All env vars set in Vercel
- [ ] `db_migration.sql` run in Supabase
- [ ] RLS policies verified in Supabase dashboard
- [ ] Razorpay webhook URL added: `https://pahadiroots.com/api/v1/webhook/razorpay`
- [ ] Razorpay webhook secret matches `RAZORPAY_KEY_SECRET`
- [ ] Test order flow end-to-end in Razorpay test mode
- [ ] Test COD flow end-to-end
- [ ] Test store_open toggle (maintenance mode)
- [ ] Run Lighthouse — target 90+ on all pages

## Phase completion

- [x] Phase 1 — Foundation (homepage, products, PDP, cart, checkout, APIs)
- [x] Phase 2 — Discovery (collections, regions, search, account, track)
- [ ] Phase 3 — Polish (blog, about, contact, policies, Sentry, load test)
# force deploy Tue Jun 23 13:39:31 IST 2026
