'use client';
import { useSearchParams } from 'next/navigation';
import { useState, useEffect, useCallback, Suspense} from 'react';
import { api, buildDateFilter, fmtCurrency, fmt } from '@/lib/api';
import KpiCard from '@/components/ui/KpiCard';
import { Card, Loader, ErrorMsg, Badge } from '@/components/ui/index';
import Modal from '@/components/ui/Modal';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, LineChart, Line  } from 'recharts';

const COLORS = ['#1a5c2a','#1a5c2a','#3fb950','var(--blue)','var(--purple)','#d29922','#f85149'];

function ProfitPage() {
  const searchParams = useSearchParams();
  const days = parseInt(searchParams.get('days') || '7', 10);
  const [data, setData]     = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState(null);
  const [drill, setDrill] = useState(null);
  const [sortBy, setSortBy] = useState('profit');

  useEffect(() => { load(days); }, [days]);

  async function load(days) {
    setLoading(true); setError(null);
    try {
      const since = new Date(buildDateFilter(days));
      const [products, orderItems, orders, categories] = await Promise.all([
        api.get('products', 'select=id,name,emoji,price,cost_price,gst_rate,available_stock,category_id&is_deleted=eq.false'),
        api.get('order_items', 'select=product_id,quantity,price_at_time,order_id'),
        api.get('orders', `select=id,total_amount,order_status,tax,created_at&created_at=gte.${since.toISOString()}`),
        api.get('categories', 'select=id,name'),
      ]);

      const catMap  = Object.fromEntries((categories||[]).map(c=>[c.id,c.name]));
      const activeIds = new Set((orders||[]).filter(o=>o.order_status!=='cancelled').map(o=>o.id));
      const prodMap = Object.fromEntries((products||[]).map(p=>[p.id,p]));

      // Per-product profit
      const stats = {};
      (products||[]).forEach(p => {
        stats[p.id] = {
          id: p.id, name: p.name, emoji: p.emoji||'',
          price: parseFloat(p.price)||0,
          costPrice: parseFloat(p.cost_price)||0,
          gstRate: parseFloat(p.gst_rate)||5,
          stock: p.available_stock||0,
          cat: catMap[p.category_id]||'Other',
          revenue: 0, units: 0, grossProfit: 0 };
      });

      (orderItems||[]).forEach(item => {
        if (!activeIds.has(item.order_id)) return;
        const s = stats[item.product_id];
        if (!s) return;
        const qty = item.quantity||1;
        const sellPrice = parseFloat(item.price_at_time)||0;
        const basePrice = sellPrice / (1 + s.gstRate/100); // ex-GST
        const cost = s.costPrice * qty;
        s.revenue += sellPrice * qty;
        s.units   += qty;
        s.grossProfit += (basePrice * qty) - cost;
      });

      const prodList = Object.values(stats).map(p => ({
        ...p,
        margin: p.revenue > 0 && p.costPrice > 0
          ? Math.round(p.grossProfit / (p.revenue / (1 + p.gstRate/100)) * 100)
          : null,
        roi: p.costPrice > 0 && p.units > 0
          ? Math.round((p.grossProfit / (p.costPrice * p.units)) * 100)
          : null }));

      // Totals
      const totalRev    = prodList.reduce((s,p) => s + p.revenue, 0);
      const totalGST    = (orders||[]).filter(o=>o.order_status!=='cancelled').reduce((s,o)=>s+(parseFloat(o.tax)||0),0);
      const totalProfit = prodList.reduce((s,p) => s + p.grossProfit, 0);
      const netProfit   = totalProfit - totalGST;
      const avgMargin   = totalRev > 0 ? Math.round(netProfit / totalRev * 100) : 0;

      // Category profit
      const catProfit = {};
      prodList.forEach(p => {
        if (!catProfit[p.cat]) catProfit[p.cat] = { name: p.cat, revenue: 0, profit: 0 };
        catProfit[p.cat].revenue += p.revenue;
        catProfit[p.cat].profit  += p.grossProfit;
      });
      const catData = Object.values(catProfit).sort((a,b) => b.profit-a.profit).map(c => ({
        ...c,
        margin: c.revenue > 0 ? Math.round(c.profit/c.revenue*100) : 0 }));

      // Daily profit trend
      const now = new Date();
      const dailyTrend = Array.from({ length: Math.min(days, 30) }, (_, i) => {
        const d = new Date(now); d.setDate(d.getDate() - (Math.min(days,30)-1-i));
        const ds = d.toDateString();
        const dayOrds = (orders||[]).filter(o => o.order_status!=='cancelled' && new Date(o.created_at).toDateString()===ds);
        const dayRev  = dayOrds.reduce((s,o)=>s+(parseFloat(o.total_amount)||0),0);
        const dayTax  = dayOrds.reduce((s,o)=>s+(parseFloat(o.tax)||0),0);
        const estProfit = dayRev > 0 ? Math.round(dayRev * (avgMargin/100)) : 0;
        return {
          date: days<=7 ? d.toLocaleDateString('en-IN',{weekday:'short'}) : d.toLocaleDateString('en-IN',{day:'numeric',month:'short'}),
          revenue: Math.round(dayRev),
          profit:  estProfit };
      });

      // Products missing cost_price
      const noCost = prodList.filter(p => p.costPrice === 0 && p.units > 0);

      setData({ prodList, totalRev, totalGST, totalProfit, netProfit, avgMargin, catData, dailyTrend, noCost });
    } catch(e) { setError(e.message); }
    finally { setLoading(false); }
  }

  if (loading) return <Loader text="Loading profit analysis…" />;
  if (error)   return <ErrorMsg error={error} onRetry={() => load(days)} />;
  if (!data)   return null;

  const tip = { contentStyle: { background: 'var(--tooltip-bg,#161b22)', border: '1px solid var(--tooltip-bd,#30363d)', borderRadius: 8, fontSize: 12, color: 'var(--tx,#e6edf3)' }, labelStyle: { color: 'var(--tx,#e6edf3)', fontWeight: 600 }, itemStyle: { color: 'var(--tx2,#8b949e)' }, cursor: { fill: 'color-mix(in srgb, var(--bd) 10%, transparent)' } };

  let sorted = [...data.prodList].filter(p => p.units > 0);
  if (sortBy==='profit')  sorted.sort((a,b)=>b.grossProfit-a.grossProfit);
  if (sortBy==='margin')  sorted.sort((a,b)=>(b.margin??-999)-(a.margin??-999));
  if (sortBy==='revenue') sorted.sort((a,b)=>b.revenue-a.revenue);
  if (sortBy==='roi')     sorted.sort((a,b)=>(b.roi??-999)-(a.roi??-999));

  return (
    <div className="space-y-4">
      {/* KPIs */}
      <div className="grid grid-cols-5 gap-3">
        <KpiCard label="Total Revenue"   value={fmtCurrency(data.totalRev)}    sub={`Last ${days} days`}      accentColor="#1a5c2a"
          onClick={() => { const el=document.getElementById('profit-table'); if(el) el.scrollIntoView({behavior:'smooth'}); }} />
        <KpiCard label="Gross Profit"    value={fmtCurrency(data.totalProfit)} sub="before GST deduction"     accentColor="#3fb950"
          onClick={() => setDrill('profit')} />
        <KpiCard label="GST Collected"   value={fmtCurrency(data.totalGST)}    sub="CGST + SGST"              accentColor="#58a6ff"
          onClick={() => setDrill('gst')} />
        <KpiCard label="Net Profit"      value={fmtCurrency(data.netProfit)}    sub="after GST"                accentColor={data.netProfit >= 0 ? '#3fb950' : '#f85149'}
          onClick={() => setDrill('profit')} />
        <KpiCard label="Avg Margin"      value={data.avgMargin + '%'}           sub="net profit / revenue"     accentColor="#d29922"
          onClick={() => { const el=document.getElementById('profit-table'); if(el) el.scrollIntoView({behavior:'smooth'}); }} />
      </div>

      {/* Warning — missing cost price */}
      {data.noCost.length > 0 && (
        <div className="bg-yellow-950/30 border border-yellow-700/40 rounded-xl p-3 flex items-center gap-3">
          <span className="text-lg">⚠️</span>
          <div>
            <div className="text-[12px] font-bold text-[var(--yellow)]">{data.noCost.length} products have no cost price set — profit calculation is inaccurate</div>
            <div className="text-[11px] text-[var(--tx3)]">{data.noCost.map(p=>p.name).join(', ')}</div>
          </div>
        </div>
      )}

      {/* Revenue vs Profit trend */}
      <div className="grid grid-cols-2 gap-4">
        <Card title="Revenue vs Profit Trend">
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={data.dailyTrend}>
              <XAxis dataKey="date" tick={{fill:'var(--chart-axis,#6e7681)',fontSize:10}} axisLine={false} tickLine={false} />
              <YAxis tick={{fill:'var(--chart-axis,#6e7681)',fontSize:10}} axisLine={false} tickLine={false} tickFormatter={v=> v >= 1000 ? '₹'+Math.round(v/1000)+'k' : '₹'+Math.round(v)} />
              <Tooltip {...tip} formatter={(v,n)=>[fmtCurrency(v),n]} />
              <Bar dataKey="revenue" fill="#1a5c2a" radius={[3,3,0,0]} name="Revenue" />
              <Bar dataKey="profit"  fill="#3fb950" radius={[3,3,0,0]} name="Est. Profit" />
            </BarChart>
          </ResponsiveContainer>
        </Card>

        {/* Category Profit */}
        <Card title="Profit by Category">
          <div className="space-y-3">
            {data.catData.map((c, i) => (
              <div key={c.name}>
                <div className="flex justify-between text-[12px] mb-1">
                  <span className="text-[var(--tx)] font-semibold">{c.name}</span>
                  <div className="flex gap-3">
                    <span className="text-[#3fb950] font-bold">{fmtCurrency(c.profit)}</span>
                    <span className="text-[var(--tx3)]">{c.margin}%</span>
                  </div>
                </div>
                <div className="h-2 bg-[var(--input-bg)] rounded-full overflow-hidden">
                  <div className="h-full rounded-full" style={{ width:`${data.catData[0]?.profit > 0 ? Math.round(c.profit/data.catData[0].profit*100) : 0}%`, background: COLORS[i%COLORS.length] }} />
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Per Product Profit Table */}
      <Card title="Product Profit Analysis" id="profit-table">
        <div className="flex gap-3 mb-4">
          <select value={sortBy} onChange={e=>setSortBy(e.target.value)}
            className="bg-[var(--input-bg)] border border-[var(--bd)] rounded-lg px-3 py-1.5 text-[12px] text-[var(--tx2)]">
            <option value="profit">Sort: Gross Profit ↓</option>
            <option value="margin">Sort: Margin % ↓</option>
            <option value="revenue">Sort: Revenue ↓</option>
            <option value="roi">Sort: ROI % ↓</option>
          </select>
          <span className="text-[11px] text-[var(--tx3)] self-center">{sorted.length} products with sales</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead><tr>
              {['Product','Category','Units','Revenue','Cost/Unit','Gross Profit','Margin %','ROI %','Health'].map(h => (
                <th key={h} className="text-left text-[10px] font-bold uppercase tracking-wider pb-3 pr-3" style={{color:"var(--tx2,#6e7681)"}}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {sorted.map(p => {
                const health = p.margin === null ? 'default' : p.margin >= 40 ? 'green' : p.margin >= 20 ? 'yellow' : p.margin >= 0 ? 'blue' : 'red';
                const healthLabel = p.margin === null ? 'No Cost' : p.margin >= 40 ? 'Excellent' : p.margin >= 20 ? 'Good' : p.margin >= 0 ? 'Low' : 'Loss';
                return (
                  <tr key={p.id} className="border-t border-[var(--bd)]/50 hover:bg-[var(--input-bg)]/20">
                    <td className="py-2.5 pr-3 text-[12px] font-semibold" style={{color:"var(--tx,#e6edf3)"}}>{p.emoji} {p.name}</td>
                    <td className="py-2.5 pr-3"><Badge type="blue">{p.cat}</Badge></td>
                    <td className="py-2.5 pr-3 text-[12px]">{p.units}</td>
                    <td className="py-2.5 pr-3 text-[12px] font-bold text-[var(--tx)]">{fmtCurrency(p.revenue)}</td>
                    <td className="py-2.5 pr-3 text-[12px] text-[var(--tx3)]">
                      {p.costPrice > 0 ? fmtCurrency(p.costPrice) : <span className="text-[#f85149] text-[10px]">not set</span>}
                    </td>
                    <td className="py-2.5 pr-3 text-[12px] font-bold" style={{color: p.grossProfit>=0?'#3fb950':'#f85149'}}>
                      {fmtCurrency(p.grossProfit)}
                    </td>
                    <td className="py-2.5 pr-3 text-[12px] font-bold" style={{color: p.margin===null?'var(--tx3,#6e7681)':p.margin>=30?'#3fb950':p.margin>=0?'#d29922':'#f85149'}}>
                      {p.margin !== null ? p.margin + '%' : '—'}
                    </td>
                    <td className="py-2.5 pr-3 text-[12px]" style={{color: p.roi===null?'var(--tx3,#6e7681)':p.roi>=50?'#3fb950':p.roi>=0?'#d29922':'#f85149'}}>
                      {p.roi !== null ? p.roi + '%' : '—'}
                    </td>
                    <td className="py-2.5"><Badge type={health}>{healthLabel}</Badge></td>
                  </tr>
                );
              })}
              {sorted.length === 0 && (
                <tr><td colSpan={9} className="py-8 text-center text-[var(--tx3)]">No sales data in this period</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

// Suspense boundary required by Next.js for useSearchParams
export default function ProfitPageWrapper(props) {
  return (
    <Suspense fallback={<div className="flex items-center justify-center py-24" style={{color:'var(--tx2,#6e7681)'}}>Loading…</div>}>
      <ProfitPage {...props} />
    </Suspense>
  );
}
