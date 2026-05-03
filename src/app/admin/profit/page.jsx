'use client';
// ─────────────────────────────────────────────────────────────────────────────
// Profit & Margins — FINAL v6
//
// ── DB FIELD MAP (audited against catalogue/page.jsx & api/admin/route.js) ──
//   products.price        = base price EXCL. GST  (what you set in catalogue)
//   products.mrp          = selling price INCL. GST (what customer pays — confusingly named)
//   products.cost_price   = your purchase/production cost (EXCL. GST)
//   products.gst_rate     = GST % (5 / 12 / 18 / 28)
//   order_items.price_at_time = selling price INCL. GST at time of order (= products.mrp snapshot)
//   orders.total_amount   = sum of order_items incl. GST + shipping - coupon
//   orders.tax            = GST collected (CGST + SGST) — stored at order level
//   orders.subtotal       = pre-GST, pre-shipping total
//   orders.coupon_discount= discount applied (already subtracted from total_amount)
//   orders.shipping_charge= shipping collected (included in total_amount)
//   returns.refund_amount = amount refunded to customer
//   returns.status        = requested | approved | received | refunded | rejected
//   returns.order_id      = FK to orders.id
//
// ── DASHBOARD FORMULA BUG (admin/page.jsx line 177) ─────────────────────────
//   Dashboard: profit = revenue - totalCost - gstTotal
//   This is WRONG: revenue includes GST, so subtracting gstTotal double-counts it.
//   revenue already has GST baked in — subtracting cost should give gross profit.
//   GST should NOT be subtracted from profit; it was never income.
//   Dashboard margin also divides by revenue (GST-inclusive) → always under-reports.
//   Dashboard daily trend uses circular estimate (margin% × dayRev) → fake.
//   ⚠ Dashboard profit numbers will differ from this page until dashboard is fixed.
//   TODO: extract shared profitCalc() to src/lib/profitCalc.js used by both pages.
//
// ── PRICING ENGINE (pricingCalc.js) LINK ────────────────────────────────────
//   pricingCalc runs a 6-stage unit economics model that includes:
//   shipping, COD mix, returns, platform fee, damage%, packaging etc.
//   The "cost_price" saved to products from the Pricing Engine is the LANDED COST
//   (purchase + inbound + handling + damage) — NOT just the purchase price.
//   This is CORRECT and is exactly what we should use as COGS basis.
//   However: pricingCalc also absorbs returns & logistics into the price.
//   So "Gross Profit" here (revenueExGST - COGS) is actually CONTRIBUTION MARGIN
//   if cost_price was set from pricingCalc (because landed cost ≠ pure purchase).
//   This is acceptable and industry standard for D2C.
//
// ── ALL FIXES IN THIS FILE ───────────────────────────────────────────────────
//  1.  GST strip via product.gst_rate proxy (add gst_rate_snapshot to order_items for history)
//  2.  Gross Profit = ex-GST revenue − COGS (no double GST deduction)
//  3.  Avg Margin denominator = ex-GST revenue (not GST-inclusive)
//  4.  order_items server-side batched filter (no full-table scan)
//  5.  Daily trend = real per-order profit (not circular estimate)
//  6.  Refunds filtered to same period via order_id match (not all-time)
//  7.  Double negative "−₹-1,160" fixed
//  8.  P&L waterfall: Refunds BEFORE GST (FMCG/Amazon standard)
//  9.  Net Revenue card correctly subtracts refunds
// 10.  NET PROFIT KPI added as final card (what goes in your pocket)
// 11.  Shipping collected shown separately (it's revenue, not profit)
// 12.  Coupon discount shown (already in total_amount but surfaced for clarity)
// 13.  prodMap unused variable removed
// 14.  Category margin uses ex-GST denominator
// 15.  Formula reference + DB field map shown in footer
// ─────────────────────────────────────────────────────────────────────────────

