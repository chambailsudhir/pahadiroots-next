'use client';
import { useSearchParams } from 'next/navigation';
import { useState, useEffect, useCallback, Suspense} from 'react';
import { api, buildDateFilter, fmtCurrency, fmt } from '@/lib/api';
import KpiCard from '@/components/ui/KpiCard';
import { Card, Loader, ErrorMsg, Badge } from '@/components/ui/index';
import Modal from '@/components/ui/Modal';
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell  } from 'recharts';

const COLORS = ['#1a5c2a','var(--blue)','#d29922','var(--purple)','#f85149','#3fb950'];

function CustomersPage() {
  const searchParams = useSearchParams();
  const days = parseInt(searchParams.get('days') || '7', 10);
  const [drill, setDrill] = useState(null);
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);
  const [search,  setSearch]  = useState('');

  useEffect(() => { load(days); }, [days]);

  async function load(days) {
    setLoading(true); setError(null);
    try {
      const since = buildDateFilter(days);
      const [customers, orders, allTimeOrders] = await Promise.all([
        api.get('customers', 'select=id,first_name,last_name,email,phone,created_at,state,city&is_deleted=eq.false&order=created_at.desc'),
        api.get('orders', `select=id,customer_id,total_amount,order_status,created_at&created_at=gte.${since}`).catch(() => []),
        api.get('orders', 'select=customer_id,total_amount,order_status').catch(() => []),
      ]);

      const custMap = Object.fromEntries((customers || []).map(c => [c.id, c]));
      const activeOrds = (orders || []).filter(o => o.order_status !== 'cancelled');
      // All-time stats for CLV + returning
      const allTimeActive = (allTimeOrders || []).filter(o => o.order_status !== 'cancelled');
      const allTimeCustStats = {};
      allTimeActive.forEach(o => {
        if (!allTimeCustStats[o.customer_id]) allTimeCustStats[o.customer_id] = { count: 0, total: 0 };
        allTimeCustStats[o.customer_id].count++;
        allTimeCustStats[o.customer_id].total += parseFloat(o.total_amount) || 0;
      });

      // Per-customer stats — orderCount/totalSpent from ALL-TIME, lastOrder from period
      const custStats = {};
      (customers || []).forEach(c => {
        const at = allTimeCustStats[c.id] || { count: 0, total: 0 };
        custStats[c.id] = { ...c, orderCount: at.count, totalSpent: at.total, lastOrder: null, firstOrder: null };
      });
      activeOrds.forEach(o => {
        const s = custStats[o.customer_id];
        if (!s) return;
        const d = new Date(o.created_at);
        if (!s.lastOrder  || d > new Date(s.lastOrder))  s.lastOrder  = o.created_at;
        if (!s.firstOrder || d < new Date(s.firstOrder)) s.firstOrder = o.created_at;
      });

      const custList = Object.values(custStats);

      // KPIs
      const totalCusts   = custList.length;
      const sinceDate    = new Date(since);
      const newCusts     = custList.filter(c => new Date(c.created_at) >= sinceDate).length;
      const returning    = custList.filter(c => c.orderCount > 1).length;
      const repeatRate   = totalCusts > 0 ? Math.round(returning / totalCusts * 100) : 0;
      const avgCLV       = custList.length > 0 ? custList.reduce((s, c) => s + c.totalSpent, 0) / custList.length : 0;

      // Customer growth
      const now = new Date();
      const growth = Array.from({ length: Math.min(days, 30) }, (_, i) => {
        const d = new Date(now); d.setDate(d.getDate() - (Math.min(days, 30) - 1 - i));
        return {
          date:  d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }),
          total: custList.filter(c => new Date(c.created_at) <= d).length,
          new:   custList.filter(c => {
            const cd = new Date(c.created_at);
            return cd.toDateString() === d.toDateString();
          }).length };
      });

      // Segmentation: High (top 20%), Medium, Low
      const sorted  = [...custList].sort((a, b) => b.totalSpent - a.totalSpent);
      const top20   = Math.ceil(sorted.length * 0.2);
      const mid40   = Math.ceil(sorted.length * 0.4);
      const segments = [
        { name: 'High Value', value: top20, color: '#1a5c2a' },
        { name: 'Medium',     value: mid40, color: 'var(--yellow)'  },
        { name: 'Low Value',  value: sorted.length - top20 - mid40, color: 'var(--tx3,#6e7681)' },
      ];

      // Purchase frequency
      const freqMap = { '1': 0, '2-3': 0, '4-5': 0, '6+': 0 };
      custList.forEach(c => {
        if      (c.orderCount === 1)  freqMap['1']++;
        else if (c.orderCount <= 3)   freqMap['2-3']++;
        else if (c.orderCount <= 5)   freqMap['4-5']++;
        else                          freqMap['6+']++;
      });
      const freqData = Object.entries(freqMap).map(([k, v]) => ({ orders: k, customers: v }));

      // Top locations
      const locMap = {};
      custList.forEach(c => { const l = c.state || c.city || 'Unknown'; locMap[l] = (locMap[l] || 0) + 1; });
      const topLocations = Object.entries(locMap).sort((a, b) => b[1] - a[1]).slice(0, 8);

      // New vs Returning
      const newVsReturn = [
        { name: 'New',       value: custList.filter(c => c.orderCount <= 1).length,  color: 'var(--blue)' },
        { name: 'Returning', value: custList.filter(c => c.orderCount > 1).length,   color: '#3fb950' },
      ];

      // Top customers by spend
      const topCusts = [...custList].sort((a, b) => b.totalSpent - a.totalSpent).slice(0, 10);

      setData({ totalCusts, newCusts, returning, repeatRate, avgCLV, growth, segments, freqData, topLocations, newVsReturn, topCusts, custList });
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  if (loading) return <Loader text="Loading customer insights…" />;
  if (error)   return <ErrorMsg error={error} onRetry={() => load(days)} />;
  if (!data)   return null;

  const tip = { contentStyle: { background: 'var(--bg2,#161b22)', border: '1px solid var(--bd,#30363d)', borderRadius: 8, fontSize: 12, color: 'var(--tx,#e6edf3)' }, labelStyle: { color: 'var(--tx,#e6edf3)', fontWeight: 600 }, itemStyle: { color: 'var(--tx2,#8b949e)' }, cursor: { fill: 'color-mix(in srgb, var(--bd) 10%, transparent)' } };

  const filtered = search
    ? data.custList.filter(c => `${c.first_name} ${c.last_name} ${c.email}`.toLowerCase().includes(search.toLowerCase()))
    : data.custList;

  return (
    <div className="space-y-4">
      {drill === 'new' && (
        <Modal title={`New Customers — Last ${days} Days (${data.newCusts})`} onClose={() => setDrill(null)}>
          <table className="w-full">
            <thead><tr>
              {['Name','Email','Phone','Location','Joined'].map(h=>(
                <th key={h} className="text-left text-[10px] font-bold text-[var(--tx3)] uppercase pb-2 pr-4">{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {data.custList.filter(c=>new Date(c.created_at)>=new Date(buildDateFilter(days))).slice(0,20).map(c=>(
                <tr key={c.id} className="border-t border-[var(--bd)]/50">
                  <td className="py-2 pr-4 text-[12px] font-semibold" style={{color:"var(--tx,#e6edf3)"}}>{c.first_name} {c.last_name}</td>
                  <td className="py-2 pr-4 text-[11px] text-[var(--tx3)]">{c.email||'—'}</td>
                  <td className="py-2 pr-4 text-[11px]">{c.phone||'—'}</td>
                  <td className="py-2 pr-4 text-[11px]">{c.state||c.city||'—'}</td>
                  <td className="py-2 text-[11px] text-[var(--tx3)]">{c.created_at?new Date(c.created_at).toLocaleDateString('en-IN'):'—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Modal>
      )}
      {drill === 'returning' && (
        <Modal title={`Returning Customers (${data.returning})`} onClose={() => setDrill(null)}>
          <table className="w-full">
            <thead><tr>
              {['Name','Orders','Total Spent','Last Order'].map(h=>(
                <th key={h} className="text-left text-[10px] font-bold text-[var(--tx3)] uppercase pb-2 pr-4">{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {data.custList.filter(c=>c.orderCount>1).sort((a,b)=>b.totalSpent-a.totalSpent).map(c=>(
                <tr key={c.id} className="border-t border-[var(--bd)]/50">
                  <td className="py-2 pr-4 text-[12px] font-semibold" style={{color:"var(--tx,#e6edf3)"}}>{c.first_name} {c.last_name}</td>
                  <td className="py-2 pr-4 text-[12px] font-bold text-[var(--blue)]">{c.orderCount}</td>
                  <td className="py-2 pr-4 text-[12px] font-bold text-[#3fb950]">{fmtCurrency(c.totalSpent)}</td>
                  <td className="py-2 text-[11px] text-[var(--tx3)]">{c.lastOrder?new Date(c.lastOrder).toLocaleDateString('en-IN'):'—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Modal>
      )}
      {/* KPIs */}
      <div className="grid grid-cols-5 gap-3">
        <KpiCard label="All Customers"     value={data.totalCusts}           sub="total registered ever" accentColor="#d29922"
          onClick={() => { const el = document.getElementById('cust-table'); if(el) el.scrollIntoView({behavior:'smooth'}); }} />
        <KpiCard label="New This Period"   value={data.newCusts}             sub={`joined in ${days} days`} accentColor="#58a6ff"
          onClick={() => setDrill('new')} />
        <KpiCard label="Returning"        value={data.returning}            sub="ordered 2+ times"    accentColor="#3fb950"
          onClick={() => setDrill('returning')} />
        <KpiCard label="Repeat Rate"      value={data.repeatRate + '%'}     sub="of all customers"    accentColor="#1a5c2a"
          onClick={() => setDrill('returning')} />
        <KpiCard label="Avg CLV"          value={fmtCurrency(data.avgCLV)}  sub="lifetime value"      accentColor="#8957e5"
          onClick={() => { const el = document.getElementById('cust-table'); if(el) el.scrollIntoView({behavior:'smooth'}); }} />
      </div>

      {/* Growth + New vs Returning */}
      <div className="grid grid-cols-3 gap-4">
        <div className="col-span-2">
          <Card title="Customer Growth Trend">
            <ResponsiveContainer width="100%" height={180}>
              <AreaChart data={data.growth}>
                <XAxis dataKey="date" tick={{ fill: 'var(--tx2,#6e7681)', fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: 'var(--tx2,#6e7681)', fontSize: 10 }} axisLine={false} tickLine={false} />
                <Tooltip {...tip} />
                <Area type="monotone" dataKey="total" stroke="#d29922" fill="var(--yellow-bg)" strokeWidth={2} name="Total" />
                <Area type="monotone" dataKey="new"   stroke="#58a6ff" fill="var(--blue-bg)"  strokeWidth={2} name="New today" />
              </AreaChart>
            </ResponsiveContainer>
          </Card>
        </div>
        <Card title="New vs Returning">
          <ResponsiveContainer width="100%" height={150}>
            <PieChart>
              <Pie data={data.newVsReturn} dataKey="value" cx="50%" cy="50%" innerRadius={45} outerRadius={65}>
                {data.newVsReturn.map((d, i) => <Cell key={i} fill={d.color} />)}
              </Pie>
              <Tooltip {...tip} />
            </PieChart>
          </ResponsiveContainer>
          <div className="flex gap-4 justify-center mt-2">
            {data.newVsReturn.map(d => (
              <span key={d.name} className="flex items-center gap-1 text-[11px] text-[var(--tx2)]">
                <span className="w-2 h-2 rounded-sm" style={{ background: d.color }} />
                {d.name}: {d.value}
              </span>
            ))}
          </div>
        </Card>
      </div>

      {/* Segmentation + Purchase Frequency + Locations */}
      <div className="grid grid-cols-3 gap-4">
        <Card title="Customer Segmentation">
          <ResponsiveContainer width="100%" height={150}>
            <PieChart>
              <Pie data={data.segments} dataKey="value" cx="50%" cy="50%" innerRadius={40} outerRadius={60}>
                {data.segments.map((d, i) => <Cell key={i} fill={d.color} />)}
              </Pie>
              <Tooltip {...tip} />
            </PieChart>
          </ResponsiveContainer>
          <div className="space-y-1.5 mt-2">
            {data.segments.map(s => (
              <div key={s.name} className="flex items-center justify-between text-[11px]">
                <span className="flex items-center gap-1.5 text-[var(--tx2)]">
                  <span className="w-2 h-2 rounded-sm" style={{ background: s.color }} />{s.name}
                </span>
                <span className="text-[var(--tx)] font-bold">{s.value}</span>
              </div>
            ))}
          </div>
        </Card>
        <Card title="Purchase Frequency">
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={data.freqData}>
              <XAxis dataKey="orders" tick={{ fill: 'var(--tx2,#6e7681)', fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: 'var(--tx2,#6e7681)', fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip {...tip} />
              <Bar dataKey="customers" fill="#58a6ff" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
          <div className="text-center text-[10px] text-[var(--tx3)] mt-1">Orders per customer</div>
        </Card>
        <Card title="Top Locations">
          <div className="space-y-2">
            {data.topLocations.map(([loc, cnt], i) => (
              <div key={i}>
                <div className="flex justify-between text-[12px] mb-1">
                  <span className="text-[var(--tx)]">{loc}</span>
                  <span className="text-[var(--tx3)]">{cnt}</span>
                </div>
                <div className="h-1.5 bg-[var(--input-bg)] rounded-full">
                  <div className="h-full bg-[var(--accent)] rounded-full" style={{ width: `${Math.round(cnt / data.topLocations[0][1] * 100)}%` }} />
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Top Customers Table */}
      <Card title="Top Customers by Lifetime Value" id="cust-table">
        <div className="mb-3">
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search customer…"
            className="bg-[var(--input-bg)] border border-[var(--bd)] rounded-lg px-3 py-1.5 text-[12px] text-[var(--tx)] w-56 focus:outline-none focus:border-[var(--accent)]" />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead><tr>
              {['Customer','Email','Location','Orders','Total Spent','CLV Tier','Last Order'].map(h => (
                <th key={h} className="text-left text-[10px] font-bold uppercase tracking-wider pb-2 pr-4" style={{color:"var(--tx2,#6e7681)"}}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {(search ? filtered : data.topCusts).map((c, i) => {
                const tier = i < 3 ? 'High' : i < 6 ? 'Medium' : 'Low';
                const tierType = i < 3 ? 'green' : i < 6 ? 'yellow' : 'default';
                return (
                  <tr key={c.id} className="border-t border-[var(--bd)]/50 hover:bg-[var(--input-bg)]/30">
                    <td className="py-2.5 pr-4 text-[var(--tx)] font-semibold text-[12px]">{c.first_name} {c.last_name}</td>
                    <td className="py-2.5 pr-4 text-[var(--tx3)] text-[11px]">{c.email || '—'}</td>
                    <td className="py-2.5 pr-4 text-[12px]">{c.state || c.city || '—'}</td>
                    <td className="py-2.5 pr-4 text-[12px] font-bold text-[var(--tx)]">{c.orderCount}</td>
                    <td className="py-2.5 pr-4 text-[12px] font-bold text-[#3fb950]">{fmtCurrency(c.totalSpent)}</td>
                    <td className="py-2.5 pr-4"><Badge type={tierType}>{tier}</Badge></td>
                    <td className="py-2.5 text-[11px] text-[var(--tx3)]">{c.lastOrder ? new Date(c.lastOrder).toLocaleDateString('en-IN') : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

// Suspense boundary required by Next.js for useSearchParams
export default function CustomersPageWrapper(props) {
  return (
    <Suspense fallback={<div className="flex items-center justify-center py-24" style={{color:'var(--tx2,#6e7681)'}}>Loading…</div>}>
      <CustomersPage {...props} />
    </Suspense>
  );
}
