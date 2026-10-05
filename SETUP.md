# Pahadi Roots Next.js — Setup Guide
## From zip to live in one sitting

---

## STEP 1 — Create GitHub repo

```bash
# Unzip
unzip pahadiroots-next-v2.zip
cd pahadiroots-next

# Init git
git init
git add .
git commit -m "Initial commit — Pahadi Roots Next.js site"

# Create repo on GitHub (do this on github.com first)
git remote add origin https://github.com/chambailsudhir/pahadiroots-next.git
git push -u origin main
```

---

## STEP 2 — Run DB migration in Supabase

Go to: **supabase.com → Your project → SQL Editor**

Paste the full contents of `db_migration.sql` and click **Run**.

Run it in sections if you want to be careful — each `-- ───` comment marks a section.

**Expected output:** No errors. If you see "already exists" warnings, that's fine — those are the `IF NOT EXISTS` guards.

**What it does:**
- Adds indexes on products, orders, customers
- Adds `idempotency_key` column to orders
- Creates tables: `reviews`, `wishlist`, `webhook_logs`, `event_logs`, `blog_posts`
- Creates RPCs: `create_order_atomic`, `deduct_stock_atomic`, `restore_stock`
- Sets RLS policies (products/categories/settings = public read, orders/customers = no public access)
- Inserts new `site_settings` keys for section toggles

---

## STEP 3 — Environment variables

```bash
cp .env.example .env.local
```

Edit `.env.local` with your real values:

```env
# ── Supabase ─────────────────────────────────────────────────────────────────
NEXT_PUBLIC_SUPABASE_URL=https://ulyrhnpoiypuvaurlqqi.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key_here        # Supabase → Settings → API → anon public
SUPABASE_SERVICE_KEY=your_service_key_here              # Supabase → Settings → API → service_role

# ── Razorpay ─────────────────────────────────────────────────────────────────
RAZORPAY_KEY_ID=rzp_live_xxxxxxxxxxxx                    # SERVER side key id (payments API + health check)
NEXT_PUBLIC_RAZORPAY_KEY_ID=rzp_live_xxxxxxxxxxxx       # same key id, used by the browser checkout. BOTH are required.
RAZORPAY_KEY_SECRET=your_razorpay_key_secret_here
# BUG FIX 23a: RAZORPAY_WEBHOOK_SECRET is a DIFFERENT value from RAZORPAY_KEY_SECRET.
# Set this in Razorpay dashboard → Settings → Webhooks → Secret (generate separately).
# Without this, webhook signature verification is disabled → replay attack risk.
RAZORPAY_WEBHOOK_SECRET=your_webhook_secret_here

# ── Email ─────────────────────────────────────────────────────────────────────
RESEND_API_KEY=re_xxxxxxxxxxxx                          # resend.com → API Keys
ADMIN_EMAIL=ops@yourdomain.com                          # receives new order notifications

# ── Site ──────────────────────────────────────────────────────────────────────
NEXT_PUBLIC_SITE_URL=https://pahadiroots.com

# ── Observability ─────────────────────────────────────────────────────────────
# Version string emitted in /api/health and every JSON log line.
# Set to your semver (e.g. "1.4.2") so each deployment is identifiable in logs.
# Falls back to VERCEL_GIT_COMMIT_SHA automatically if not set.
NEXT_PUBLIC_APP_VERSION=1.0.0

# ── Cron auth ─────────────────────────────────────────────────────────────────
# Random secret Vercel sends in Authorization: Bearer <CRON_SECRET> on cron calls.
# Without this, /api/v1/cron/retry-failed-emails returns 500 and dead-letter
# emails (including payment confirmations) are never retried.
# Generate: openssl rand -hex 32
CRON_SECRET=your_random_secret_here

# ── Rate limiting (Upstash KV) — optional but strongly recommended ────────────
# Without these, distributed rate limits on orders/payments/coupons are disabled
# (only per-replica in-process fallback applies — NOT shared across instances).
# Create a free Redis DB at upstash.com → copy the REST URL and token.
UPSTASH_REDIS_REST_URL=https://xxxx.upstash.io
UPSTASH_REDIS_REST_TOKEN=AXxx...
```

---

## STEP 4 — Install and run locally

```bash
npm install
npm run dev
```

Open **http://localhost:3000**

Test checklist locally:
- [ ] Homepage loads with hero banner
- [ ] Products page loads your products from Supabase
- [ ] Product detail page opens
- [ ] Add to cart works
- [ ] Cart drawer slides open
- [ ] Checkout form works
- [ ] COD order places successfully
- [ ] Announcement bar / ticker visible
- [ ] Search overlay works

---

