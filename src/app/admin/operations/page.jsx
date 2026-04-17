'use client';
import { useState, useEffect, useCallback, Suspense} from 'react';
import { useRouter, useSearchParams} from 'next/navigation';
import { api, buildDateFilter, fmtCurrency } from '@/lib/api';
import KpiCard from '@/components/ui/KpiCard';
import { Card, Loader, ErrorMsg, StatusBadge, Badge } from '@/components/ui/index';
import Modal from '@/components/ui/Modal';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell  } from 'recharts';

const STATUS_FLOW = ['pending','confirmed','packed','shipped','delivered','returned','cancelled'];
const STATUS_COLORS = { pending:'#d29922', confirmed:'#58a6ff', packed:'#8957e5', shipped:'#3fb950', delivered:'#1a5c2a', cancelled:'#f85149' };

function OperationsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const days = parseInt(searchParams.get('days') || '7', 10);
  const [data,     setData]     = useState(null);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState(null);
  const [search,   setSearch]   = useState('');
  const [statusF,  setStatusF]  = useState('');
  const [updating, setUpdating] = useState(null);
  const [drill, setDrill] = useState(null);

  useEffect(() => { load(days); }, [days]);

  async function load(days) {
    setLoading(true); setError(null);
    try {
      const since = buildDateFilter(days);
      const [orders, customers, products, returns] = await Promise.all([
        api.get('orders', `select=id,order_number,total_amount,order_status,payment_method,created_at,customer_id&created_at=gte.${since}&order=created_at.desc`),
        api.get('customers', 'select=id,first_name,last_name,phone&is_deleted=eq.false'),
        api.get('products', 'select=id,name,emoji,available_stock,cost_price,price&is_deleted=eq.false'),
        api.get('returns', 'select=id,status,created_at').catch(() => []),
      ]);

      const custMap = Object.fromEntries((customers || []).map(c => [c.id, c]));

      const pending   = (orders || []).filter(o => o.order_status === 'pending').length;
      const confirmed = (orders || []).filter(o => o.order_status === 'confirmed').length;
      const packed    = (orders || []).filter(o => o.order_status === 'packed').length;
      const shipped   = (orders || []).filter(o => o.order_status === 'shipped').length;
      const delivered = (orders || []).filter(o => o.order_status === 'delivered').length;
      const returned  = (orders || []).filter(o => o.order_status === 'returned').length;
      const cancelled = (orders || []).filter(o => o.order_status === 'cancelled').length;
      const total     = (orders || []).length;
      const cancelRate  = total > 0 ? Math.round(cancelled / total * 100) : 0;
      const returnCount = (returns || []).filter(r => {
        if (!r.created_at) return false;
        return new Date(r.created_at) >= new Date(since);
      }).length;
      const returnRate  = total > 0 ? Math.round(returnCount / total * 100) : 0;

      const funnel = STATUS_FLOW.map(s => ({
        status: s,
        count: (orders || []).filter(o => o.order_status === s || STATUS_FLOW.indexOf(o.order_status) > STATUS_FLOW.indexOf(s)).length }));

      const dayCount = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d => ({ day: d, orders: 0 }));
      (orders || []).forEach(o => { dayCount[new Date(o.created_at).getDay()].orders++; });

      // Low stock with inventory intelligence
      const lowStock = (products || [])
        .filter(p => (p.available_stock || 0) <= 10)
        .map(p => ({
          ...p,
          margin: p.price > 0 ? Math.round((p.price - (p.cost_price || 0)) / p.price * 100) : 0 }))
        .sort((a, b) => a.available_stock - b.available_stock);

      const enriched = (orders || []).map(o => ({
        ...o,
        customerName: custMap[o.customer_id] ? `${custMap[o.customer_id].first_name || ''} ${custMap[o.customer_id].last_name || ''}`.trim() : 'Guest',
        customerPhone: custMap[o.customer_id]?.phone || '' }));

      setData({ pending, confirmed, packed, shipped, delivered, returned, cancelled, cancelRate, returnRate, returnCount, funnel, dayCount, lowStock, orders: enriched, total });
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  async function updateStatus(orderId, newStatus) {
    setUpdating(orderId);
    try {
      await api.patch('orders', `id=eq.${orderId}`, { order_status: newStatus });
      await load(days);
    } catch (e) { alert('Failed: ' + e.message); }
    finally { setUpdating(null); }
  }

  function exportCSV(status) {
    const rows = data.orders.filter(o => o.order_status === status);
    if (!rows.length) return alert('No orders to export');
    const headers = ['Order #', 'Customer', 'Phone', 'Amount', 'Payment', 'Status', 'Date'];
    const lines = rows.map(o => [
      o.order_number || '#' + String(o.id).slice(-6).toUpperCase(),
      o.customerName,
      o.customerPhone,
      parseFloat(o.total_amount) || 0,
      o.payment_method === 'razorpay_online' ? 'Online' : 'COD',
      o.order_status,
      new Date(o.created_at).toLocaleDateString('en-IN'),
    ]);
    const csv = [headers, ...lines].map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url;
    a.download = `pahadi-${status}-orders-${new Date().toISOString().slice(0,10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
  }

  if (loading) return <Loader text="Loading operations…" />;
  if (error)   return <ErrorMsg error={error} onRetry={() => load(days)} />;
  if (!data)   return null;

  const tip = { contentStyle: { background: 'var(--bg2,#161b22)', border: '1px solid var(--bd,#30363d)', borderRadius: 8, fontSize: 12, color: 'var(--tx,#e6edf3)' }, labelStyle: { color: 'var(--tx,#e6edf3)', fontWeight: 600 }, itemStyle: { color: 'var(--tx2,#8b949e)' }, cursor: { fill: 'rgba(255,255,255,0.04)' } };

  const filtered = data.orders.filter(o => {
    const matchSearch = !search || o.order_number?.toLowerCase().includes(search) || o.customerName.toLowerCase().includes(search);
    const matchStatus = !statusF || o.order_status === statusF;
    return matchSearch && matchStatus;
  });

  return (
    <div className="space-y-4">
      {drill && (
        <Modal title={`${drill.charAt(0).toUpperCase()+drill.slice(1)} Orders`} onClose={() => setDrill(null)}>
          <div className="flex justify-end mb-3">
            <button onClick={() => exportCSV(drill)}
              className="px-3 py-1.5 rounded-lg text-[11px] font-bold text-white flex items-center gap-1.5"
              style={{background:'var(--accent,#1a5c2a)'}}>
              ⬇ Export CSV
            </button>
          </div>
          <table className="w-full">
            <thead><tr>
              {['Order #','Customer','Amount','Date',''].map(h=>(
                <th key={h} className="text-left text-[10px] font-bold text-[#6e7681] uppercase pb-2 pr-4">{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {data.orders.filter(o=>o.order_status===drill).map(o=>(
                <tr key={o.id} className="border-t border-[#30363d]/50">
                  <td className="py-2 pr-4 text-[11px] text-[#58a6ff] font-mono">{o.order_number||'#'+String(o.id).slice(-6).toUpperCase()}</td>
                  <td className="py-2 pr-4 text-[12px] font-semibold" style={{color:"var(--tx,#e6edf3)"}}>{o.customerName}</td>
                  <td className="py-2 pr-4 text-[12px] font-bold">{fmtCurrency(parseFloat(o.total_amount)||0)}</td>
                  <td className="py-2 text-[11px] text-[#6e7681]">{new Date(o.created_at).toLocaleDateString('en-IN')}</td>
                  <td className="py-2">
                    {['delivered','shipped'].includes(o.order_status) && (
                      <button onClick={()=>{setDrill(null);}} className="text-[10px] px-2 py-1 rounded"
                        style={{color:'#f85149',border:'1px solid rgba(248,81,73,0.3)',background:'rgba(248,81,73,0.06)',cursor:'pointer'}}>
                        ↩ Return
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {data.orders.filter(o=>o.order_status===drill).length===0 && (
                <tr><td colSpan={5} className="py-4 text-center text-[#6e7681]">No {drill} orders</td></tr>
              )}
            </tbody>
          </table>
        </Modal>
      )}
      <div className="grid grid-cols-4 gap-3 md:grid-cols-7">
        <KpiCard label="Pending"    value={data.pending}    sub="needs action"  accentColor="#d29922"
          onClick={() => setDrill('pending')} />
        <KpiCard label="Confirmed"  value={data.confirmed}  sub="accepted"      accentColor="#58a6ff"
          onClick={() => setDrill('confirmed')} />
        <KpiCard label="Packed"     value={data.packed}     sub="ready to ship" accentColor="#8957e5"
          onClick={() => setDrill('packed')} />
        <KpiCard label="Shipped"    value={data.shipped}    sub="in transit"    accentColor="#3fb950"
          onClick={() => setDrill('shipped')} />
        <KpiCard label="Delivered"  value={data.delivered}  sub="completed"     accentColor="#1a5c2a"
          onClick={() => setDrill('delivered')} />
        <div className="rounded-xl p-4 cursor-pointer transition hover:opacity-80"
          style={{background:'var(--bg2,#161b22)',border:`2px solid ${data.returnRate > 8 ? '#f85149' : data.returnRate > 4 ? '#ffa600' : '#3fb950'}`}}
          onClick={() => setDrill('returned')}>
          <div className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{color:'var(--tx2,#8b949e)'}}>Returned</div>
          <div className="text-[22px] font-bold" style={{color: data.returnRate > 8 ? '#f85149' : data.returnRate > 4 ? '#ffa600' : '#3fb950'}}>
            {data.returned}
          </div>
          <div className="text-[11px] mt-0.5" style={{color:'var(--tx2,#8b949e)'}}>{data.returnRate}% return rate</div>
          <div className="text-[9px] mt-1 font-semibold" style={{color: data.returnRate > 8 ? '#f85149' : data.returnRate > 4 ? '#ffa600' : '#3fb950'}}>
            {data.returnRate > 8 ? '⚠ Above 8% target' : data.returnRate > 4 ? '↗ Watch closely' : '✓ Healthy (<8%)'}
          </div>
        </div>
        <KpiCard label="Cancelled"  value={data.cancelled}  sub={`${data.cancelRate}% rate`} accentColor="#f85149"
          onClick={() => setDrill('cancelled')} />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Card title="Order Status Funnel">
          <div className="space-y-2">
            {data.funnel.map(f => (
              <div key={f.status}>
                <div className="flex justify-between text-[12px] mb-1">
                  <StatusBadge status={f.status} />
                  <span className="text-white font-bold">{f.count}</span>
                </div>
                <div className="h-6 bg-[#21262d] rounded-md overflow-hidden">
                  <div className="h-full rounded-md flex items-center justify-end pr-2 text-[10px] text-white font-bold transition-all"
                    style={{ width: `${data.funnel[0].count > 0 ? Math.round(f.count / data.funnel[0].count * 100) : 0}%`, background: STATUS_COLORS[f.status] }}>
                    {data.funnel[0].count > 0 ? Math.round(f.count / data.funnel[0].count * 100) : 0}%
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>
        <Card title="Daily Order Heatmap">
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={data.dayCount}>
              <XAxis dataKey="day" tick={{ fill: 'var(--tx2,#6e7681)', fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: 'var(--tx2,#6e7681)', fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip {...tip} />
              <Bar dataKey="orders" radius={[4,4,0,0]}>
                {data.dayCount.map((d, i) => {
                  const max = Math.max(...data.dayCount.map(x => x.orders));
                  const intensity = max > 0 ? d.orders / max : 0;
                  const g = Math.round(92 + intensity * 93);
                  return <Cell key={i} fill={`rgb(26,${g},42)`} />;
                })}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>

      {/* Inventory Intelligence */}
      {data.lowStock.length > 0 && (
        <Card title="⚠ Low Stock — Inventory Intelligence" action={<span className="text-[11px] text-[#f85149]">{data.lowStock.length} products</span>}>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr>
                {['Product','Stock','Margin %','Action'].map(h => (
                  <th key={h} className="text-left text-[10px] font-bold uppercase tracking-wider pb-2 pr-4" style={{color:"var(--tx2,#6e7681)"}}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {data.lowStock.map(p => (
                  <tr key={p.id} className="border-t border-[#30363d]/50 hover:bg-[#21262d]/20">
                    <td className="py-2 pr-4 text-[12px] text-white">{p.emoji} {p.name}</td>
                    <td className="py-2 pr-4">
                      <span className="font-bold text-[13px]" style={{ color: p.available_stock <= 5 ? '#f85149' : '#d29922' }}>
                        {p.available_stock}
                      </span>
                    </td>
                    <td className="py-2 pr-4">
                      <span className="text-[12px]" style={{ color: p.margin >= 30 ? '#3fb950' : p.margin >= 15 ? '#d29922' : '#f85149' }}>
                        {p.margin}%
                      </span>
                    </td>
                    <td className="py-2">
                      <button onClick={() => router.push('/admin/products')} className="text-[11px] text-[#58a6ff] hover:underline">Edit Stock →</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Orders Table */}
      <Card title="Orders Management">
        <div className="flex gap-3 mb-4 flex-wrap">
          <input value={search} onChange={e => setSearch(e.target.value.toLowerCase())} placeholder="Search order #, customer…"
            className="bg-[#21262d] border border-[#30363d] rounded-lg px-3 py-1.5 text-[12px] text-white w-52 focus:outline-none focus:border-[#1a5c2a]" />
          <select value={statusF} onChange={e => setStatusF(e.target.value)}
            className="bg-[#21262d] border border-[#30363d] rounded-lg px-3 py-1.5 text-[12px] text-[#8b949e]">
            <option value="">All Status</option>
            {STATUS_FLOW.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
          </select>
          <span className="text-[11px] text-[#6e7681] self-center">{filtered.length} orders</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead><tr>
              {['Order #','Customer','Phone','Amount','Payment','Status','Update','Date'].map(h => (
                <th key={h} className="text-left text-[10px] font-bold uppercase tracking-wider pb-2 pr-3" style={{color:"var(--tx2,#6e7681)"}}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {filtered.slice(0, 50).map(o => (
                <tr key={o.id} className="border-t border-[#30363d]/50 hover:bg-[#21262d]/20">
                  <td className="py-2.5 pr-3 text-[11px] text-[#58a6ff] font-mono">{o.order_number || '#' + String(o.id).slice(-6).toUpperCase()}</td>
                  <td className="py-2.5 pr-3 text-[12px] font-semibold" style={{color:"var(--tx,#e6edf3)"}}>{o.customerName}</td>
                  <td className="py-2.5 pr-3 text-[11px] text-[#6e7681]">{o.customerPhone}</td>
                  <td className="py-2.5 pr-3 text-[12px] font-bold">{fmtCurrency(parseFloat(o.total_amount) || 0)}</td>
                  <td className="py-2.5 pr-3"><Badge type={o.payment_method === 'razorpay_online' ? 'blue' : 'purple'}>{o.payment_method === 'razorpay_online' ? 'Online' : 'COD'}</Badge></td>
                  <td className="py-2.5 pr-3"><StatusBadge status={o.order_status} /></td>
                  <td className="py-2.5 pr-3">
                    {o.order_status !== 'delivered' && o.order_status !== 'cancelled' && (
                      <select defaultValue={o.order_status} disabled={updating === o.id}
                        onChange={e => updateStatus(o.id, e.target.value)}
                        className="bg-[#21262d] border border-[#30363d] rounded-md px-2 py-1 text-[11px] text-[#8b949e] focus:outline-none">
                        {STATUS_FLOW.map(s => (
                          <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
                        ))}
                      </select>
                    )}
                  </td>
                  <td className="py-2.5 text-[11px] text-[#6e7681]">{new Date(o.created_at).toLocaleDateString('en-IN')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

// Suspense boundary required by Next.js for useSearchParams
export default function OperationsPageWrapper(props) {
  return (
    <Suspense fallback={<div className="flex items-center justify-center py-24" style={{color:'var(--tx2,#6e7681)'}}>Loading…</div>}>
      <OperationsPage {...props} />
    </Suspense>
  );
}
