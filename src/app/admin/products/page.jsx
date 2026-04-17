'use client';
import { useState, useEffect, useCallback, Suspense} from 'react';
import { useRouter, useSearchParams} from 'next/navigation';
import { api, buildDateFilter, fmtCurrency, fmt } from '@/lib/api';
import KpiCard from '@/components/ui/KpiCard';
import { Card, Loader, ErrorMsg, Badge } from '@/components/ui/index';
import Modal from '@/components/ui/Modal';
import { BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

const COLORS = ['#1a5c2a','#1a5c2a','#3fb950','#58a6ff','#8957e5','#d29922','#f85149'];

function ProductsPage() {
  const searchParams = useSearchParams();
  const days = parseInt(searchParams.get('days') || '7', 10);
  const router  = useRouter();
  const [drill, setDrill] = useState(null);
  const [data, setData]     = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState(null);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState('revenue');
  const [catFilter, setCatFilter] = useState('');

  useEffect(() => { load(days); }, [days]);

  async function load(days) {
    setLoading(true); setError(null);
    try {
      const since = buildDateFilter(days);
      const [products, orderItems, orders, categories] = await Promise.all([
        api.get('products', 'select=id,name,emoji,price,cost_price,gst_rate,available_stock,initial_stock,category_id,status&is_deleted=eq.false'),
        api.get('order_items', 'select=product_id,quantity,price_at_time,order_id'),
        api.get('orders', `select=id,order_status,created_at&created_at=gte.${since}`),
        api.get('categories', 'select=id,name'),
      ]);

      const catMap = Object.fromEntries((categories || []).map(c => [c.id, c.name]));
      const activeIds = new Set((orders || []).filter(o => o.order_status !== 'cancelled').map(o => o.id));

      const stats = {};
      (products || []).forEach(p => {
        stats[p.id] = { ...p, revenue: 0, units: 0, profit: 0, margin: 0, cat: catMap[p.category_id] || 'Other' };
      });
      (orderItems || []).forEach(item => {
        if (!activeIds.has(item.order_id)) return;
        const s = stats[item.product_id];
        if (!s) return;
        const rev  = (parseFloat(item.price_at_time) || 0) * (item.quantity || 1);
        const cost = (parseFloat(s.cost_price) || 0) * (item.quantity || 1);
        s.revenue += rev;
        s.units   += item.quantity || 1;
        s.profit  += (rev / (1 + (s.gst_rate || 5) / 100)) - cost;
      });
      Object.values(stats).forEach(s => {
        const baseRev = s.revenue / (1 + (s.gst_rate || 5) / 100);
        s.margin   = baseRev > 0 && s.cost_price > 0 ? Math.round(s.profit / baseRev * 100) : null;
        s.turnover = s.initial_stock > 0 ? Math.round(s.units / s.initial_stock * 100) : 0;
      });

      const all       = Object.values(stats).sort((a, b) => b.revenue - a.revenue);
      const totalRev  = all.reduce((s, p) => s + p.revenue, 0);
      const totalProfit = all.reduce((s, p) => s + p.profit, 0);
      const totalUnits  = all.reduce((s, p) => s + p.units, 0);
      const deadStock   = all.filter(p => p.units === 0 && (p.available_stock || 0) > 5);
      const avgMargin   = totalRev > 0 ? Math.round(totalProfit / (totalRev / 1.05) * 100) : 0;

      // Category revenue
      const catRev = {};
      all.forEach(p => { catRev[p.cat] = (catRev[p.cat] || 0) + p.revenue; });
      const catData = Object.entries(catRev).sort((a, b) => b[1] - a[1]).map(([name, value]) => ({ name, value: Math.round(value) }));

      // Top 10 by units
      const top10Units = [...all].sort((a, b) => b.units - a.units).slice(0, 10)
        .map(p => ({ name: (p.emoji || '') + ' ' + p.name.substring(0, 14), units: p.units }));

      setData({ all, totalRev, totalProfit, totalUnits, deadStock, avgMargin, catData, top10Units, categories: Object.values(catMap) });
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  if (loading) return <Loader text="Loading product analytics…" />;
  if (error)   return <ErrorMsg error={error} onRetry={() => load(days)} />;
  if (!data)   return null;

  const tip = { contentStyle: { background: 'var(--bg2,#161b22)', border: '1px solid var(--bd,#30363d)', borderRadius: 8, fontSize: 12, color: 'var(--tx,#e6edf3)' }, labelStyle: { color: 'var(--tx,#e6edf3)', fontWeight: 600 }, itemStyle: { color: 'var(--tx2,#8b949e)' }, cursor: { fill: 'rgba(255,255,255,0.04)' } };

  // Filter + sort
  let filtered = [...(data.all || [])];
  if (search)    filtered = filtered.filter(p => p.name.toLowerCase().includes(search.toLowerCase()));
  if (catFilter) filtered = filtered.filter(p => p.cat === catFilter);
  if (sortBy === 'units')   filtered.sort((a, b) => b.units - a.units);
  if (sortBy === 'profit')  filtered.sort((a, b) => b.profit - a.profit);
  if (sortBy === 'margin')  filtered.sort((a, b) => (b.margin ?? -999) - (a.margin ?? -999));
  if (sortBy === 'stock')   filtered.sort((a, b) => a.available_stock - b.available_stock);

  const top10Rev = filtered.slice(0, 10).map(p => ({ name: (p.emoji || '') + ' ' + p.name.substring(0, 14), revenue: Math.round(p.revenue) }));

  return (
    <div className="space-y-4">
      {/* Dead Stock Drill */}
      {drill === 'units' && (
        <Modal title={`Units Sold — Last ${days} Days`} onClose={() => setDrill(null)}>
          <table className="w-full">
            <thead><tr>
              {['Product','Category','Units Sold','Revenue','Avg Price'].map(h=>(
                <th key={h} className="text-left text-[10px] font-bold text-[#6e7681] uppercase pb-2 pr-4">{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {[...data.all].filter(p=>p.units>0).sort((a,b)=>b.units-a.units).map(p=>(
                <tr key={p.id} className="border-t border-[#30363d]/50">
                  <td className="py-2 pr-4 text-[12px] font-semibold" style={{color:"var(--tx,#e6edf3)"}}>{p.emoji} {p.name}</td>
                  <td className="py-2 pr-4"><Badge type="blue">{p.cat}</Badge></td>
                  <td className="py-2 pr-4 text-[13px] font-bold text-[#58a6ff]">{p.units}</td>
                  <td className="py-2 pr-4 text-[12px] text-[#3fb950]">{fmtCurrency(p.revenue)}</td>
                  <td className="py-2 text-[12px] text-[#6e7681]">{p.units>0?fmtCurrency(p.revenue/p.units):'—'}</td>
                </tr>
              ))}
              {data.all.filter(p=>p.units>0).length === 0 && (
                <tr><td colSpan={5} className="py-4 text-center text-[#6e7681]">No sales in this period</td></tr>
              )}
            </tbody>
          </table>
        </Modal>
      )}
      {drill === 'deadstock' && (
        <Modal title={`⚠ Dead Stock (${data.deadStock.length} products)`} onClose={() => setDrill(null)}>
          <table className="w-full">
            <thead><tr>
              {['Product','Category','Stock','Recommendation'].map(h=>(
                <th key={h} className="text-left text-[10px] font-bold text-[#6e7681] uppercase pb-2 pr-4">{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {data.deadStock.map(p=>(
                <tr key={p.id} className="border-t border-[#30363d]/50">
                  <td className="py-2 pr-4 text-[12px] font-semibold" style={{color:"var(--tx,#e6edf3)"}}>{p.emoji} {p.name}</td>
                  <td className="py-2 pr-4"><Badge type="blue">{p.cat}</Badge></td>
                  <td className="py-2 pr-4 text-[12px] font-bold text-[#f85149]">{p.available_stock}</td>
                  <td className="py-2 text-[11px] text-[#d29922]">{p.available_stock>20?'Consider discounting':'Monitor closely'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Modal>
      )}
      {drill === 'profit' && (
        <Modal title="Top Products by Profit" onClose={() => setDrill(null)}>
          <table className="w-full">
            <thead><tr>
              {['Product','Revenue','Profit','Margin'].map(h=>(
                <th key={h} className="text-left text-[10px] font-bold text-[#6e7681] uppercase pb-2 pr-4">{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {[...data.all].filter(p=>p.units>0).sort((a,b)=>b.profit-a.profit).slice(0,10).map(p=>(
                <tr key={p.id} className="border-t border-[#30363d]/50">
                  <td className="py-2 pr-4 text-[12px] text-white">{p.emoji} {p.name}</td>
                  <td className="py-2 pr-4 text-[12px]">{fmtCurrency(p.revenue)}</td>
                  <td className="py-2 pr-4 text-[12px] font-bold" style={{color:p.profit>=0?'#3fb950':'#f85149'}}>{fmtCurrency(p.profit)}</td>
                  <td className="py-2 text-[12px]" style={{color:p.margin>30?'#3fb950':p.margin>0?'#d29922':'#f85149'}}>{p.margin!=null?p.margin+'%':'—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-4 text-center">
            <button onClick={()=>{setDrill(null);router.push('/admin/profit');}}
              className="px-4 py-2 bg-[#1a5c2a] hover:bg-[#1a5c2a] text-white text-[12px] rounded-lg transition">
              Full Profit Analysis →
            </button>
          </div>
        </Modal>
      )}
      {/* KPIs */}
      <div className="grid grid-cols-4 gap-3">
        <KpiCard label="Total Revenue"    value={fmtCurrency(data.totalRev)}    sub={`Last ${days} days`}          accentColor="#1a5c2a"
          onClick={() => { const el = document.getElementById('prod-table'); if(el) el.scrollIntoView({behavior:'smooth'}); }} />
        <KpiCard label="Units Sold"       value={fmt(data.totalUnits)}           sub={`${data.all.filter(p=>p.units>0).length} products sold`} accentColor="#58a6ff"
          onClick={() => setDrill('units')} />
        <KpiCard label="Gross Profit"     value={fmtCurrency(data.totalProfit)}  sub={`Avg margin: ${data.avgMargin}%`} accentColor="#3fb950"
          onClick={() => setDrill('profit')} />
        <KpiCard label="Dead Stock"       value={data.deadStock.length}          sub="high stock, zero sales"       accentColor="#f85149"
          onClick={() => setDrill('deadstock')} />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-2 gap-4">
        <Card title="Top 10 Products by Revenue">
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={top10Rev} layout="vertical">
              <XAxis type="number" tick={{ fill: 'var(--tx2,#6e7681)', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={v => '₹' + Math.round(v / 1000) + 'k'} />
              <YAxis type="category" dataKey="name" tick={{ fill: 'var(--tx2,#8b949e)', fontSize: 10 }} axisLine={false} tickLine={false} width={100} />
              <Tooltip {...tip} formatter={v => [fmtCurrency(v), 'Revenue']} />
              <Bar dataKey="revenue" radius={[0, 4, 4, 0]}>
                {top10Rev.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>
        <div className="space-y-4">
          <Card title="Category Sales Distribution">
            <ResponsiveContainer width="100%" height={140}>
              <PieChart>
                <Pie data={data.catData} dataKey="value" cx="50%" cy="50%" innerRadius={40} outerRadius={60}>
                  {data.catData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip {...tip} formatter={v => [fmtCurrency(v), 'Revenue']} />
              </PieChart>
            </ResponsiveContainer>
            <div className="flex flex-wrap gap-2 mt-1">
              {data.catData.map((c, i) => (
                <span key={i} className="flex items-center gap-1 text-[10px] text-[#8b949e]">
                  <span className="w-2 h-2 rounded-sm" style={{ background: COLORS[i % COLORS.length] }} />
                  {c.name}
                </span>
              ))}
            </div>
          </Card>

          <Card title="Your Category Performance" action={<span className="text-[10px] text-[#6e7681]">% share of revenue</span>}>
            {data.catData.length === 0
              ? <p className="text-[12px] text-[#6e7681]">No sales data yet.</p>
              : (() => {
                  const total = data.catData.reduce((s, c) => s + c.value, 0);
                  return (
                    <div className="flex flex-col gap-3">
                      {data.catData.map((c, i) => {
                        const pct = total > 0 ? Math.round(c.value / total * 100) : 0;
                        return (
                          <div key={i}>
                            <div className="flex justify-between mb-1">
                              <span style={{ fontSize:12, color:'#e6edf3' }}>{c.name}</span>
                              <span style={{ fontSize:12, color:COLORS[i%COLORS.length], fontWeight:700 }}>{pct}% · {fmtCurrency(c.value)}</span>
                            </div>
                            <div style={{ background:'#21262d', borderRadius:4, height:8 }}>
                              <div style={{ width:`${pct}%`, height:'100%', background:COLORS[i%COLORS.length], borderRadius:4 }} />
                            </div>
                          </div>
                        );
                      })}
                      <p className="text-[10px] text-[#6e7681] mt-1">Largest bar = biggest revenue driver. Stock up here before festivals.</p>
                    </div>
                  );
                })()
            }
          </Card>

          <Card title="Top 10 by Units Sold">
            <ResponsiveContainer width="100%" height={120}>
              <BarChart data={data.top10Units} layout="vertical">
                <XAxis type="number" tick={{ fill: 'var(--tx2,#6e7681)', fontSize: 9 }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="name" tick={{ fill: 'var(--tx2,#8b949e)', fontSize: 9 }} axisLine={false} tickLine={false} width={90} />
                <Tooltip {...tip} />
                <Bar dataKey="units" fill="#58a6ff" radius={[0, 3, 3, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </Card>
        </div>
      </div>

      {/* Full Product Table */}
      <Card title="Full Product Performance" id="prod-table">
        <div className="flex gap-3 mb-4 flex-wrap">
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search product…"
            className="bg-[#21262d] border border-[#30363d] rounded-lg px-3 py-1.5 text-[12px] text-white w-48 focus:outline-none focus:border-[#1a5c2a]" />
          <select value={sortBy} onChange={e => setSortBy(e.target.value)}
            className="bg-[#21262d] border border-[#30363d] rounded-lg px-3 py-1.5 text-[12px] text-[#8b949e]">
            <option value="revenue">Sort: Revenue</option>
            <option value="units">Sort: Units</option>
            <option value="profit">Sort: Profit</option>
            <option value="margin">Sort: Margin %</option>
            <option value="stock">Sort: Stock ↑</option>
          </select>
          <select value={catFilter} onChange={e => setCatFilter(e.target.value)}
            className="bg-[#21262d] border border-[#30363d] rounded-lg px-3 py-1.5 text-[12px] text-[#8b949e]">
            <option value="">All Categories</option>
            {data.categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead><tr>
              {['Product','Category','Revenue','Units','Cost Price','Gross Profit','Margin %','Stock','Turnover','Status'].map(h => (
                <th key={h} className="text-left text-[10px] font-bold uppercase tracking-wider pb-2 pr-4" style={{color:"var(--tx2,#6e7681)"}}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {filtered.map(p => (
                <tr key={p.id} className="border-t border-[#30363d]/50 hover:bg-[#21262d]/30">
                  <td className="py-2.5 pr-4 text-[12px] text-white font-semibold">{p.emoji} {p.name}</td>
                  <td className="py-2.5 pr-4"><Badge type="blue">{p.cat}</Badge></td>
                  <td className="py-2.5 pr-4 text-[12px] font-bold text-white">{fmtCurrency(p.revenue)}</td>
                  <td className="py-2.5 pr-4 text-[12px]">{p.units}</td>
                  <td className="py-2.5 pr-4 text-[12px] text-[#6e7681]">{p.cost_price ? fmtCurrency(p.cost_price) : <span className="text-[10px]">not set</span>}</td>
                  <td className="py-2.5 pr-4 text-[12px]" style={{ color: p.profit >= 0 ? '#3fb950' : '#f85149' }}>{fmtCurrency(p.profit)}</td>
                  <td className="py-2.5 pr-4 text-[12px] font-bold" style={{ color: p.margin > 30 ? '#3fb950' : p.margin > 0 ? '#d29922' : p.margin < 0 ? '#f85149' : '#6e7681' }}>
                    {p.margin != null ? p.margin + '%' : '—'}
                  </td>
                  <td className="py-2.5 pr-4 text-[12px] font-bold" style={{ color: p.available_stock <= 5 ? '#f85149' : p.available_stock <= 10 ? '#d29922' : '#8b949e' }}>{p.available_stock}</td>
                  <td className="py-2.5 pr-4 text-[12px]">{p.turnover ? p.turnover + '%' : '—'}</td>
                  <td className="py-2.5"><Badge type={p.units === 0 ? 'red' : p.units > 5 ? 'green' : 'blue'}>{p.units === 0 ? 'No Sales' : p.units > 5 ? 'Top' : 'Selling'}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Dead Stock */}
      <Card title="⚠ Dead Stock Analysis" action={<span className="text-[11px] text-[#f85149]">{data.deadStock.length} products</span>}>
        {data.deadStock.length === 0
          ? <div className="text-[#3fb950] text-sm text-center py-4">✓ No dead stock — all products are selling!</div>
          : <table className="w-full">
              <thead><tr>
                {['Product','Stock','Initial','Units Sold','Recommendation'].map(h => (
                  <th key={h} className="text-left text-[10px] font-bold uppercase tracking-wider pb-2 pr-4" style={{color:"var(--tx2,#6e7681)"}}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {data.deadStock.map(p => (
                  <tr key={p.id} className="border-t border-[#30363d]/50">
                    <td className="py-2.5 text-white font-semibold text-[12px]">{p.emoji} {p.name}</td>
                    <td className="py-2.5 font-bold text-[#f85149]">{p.available_stock}</td>
                    <td className="py-2.5 text-[#8b949e]">{p.initial_stock}</td>
                    <td className="py-2.5 text-[#8b949e]">0</td>
                    <td className="py-2.5 text-[#d29922] text-[11px]">{p.available_stock > 20 ? '⚠ Consider discounting' : '📦 Monitor'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
        }
      </Card>
    </div>
  );
}

// Suspense boundary required by Next.js for useSearchParams
export default function ProductsPageWrapper(props) {
  return (
    <Suspense fallback={<div className="flex items-center justify-center py-24" style={{color:'var(--tx2,#6e7681)'}}>Loading…</div>}>
      <ProductsPage {...props} />
    </Suspense>
  );
}
