'use client';
import { useState, useEffect, useCallback, Suspense} from 'react';
import { useRouter, useSearchParams} from 'next/navigation';
import { api, buildDateFilter, fmtCurrency, fmt } from '@/lib/api';
import KpiCard from '@/components/ui/KpiCard';
import { Card, Loader, ErrorMsg, StatusBadge } from '@/components/ui/index';
import {
  BarChart, Bar, LineChart, Line, AreaChart, Area,
  XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell
} from 'recharts';

const COLORS = ['#1a5c2a','#1a5c2a','#58a6ff','#d29922','#8957e5','#f85149','#3fb950'];
const STATUS_COLORS = { pending:'#d29922', confirmed:'#58a6ff', packed:'#8957e5', shipped:'#3fb950', delivered:'#1a5c2a', cancelled:'#f85149' };

// ── Smart Alert Banners ─────────────────────────────────────────
function SmartAlerts({ data, days }) {
  const [dismissed, setDismissed] = useState([]);
  if (!data) return null;

  const alerts = [];

  // Revenue drop > 15% vs previous period
  if (data.revTrend !== null && data.revTrend <= -15)
    alerts.push({ id: 'rev-drop', level: 'danger', icon: '📉', title: `Revenue dropped ${Math.abs(data.revTrend)}% vs previous period`, action: 'Check orders →', href: '/admin/orders' });

  // Revenue spike > 20%
  if (data.revTrend !== null && data.revTrend >= 20)
    alerts.push({ id: 'rev-spike', level: 'success', icon: '🚀', title: `Revenue up ${data.revTrend}% vs previous period — great momentum!`, action: null });

  // High pending orders (> 10 or > 20% of total)
  if (data.pendingCount > 10 || (data.activeCount > 0 && data.pendingCount / data.activeCount > 0.2))
    alerts.push({ id: 'pending', level: 'warning', icon: '⏳', title: `${data.pendingCount} orders still pending — action needed`, action: 'View pending →', href: '/admin/orders' });

  // Low stock items
  if (data.lowStock && data.lowStock.length > 0)
    alerts.push({ id: 'stock', level: 'danger', icon: '📦', title: `${data.lowStock.length} product${data.lowStock.length > 1 ? 's' : ''} critically low on stock (≤10 units)`, action: 'View products →', href: '/admin/products' });

  // High cart abandonment > 60%
  if (data.abandonRate > 60)
    alerts.push({ id: 'abandon', level: 'warning', icon: '🛒', title: `Cart abandonment rate is ${data.abandonRate}% — high drop-off before purchase`, action: 'View marketing →', href: '/admin/marketing' });

  // High return rate > 8%
  if (data.returnRate > 8)
    alerts.push({ id: 'returns', level: 'warning', icon: '↩️', title: `Return rate is ${data.returnRate}% — above healthy threshold (8%)`, action: 'View returns →', href: '/admin/returns' });

  // Low repeat customer rate
  if (data.repeatPct < 15)
    alerts.push({ id: 'repeat', level: 'info', icon: '🔁', title: `Only ${data.repeatPct}% repeat customers — consider loyalty offers`, action: 'View customers →', href: '/admin/customers' });

  // Zero orders in last 2 days (only show for 7-day view)
  if (days <= 7 && data.chartData) {
    const last2 = data.chartData.slice(-2);
    const zeroRecent = last2.every(d => d.orders === 0);
    if (zeroRecent) alerts.push({ id: 'zero-orders', level: 'danger', icon: '🚨', title: 'No orders in the last 2 days — check your store / payment gateway', action: null });
  }

  const LEVEL_STYLE = {
    danger:  { bg: '#2d1117', border: '#f85149', icon: '#f85149', text: '#ffa198' },
    warning: { bg: '#2d2011', border: '#d29922', icon: '#d29922', text: '#e3b341' },
    success: { bg: '#0d2b1a', border: '#3fb950', icon: '#3fb950', text: '#7ee787' },
    info:    { bg: '#0d1b2e', border: '#58a6ff', icon: '#58a6ff', text: '#79c0ff' },
  };

  const visible = alerts.filter(a => !dismissed.includes(a.id));
  if (visible.length === 0) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {visible.map(alert => {
        const s = LEVEL_STYLE[alert.level];
        return (
          <div key={alert.id} style={{ background: s.bg, border: `1px solid ${s.border}`, borderRadius: 10, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 16, flexShrink: 0 }}>{alert.icon}</span>
            <span style={{ flex: 1, fontSize: 13, color: s.text, fontWeight: 500 }}>{alert.title}</span>
            {alert.href && (
              <a href={alert.href} style={{ fontSize: 12, color: s.border, fontWeight: 600, whiteSpace: 'nowrap', textDecoration: 'none' }}>{alert.action}</a>
            )}
            <button onClick={() => setDismissed(d => [...d, alert.id])} style={{ background: 'none', border: 'none', color: '#6e7681', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: '0 0 0 4px', flexShrink: 0 }}>×</button>
          </div>
        );
      })}
    </div>
  );
}