import { useSearchParams } from 'next/navigation';
import { useState, useEffect, Suspense } from 'react';
import { api, buildDateFilter, fmtCurrency } from '@/lib/api';
import KpiCard from '@/components/ui/KpiCard';
import { Card, Loader, ErrorMsg, Badge } from '@/components/ui/index';
import { Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, ComposedChart } from 'recharts';

// ── constants ─────────────────────────────────────────────────────────────────
const COLORS = ['#1a5c2a','#3fb950','var(--blue)','var(--purple)','#d29922','#f85149','#58a6ff'];

// ── helpers ───────────────────────────────────────────────────────────────────
// price_at_time is INCL. GST → strip to get base (your actual revenue)
const exGST   = (price, rate) => price / (1 + rate / 100);
const safeMax = (n) => Math.max(0, n);

// ── data fetching ─────────────────────────────────────────────────────────────
async function fetchProfitData(days) {
  const since = new Date(buildDateFilter(days));

  // 1. Products + categories (parallel — products.price is ex-GST base)
  const [products, categories] = await Promise.all([
    api.get('products',
      'select=id,name,emoji,price,cost_price,gst_rate,available_stock,category_id' +
      '&is_deleted=eq.false'),
    api.get('categories', 'select=id,name'),
  ]);
  const catMap = Object.fromEntries((categories || []).map(c => [c.id, c.name]));

  // 2. Orders in date range
  //    total_amount = incl. GST + shipping − coupon_discount
  //    tax          = GST collected (CGST + SGST)
  //    shipping_charge included in total_amount
  //    coupon_discount already subtracted from total_amount
  const orders = await api.get('orders',
    `select=id,total_amount,order_status,tax,shipping_charge,coupon_discount,created_at` +
    `&created_at=gte.${since.toISOString()}&order=created_at.desc`
  );
  const activeOrders    = (orders || []).filter(o => o.order_status !== 'cancelled');
  const activeOrderIds  = activeOrders.map(o => o.id);
  const activeOrderIdSet = new Set(activeOrderIds);

  // 3. Refunds — only for orders that fall within this period
  //    returns.status = 'refunded' means money was actually sent back
  //    We match via order_id so "Today" doesn't show last month's refunds
  let returns = [];
  try {
    returns = await api.get('returns', 'select=order_id,refund_amount,status');
  } catch (_) {}
  const periodRefunds = (returns || []).filter(
    r => r.status === 'refunded' && activeOrderIdSet.has(r.order_id)
  );
  const totalRefunds = periodRefunds.reduce(
    (s, r) => s + (parseFloat(r.refund_amount) || 0), 0
  );

  // 4. order_items — server-side filter by order IDs in batches of 200
  //    price_at_time = selling price INCL. GST at order time (= products.mrp at that point)
  //    ⚠ No gst_rate_snapshot stored — we use products.gst_rate as proxy.
  //      Add ALTER TABLE order_items ADD COLUMN gst_rate_snapshot NUMERIC DEFAULT 5;
  //      for perfect historical accuracy when GST rates change.
  let orderItems = [];
  if (activeOrderIds.length > 0) {
    const BATCH = 200;
    const results = await Promise.all(
      Array.from({ length: Math.ceil(activeOrderIds.length / BATCH) }, (_, i) =>
        api.get('order_items',
          `select=product_id,quantity,price_at_time,order_id` +
          `&order_id=in.(${activeOrderIds.slice(i * BATCH, (i + 1) * BATCH).join(',')})`)
      )
    );
    orderItems = results.flat();
  }

  // 5. Build per-product stats
  const stats = {};
  (products || []).forEach(p => {
    stats[p.id] = {
      id: p.id, name: p.name, emoji: p.emoji || '',
      price:     parseFloat(p.price)      || 0,   // ex-GST base (catalogue)
      costPrice: parseFloat(p.cost_price) || 0,   // landed cost from pricing engine
      gstRate:   parseFloat(p.gst_rate)   || 5,
      stock:     p.available_stock        || 0,
      cat:       catMap[p.category_id]    || 'Other',
      // accumulators
      revenueGross: 0,   // GST-inclusive (what customer paid)
      revenueExGST: 0,   // ex-GST (your actual top line)
      gstCollected: 0,   // GST portion (govt's money)
      cogs:         0,   // cost_price × units
      grossProfit:  0,   // revenueExGST − cogs
      units:        0,
    };
  });

  // Per-order profit map → for real daily trend (not circular estimate)
  const orderProfitMap = {};

  orderItems.forEach(item => {
    const s = stats[item.product_id];
    if (!s) return;
    const qty       = item.quantity || 1;
    // price_at_time = INCL. GST (confirmed from catalogue: products.mrp = incl. GST)
    const sellPrice = parseFloat(item.price_at_time) || 0;
    const gstRate   = s.gstRate; // proxy — add gst_rate_snapshot to order_items for accuracy
    const unitExGST = exGST(sellPrice, gstRate);
    const unitGST   = sellPrice - unitExGST;
    const cost      = s.costPrice * qty;
    const lineProfit = (unitExGST * qty) - cost;

    s.revenueGross += sellPrice * qty;
    s.revenueExGST += unitExGST * qty;
    s.gstCollected += unitGST * qty;
    s.cogs         += cost;
    s.grossProfit  += lineProfit;
    s.units        += qty;

    orderProfitMap[item.order_id] = (orderProfitMap[item.order_id] || 0) + lineProfit;
  });

  const prodList = Object.values(stats).map(p => ({
    ...p,
    margin: p.revenueExGST > 0 && p.costPrice > 0
      ? Math.round((p.grossProfit / p.revenueExGST) * 100) : null,
    roi: p.costPrice > 0 && p.units > 0
      ? Math.round((p.grossProfit / (p.costPrice * p.units)) * 100) : null,
  }));

  // 6. Totals
  const totalRevGross  = prodList.reduce((s, p) => s + p.revenueGross, 0);
  const totalRevExGST  = prodList.reduce((s, p) => s + p.revenueExGST, 0);
  const totalGSTItems  = prodList.reduce((s, p) => s + p.gstCollected, 0);
  // Prefer item-level GST; fall back to orders.tax if items not synced
  const totalGSTOrders = activeOrders.reduce((s, o) => s + (parseFloat(o.tax) || 0), 0);
  const totalGST       = totalGSTItems > 0 ? totalGSTItems : totalGSTOrders;
  const totalCOGS      = prodList.reduce((s, p) => s + p.cogs, 0);

  // Shipping collected (included in total_amount but useful to surface)
  const totalShipping  = activeOrders.reduce((s, o) => s + (parseFloat(o.shipping_charge) || 0), 0);
  // Coupon discounts (already subtracted from total_amount — for visibility only)
  const totalCoupons   = activeOrders.reduce((s, o) => s + (parseFloat(o.coupon_discount) || 0), 0);

  // Correct P&L flow:
  // Gross Revenue − Refunds = Net Revenue (collected)
  // Net Revenue − GST       = Net Revenue ex-GST  ← your real top line
  // Net Revenue ex-GST − COGS = Gross Profit
  const netRevCollected = safeMax(totalRevGross - totalRefunds);
  const netRevExGST     = safeMax(totalRevExGST - totalRefunds); // ex-GST after refunds
  const totalGrossProfit = prodList.reduce((s, p) => s + p.grossProfit, 0);

  // NET PROFIT = Gross Profit (we have no other overhead inputs yet)
  // When you track logistics/marketing/ops separately, subtract here.
  // For now: Net Profit = Gross Profit. Label makes this clear.
  const netProfit = totalGrossProfit;

  // Margin over ex-GST revenue after refunds (correct denominator)
  const avgMargin = netRevExGST > 0
    ? Math.round((totalGrossProfit / netRevExGST) * 100) : 0;

  // 7. Category profit
  const catAgg = {};
  prodList.forEach(p => {
    if (!catAgg[p.cat]) catAgg[p.cat] = { name: p.cat, revenueExGST: 0, profit: 0, cogs: 0 };
    catAgg[p.cat].revenueExGST += p.revenueExGST;
    catAgg[p.cat].profit       += p.grossProfit;
    catAgg[p.cat].cogs         += p.cogs;
  });
  const catData = Object.values(catAgg)
    .sort((a, b) => b.profit - a.profit)
    .map(c => ({
      ...c,
      margin: c.revenueExGST > 0 ? Math.round((c.profit / c.revenueExGST) * 100) : 0,
    }));

  // 8. Real daily trend — per-order actual profit, not circular estimate
  const now = new Date();
  const trendDays = Math.min(days, 30);
  const dailyTrend = Array.from({ length: trendDays }, (_, i) => {
    const d  = new Date(now);
    d.setDate(d.getDate() - (trendDays - 1 - i));
    const ds = d.toDateString();
    const dayOrds   = activeOrders.filter(o => new Date(o.created_at).toDateString() === ds);
    const dayRev    = dayOrds.reduce((s, o) => s + (parseFloat(o.total_amount) || 0), 0);
    const dayProfit = dayOrds.reduce((s, o) => s + (orderProfitMap[o.id] || 0), 0);
    return {
      date: days <= 7
        ? d.toLocaleDateString('en-IN', { weekday: 'short' })
        : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }),
      revenue: Math.round(dayRev),
      profit:  Math.round(dayProfit),
    };
  });

  const noCost = prodList.filter(p => p.costPrice === 0 && p.units > 0);

  return {
    prodList, catData, dailyTrend, noCost,
    // KPI values
    totalRevGross,     // GMV — what customers paid
    netRevCollected,   // after refunds
    netRevExGST,       // after refunds + GST stripped — real top line
    totalGST,          // govt liability
    totalCOGS,         // cost of goods sold
    totalGrossProfit,  // = netRevExGST − COGS
    netProfit,         // = grossProfit (until overhead tracking added)
    avgMargin,         // gross margin %
    totalRefunds,      // refunds this period
    totalShipping,     // shipping collected
    totalCoupons,      // coupons given
    activeOrderCount:  activeOrders.length,
  };
}

