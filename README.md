# 🌿 Pahadi Roots — Admin Panel v3.0 (Next.js)

## Setup Instructions

### Step 1: Copy files into your project

Copy ALL files from this ZIP into your `pahadi-admin` folder.
When it asks to replace files — click YES for all.

### Step 2: Install dependencies

Open terminal in `pahadi-admin` folder and run:
```
npm install recharts date-fns
```

### Step 3: Set environment variables

Open `.env.local` file and fill in:
- `SUPABASE_URL` — your Supabase project URL
- `SUPABASE_SERVICE_KEY` — from Supabase → Settings → API → service_role key
- `ADMIN_PASSWORD` — your current admin password (same as pahadiroots.com/admin)
- `MANAGER_PASSWORD` — password for manager role
- `PACKING_PASSWORD` — password for packing team

### Step 4: Run locally

```
npm run dev
```

Open: http://localhost:3000/admin

### Step 5: Deploy to Vercel

1. Push to a NEW GitHub repo (e.g. `pahadi-admin`)
2. Go to vercel.com → New Project → Import that repo
3. Add environment variables in Vercel dashboard
4. Deploy!

Your admin will be at: `https://pahadi-admin.vercel.app/admin`

---

## Pages

| URL | Page | Role Access |
|-----|------|-------------|
| `/admin` | Home Dashboard | Owner, Manager |
| `/admin/products` | Product Analytics | Owner, Manager |
| `/admin/customers` | Customer Insights | Owner, Manager |
| `/admin/operations` | Operations | Owner, Manager, Packing |
| `/admin/marketing` | Marketing & Sales | Owner, Manager |

## Features (from doc)

### Home Dashboard
- ✅ Revenue, Orders, Pending, Customers, AOV, Repeat % KPIs
- ✅ Revenue Trend (Bar + Orders line)
- ✅ Revenue vs Profit (Dual chart)
- ✅ Customer Growth Trend
- ✅ Sales Forecast (Moving Average — next 14 days)
- ✅ Order Status Donut
- ✅ Top 5 Products by Revenue
- ✅ Category Sales Split
- ✅ GST Collected (CGST + SGST)
- ✅ Payment Method Split
- ✅ Region-wise Orders
- ✅ Festival / Seasonal Trends
- ✅ Coupon & Cart Analytics
- ✅ Smart Alerts (bell icon)
- ✅ Date Range Filter (Today/7d/30d/90d)

### Product Analytics
- ✅ Revenue, Units, Profit, Dead Stock KPIs
- ✅ Top 10 by Revenue + Units
- ✅ Category Distribution
- ✅ Profit Margin per product
- ✅ Full table (sortable + filterable)
- ✅ Dead Stock Analysis
- ✅ Stock Turnover Rate

### Customer Insights
- ✅ Total, New, Returning, Repeat %, CLV KPIs
- ✅ Customer Growth Trend
- ✅ New vs Returning (donut)
- ✅ Customer Segmentation (High/Medium/Low)
- ✅ Purchase Frequency chart
- ✅ Top Locations
- ✅ Top Customers table with CLV tier

### Operations
- ✅ Pending, Packed, Shipped, Delivered, Cancel Rate KPIs
- ✅ Order Status Funnel
- ✅ Daily Order Heatmap
- ✅ Low Stock Alerts
- ✅ Full Orders table with status update dropdown
- ✅ Search + filter by status

### Marketing
- ✅ Revenue, Coupon Uses, Discount, Abandoned, Lost Revenue KPIs
- ✅ Revenue + Coupon Activity chart
- ✅ Sales by Channel
- ✅ Conversion Funnel
- ✅ Abandoned Cart Analysis
- ✅ Coupon Performance table
- ✅ All Coupons table

### Role-Based Access
- ✅ Owner — full access
- ✅ Manager — no settings
- ✅ Packing — operations only
- ✅ Auto role detection on login