// ── Drill-down modal ────────────────────────────────────────────
function DrillModal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.7)' }}>
      <div className="rounded-xl w-[700px] max-h-[80vh] flex flex-col" style={{background:"var(--bg2,#161b22)",border:"1px solid var(--bd,#30363d)"}}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#30363d]">
          <h2 className="text-[14px] font-bold text-white">{title}</h2>
          <button onClick={onClose} className="text-[#6e7681] hover:text-white text-xl leading-none">×</button>
        </div>
        <div className="overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );
}

function DashboardPage() {
  const searchParams = useSearchParams();
  const days = parseInt(searchParams.get('days') || '7', 10);
  const router = useRouter();
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);
  const [drill,   setDrill]   = useState(null); // { type, data }

  useEffect(() => { loadDashboard(days); }, [days]);

  async function loadDashboard(days) {
    setLoading(true); setError(null);
    try {
      const since     = buildDateFilter(days);
      const prevSince = buildDateFilter(days * 2);

      const [allOrders, prevOrders, allCustomers, products, orderItems, categories, couponUsage, abandoned, allOrdersForStats, returns] = await Promise.all([
        api.get('orders', `select=id,order_number,total_amount,order_status,payment_method,created_at,customer_id,tax&created_at=gte.${since}&order=created_at.desc`),
        api.get('orders', `select=total_amount,order_status&created_at=gte.${prevSince}&created_at=lt.${since}`),
        api.get('customers', 'select=id,first_name,last_name,created_at,state&is_deleted=eq.false'),
        api.get('products', 'select=id,name,emoji,price,cost_price,gst_rate,available_stock,initial_stock,category_id,status&is_deleted=eq.false'),
        api.get('order_items', 'select=product_id,quantity,price_at_time,order_id'),
        api.get('categories', 'select=id,name'),
        api.get('coupon_usage', `select=id,coupon_id,discount_amount,used_at&used_at=gte.${since}`).catch(() => []),
        api.get('abandoned_carts', `select=id,cart_total,created_at&created_at=gte.${since}`).catch(() => []),
        api.get('orders', 'select=customer_id,order_status,total_amount,created_at').catch(() => []),
        api.get('returns', `select=id,status,refund_amount,created_at&created_at=gte.${since}`).catch(() => []),
      ]);

      const catMap    = Object.fromEntries((categories || []).map(c => [c.id, c.name]));
      const active    = (allOrders || []).filter(o => o.order_status !== 'cancelled');
      const prevActive = (prevOrders || []).filter(o => o.order_status !== 'cancelled');

      // Revenue
      const revenue  = active.reduce((s, o) => s + (parseFloat(o.total_amount) || 0), 0);
      const prevRev  = prevActive.reduce((s, o) => s + (parseFloat(o.total_amount) || 0), 0);
      const revTrend = prevRev > 0 ? Math.round((revenue - prevRev) / prevRev * 100) : null;

      // GST
      const gstTotal = active.reduce((s, o) => s + (parseFloat(o.tax) || 0), 0);

      // AOV
      const aov = active.length > 0 ? revenue / active.length : 0;

      // Pending
      const pending   = (allOrders || []).filter(o => o.order_status === 'pending');
      const pendingCount = pending.length;

      // Customers — new in period vs total
      // For "Today" use start of today, for other periods use N days ago
      const sinceDateObj = days === 1
        ? new Date(new Date().toDateString()) // midnight today
        : new Date(buildDateFilter(days));
      const newCustCount = (allCustomers || []).filter(c => new Date(c.created_at) >= sinceDateObj).length;
      const totalCustCount = (allCustomers || []).length;

      // Repeat customers — use ALL-TIME orders, not just period
      const allTimeCustOrds = {};
      (allOrdersForStats || []).filter(o=>o.order_status!=='cancelled').forEach(o => { if (o.customer_id) allTimeCustOrds[o.customer_id] = (allTimeCustOrds[o.customer_id] || 0) + 1; });
      const repeatPct = totalCustCount > 0
        ? Math.round(Object.values(allTimeCustOrds).filter(v => v > 1).length / totalCustCount * 100) : 0;

      // Profit
      const prodMap = Object.fromEntries((products || []).map(p => [p.id, p]));
      let totalCost = 0;
      const prodRevMap = {};
      (orderItems || []).forEach(item => {
        const o = (allOrders || []).find(x => x.id === item.order_id);
        if (!o || o.order_status === 'cancelled') return;
        const p = prodMap[item.product_id];
        if (!p) return;
        const rev = (parseFloat(item.price_at_time) || 0) * (item.quantity || 1);
        totalCost += (parseFloat(p.cost_price) || 0) * (item.quantity || 1);
        prodRevMap[p.id] = (prodRevMap[p.id] || 0) + rev;
      });
      const profit = revenue - totalCost - gstTotal;
      const margin = revenue > 0 ? Math.round(profit / revenue * 100) : 0;

      // Revenue chart
      const now = new Date();
      const chartData = Array.from({ length: Math.min(days, 30) }, (_, i) => {
        const d = new Date(now); d.setDate(d.getDate() - (Math.min(days, 30) - 1 - i));
        const ds = d.toDateString();
        const dayO = active.filter(o => new Date(o.created_at).toDateString() === ds);
        const dayRev = dayO.reduce((s, o) => s + (parseFloat(o.total_amount) || 0), 0);
        return {
          date:    days <= 7 ? d.toLocaleDateString('en-IN', { weekday: 'short' }) : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }),
          revenue: Math.round(dayRev),
          orders:  dayO.length,
          profit:  Math.round(dayRev * (margin / 100)) };
      });

      // Forecast
      const recent7  = chartData.slice(-7).map(d => d.revenue);
      const ma       = recent7.reduce((s, v) => s + v, 0) / Math.max(recent7.length, 1);
      const forecast = [
        ...chartData.map(d => ({ ...d, forecast: null })),
        ...Array.from({ length: 14 }, (_, i) => ({
          date:    new Date(now.getTime() + (i + 1) * 86400000).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }),
          revenue: null, forecast: Math.max(0, Math.round(ma * (1 + i * 0.01))) })),
      ];

      // Order status donut
      const statusCount = {};
      (allOrders || []).forEach(o => { statusCount[o.order_status] = (statusCount[o.order_status] || 0) + 1; });
      const statusData = Object.entries(statusCount).map(([k, v]) => ({ name: k, value: v }));

      // Top products
      const topProds = Object.entries(prodRevMap)
        .sort((a, b) => b[1] - a[1]).slice(0, 5)
        .map(([id, rev]) => ({ name: (prodMap[id]?.emoji || '') + ' ' + (prodMap[id]?.name || '').substring(0, 14), revenue: Math.round(rev) }));

      // Category split
      const catRev = {};
      (orderItems || []).forEach(item => {
        const o = (allOrders || []).find(x => x.id === item.order_id);
        if (!o || o.order_status === 'cancelled') return;
        const p = prodMap[item.product_id];
        if (!p) return;
        catRev[catMap[p.category_id] || 'Other'] = (catRev[catMap[p.category_id] || 'Other'] || 0)
          + (parseFloat(item.price_at_time) || 0) * (item.quantity || 1);
      });
      const catData = Object.entries(catRev).sort((a, b) => b[1] - a[1]).map(([name, value]) => ({ name, value: Math.round(value) }));

      // Payment split
      const online = active.filter(o => o.payment_method === 'razorpay_online').length;
      const payData = [{ name: 'Online', value: online }, { name: 'COD/WhatsApp', value: active.length - online }];

      // Customer growth
      const custGrowth = Array.from({ length: Math.min(days, 30) }, (_, i) => {
        const d = new Date(now); d.setDate(d.getDate() - (Math.min(days, 30) - 1 - i));
        return {
          date:  d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }),
          count: (allCustomers || []).filter(c => new Date(c.created_at) <= d).length };
      });

      // Region — based on customers who placed orders in this period
      const regionCount = {};
      const orderedCustIds = new Set(active.map(o => o.customer_id).filter(Boolean));
      (allCustomers || []).forEach(c => {
        if (orderedCustIds.has(c.id) && c.state) {
          regionCount[c.state] = (regionCount[c.state] || 0) + 1;
        }
      });
      const regions = Object.entries(regionCount).sort((a, b) => b[1] - a[1]).slice(0, 8);

      // Seasonal
      // Seasonal always uses ALL-TIME orders (ignore date filter)
      const monthRev = Array(12).fill(0);
      (allOrdersForStats || allOrders || []).forEach(o => {
        if (o.order_status !== 'cancelled') monthRev[new Date(o.created_at).getMonth()] += parseFloat(o.total_amount) || 0;
      });
      const seasonal = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
        .map((m, i) => ({ month: m, revenue: Math.round(monthRev[i]) }));

      // Recent orders (enriched with customer names)
      const custMap2 = Object.fromEntries((allCustomers || []).map(c => [c.id, `${c.first_name || ''} ${c.last_name || ''}`.trim() || 'Guest']));
      const recentOrders = (allOrders || []).slice(0, 8).map(o => ({ ...o, customerName: custMap2[o.customer_id] || 'Guest' }));

      // Low stock
      const lowStock = (products || []).filter(p => (p.available_stock || 0) <= 10)
        .map(p => ({ ...p, margin: p.price > 0 ? Math.round((p.price - (p.cost_price || 0)) / p.price * 100) : 0 }))
        .sort((a, b) => a.available_stock - b.available_stock).slice(0, 8);

      // Coupon & Cart — FIXED: use coupon_usage count, not coupons count
      const couponUseCount  = (couponUsage || []).length;
      const couponDiscount  = (couponUsage || []).reduce((s, c) => s + (parseFloat(c.discount_amount) || 0), 0);
      const abandonedCount  = (abandoned || []).length;
      const convertedCount  = 0; // status column not in DB
      const abandonRate     = abandonedCount > 0 ? Math.round((abandonedCount - convertedCount) / abandonedCount * 100) : 0;
      const revenueLost     = (abandoned || []).reduce((s, c) => s + (parseFloat(c.cart_total) || 0), 0);

      // Return Rate KPI
      const returnCount   = (returns || []).length;
      const refundTotal   = (returns || []).reduce((s,r) => s+(parseFloat(r.refund_amount)||0), 0);
      const returnRate    = (allOrders||[]).length > 0 ? Math.round(returnCount / (allOrders||[]).length * 100) : 0;

      // Pending orders enriched (for drill-down)
      const pendingEnriched = pending.map(o => ({ ...o, customerName: custMap2[o.customer_id] || 'Guest' }));

      // Enrich allOrders with customerName for drill-down
      const custMap2Enriched = Object.fromEntries((allCustomers || []).map(c => [c.id, `${c.first_name||''} ${c.last_name||''}`.trim()||'Guest']));
      const enrichedAllOrders = (allOrders || []).map(o => ({ ...o, customerName: custMap2Enriched[o.customer_id] || 'Guest' }));

      setData({
        revenue, revTrend, aov, pendingCount, repeatPct, margin, profit, gstTotal,
        activeCount: active.length,
        allOrders: enrichedAllOrders,
        totalCustCount, newCustCount,
        chartData, forecast, statusData, topProds, catData, payData, custGrowth, regions, seasonal,
        recentOrders, lowStock,
        couponUseCount, couponDiscount, abandonedCount, convertedCount, abandonRate, revenueLost,
        pendingEnriched,
        returnRate, returnCount, refundTotal });
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  if (loading) return <Loader text="Loading dashboard…" />;
  if (error)   return <ErrorMsg error={error} onRetry={() => loadDashboard(days)} />;
  if (!data)   return null;

  const tipBg = typeof document !== 'undefined' ? getComputedStyle(document.documentElement).getPropertyValue('--bg2').trim() || '#161b22' : '#161b22';
  const tipTx = typeof document !== 'undefined' ? getComputedStyle(document.documentElement).getPropertyValue('--tx').trim() || '#e6edf3' : '#e6edf3';
  const tip = { 
    contentStyle: { background: 'var(--tooltip-bg,#161b22)', border: '1px solid var(--tooltip-bd,#30363d)', borderRadius: 8, fontSize: 12, color: 'var(--tx,#e6edf3)' }, 
    labelStyle: { color: 'var(--tx,#e6edf3)', fontWeight: 600 },
    itemStyle: { color: 'var(--tx2,#8b949e)' },
    cursor: { fill: 'rgba(255,255,255,0.04)' }
  };

  return (
    <div className="space-y-4">

      {/* Drill-down Modal */}
      {drill?.type === 'pending' && (
        <DrillModal title={`⏳ Pending Orders (${data.pendingEnriched.length})`} onClose={() => setDrill(null)}>
          <table className="w-full">
            <thead><tr>
              {['Order #','Customer','Amount','Date'].map(h => (
                <th key={h} className="text-left text-[10px] font-bold text-[#6e7681] uppercase tracking-wider pb-2 pr-4">{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {data.pendingEnriched.map(o => (
                <tr key={o.id} className="border-t border-[#30363d]/50">
                  <td className="py-2 text-[11px] font-mono pr-4" style={{color:"var(--accent,#60a5fa)"}}>{o.order_number || '#' + String(o.id).slice(-6).toUpperCase()}</td>
                  <td className="py-2 text-[12px] font-semibold pr-4" style={{color:"var(--tx,#e2fce8)"}}>{o.customerName}</td>
                  <td className="py-2 text-[12px] font-bold pr-4">{fmtCurrency(parseFloat(o.total_amount) || 0)}</td>
                  <td className="py-2 text-[11px] text-[#6e7681]">{new Date(o.created_at).toLocaleDateString('en-IN')}</td>
                </tr>
              ))}
              {data.pendingEnriched.length === 0 && <tr><td colSpan={4} className="py-4 text-center text-[#3fb950]">✓ No pending orders</td></tr>}
            </tbody>
          </table>
          <div className="mt-4 text-center">
            <button onClick={() => { setDrill(null); router.push('/admin/operations'); }}
              className="px-4 py-2 bg-[#1a5c2a] hover:bg-[#1a5c2a] text-white text-[12px] rounded-lg transition">
              View in Operations →
            </button>
          </div>
        </DrillModal>
      )}

      {drill?.type === 'status' && (
        <DrillModal title={`${drill.status.charAt(0).toUpperCase() + drill.status.slice(1)} Orders`} onClose={() => setDrill(null)}>
          <table className="w-full">
            <thead><tr>
              {['Order #','Customer','Amount','Date'].map(h => (
                <th key={h} className="text-left text-[10px] font-bold text-[#6e7681] uppercase tracking-wider pb-2 pr-4">{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {(data.allOrders || []).filter(o => o.order_status === drill.status).map(o => (
                <tr key={o.id} className="border-t border-[#30363d]/50">
                  <td className="py-2 text-[11px] font-mono pr-4" style={{color:"var(--accent,#60a5fa)"}}>{o.order_number || '#' + String(o.id).slice(-6).toUpperCase()}</td>
                  <td className="py-2 text-[12px] font-semibold pr-4" style={{color:"var(--tx,#e2fce8)"}}>{o.customerName || 'Guest'}</td>
                  <td className="py-2 text-[12px] font-bold pr-4">{fmtCurrency(parseFloat(o.total_amount) || 0)}</td>
                  <td className="py-2 text-[11px] text-[#6e7681]">{new Date(o.created_at).toLocaleDateString('en-IN')}</td>
                </tr>
              ))}
              {(data.allOrders || []).filter(o => o.order_status === drill.status).length === 0 && (
                <tr><td colSpan={4} className="py-4 text-center text-[#6e7681]">No orders with this status</td></tr>
              )}
            </tbody>
          </table>
          <div className="mt-4 text-center">
            <button onClick={() => { setDrill(null); router.push('/admin/orders'); }}
              className="px-4 py-2 bg-[#1a5c2a] hover:bg-[#1a5c2a] text-white text-[12px] rounded-lg transition">
              View All Orders →
            </button>
          </div>
        </DrillModal>
      )}

      {drill?.type === 'revenue' && (
        <DrillModal title={`💰 Revenue Orders (${data.activeCount})`} onClose={() => setDrill(null)}>
          <table className="w-full">
            <thead><tr>
              {['Order #','Customer','Amount','Status','Date'].map(h => (
                <th key={h} className="text-left text-[10px] font-bold text-[#6e7681] uppercase tracking-wider pb-2 pr-4">{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {data.recentOrders.map(o => (
                <tr key={o.id} className="border-t border-[#30363d]/50">
                  <td className="py-2 text-[11px] font-mono pr-4" style={{color:"var(--accent,#60a5fa)"}}>{o.order_number || '#' + String(o.id).slice(-6).toUpperCase()}</td>
                  <td className="py-2 text-[12px] text-white pr-4">{o.customerName}</td>
                  <td className="py-2 text-[12px] font-bold pr-4">{fmtCurrency(parseFloat(o.total_amount) || 0)}</td>
                  <td className="py-2 pr-4"><StatusBadge status={o.order_status} /></td>
                  <td className="py-2 text-[11px] text-[#6e7681]">{new Date(o.created_at).toLocaleDateString('en-IN')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </DrillModal>
      )}

      {drill?.type === 'customers' && (
        <DrillModal title={`👥 Customers`} onClose={() => setDrill(null)}>
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div className="bg-[#21262d] rounded-lg p-3 text-center">
              <div className="text-[10px] text-[#6e7681] mb-1">New This Period</div>
              <div className="text-[20px] font-bold text-[#58a6ff]">{data.newCustCount}</div>
            </div>
            <div className="bg-[#21262d] rounded-lg p-3 text-center">
              <div className="text-[10px] text-[#6e7681] mb-1">Total Registered</div>
              <div className="text-[20px] font-bold text-white">{data.totalCustCount}</div>
            </div>
          </div>
          <button onClick={() => { setDrill(null); router.push('/admin/customers'); }}
            className="px-4 py-2 bg-[#1a5c2a] hover:bg-[#1a5c2a] text-white text-[12px] rounded-lg transition">
            View All Customers →
          </button>
        </DrillModal>
      )}

      {/* Smart Alert Banners */}
      <SmartAlerts data={data} days={days} />

      {/* KPI Row */}
      <div className="grid grid-cols-4 gap-3 lg:grid-cols-7">
        <KpiCard label="Total Revenue"     value={fmtCurrency(data.revenue)}   trend={data.revTrend}  accentColor="#1a5c2a"
          onClick={() => setDrill({ type: 'revenue' })} />
        <KpiCard label="Total Orders"      value={data.activeCount}             sub={`Last ${days} days`} accentColor="#58a6ff"
          onClick={() => router.push('/admin/operations')} />
        <KpiCard label="Pending Orders"    value={data.pendingCount}            sub="needs action"     accentColor="#f85149"
          onClick={() => setDrill({ type: 'pending' })} />
        <KpiCard label="Customers"         value={data.newCustCount}
          sub={`of ${data.totalCustCount} total`} accentColor="#d29922"
          onClick={() => setDrill({ type: 'customers' })} />
        <KpiCard label="Avg Order Value"   value={fmtCurrency(data.aov)}        sub="per active order" accentColor="#8957e5" />
        <KpiCard label="Repeat Customer %" value={data.repeatPct + '%'}         sub="all-time metric" accentColor="#3fb950"
          onClick={() => router.push('/admin/customers')} />
        {/* Return Rate — matches KpiCard style */}
        {(() => {
          const rc = data.returnRate > 8 ? '#f85149' : data.returnRate > 4 ? '#ffa600' : '#3fb950';
          return (
            <div className="rounded-xl p-4 flex flex-col gap-1 cursor-pointer transition hover:brightness-110"
              style={{ background:'var(--bg2,#161b22)', border:`1px solid ${rc}55`, boxShadow:`inset 3px 0 0 0 ${rc}` }}
              onClick={() => router.push('/admin/returns')}>
              <div className="text-[10px] font-bold uppercase tracking-widest" style={{color:'var(--tx2,#6e9a75)'}}>Return Rate</div>
              <div className="text-[26px] font-bold tabular-nums leading-tight" style={{color:'#ffffff'}}>{data.returnRate}%</div>
              <div className="text-[11px]" style={{color: rc}}>
                {data.returnCount} return{data.returnCount !== 1 ? 's' : ''}
              </div>
              <div className="text-[9px] font-semibold" style={{color: rc}}>
                {data.returnRate > 8 ? '⚠ Above 8% target' : data.returnRate > 4 ? '↗ Watch closely' : '✓ Target: <8%'}
              </div>
              <div className="h-[2px] rounded-full mt-2 -mx-4 -mb-4" style={{ background: rc }} />
            </div>
          );
        })()}
      </div>

      {/* Revenue Trend + Status Donut */}
      <div className="grid grid-cols-3 gap-4">
        <div className="col-span-2">
          <Card title="Revenue Trend">
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={data.chartData}>
                <XAxis dataKey="date" tick={{ fill: 'var(--chart-axis,#6e7681)', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis yAxisId="rev" tick={{ fill: 'var(--chart-axis,#6e7681)', fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={v => '₹' + Math.round(v / 1000) + 'k'} />
                <YAxis yAxisId="ord" orientation="right" tick={{ fill: 'var(--chart-axis,#58a6ff)', fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip {...tip} formatter={(v, n) => [n === 'orders' ? v : fmtCurrency(v), n]} />
                <Bar yAxisId="rev" dataKey="revenue" fill="var(--accent,#22c55e)" radius={[4,4,0,0]} />
                <Line yAxisId="ord" type="monotone" dataKey="orders" stroke="#58a6ff" strokeWidth={2} dot={false} />
              </BarChart>
            </ResponsiveContainer>
          </Card>
        </div>
        <Card title="Order Status">
          <ResponsiveContainer width="100%" height={140}>
            <PieChart>
              <Pie data={data.statusData} dataKey="value" cx="50%" cy="50%" innerRadius={45} outerRadius={65}
                onClick={(entry) => entry && setDrill({ type: 'status', status: entry.name })}>
                {data.statusData.map((s, i) => <Cell key={i} fill={STATUS_COLORS[s.name] || COLORS[i % COLORS.length]} />)}
              </Pie>
              <Tooltip {...tip} />
            </PieChart>
          </ResponsiveContainer>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {data.statusData.map((s, i) => (
              <span key={i} className="flex items-center gap-1 text-[10px]" style={{color:"var(--tx2,#8b949e)"}}>
                <span className="w-2 h-2 rounded-sm inline-block" style={{ background: STATUS_COLORS[s.name] || COLORS[i] }} />
                {s.name} ({s.value})
              </span>
            ))}
          </div>
        </Card>
      </div>

      {/* Top Products + Category + GST/Profit */}
      <div className="grid grid-cols-3 gap-4">
        <Card title="Top 5 Products by Revenue" action={<button onClick={() => router.push('/admin/products')} className="text-[11px]" style={{color:"var(--accent,#58a6ff)"}}>View all →</button>}>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={data.topProds} layout="vertical">
              <XAxis type="number" tick={{ fill: 'var(--chart-axis,#6e7681)', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={v => '₹' + Math.round(v / 1000) + 'k'} />
              <YAxis type="category" dataKey="name" tick={{ fill: 'var(--chart-axis,#6e7681)', fontSize: 10 }} axisLine={false} tickLine={false} width={90} />
              <Tooltip {...tip} formatter={v => [fmtCurrency(v), 'Revenue']} />
              <Bar dataKey="revenue" radius={[0,4,4,0]}>
                {data.topProds.map((_, i) => <Cell key={i} fill={COLORS[i]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>
        <Card title="Category Sales">
          <ResponsiveContainer width="100%" height={120}>
            <PieChart>
              <Pie data={data.catData} dataKey="value" cx="50%" cy="50%" innerRadius={30} outerRadius={52}>
                {data.catData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Pie>
              <Tooltip {...tip} formatter={v => [fmtCurrency(v), 'Revenue']} />
            </PieChart>
          </ResponsiveContainer>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {data.catData.map((c, i) => (
              <span key={i} className="flex items-center gap-1 text-[10px]" style={{color:"var(--tx2,#8b949e)"}}>
                <span className="w-2 h-2 rounded-sm inline-block" style={{ background: COLORS[i % COLORS.length] }} />
                {c.name}
              </span>
            ))}
          </div>
        </Card>
        <Card title="GST & Profit">
          <div className="grid grid-cols-3 gap-2 mb-3">
            {[['Total GST', data.gstTotal], ['CGST', data.gstTotal / 2], ['SGST', data.gstTotal / 2]].map(([l, v]) => (
              <div key={l} className="bg-[#21262d] rounded-lg p-2.5 text-center">
                <div className="text-[10px] text-[#6e7681] mb-1">{l}</div>
                <div className="text-[14px] font-bold" style={{color:"var(--tx,#e2fce8)"}}>{fmtCurrency(v)}</div>
              </div>
            ))}
          </div>
          <div className="bg-[#21262d] rounded-lg p-2.5 text-center">
            <div className="text-[10px] text-[#6e7681] mb-1">Gross Profit (est.)</div>
            <div className="text-[15px] font-bold" style={{ color: data.profit >= 0 ? '#3fb950' : '#f85149' }}>
              {fmtCurrency(data.profit)} <span className="text-[11px]">({data.margin}%)</span>
            </div>
          </div>
        </Card>
      </div>

      {/* Revenue vs Profit + Customer Growth */}
      <div className="grid grid-cols-2 gap-4">
        <Card title="Revenue vs Profit">
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={data.chartData}>
              <XAxis dataKey="date" tick={{ fill: 'var(--chart-axis,#6e7681)', fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: 'var(--chart-axis,#6e7681)', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={v => '₹' + Math.round(v / 1000) + 'k'} />
              <Tooltip {...tip} formatter={(v, n) => [fmtCurrency(v), n]} />
              <Bar dataKey="revenue" fill="var(--accent,#22c55e)" fillOpacity={0.7} radius={[3,3,0,0]} name="Revenue" />
              <Bar dataKey="profit" fill="var(--accent,#22c55e)" radius={[3,3,0,0]} name="Profit" />
            </BarChart>
          </ResponsiveContainer>
        </Card>
        <Card title="Customer Growth Trend" action={<button onClick={() => router.push('/admin/customers')} className="text-[11px]" style={{color:"var(--accent,#58a6ff)"}}>Details →</button>}>
          <ResponsiveContainer width="100%" height={160}>
            <AreaChart data={data.custGrowth}>
              <XAxis dataKey="date" tick={{ fill: 'var(--chart-axis,#6e7681)', fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: 'var(--chart-axis,#6e7681)', fontSize: 10 }} axisLine={false} tickLine={false} />
              <Tooltip {...tip} />
              <Area type="monotone" dataKey="count" stroke="var(--accent,#22c55e)" fill="rgba(34,197,94,0.1)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </Card>
      </div>

      {/* Sales Forecast + Region */}
      <div className="grid grid-cols-2 gap-4">
        <Card title="Sales Forecast — Next 14 Days">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[10px] text-[#58a6ff] bg-blue-950/30 px-2 py-0.5 rounded-full">Moving Average</span>
          </div>
          <ResponsiveContainer width="100%" height={150}>
            <LineChart data={data.forecast}>
              <XAxis dataKey="date" tick={{ fill: 'var(--tx2,#6e7681)', fontSize: 9 }} axisLine={false} tickLine={false} interval={Math.floor(data.forecast.length / 6)} />
              <YAxis tick={{ fill: 'var(--chart-axis,#6e7681)', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={v => '₹' + Math.round(v / 1000) + 'k'} />
              <Tooltip {...tip} formatter={(v, n) => [v ? fmtCurrency(v) : '—', n]} />
              <Line type="monotone" dataKey="revenue"  stroke="#1a5c2a" strokeWidth={2} dot={false} connectNulls={false} />
              <Line type="monotone" dataKey="forecast" stroke="#58a6ff" strokeWidth={2} strokeDasharray="5 5" dot={false} connectNulls={false} />
            </LineChart>
          </ResponsiveContainer>
        </Card>
        <Card title="Region-wise Orders">
          <div className="space-y-2">
            {data.regions.length ? data.regions.map(([reg, cnt], i) => (
              <div key={i}>
                <div className="flex justify-between text-[12px] mb-1">
                  <span style={{color:"var(--tx,#e6edf3)"}}>{reg}</span>
                  <span style={{color:"var(--tx2,#6e7681)"}}>{cnt} order{cnt>1?"s":""}</span>
                </div>
                <div className="h-1.5 bg-[#21262d] rounded-full overflow-hidden">
                  <div className="h-full bg-[#1a5c2a] rounded-full" style={{ width: `${Math.round(cnt / data.regions[0][1] * 100)}%` }} />
                </div>
              </div>
            )) : <div className="text-[#6e7681] text-sm text-center py-4">No region data yet</div>}
          </div>
        </Card>
      </div>

      {/* Coupon + Payment */}
      <div className="grid grid-cols-2 gap-4">
        <Card title="Coupon & Cart Analytics" action={<button onClick={() => router.push('/admin/marketing')} className="text-[11px]" style={{color:"var(--accent,#58a6ff)"}}>Details →</button>}>
          <div className="grid grid-cols-2 gap-2">
            {[
              ['Coupon Uses',    data.couponUseCount,              '#3fb950'],
              ['Discount Given', fmtCurrency(data.couponDiscount), '#58a6ff'],
              ['Abandoned',      data.abandonedCount,              '#f85149'],
              ['Recovered',      data.convertedCount,              '#d29922'],
            ].map(([l, v, c]) => (
              <div key={l} className="bg-[#21262d] rounded-lg p-2.5 text-center">
                <div className="text-[10px] text-[#6e7681] mb-1">{l}</div>
                <div className="text-[15px] font-bold" style={{ color: c }}>{v}</div>
              </div>
            ))}
          </div>
          {data.abandonedCount > 0 && (
            <div className="mt-2 text-center text-[11px]" style={{ color: data.abandonRate > 50 ? '#f85149' : '#d29922' }}>
              {data.abandonRate}% abandon rate · ₹{fmt(data.revenueLost)} lost
            </div>
          )}
        </Card>

        <Card title="Payment Method Split">
          <ResponsiveContainer width="100%" height={110}>
            <PieChart>
              <Pie data={data.payData} dataKey="value" cx="50%" cy="50%" innerRadius={30} outerRadius={50}>
                <Cell fill="#60a5fa" /><Cell fill="#a78bfa" />
              </Pie>
              <Tooltip {...tip} />
            </PieChart>
          </ResponsiveContainer>
          <div className="flex gap-3 justify-center mt-2">
            {data.payData.map((p, i) => (
              <span key={i} className="flex items-center gap-1 text-[11px] text-[#8b949e]">
                <span className="w-2 h-2 rounded-sm inline-block" style={{ background: i === 0 ? '#58a6ff' : '#8957e5' }} />
                {p.name}: {p.value}
              </span>
            ))}
          </div>
        </Card>
      </div>

      {/* Quick Navigation — replaces removed Recent Orders + Low Stock tables */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'All Orders', sub: `${data.activeCount} active · ${data.pendingCount} pending`, color: '#58a6ff', href: '/admin/orders' },
          { label: 'Low Stock Products', sub: `${data.lowStock.length} product${data.lowStock.length !== 1 ? 's' : ''} need restocking`, color: '#f85149', href: '/admin/products' },
          { label: 'Analytics & Insights', sub: 'Cohort · Heatmap · Region map', color: '#8957e5', href: '/admin/analytics' },
        ].map(q => (
          <button key={q.label} onClick={() => router.push(q.href)}
            className="rounded-xl p-4 text-left transition hover:brightness-110"
            style={{ background:'var(--bg2,#161b22)', border:`1px solid ${q.color}55`, boxShadow:`inset 3px 0 0 0 ${q.color}` }}>
            <div className="text-[13px] font-semibold text-white">{q.label} →</div>
            <div className="text-[11px] mt-1" style={{ color: q.color }}>{q.sub}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

// Suspense boundary required by Next.js for useSearchParams
export default function DashboardPageWrapper(props) {
  return (
    <Suspense fallback={<div className="flex items-center justify-center py-24" style={{color:'var(--tx2,#6e7681)'}}>Loading…</div>}>
      <DashboardPage {...props} />
    </Suspense>
  );
}
