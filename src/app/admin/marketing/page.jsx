'use client';
import { useSearchParams } from 'next/navigation';
import { useState, useEffect, useCallback, Suspense} from 'react';
import { api, buildDateFilter, fmtCurrency, fmt } from '@/lib/api';
import KpiCard from '@/components/ui/KpiCard';
import { Card, Loader, ErrorMsg, Badge } from '@/components/ui/index';
import Modal from '@/components/ui/Modal';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell  } from 'recharts';

const COLORS = ['#1a5c2a','#58a6ff','#d29922','#8957e5','#f85149','#3fb950'];

function MarketingPage() {
  const searchParams = useSearchParams();
  const days = parseInt(searchParams.get('days') || '7', 10);
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);
  const [drill, setDrill] = useState(null);

  useEffect(() => { load(days); }, [days]);

  async function load(days) {
    setLoading(true); setError(null);
    try {
      const since = buildDateFilter(days);
      // NOTE: orders table has no coupon_code column — use coupon_usage table only
      const [orders, coupons, couponUsage, abandoned, customers] = await Promise.all([
        api.get('orders', `select=id,total_amount,order_status,payment_method,created_at&created_at=gte.${since}`),
        api.get('coupons', 'select=id,code,type,value,uses_count,is_active').catch(() => []),
        api.get('coupon_usage', `select=id,coupon_id,order_id,discount_amount,used_at&used_at=gte.${since}`).catch(() => []),
        api.get('abandoned_carts', `select=id,cart_total,created_at&created_at=gte.${since}`).catch(() => []),
        api.get('customers', `select=id,created_at&is_deleted=eq.false&created_at=gte.${since}`),
      ]);

      const active    = (orders || []).filter(o => o.order_status !== 'cancelled');
      const revenue   = active.reduce((s, o) => s + (parseFloat(o.total_amount) || 0), 0);
      const totalOrds = active.length;

      const couponRevenue  = (couponUsage || []).reduce((s, c) => s + (parseFloat(c.discount_amount) || 0), 0);
      const couponOrdCount = (couponUsage || []).length;

      const totalAbandoned   = (abandoned || []).length;
      const converted        = (abandoned || []).filter(c => c.status === 'converted').length;
      const abandonRate      = totalAbandoned > 0 ? Math.round((totalAbandoned - converted) / totalAbandoned * 100) : 0;
      const abandonedRevLost = (abandoned || []).filter(c => c.status !== 'converted').reduce((s, c) => s + (parseFloat(c.cart_total) || 0), 0);

      const funnelData = [
        { name: 'Visitors (est.)',  value: totalOrds * 8 || 1 },
        { name: 'Product Views',    value: totalOrds * 5 || 1 },
        { name: 'Add to Cart',      value: totalOrds * 2 + totalAbandoned || 1 },
        { name: 'Checkout Started', value: totalOrds + totalAbandoned || 1 },
        { name: 'Orders Placed',    value: totalOrds || 0 },
      ];

      const payData = [
        { name: 'Online (Razorpay)', value: active.filter(o => o.payment_method === 'razorpay_online').length },
        { name: 'COD / WhatsApp',    value: active.filter(o => o.payment_method !== 'razorpay_online').length },
      ];

      const now = new Date();
      const dailyRev = Array.from({ length: Math.min(days, 30) }, (_, i) => {
        const d = new Date(now); d.setDate(d.getDate() - (Math.min(days, 30) - 1 - i));
        const ds = d.toDateString();
        const dayOrds = active.filter(o => new Date(o.created_at).toDateString() === ds);
        return {
          date:    d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }),
          revenue: Math.round(dayOrds.reduce((s, o) => s + (parseFloat(o.total_amount) || 0), 0)),
          coupons: (couponUsage || []).filter(c => new Date(c.used_at||c.created_at).toDateString() === ds).length };
      });

      const couponMap   = Object.fromEntries((coupons || []).map(c => [c.id, c]));
      const couponStats = {};
      (couponUsage || []).forEach(u => {
        const c = couponMap[u.coupon_id];
        if (!c) return;
        if (!couponStats[c.code]) couponStats[c.code] = { code: c.code, type: c.type, value: c.value, uses: 0, discount: 0 };
        couponStats[c.code].uses++;
        couponStats[c.code].discount += parseFloat(u.discount_amount) || 0;
      });

      setData({
        revenue, totalOrds, couponRevenue, couponOrdCount, abandonRate, totalAbandoned, abandonedRevLost,
        converted,
        funnelData, payData, dailyRev, couponStats: Object.values(couponStats),
        allCoupons: coupons || [] });
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  if (loading) return <Loader text="Loading marketing data…" />;
  if (error)   return <ErrorMsg error={error} onRetry={() => load(days)} />;
  if (!data)   return null;

  const tip = { contentStyle: { background: 'var(--bg2,#161b22)', border: '1px solid var(--bd,#30363d)', borderRadius: 8, fontSize: 12, color: 'var(--tx,#e6edf3)' }, labelStyle: { color: 'var(--tx,#e6edf3)', fontWeight: 600 }, itemStyle: { color: 'var(--tx2,#8b949e)' }, cursor: { fill: 'rgba(255,255,255,0.04)' } };

  return (
    <div className="space-y-4">
      {drill === 'coupons' && (
        <Modal title={`Coupon Usage — Last ${days} Days`} onClose={() => setDrill(null)}>
          {data.couponStats.length > 0 ? (
            <table className="w-full">
              <thead><tr>
                {['Code','Uses','Discount Given'].map(h=>(
                  <th key={h} className="text-left text-[10px] font-bold text-[#6e7681] uppercase pb-2 pr-4">{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {data.couponStats.sort((a,b)=>b.uses-a.uses).map(c=>(
                  <tr key={c.code} className="border-t border-[#30363d]/50">
                    <td className="py-2 pr-4 text-[13px] text-[#58a6ff] font-mono font-bold">{c.code}</td>
                    <td className="py-2 pr-4 text-[12px] font-bold text-white">{c.uses}</td>
                    <td className="py-2 text-[12px] font-bold text-[#f85149]">₹{fmt(c.discount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <div className="text-center py-8 text-[#6e7681]">No coupon usage in this period</div>}
        </Modal>
      )}
      {drill === 'abandoned' && (
        <Modal title={`Abandoned Carts (${data.totalAbandoned})`} onClose={() => setDrill(null)}>
          <div className="grid grid-cols-3 gap-3 mb-4">
            <div className="bg-[#21262d] rounded-lg p-3 text-center">
              <div className="text-[10px] text-[#6e7681] mb-1">Total Abandoned</div>
              <div className="text-[18px] font-bold text-[#f85149]">{data.totalAbandoned}</div>
            </div>
            <div className="bg-[#21262d] rounded-lg p-3 text-center">
              <div className="text-[10px] text-[#6e7681] mb-1">Recovered</div>
              <div className="text-[18px] font-bold text-[#3fb950]">{data.converted}</div>
            </div>
            <div className="bg-[#21262d] rounded-lg p-3 text-center">
              <div className="text-[10px] text-[#6e7681] mb-1">Revenue Lost</div>
              <div className="text-[18px] font-bold text-[#d29922]">{fmtCurrency(data.abandonedRevLost)}</div>
            </div>
          </div>
          <div className="text-center text-[12px] text-[#6e7681]">Abandon Rate: <span className="text-white font-bold">{data.abandonRate}%</span></div>
        </Modal>
      )}
      <div className="grid grid-cols-4 gap-3">
        <KpiCard label="Revenue"        value={fmtCurrency(data.revenue)}          sub={`${data.totalOrds} orders`}            accentColor="#3fb950" />
        <KpiCard label="Coupon Uses"    value={data.couponOrdCount}                sub={`₹${fmt(data.couponRevenue)} discount`} accentColor="#58a6ff"
          onClick={() => setDrill('coupons')} />
        <KpiCard label="Abandoned Carts" value={data.totalAbandoned}               sub={`${data.abandonRate}% rate`}           accentColor="#d29922"
          onClick={() => setDrill('abandoned')} />
        <KpiCard label="Revenue Lost"   value={fmtCurrency(data.abandonedRevLost)} sub="from abandoned"                       accentColor="#f85149"
          onClick={() => setDrill('abandoned')} />
      </div>

      {/* Revenue + Coupon Chart */}
      <Card title="Revenue & Coupon Activity">
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={data.dailyRev}>
            <XAxis dataKey="date" tick={{ fill: 'var(--tx2,#6e7681)', fontSize: 10 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: 'var(--tx2,#6e7681)', fontSize: 10 }} axisLine={false} tickLine={false} />
            <Tooltip {...tip} formatter={(v, n) => [n === 'revenue' ? `₹${v}` : v, n === 'revenue' ? 'Revenue' : 'Coupon Uses']} />
            <Bar dataKey="revenue" fill="#1a5c2a" radius={[3,3,0,0]} />
            <Bar dataKey="coupons" fill="#58a6ff" radius={[3,3,0,0]} />
          </BarChart>
        </ResponsiveContainer>
      </Card>

      <div className="grid grid-cols-2 gap-4">
        {/* Payment Split */}
        <Card title="Sales by Channel">
          <ResponsiveContainer width="100%" height={180}>
            <PieChart>
              <Pie data={data.payData} cx="50%" cy="50%" outerRadius={70} dataKey="value">
                {data.payData.map((_, i) => <Cell key={i} fill={COLORS[i]} />)}
              </Pie>
              <Tooltip {...tip} />
            </PieChart>
          </ResponsiveContainer>
        </Card>

        {/* Conversion Funnel */}
        <Card title="Conversion Funnel">
          <div className="space-y-2 mt-2">
            {data.funnelData.map((f, i) => (
              <div key={f.name}>
                <div className="flex justify-between text-[11px] mb-1">
                  <span className="text-[#8b949e]">{f.name}</span>
                  <span className="text-white font-bold">{fmt(f.value)}</span>
                </div>
                <div className="h-5 bg-[#21262d] rounded overflow-hidden">
                  <div className="h-full rounded transition-all"
                    style={{ width: `${Math.round(f.value / data.funnelData[0].value * 100)}%`, background: COLORS[i] }} />
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Coupon Performance */}
      {data.couponStats.length > 0 && (
        <Card title="Coupon Performance">
          <table className="w-full">
            <thead><tr>
              {['Code','Type','Value','Uses','Discount Given'].map(h => (
                <th key={h} className="text-left text-[10px] font-bold uppercase tracking-wider pb-2 pr-4" style={{color:"var(--tx2,#6e7681)"}}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {data.couponStats.sort((a,b) => b.uses - a.uses).map(c => (
                <tr key={c.code} className="border-t border-[#30363d]/50 hover:bg-[#21262d]/20">
                  <td className="py-2 pr-4 text-[12px] text-[#58a6ff] font-mono font-bold">{c.code}</td>
                  <td className="py-2 pr-4 text-[11px] text-[#8b949e]">{c.type}</td>
                  <td className="py-2 pr-4 text-[12px] text-white">{c.type === 'percent' ? `${c.value}%` : `₹${c.value}`}</td>
                  <td className="py-2 pr-4 text-[12px] text-white font-bold">{c.uses}</td>
                  <td className="py-2 text-[12px] text-[#f85149] font-bold">₹{fmt(c.discount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {/* All Coupons */}
      <Card title="All Active Coupons">
        <table className="w-full">
          <thead><tr>
            {['Code','Type','Value','Total Uses','Status'].map(h => (
              <th key={h} className="text-left text-[10px] font-bold uppercase tracking-wider pb-2 pr-4" style={{color:"var(--tx2,#6e7681)"}}>{h}</th>
            ))}
          </tr></thead>
          <tbody>
            {data.allCoupons.map(c => (
              <tr key={c.id} className="border-t border-[#30363d]/50 hover:bg-[#21262d]/20">
                <td className="py-2 pr-4 text-[12px] text-[#58a6ff] font-mono font-bold">{c.code}</td>
                <td className="py-2 pr-4 text-[11px] text-[#8b949e]">{c.type}</td>
                <td className="py-2 pr-4 text-[12px] text-white">{c.type === 'percent' ? `${c.value}%` : `₹${c.value}`}</td>
                <td className="py-2 pr-4 text-[12px] text-white">{c.uses_count || 0}</td>
                <td className="py-2">
                  <Badge type={c.is_active ? 'green' : 'red'}>{c.is_active ? 'Active' : 'Inactive'}</Badge>
                </td>
              </tr>
            ))}
            {data.allCoupons.length === 0 && (
              <tr><td colSpan={5} className="py-4 text-center text-[#6e7681] text-[12px]">No coupons found</td></tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

// Suspense boundary required by Next.js for useSearchParams
export default function MarketingPageWrapper(props) {
  return (
    <Suspense fallback={<div className="flex items-center justify-center py-24" style={{color:'var(--tx2,#6e7681)'}}>Loading…</div>}>
      <MarketingPage {...props} />
    </Suspense>
  );
}
