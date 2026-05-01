'use client';
import { useState, useEffect } from 'react';
import { api, fmtCurrency } from '@/lib/api';
import { Loader, ErrorMsg } from '@/components/ui/index';
import { BarChart, Bar, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

const tip = {
  contentStyle: { background: 'var(--bg2,#161b22)', border: '1px solid var(--bd,#30363d)', borderRadius: 8, fontSize: 12, color: 'var(--tx,#e6edf3)' },
  labelStyle: { color: 'var(--tx,#e6edf3)', fontWeight: 600 },
  cursor: { fill: 'color-mix(in srgb, var(--bd) 10%, transparent)' },
};

// ── Cohort Retention ────────────────────────────────────────────
function CohortChart({ orders, customers }) {
  if (!orders?.length || !customers?.length)
    return <p className="text-[13px] text-[var(--tx3)] py-6 text-center">Not enough data yet. Builds automatically over time.</p>;

  const custSignup = {};
  customers.forEach(c => { custSignup[c.id] = new Date(c.created_at).toISOString().slice(0, 7); });

  const custPurchases = {};
  orders.filter(o => o.order_status !== 'cancelled' && o.customer_id).forEach(o => {
    const m = new Date(o.created_at).toISOString().slice(0, 7);
    if (!custPurchases[o.customer_id]) custPurchases[o.customer_id] = new Set();
    custPurchases[o.customer_id].add(m);
  });

  const allMonths = [...new Set(Object.values(custSignup))].sort().slice(-6);
  const cohorts = allMonths.map(cohortMonth => {
    const cohortCusts = customers.filter(c => custSignup[c.id] === cohortMonth);
    const size = cohortCusts.length;
    const retention = [0,1,2,3,4,5].map(offset => {
      const d = new Date(cohortMonth + '-01');
      d.setMonth(d.getMonth() + offset);
      const tm = d.toISOString().slice(0, 7);
      const active = cohortCusts.filter(c => custPurchases[c.id]?.has(tm)).length;
      return size > 0 ? Math.round(active / size * 100) : null;
    });
    return { month: cohortMonth, size, retention };
  });

  const cellBg = v => !v ? 'var(--input-bg,#1c2128)' : v < 10 ? '#0d2b1a' : v < 25 ? '#1a5c2a' : v < 50 ? '#2ea043' : '#3fb950';
  const cellTx = v => (!v || v < 10) ? '#7ee787' : '#fff';

  return (
    <div>
      <p className="text-[11px] text-[var(--tx3)] mb-3">Each row = customers who signed up that month. M0 = signup month. Darker green = more still buying.</p>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', fontSize: 12, width: '100%' }}>
          <thead>
            <tr>
              <th style={{ textAlign:'left', color:'var(--tx3,#6e7681)', fontWeight:600, padding:'4px 8px 8px 0', fontSize:11 }}>Cohort</th>
              <th style={{ textAlign:'right', color:'var(--tx3,#6e7681)', fontWeight:600, padding:'4px 8px 8px', fontSize:11 }}>Size</th>
              {['M0','M1','M2','M3','M4','M5'].map(l => (
                <th key={l} style={{ textAlign:'center', color:'var(--tx3,#6e7681)', fontWeight:600, padding:'4px 6px 8px', fontSize:11, minWidth:46 }}>{l}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {cohorts.map(c => (
              <tr key={c.month}>
                <td style={{ color:'var(--tx,#e6edf3)', fontWeight:500, padding:'3px 8px 3px 0', whiteSpace:'nowrap' }}>
                  {new Date(c.month + '-01').toLocaleDateString('en-IN', { month:'short', year:'2-digit' })}
                </td>
                <td style={{ textAlign:'right', color:'var(--tx2,#8b949e)', padding:'3px 8px', fontSize:11 }}>{c.size}</td>
                {c.retention.map((val, i) => (
                  <td key={i} style={{ textAlign:'center', padding:'3px 4px', background:cellBg(val), color:cellTx(val), borderRadius:4, fontWeight:600, fontSize:11, border:'2px solid var(--bg,#0d1117)' }}>
                    {val !== null ? val + '%' : '—'}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex gap-4 mt-3 flex-wrap">
        {[['No data','var(--input-bg)'],['0%','#0d2b1a'],['<10%','#1a5c2a'],['<25%','#2ea043'],['50%+','#3fb950']].map(([l,c]) => (
          <span key={l} style={{ display:'flex', alignItems:'center', gap:5, fontSize:11, color:'var(--tx2,#8b949e)' }}>
            <span style={{ width:14, height:14, borderRadius:3, background:c, display:'inline-block' }} />{l}
          </span>
        ))}
      </div>
    </div>
  );
}

// ── Daily Order Heatmap ─────────────────────────────────────────
function OrderHeatmap({ orders }) {
  if (!orders?.length)
    return <p className="text-[13px] text-[var(--tx3)] py-6 text-center">No order data yet.</p>;

  const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const HOURS = Array.from({ length: 24 }, (_, i) => i);
  const grid = Array.from({ length: 7 }, () => Array(24).fill(0));
  orders.filter(o => o.order_status !== 'cancelled').forEach(o => {
    const d = new Date(o.created_at);
    grid[d.getDay()][d.getHours()]++;
  });
  const maxVal = Math.max(...grid.flat(), 1);
  let peakDay=0, peakHour=0, peakVal=0;
  grid.forEach((row,d) => row.forEach((v,h) => { if(v>peakVal){peakVal=v;peakDay=d;peakHour=h;} }));
  const dayTotals = grid.map(row => row.reduce((s,v)=>s+v,0));
  const busyDay = DAYS[dayTotals.indexOf(Math.max(...dayTotals))];
  const cellColor = v => { const p=v/maxVal; return !v?'var(--input-bg)':p<0.2?'#0d2b1a':p<0.4?'#1a5c2a':p<0.6?'#2ea043':p<0.8?'#3fb950':'#56d364'; };

  return (
    <div>
      <div className="flex gap-4 mb-4 flex-wrap">
        {[{label:'Busiest Day',value:busyDay},{label:'Peak Hour',value:`${peakHour}:00–${peakHour+1}:00`},{label:'Peak Orders',value:peakVal}].map(s => (
          <div key={s.label} style={{ background:'var(--input-bg,#21262d)', borderRadius:8, padding:'8px 14px' }}>
            <div style={{ fontSize:10, color:'var(--tx3,#6e7681)', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.05em' }}>{s.label}</div>
            <div style={{ fontSize:18, fontWeight:700, color:'#3fb950', marginTop:2 }}>{s.value}</div>
          </div>
        ))}
      </div>
      <div style={{ overflowX:'auto' }}>
        <div style={{ display:'grid', gridTemplateColumns:'auto repeat(24, minmax(22px, 1fr))', gap:2, minWidth:640 }}>
          <div />
          {HOURS.map(h => <div key={h} style={{ textAlign:'center', fontSize:9, color:'var(--tx3,#6e7681)', paddingBottom:3 }}>{h%3===0?h+'h':''}</div>)}
          {DAYS.map((day,di) => (
            <>
              <div key={day+'-l'} style={{ fontSize:11, color:'var(--tx2,#8b949e)', display:'flex', alignItems:'center', paddingRight:6, whiteSpace:'nowrap' }}>{day}</div>
              {HOURS.map(h => (
                <div key={h} title={`${day} ${h}:00 — ${grid[di][h]} orders`}
                  style={{ height:22, borderRadius:3, background:cellColor(grid[di][h]), border: grid[di][h]===peakVal&&peakVal>0?'1px solid #56d364':'1px solid transparent' }} />
              ))}
            </>
          ))}
        </div>
      </div>
      <div className="flex gap-3 mt-3 flex-wrap items-center">
        <span style={{ fontSize:11, color:'var(--tx3,#6e7681)' }}>Less</span>
        {['var(--input-bg)','rgba(13,43,26,0.5)','rgba(26,92,42,0.7)','#2ea043','#3fb950','#56d364'].map(c => (
          <span key={c} style={{ width:14, height:14, borderRadius:3, background:c, display:'inline-block' }} />
        ))}
        <span style={{ fontSize:11, color:'var(--tx3,#6e7681)' }}>More</span>
      </div>
    </div>
  );
}

// ── India State Bar Map ─────────────────────────────────────────
function IndiaMap({ customers, orders }) {
  const activeOrders = (orders||[]).filter(o => o.order_status !== 'cancelled');
  const orderedCustIds = new Set(activeOrders.map(o=>o.customer_id).filter(Boolean));
  const stateCounts = {};
  (customers||[]).forEach(c => {
    if (orderedCustIds.has(c.id) && c.state) {
      const s = c.state.trim();
      stateCounts[s] = (stateCounts[s]||0) + 1;
    }
  });
  const sorted = Object.entries(stateCounts).sort((a,b)=>b[1]-a[1]);
  const maxCount = sorted[0]?.[1]||1;
  const total = activeOrders.length;

  if (!sorted.length)
    return <p className="text-[13px] text-[var(--tx3)] py-6 text-center">No regional data yet. Collected from customer state field.</p>;

  const barColor = count => { const p=count/maxCount; return p>0.8?'#3fb950':p>0.5?'#2ea043':p>0.25?'#1a5c2a':'#0d2b1a'; };

  return (
    <div>
      <p className="text-[11px] text-[var(--tx3)] mb-3">Based on customer registered state. Top {Math.min(sorted.length,15)} markets shown.</p>
      <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
        {sorted.slice(0,15).map(([state,count],i) => (
          <div key={state} style={{ display:'flex', alignItems:'center', gap:10 }}>
            <div style={{ width:20, fontSize:11, color:'var(--tx3,#6e7681)', flexShrink:0, textAlign:'right' }}>{i+1}</div>
            <div style={{ width:150, fontSize:12, color:'var(--tx,#e6edf3)', flexShrink:0 }}>{state}</div>
            <div style={{ flex:1, background:'var(--input-bg,#21262d)', borderRadius:4, height:22, overflow:'hidden' }}>
              <div style={{ width:`${Math.round(count/maxCount*100)}%`, height:'100%', background:barColor(count), borderRadius:4 }} />
            </div>
            <div style={{ width:36, fontSize:12, fontWeight:700, color:'#3fb950', textAlign:'right', flexShrink:0 }}>{count}</div>
            <div style={{ width:44, fontSize:11, color:'var(--tx3,#6e7681)', textAlign:'right', flexShrink:0 }}>{total>0?Math.round(count/total*100):0}%</div>
          </div>
        ))}
      </div>
      {sorted.length>15 && <p style={{ fontSize:11, color:'var(--tx3,#6e7681)', marginTop:8 }}>+{sorted.length-15} more states</p>}
    </div>
  );
}

// ── Festival / Seasonal Trends ──────────────────────────────────
function SeasonalChart({ orders }) {
  const monthRev = Array(12).fill(0);
  (orders||[]).forEach(o => {
    if (o.order_status !== 'cancelled')
      monthRev[new Date(o.created_at).getMonth()] += parseFloat(o.total_amount)||0;
  });
  const seasonal = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
    .map((m,i) => ({ month:m, revenue:Math.round(monthRev[i]) }));

  const peakMonth = seasonal.reduce((a,b) => b.revenue>a.revenue?b:a, seasonal[0]);

  return (
    <div>
      <p className="text-[11px] text-[var(--tx3)] mb-3">
        All-time monthly revenue — orange = Oct/Nov (Diwali), blue = Dec/Jan (winter). Peak: <strong style={{color:'#3fb950'}}>{peakMonth.month}</strong> (₹{Math.round(peakMonth.revenue/1000)}k).
        {' '}This chart grows more useful every month — use it to plan inventory before festivals.
      </p>
      <ResponsiveContainer width="100%" height={160}>
        <BarChart data={seasonal}>
          <XAxis dataKey="month" tick={{ fill:'var(--chart-axis,#6e7681)', fontSize:11 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill:'var(--chart-axis,#6e7681)', fontSize:10 }} axisLine={false} tickLine={false} tickFormatter={v => '₹'+Math.round(v/1000)+'k'} />
          <Tooltip {...tip} formatter={v => [fmtCurrency(v),'Revenue']} />
          <Bar dataKey="revenue" radius={[3,3,0,0]}>
            {seasonal.map((d,i) => (
              <Cell key={i} fill={[9,10].includes(i)?'#f59e0b':[11,0].includes(i)?'#60a5fa':'#22c55e'} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <div className="flex gap-4 mt-2 flex-wrap">
        {[['Regular','#22c55e'],['Diwali (Oct–Nov)','#f59e0b'],['Winter (Dec–Jan)','#60a5fa']].map(([l,c]) => (
          <span key={l} style={{ display:'flex', alignItems:'center', gap:5, fontSize:11, color:'var(--tx2,#8b949e)' }}>
            <span style={{ width:10, height:10, borderRadius:2, background:c, display:'inline-block' }} />{l}
          </span>
        ))}
      </div>
    </div>
  );
}

// ── Page ────────────────────────────────────────────────────────
export default function AnalyticsPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true); setError(null);
    try {
      const [orders, customers] = await Promise.all([
        api.get('orders', 'select=id,customer_id,order_status,total_amount,created_at&order=created_at.desc'),
        api.get('customers', 'select=id,created_at,state&is_deleted=eq.false'),
      ]);
      setData({ orders: orders||[], customers: customers||[] });
    } catch(e) { setError(e.message); }
    finally { setLoading(false); }
  }

  if (loading) return <Loader text="Loading analytics…" />;
  if (error)   return <ErrorMsg error={error} onRetry={load} />;
  if (!data)   return null;

  const activeOrders = data.orders.filter(o => o.order_status !== 'cancelled');
  const stateSet = new Set(data.customers.map(c => c.state).filter(Boolean));
  const monthSet = new Set(data.orders.map(o => new Date(o.created_at).toISOString().slice(0,7)));

  const card = (title, subtitle, children) => (
    <div style={{ background:'var(--bg2,#161b22)', border:'1px solid var(--bd,#30363d)', borderRadius:12, padding:'18px 20px' }}>
      <div style={{ marginBottom:14 }}>
        <div style={{ fontSize:15, fontWeight:700, color:'var(--tx,#e6edf3)' }}>{title}</div>
        {subtitle && <div style={{ fontSize:12, color:'var(--tx3,#6e7681)', marginTop:2 }}>{subtitle}</div>}
      </div>
      {children}
    </div>
  );

  return (
    <div className="space-y-4">

      {/* Header */}
      <div>
        <h1 style={{ fontSize:20, fontWeight:700, color:'var(--tx,#e6edf3)', margin:0 }}>Analytics</h1>
        <p style={{ fontSize:13, color:'var(--tx3,#6e7681)', margin:'2px 0 0' }}>Retention · Timing · Geography · Seasonality</p>
      </div>

      {/* Summary stats */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(4, minmax(0,1fr))', gap:12 }}>
        {[
          { label:'Total Orders',    value:activeOrders.length,  color:'#3fb950' },
          { label:'Total Customers', value:data.customers.length, color:'var(--blue)' },
          { label:'States Covered',  value:stateSet.size,         color:'var(--yellow)' },
          { label:'Months of Data',  value:monthSet.size,         color:'var(--purple)' },
        ].map(s => (
          <div key={s.label} style={{ background:'var(--bg2,#161b22)', border:'1px solid var(--bd,#30363d)', borderRadius:10, padding:'14px 16px' }}>
            <div style={{ fontSize:10, color:'var(--tx3,#6e7681)', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.05em' }}>{s.label}</div>
            <div style={{ fontSize:26, fontWeight:700, color:s.color, marginTop:4 }}>{s.value}</div>
          </div>
        ))}
      </div>

      {card('🔁 Cohort Retention Analysis', 'What % of customers from each signup month kept buying in later months?',
        <CohortChart orders={data.orders} customers={data.customers} />
      )}

      {card('🔥 Daily Order Heatmap', 'Which day and hour gets the most orders? Time your campaigns and staffing around this.',
        <OrderHeatmap orders={data.orders} />
      )}

      {card('🗺️ Region-wise Orders (India)', 'Your top markets by state — focus ads, delivery partners and stock here.',
        <IndiaMap customers={data.customers} orders={data.orders} />
      )}

      {card('📅 Festival / Seasonal Trends', 'All-time monthly view — plan your inventory before Diwali, winter, and other peak seasons.',
        <SeasonalChart orders={data.orders} />
      )}

    </div>
  );
}