## STEP 5 — Deploy to Vercel

### Option A: Via Vercel dashboard (recommended)
1. Go to **vercel.com → Add New Project**
2. Import `chambailsudhir/pahadiroots-next` from GitHub
3. Framework: Next.js (auto-detected)
4. Add all env variables from `.env.local`
5. Click **Deploy**

### Option B: Via CLI
```bash
npm i -g vercel
vercel --prod
# Follow prompts, add env vars when asked
```

**Important:** In Vercel project settings → **Environment Variables**, add every REQUIRED variable from `.env.example`. The `SUPABASE_SERVICE_KEY` must be Server-only (not `NEXT_PUBLIC_`).

---

## STEP 6 — Razorpay webhook

In **Razorpay dashboard → Settings → Webhooks → Add new webhook:**

- URL: `https://pahadiroots-next.vercel.app/api/v1/webhook/razorpay`  
  *(replace with your actual Vercel URL or custom domain)*
- Secret: generate a new random string (`openssl rand -hex 32`) and set it as
  **both** the webhook secret in the Razorpay dashboard **and** `RAZORPAY_WEBHOOK_SECRET` in Vercel  
  ⚠️  `RAZORPAY_WEBHOOK_SECRET` is a DIFFERENT value from `RAZORPAY_KEY_SECRET` (the API key secret)
- Events to enable:
  - `payment.captured`
  - `payment.failed`

---

## STEP 7 — Connect admin panel to new site

The **pahadi-admin** panel already writes to the same Supabase DB — no changes needed there.

### Add new section toggles to admin Settings page

Open `ADMIN_SETTINGS_UPGRADE.jsx` from the zip. Follow the instructions at the top of that file:

1. In `pahadi-admin/src/app/admin/settings/page.jsx`, find the `StoreStatusSection` component
2. Delete the "COMING SOON" dashed block (lines with `🔮 COMING SOON`)
3. Paste in the `SiteVisibilitySection` component from `ADMIN_SETTINGS_UPGRADE.jsx`
4. Add `<SiteVisibilitySection settings={settings} onSaved={reload} />` in the main render, right after `<StoreStatusSection />`

Now your admin panel has live toggles for every section on the site.

---

## STEP 8 — DNS cutover (when ready to go live)

When the site is fully tested on the Vercel preview URL:

1. In Vercel project → **Settings → Domains → Add domain**: `pahadiroots.com`
2. Update your domain registrar DNS:
   - Add CNAME record: `www` → `cname.vercel-dns.com`
   - Or add A record: `@` → `76.76.21.21` (Vercel IP)
3. SSL is automatic — done in minutes

**Old HTML site:** Set `chambailsudhir/pahadiroots` repo to private. Keep it for 2 weeks as backup, then archive.

---

## Quick reference — Admin controls → Site effect

| Admin setting | Where | Effect on site |
|---|---|---|
| `store_open = false` | Store Status | Entire site → maintenance page |
| `ann_hide = true` | Announcement Bar | Hides top green bar |
| `ann_text` | Announcement Bar | Custom text in top bar |
| `ticker_hide = true` | Ticker Bar | Hides scrolling orange bar |
| `show_trust_bar = false` | Site Sections | Hides Natural/COD/Free Ship strip |
| `show_best_sellers = false` | Site Sections | Hides best sellers on homepage |
| `cod_enabled = false` | Site Sections | Removes COD option at checkout |
| `prepaid_discount_pct = 5` | Site Sections | Shows "Save extra 5% on prepaid" |
| `catalogue_visible = false` | Site Sections | Products show "coming soon" |
| `featured_collection_slug` | Site Sections | Sets featured banner on homepage |

All changes visible on live site within **5 minutes** — no redeploy needed.

---

## Troubleshooting

**`column "customer_phone" does not exist`**  
→ Use the fixed `db_migration.sql` (v2 in this zip). This column was removed — orders use `customer_id` FK.

**`relation "webhook_logs" does not exist`**  
→ Run `db_migration.sql` first.

**Products not showing**  
→ Check RLS policy: `products` needs `status = active` and `is_deleted = false`.  
→ Check `NEXT_PUBLIC_SUPABASE_ANON_KEY` is set correctly.

**Orders not creating**  
→ Check `SUPABASE_SERVICE_KEY` is set in Vercel env vars.  
→ Check `create_order_atomic` RPC was created in Supabase.

**Razorpay payment not capturing**  
→ Verify webhook URL and secret in Razorpay dashboard.  
→ Check `RAZORPAY_KEY_SECRET` matches.

**Site settings not loading / features not toggling**  
→ ISR revalidation is 5 minutes. Force revalidate: redeploy or wait 5 min.