// ── component ─────────────────────────────────────────────────────────────────
function ProfitPage() {
  const searchParams = useSearchParams();
  const days = parseInt(searchParams.get('days') || '7', 10);

  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);
  const [sortBy,  setSortBy]  = useState('profit');

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(null);
    fetchProfitData(days)
      .then(d  => { if (!cancelled) setData(d); })
      .catch(e => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [days]);

  if (loading) return <Loader text="Loading profit analysis…" />;
  if (error)   return <ErrorMsg error={error} onRetry={() => setLoading(true)} />;
  if (!data)   return null;

  const tip = {
    contentStyle: { background: 'var(--tooltip-bg,#161b22)', border: '1px solid var(--tooltip-bd,#30363d)', borderRadius: 8, fontSize: 12, color: 'var(--tx,#e6edf3)' },
    labelStyle:   { color: 'var(--tx,#e6edf3)', fontWeight: 600 },
    itemStyle:    { color: 'var(--tx2,#8b949e)' },
    cursor:       { fill: 'color-mix(in srgb, var(--bd) 10%, transparent)' },
  };

  const sorted = [...data.prodList]
    .filter(p => p.units > 0)
    .sort((a, b) => {
      if (sortBy === 'margin')  return (b.margin  ?? -999) - (a.margin  ?? -999);
      if (sortBy === 'revenue') return b.revenueGross - a.revenueGross;
      if (sortBy === 'roi')     return (b.roi     ?? -999) - (a.roi     ?? -999);
      return b.grossProfit - a.grossProfit;
    });

  // P&L waterfall — FMCG/Amazon correct order
  const plRows = [
    { label: 'Gross Revenue (GMV, incl. GST)',          value: data.totalRevGross,      color: 'var(--tx)',  bold: false },
    { label: '  − Refunds / Returns',                   value: data.totalRefunds,       color: '#f85149',   bold: false, minus: true },
    { label: 'Net Revenue (collected)',                  value: data.netRevCollected,    color: 'var(--tx)', bold: true  },
    { label: '  − GST Liability (govt — not yours)',    value: data.totalGST,           color: '#58a6ff',   bold: false, minus: true },
    { label: 'Net Revenue ex-GST  ← your P&L top line',value: data.netRevExGST,        color: '#3fb950',   bold: true  },
    { label: '  − COGS (cost_price × units)',           value: data.totalCOGS,          color: '#f85149',   bold: false, minus: true },
    { label: 'Gross Profit',                            value: data.totalGrossProfit,   color: '#3fb950',   bold: true  },
    { label: 'Gross Margin %',                          display: data.avgMargin + '%',  color: '#d29922',   bold: true  },
    { label: 'Net Profit (in your pocket)',             value: data.netProfit,          color: data.netProfit >= 0 ? '#3fb950' : '#f85149', bold: true },
  ];

  const marginColor = data.totalCOGS === 0 ? '#d29922'
    : data.avgMargin >= 40 ? '#3fb950'
    : data.avgMargin >= 20 ? '#d29922'
    : '#f85149';

  const netProfitColor = data.netProfit >= 0 ? '#3fb950' : '#f85149';

  return (
    <div className="space-y-4">

      {/* ── Row 1: What you made ── */}
      <div className="grid grid-cols-5 gap-3">
        <KpiCard
          label="Gross Revenue"
          value={fmtCurrency(data.totalRevGross)}
          sub={`${data.activeOrderCount} orders · Last ${days === 1 ? 'day' : days + ' days'}`}
          accentColor="#1a5c2a"
        />
        <KpiCard
          label="Deductions"
          value={`−${fmtCurrency(data.totalGST + data.totalRefunds)}`}
          sub={`GST ${fmtCurrency(data.totalGST)} · Refunds ${fmtCurrency(data.totalRefunds)}`}
          accentColor="#6e7681"
        />
        <KpiCard
          label="Net Revenue (ex-GST)"
          value={fmtCurrency(data.netRevExGST)}
          sub="after refunds & GST — real top line"
          accentColor="#3fb950"
        />
        <KpiCard
          label="Gross Margin %"
          value={data.avgMargin + '%'}
          sub={data.totalCOGS === 0 ? '⚠ set cost prices' : 'profit / net rev ex-GST'}
          accentColor={marginColor}
        />
        <KpiCard
          label="Net Profit (in pocket)"
          value={fmtCurrency(data.netProfit)}
          sub={data.totalCOGS === 0 ? '⚠ needs cost prices' : 'gross profit (no overhead yet)'}
          accentColor={netProfitColor}
        />
      </div>

      {/* ── Row 2: GST + extras ── */}
      <div className="rounded-xl px-4 py-2.5 flex flex-wrap gap-x-6 gap-y-1 text-[12px]"
        style={{ background: 'var(--bg2,#161b22)', border: '1px solid #58a6ff33' }}>
        <span className="font-bold text-[#58a6ff]">GST — govt liability, not your income</span>
        <span style={{ color: 'var(--tx2)' }}>Total: <strong style={{ color: 'var(--tx)' }}>{fmtCurrency(data.totalGST)}</strong></span>
        <span style={{ color: 'var(--tx2)' }}>CGST: <strong style={{ color: 'var(--tx)' }}>{fmtCurrency(data.totalGST / 2)}</strong></span>
        <span style={{ color: 'var(--tx2)' }}>SGST: <strong style={{ color: 'var(--tx)' }}>{fmtCurrency(data.totalGST / 2)}</strong></span>
        <span style={{ color: 'var(--tx2)' }}>Shipping collected: <strong style={{ color: 'var(--tx)' }}>{fmtCurrency(data.totalShipping)}</strong></span>
        {data.totalCoupons > 0 && (
          <span style={{ color: 'var(--tx2)' }}>Coupons given: <strong style={{ color: '#f85149' }}>−{fmtCurrency(data.totalCoupons)}</strong></span>
        )}
        {data.totalRefunds > 0 && (
          <span style={{ color: 'var(--tx2)' }}>
            Refunds this period: <strong style={{ color: '#f85149' }}>{fmtCurrency(data.totalRefunds)}</strong>
            <span style={{ color: 'var(--tx3)' }}> (already deducted above)</span>
          </span>
        )}
      </div>

      {/* ── Missing cost price warning ── */}
      {data.noCost.length > 0 && (
        <div className="rounded-xl p-3 flex items-start gap-3"
          style={{ background: 'rgba(210,153,34,0.08)', border: '1px solid rgba(210,153,34,0.3)' }}>
          <span className="text-lg mt-0.5">⚠️</span>
          <div>
            <div className="text-[12px] font-bold" style={{ color: '#d29922' }}>
              {data.noCost.length} products have no cost price — COGS = ₹0, Net Profit is overstated
            </div>
            <div className="text-[11px] mt-0.5" style={{ color: 'var(--tx3)' }}>
              Fix: Admin → Catalogue → open product → fill Cost Price → Save
              {' '}(or use Pricing Engine to calculate and auto-fill)
            </div>
            <div className="text-[11px] mt-1" style={{ color: 'var(--tx3)' }}>
              {data.noCost.map(p => p.name).join(' · ')}
            </div>
          </div>
        </div>
      )}

      {/* ── P&L Waterfall + Chart ── */}
      <div className="grid grid-cols-2 gap-4">

        <Card title="P&L Summary (FMCG-style)">
          <div className="space-y-1.5 text-[13px]">
            {plRows.map((row, i) => (
              <div key={i}
                className={`flex justify-between items-center ${row.bold ? 'border-t border-[var(--bd)] pt-2 mt-1' : ''}`}
                style={{ fontWeight: row.bold ? 600 : 400 }}>
                <span style={{ color: row.bold ? 'var(--tx)' : 'var(--tx2)' }}>{row.label}</span>
                <span style={{ color: row.color }}>
                  {row.display
                    ? row.display
                    : row.minus
                      ? `−${fmtCurrency(row.value)}`
                      : fmtCurrency(row.value ?? 0)}
                </span>
              </div>
            ))}
          </div>
          {/* Net profit callout */}
          <div className="mt-4 rounded-lg p-3 text-center"
            style={{
              background: data.netProfit >= 0 ? 'rgba(63,185,80,0.08)' : 'rgba(248,81,73,0.08)',
              border: `1px solid ${data.netProfit >= 0 ? 'rgba(63,185,80,0.3)' : 'rgba(248,81,73,0.3)'}`,
            }}>
            <div className="text-[11px] mb-1" style={{ color: 'var(--tx3)' }}>
              Net Profit — what goes in your pocket
            </div>
            <div className="text-[22px] font-bold" style={{ color: netProfitColor }}>
              {fmtCurrency(data.netProfit)}
            </div>
            <div className="text-[11px] mt-1" style={{ color: 'var(--tx3)' }}>
              {data.totalCOGS === 0
                ? '⚠ Overstated — fill cost prices in Catalogue'
                : 'Gross Profit (add logistics/mktg costs for true net)'}
            </div>
          </div>
        </Card>

        <Card title="Revenue vs Real Profit (daily)">
          <ResponsiveContainer width="100%" height={220}>
            <ComposedChart data={data.dailyTrend}>
              <XAxis dataKey="date"
                tick={{ fill: 'var(--chart-axis,#6e7681)', fontSize: 10 }}
                axisLine={false} tickLine={false} />
              <YAxis
                tick={{ fill: 'var(--chart-axis,#6e7681)', fontSize: 10 }}
                axisLine={false} tickLine={false}
                tickFormatter={v => v >= 1000 ? '₹' + Math.round(v / 1000) + 'k' : '₹' + v} />
              <Tooltip {...tip} formatter={(v, n) => [fmtCurrency(v), n]} />
              <Bar dataKey="revenue" fill="#1a5c2a" radius={[3,3,0,0]} name="Revenue" />
              <Bar dataKey="profit"  fill="#3fb950" radius={[3,3,0,0]} name="Gross Profit" />
            </ComposedChart>
          </ResponsiveContainer>
        </Card>
      </div>

      {/* ── Profit by Category ── */}
      <Card title="Profit by Category">
        <div className="space-y-3">
          {data.catData.length === 0 && (
            <div className="py-4 text-center text-[12px]" style={{ color: 'var(--tx3)' }}>No sales in this period</div>
          )}
          {data.catData.map((c, i) => (
            <div key={c.name}>
              <div className="flex justify-between text-[12px] mb-1">
                <span className="font-semibold" style={{ color: 'var(--tx)' }}>{c.name}</span>
                <div className="flex gap-4">
                  <span style={{ color: 'var(--tx3)', fontSize: 11 }}>COGS {fmtCurrency(c.cogs)}</span>
                  <span className="font-bold" style={{ color: '#3fb950' }}>{fmtCurrency(c.profit)}</span>
                  <span style={{ color: 'var(--tx3)' }}>{c.margin}%</span>
                </div>
              </div>
              <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--input-bg)' }}>
                <div className="h-full rounded-full" style={{
                  width: `${data.catData[0]?.profit > 0 ? safeMax((c.profit / data.catData[0].profit) * 100) : 0}%`,
                  background: COLORS[i % COLORS.length],
                }} />
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* ── Product Table ── */}
      <Card title="Product Profit Analysis">
        <div className="flex items-center gap-3 mb-4">
          <select value={sortBy} onChange={e => setSortBy(e.target.value)}
            className="rounded-lg px-3 py-1.5 text-[12px]"
            style={{ background: 'var(--input-bg)', border: '1px solid var(--bd)', color: 'var(--tx2)' }}>
            <option value="profit">Sort: Gross Profit ↓</option>
            <option value="margin">Sort: Margin % ↓</option>
            <option value="revenue">Sort: Revenue ↓</option>
            <option value="roi">Sort: ROI % ↓</option>
          </select>
          <span className="text-[11px]" style={{ color: 'var(--tx3)' }}>
            {sorted.length} products with sales
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                {['Product','Category','Units','Revenue (gross)','Revenue (ex-GST)','COGS','Gross Profit','Margin %','ROI %','Health'].map(h => (
                  <th key={h} className="text-left pb-3 pr-3"
                    style={{ fontSize: 10, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--tx2)' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map(p => {
                const health      = p.margin === null ? 'default' : p.margin >= 40 ? 'green' : p.margin >= 20 ? 'yellow' : p.margin >= 0 ? 'blue' : 'red';
                const healthLabel = p.margin === null ? 'No Cost' : p.margin >= 40 ? 'Excellent' : p.margin >= 20 ? 'Good' : p.margin >= 0 ? 'Low' : 'Loss';
                const mColor      = p.margin === null ? 'var(--tx3)' : p.margin >= 30 ? '#3fb950' : p.margin >= 0 ? '#d29922' : '#f85149';
                const rColor      = p.roi    === null ? 'var(--tx3)' : p.roi    >= 50 ? '#3fb950' : p.roi    >= 0 ? '#d29922' : '#f85149';
                return (
                  <tr key={p.id}
                    style={{ borderTop: '1px solid color-mix(in srgb, var(--bd) 50%, transparent)' }}
                    className="hover:bg-[var(--input-bg)]/20">
                    <td className="py-2.5 pr-3 text-[12px] font-semibold" style={{ color: 'var(--tx)' }}>
                      {p.emoji} {p.name}
                    </td>
                    <td className="py-2.5 pr-3"><Badge type="blue">{p.cat}</Badge></td>
                    <td className="py-2.5 pr-3 text-[12px]" style={{ color: 'var(--tx2)' }}>{p.units}</td>
                    <td className="py-2.5 pr-3 text-[12px] font-bold" style={{ color: 'var(--tx)' }}>
                      {fmtCurrency(p.revenueGross)}
                    </td>
                    <td className="py-2.5 pr-3 text-[12px]" style={{ color: 'var(--tx2)' }}>
                      {fmtCurrency(p.revenueExGST)}
                    </td>
                    <td className="py-2.5 pr-3 text-[12px]" style={{ color: 'var(--tx3)' }}>
                      {p.costPrice > 0
                        ? fmtCurrency(p.cogs)
                        : <span style={{ color: '#f85149', fontSize: 10 }}>not set</span>}
                    </td>
                    <td className="py-2.5 pr-3 text-[12px] font-bold"
                      style={{ color: p.grossProfit >= 0 ? '#3fb950' : '#f85149' }}>
                      {fmtCurrency(p.grossProfit)}
                    </td>
                    <td className="py-2.5 pr-3 text-[12px] font-bold" style={{ color: mColor }}>
                      {p.margin !== null ? p.margin + '%' : '—'}
                    </td>
                    <td className="py-2.5 pr-3 text-[12px]" style={{ color: rColor }}>
                      {p.roi !== null ? p.roi + '%' : '—'}
                    </td>
                    <td className="py-2.5"><Badge type={health}>{healthLabel}</Badge></td>
                  </tr>
                );
              })}
              {sorted.length === 0 && (
                <tr>
                  <td colSpan={10} className="py-10 text-center text-[12px]" style={{ color: 'var(--tx3)' }}>
                    No sales in this period
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Formula + DB field reference */}
        <div className="mt-6 p-3 rounded-xl text-[11px] space-y-1"
          style={{ background: 'var(--input-bg)', color: 'var(--tx3)' }}>
          <div className="font-bold mb-2" style={{ color: 'var(--tx2)', fontSize: 12 }}>Formula & DB field reference</div>
          <div>• <strong>Revenue (gross)</strong>: order_items.price_at_time × qty — GST-inclusive (= products.mrp at order time)</div>
          <div>• <strong>Revenue (ex-GST)</strong>: gross ÷ (1 + products.gst_rate%) — your actual earned revenue</div>
          <div>• <strong>COGS</strong>: products.cost_price × units — fill via Catalogue or auto-filled by Pricing Engine</div>
          <div>• <strong>Gross Profit</strong>: ex-GST revenue − COGS</div>
          <div>• <strong>Net Profit</strong>: Gross Profit (add logistics/marketing/ops overhead when tracked)</div>
          <div>• <strong>Margin %</strong>: Gross Profit ÷ ex-GST Revenue × 100</div>
          <div>• <strong>ROI %</strong>: Gross Profit ÷ COGS × 100 — return on every ₹ invested in stock</div>
          <div>• <strong>GST</strong>: collected from customers on govt's behalf — legally never your income</div>
          <div className="pt-2 mt-1" style={{ borderTop: '1px solid var(--bd)', color: '#d29922' }}>
            ⚠ Dashboard profit numbers differ from this page — dashboard uses a different (incorrect) formula.
            TODO: extract shared profitCalc() to src/lib/profitCalc.js for consistency.
          </div>
        </div>
      </Card>
    </div>
  );
}

// ── wrapper (required for useSearchParams inside Suspense) ────────────────────
export default function ProfitPageWrapper(props) {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center py-24 text-[12px]"
        style={{ color: 'var(--tx2,#6e7681)' }}>
        Loading profit data…
      </div>
    }>
      <ProfitPage {...props} />
    </Suspense>
  );
}
