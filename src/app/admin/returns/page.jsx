'use client';
import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';

const RETURN_STATUSES = ['requested','approved','received','refunded','rejected'];
const RETURN_REASONS  = ['damaged','wrong_item','not_as_described','changed_mind','missing_parts','other'];

// ── Reason → Restock (auto, locked) ──────────────────────────
const REASON_RESTOCK = {
  damaged:          false,
  missing_parts:    false,
  wrong_item:       true,
  not_as_described: true,
  changed_mind:     true,
  other:            null, // admin decides manually
};

function getAutoRestock(reason) {
  return REASON_RESTOCK[reason] ?? null;
}

// ── What payment becomes on each return status ────────────────
const STATUS_PAYMENT_MAP = {
  approved: 'refund_pending',
  received: null,             // no change
  refunded: 'refunded',
  rejected: 'paid',           // revert to paid
  requested: null,            // no change
};

function StatusBadge({ status }) {
  const map = {
    requested: { bg:'rgba(255,166,0,0.15)',  color:'#ffa600' },
    approved:  { bg:'rgba(88,166,255,0.15)', color:'#58a6ff' },
    received:  { bg:'rgba(188,140,255,0.15)',color:'#bc8cff' },
    refunded:  { bg:'rgba(63,185,80,0.15)',  color:'#3fb950' },
    rejected:  { bg:'rgba(248,81,73,0.15)',  color:'#f85149' },
  };
  const s = map[status] || { bg:'rgba(110,118,129,0.15)',color:'#8b949e' };
  return <span style={{background:s.bg,color:s.color,padding:'2px 8px',borderRadius:4,fontSize:10,fontWeight:700,letterSpacing:'0.05em',textTransform:'uppercase'}}>{status}</span>;
}

function PaymentEffect({ returnStatus }) {
  const effects = {
    approved:  { color:'#58a6ff', icon:'🔄', text:'Payment → Refund Pending' },
    received:  { color:'#bc8cff', icon:'📬', text:'No payment change' },
    refunded:  { color:'#3fb950', icon:'✅', text:'Payment → Refunded (final)' },
    rejected:  { color:'#f85149', icon:'❌', text:'Payment → Paid (reverted)' },
    requested: { color:'#ffa600', icon:'📋', text:'No payment change' },
  };
  const e = effects[returnStatus] || effects.requested;
  return (
    <div style={{fontSize:10,padding:'6px 10px',borderRadius:6,background:'rgba(88,166,255,0.06)',border:'1px solid rgba(88,166,255,0.15)',color:e.color}}>
      {e.icon} {e.text}
    </div>
  );
}

const inp = { width:'100%',padding:'7px 10px',borderRadius:6,background:'var(--bg,#0d1117)',border:'1px solid var(--bd,#30363d)',color:'var(--tx,#e6edf3)',fontSize:13,boxSizing:'border-box' };
const lbl = { fontSize:10,fontWeight:700,color:'#8b949e',letterSpacing:'0.08em',marginBottom:4,display:'block' };

export default function ReturnsPage() {
  const [returns, setReturns]   = useState([]);
  const [orders, setOrders]     = useState([]);
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [modal, setModal]       = useState(null);
  const [filterStatus, setFilterStatus] = useState('');
  const [search, setSearch]     = useState('');
  const [form, setForm] = useState({
    order_id:'', order_number:'', customer_name:'', reason:'damaged',
    description:'', refund_amount:'', status:'requested', restock:false,
  });
  const [orderSearch, setOrderSearch] = useState('');
  const [orderDropdown, setOrderDropdown] = useState(false);
  const [customers, setCustomers] = useState({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [ret, ord] = await Promise.all([
        api.get('returns', 'select=*&order=created_at.desc&limit=200').catch(() => []),
        api.get('orders', 'select=id,order_number,total_amount,customer_id,order_status,payment_status&order=created_at.desc&limit=500'),
      ]);
      setReturns(ret || []);
      setOrders(ord || []);
      const ids = [...new Set((ord||[]).map(o=>o.customer_id).filter(Boolean))];
      if (ids.length) {
        const cs = await api.get('customers', `id=in.(${ids.join(',')})&select=id,first_name,last_name,email`).catch(()=>[]);
        const map = {};
        (cs||[]).forEach(c=>{ map[c.id] = { name:`${c.first_name||''} ${c.last_name||''}`.trim(), email: c.email||'' }; });
        setCustomers(map);
      }
    } catch(e) { console.error(e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  // ── Fire stock movement when return is received ───────────
  // restock=true  → RETURN: initial+qty, available+qty
  // restock=false → DAMAGE: initial-qty (written off)
  // Called from both new return creation and status edit paths
  // Issue 15 fix: throws on fetch failure instead of silent skip
  async function fireReturnStockMovement(orderId, orderNumber, restock) {
    const orderItems = await api.get(
      'order_items',
      `order_id=eq.${orderId}&select=variant_id,quantity`
    ); // No .catch() — let it throw so caller knows it failed
    if (!orderItems || orderItems.length === 0) {
      throw new Error(`No items found for order ${orderNumber} — stock not updated`);
    }
    // Issue 4 fix: Promise.allSettled for all items together
    const results = await Promise.allSettled(
      orderItems
        .filter(item => item.variant_id)
        .map(item => api.post('stock_movements', {
          variant_id:   item.variant_id,
          type:         restock ? 'RETURN' : 'DAMAGE',
          quantity:     parseInt(item.quantity) || 1,
          source:       'return',
          notes:        restock
            ? `Return received — order ${orderNumber} restocked`
            : `Return received — order ${orderNumber} damaged, written off`,
          performed_by: 'admin',
        }))
    );
    const failed = results.filter(r => r.status === 'rejected');
    if (failed.length > 0) {
      throw new Error(`${failed.length} stock movement(s) failed for order ${orderNumber}. Please manually record in Inventory.`);
    }
  }

  async function saveReturn() {
    if (!form.order_number) return alert('Select an order');
    if (!form.reason)       return alert('Select a reason');
    setSaving(true);
    try {
      // Auto-compute restock based on reason
      const autoRestock = getAutoRestock(form.reason);
      const restock = autoRestock !== null ? autoRestock : form.restock;

      const body = {
        order_id:       form.order_id || null,
        order_number:   form.order_number,
        customer_name:  form.customer_name || null,
        reason:         form.reason,
        description:    form.description || null,
        refund_amount:  form.refund_amount ? parseFloat(form.refund_amount) : null,
        status:         form.status,
        restock,
        updated_at:     new Date().toISOString(),
      };

      if (modal === 'new') {
        // New return → create + set payment to refund_pending
        await api.post('returns', { ...body, created_at: new Date().toISOString() });
        if (form.order_id) {
          await api.patch('orders', `id=eq.${form.order_id}`, { payment_status: 'refund_pending' }).catch(()=>{});
        }
        // If created directly with status=received, fire stock movement immediately
        if (form.status === 'received' && form.order_id) {
          try {
            await fireReturnStockMovement(form.order_id, form.order_number, restock);
          } catch(stockErr) {
            alert(`⚠️ Return saved but stock update failed: ${stockErr.message}`);
          }
        }
        // Email customer — return requested
        await sendReturnEmail(form.order_id, form.order_number, form.customer_name, 'return_requested');

      } else {
        // Editing existing return
        const oldStatus = modal.status;
        const newStatus = form.status;
        await api.patch('returns', `id=eq.${modal.id}`, body);

        // ── Auto payment update based on return status change ──
        if (newStatus !== oldStatus && modal.order_id) {
          const newPayment = STATUS_PAYMENT_MAP[newStatus];
          if (newPayment !== null && newPayment !== undefined) {
            await api.patch('orders', `id=eq.${modal.order_id}`, { payment_status: newPayment }).catch(()=>{});
          }
        }

        // ── Auto stock movement when return is received ────────
        // Fire once only when status transitions TO 'received'
        // restock=true  → RETURN movement (good condition) → available+1, initial+1
        // restock=false → DAMAGE movement (damaged/unusable) → initial-1, available-1
        // Only fires at 'received' — not at requested/approved/refunded
        if (newStatus === 'received' && oldStatus !== 'received') {
          if (modal.order_id) {
            // Issue 12 fix: check if a RETURN/DAMAGE movement already exists for this order
            // Prevents double-firing if admin moves received→approved→received
            const existingMov = await api.get(
              'stock_movements',
              `source=eq.return&notes=ilike.*${modal.order_number}*&type=in.(RETURN,DAMAGE)&select=id`
            ).catch(() => []);
            if (existingMov && existingMov.length > 0) {
              // Already fired — skip to prevent double stock update
              console.warn(`Return stock movement already exists for ${modal.order_number} — skipping`);
            } else {
              try {
                await fireReturnStockMovement(modal.order_id, modal.order_number, restock);
              } catch(stockErr) {
                alert(`⚠️ Return updated but stock movement failed: ${stockErr.message}`);
              }
            }
          }
        }
        // ──────────────────────────────────────────────────────

        // ── Email customer on status change ───────────────────
        if (newStatus !== oldStatus) {
          const emailMap = {
            approved: 'return_approved',
            received: 'return_received',
            refunded: 'refund_initiated',
            rejected: 'return_rejected',
          };
          const emailStatus = emailMap[newStatus];
          if (emailStatus) {
            await sendReturnEmail(modal.order_id, modal.order_number, modal.customer_name, emailStatus);
          }
        }
      }

      setModal(null);
      await load();
    } catch(e) {
      if (e.message?.includes('42P01') || e.message?.includes('relation') || e.message?.includes('does not exist')) {
        alert('⚠️ The "returns" table does not exist yet.\n\nRun the SQL migration in Supabase first.');
      } else {
        alert('Error: ' + e.message);
      }
    } finally { setSaving(false); }
  }

  async function sendReturnEmail(orderId, orderNumber, customerName, emailStatus) {
    try {
      // Find order to get customer email
      const order = orders.find(o => String(o.id) === String(orderId));
      const custInfo = order ? customers[order.customer_id] : null;
      const custEmail = custInfo?.email;
      const custNameFinal = custInfo?.name || customerName || 'Customer';
      if (!custEmail) return;
      const pw = typeof window !== 'undefined' ? sessionStorage.getItem('pr_pw') : null;
      if (!pw) return;
      fetch('/api/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-password': pw },
        body: JSON.stringify({
          action:      'send_status_email',
          to:          custEmail,
          status:      emailStatus,
          orderNumber: orderNumber || String(orderId),
          orderId,
          name:        custNameFinal,
        }),
      }).catch(() => {});
    } catch(e) {}
  }

  function openEdit(r) {
    const autoRestock = getAutoRestock(r.reason);
    setForm({
      order_id:      r.order_id || '',
      order_number:  r.order_number || '',
      customer_name: r.customer_name || '',
      reason:        r.reason || 'damaged',
      description:   r.description || '',
      refund_amount: r.refund_amount || '',
      status:        r.status || 'requested',
      restock:       autoRestock !== null ? autoRestock : (r.restock !== false),
    });
    setModal(r);
  }

  function openNew() {
    setForm({ order_id:'', order_number:'', customer_name:'', reason:'damaged', description:'', refund_amount:'', status:'requested', restock:false });
    setOrderSearch('');
    setOrderDropdown(false);
    setModal('new');
  }

  // When reason changes → auto-update restock
  function onReasonChange(reason) {
    const autoRestock = getAutoRestock(reason);
    setForm(f => ({ ...f, reason, restock: autoRestock !== null ? autoRestock : f.restock }));
  }

  const filtered = returns.filter(r => {
    if (filterStatus && r.status !== filterStatus) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!(r.order_number||'').toLowerCase().includes(q) && !(r.customer_name||'').toLowerCase().includes(q) && !(r.reason||'').toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const stats = {
    total:         returns.length,
    pending:       returns.filter(r=>['requested','approved','received'].includes(r.status)).length,
    refund_pending:returns.filter(r=>r.status==='approved'||r.status==='received').length,
    refunded:      returns.filter(r=>r.status==='refunded').length,
    amount:        returns.filter(r=>r.status==='refunded').reduce((s,r)=>s+(r.refund_amount||0),0),
  };

  const fmtDate = ts => { if(!ts) return '—'; const d=new Date(ts); return d.toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}); };

  return (
    <div style={{padding:24}}>
      {/* Header */}
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:20}}>
        <div>
          <div style={{fontSize:20,fontWeight:700,color:'var(--tx,#e6edf3)'}}>↩️ Returns Management</div>
          <div style={{fontSize:12,color:'#8b949e',marginTop:2}}>Full lifecycle: Request → Approve → Receive → Refund · Payment auto-updates at each step</div>
        </div>
        <button onClick={openNew} style={{background:'var(--accent,#1a5c2a)',color:'#fff',border:'none',borderRadius:6,padding:'8px 16px',fontWeight:700,fontSize:13,cursor:'pointer'}}>
          + New Return
        </button>
      </div>

      {/* KPIs */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(5,1fr)',gap:12,marginBottom:20}}>
        {[
          {label:'Total Returns',    value:stats.total,                  color:'var(--tx)'},
          {label:'Pending Action',   value:stats.pending,                color:'#ffa600'},
          {label:'Refund Pending',   value:stats.refund_pending,         color:'#58a6ff'},
          {label:'Refunds Issued',   value:stats.refunded,               color:'#3fb950'},
          {label:'Amount Refunded',  value:'₹'+Math.round(stats.amount).toLocaleString('en-IN'), color:'#3fb950'},
        ].map((k,i)=>(
          <div key={i} style={{background:'var(--bg2,#161b22)',border:'1px solid var(--bd,#30363d)',borderRadius:8,padding:'14px 18px'}}>
            <div style={{fontSize:11,color:'#8b949e',marginBottom:4}}>{k.label}</div>
            <div style={{fontSize:20,fontWeight:700,color:k.color}}>{k.value}</div>
          </div>
        ))}
      </div>

      {/* Auto-rules info */}
      <div style={{background:'rgba(26,92,42,0.08)',border:'1px solid rgba(26,92,42,0.25)',borderRadius:8,padding:'10px 14px',marginBottom:16,fontSize:11,color:'#4a9c5d'}}>
        💡 <strong>Auto-rules:</strong> &nbsp;
        Approved → Payment: Refund Pending &nbsp;·&nbsp;
        Refunded → Payment: Refunded &nbsp;·&nbsp;
        Rejected → Payment: Paid (reverted) &nbsp;·&nbsp;
        Damaged/Missing → No restock &nbsp;·&nbsp;
        Wrong item/Changed mind → Auto restock
      </div>

      {/* Filters */}
      <div style={{display:'flex',gap:10,marginBottom:16}}>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search order#, customer, reason…" style={{...inp,width:240}}/>
        <select value={filterStatus} onChange={e=>setFilterStatus(e.target.value)} style={{...inp,width:180}}>
          <option value="">All Statuses</option>
          {RETURN_STATUSES.map(s=><option key={s} value={s}>{s.charAt(0).toUpperCase()+s.slice(1)}</option>)}
        </select>
        <button onClick={load} style={{background:'var(--bg2)',border:'1px solid var(--bd)',color:'var(--tx2)',borderRadius:6,padding:'7px 14px',fontSize:12,cursor:'pointer'}}>↻ Refresh</button>
      </div>

      {/* Table */}
      <div style={{background:'var(--bg2,#161b22)',border:'1px solid var(--bd,#30363d)',borderRadius:8,overflow:'hidden'}}>
        <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
          <thead>
            <tr style={{borderBottom:'1px solid var(--bd)',background:'rgba(255,255,255,0.02)'}}>
              {['Date','Order #','Customer','Reason','Refund Amt','Restock','Status','Payment Effect',''].map(h=>(
                <th key={h} style={{padding:'10px 12px',textAlign:'left',fontSize:10,fontWeight:700,color:'#8b949e',letterSpacing:'0.07em',textTransform:'uppercase'}}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} style={{padding:40,textAlign:'center',color:'#8b949e'}}>Loading…</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={9} style={{padding:60,textAlign:'center',color:'#8b949e'}}>
                <div style={{fontSize:32,marginBottom:8}}>↩️</div>
                <div style={{fontWeight:600,marginBottom:4}}>No returns yet</div>
                <div style={{fontSize:11}}>Returns will appear here</div>
              </td></tr>
            ) : filtered.map((r,i)=>(
              <tr key={r.id||i} style={{borderBottom:'1px solid rgba(48,54,61,0.5)',cursor:'pointer'}} onClick={()=>openEdit(r)}>
                <td style={{padding:'9px 12px',color:'#8b949e',fontSize:11}}>{fmtDate(r.created_at)}</td>
                <td style={{padding:'9px 12px',color:'var(--tx)',fontWeight:600,fontFamily:'monospace'}}>{r.order_number||'—'}</td>
                <td style={{padding:'9px 12px',color:'var(--tx2)'}}>{r.customer_name||'—'}</td>
                <td style={{padding:'9px 12px',color:'#8b949e',textTransform:'capitalize'}}>{(r.reason||'—').replace(/_/g,' ')}</td>
                <td style={{padding:'9px 12px',fontWeight:600,color:'#3fb950'}}>{r.refund_amount?'₹'+Math.round(r.refund_amount).toLocaleString('en-IN'):'—'}</td>
                <td style={{padding:'9px 12px'}}>
                  <span style={{color:r.restock?'#3fb950':'#f85149',fontWeight:600}}>{r.restock?'✓ Yes':'✗ No'}</span>
                  {REASON_RESTOCK[r.reason]!==null&&<span style={{fontSize:9,color:'#4a9c5d',marginLeft:4}}>auto</span>}
                </td>
                <td style={{padding:'9px 12px'}}><StatusBadge status={r.status}/></td>
                <td style={{padding:'9px 12px',fontSize:10,color:'#6e7681'}}>
                  {STATUS_PAYMENT_MAP[r.status] ? `→ ${STATUS_PAYMENT_MAP[r.status]}` : '—'}
                </td>
                <td style={{padding:'9px 12px'}}><span style={{color:'var(--accent)',fontSize:11}}>Edit →</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{fontSize:11,color:'#8b949e',marginTop:8}}>{filtered.length} returns</div>

      {/* Modal */}
      {modal && (
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.75)',zIndex:1000,display:'flex',alignItems:'center',justifyContent:'center'}}>
          <div style={{background:'var(--bg2,#161b22)',border:'1px solid var(--bd,#30363d)',borderRadius:10,width:520,maxHeight:'92vh',overflow:'auto',padding:24}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:18}}>
              <div style={{fontSize:14,fontWeight:700,color:'var(--tx)'}}>
                {modal==='new'?'↩️ New Return Request':'↩️ Edit Return — '+modal.order_number}
              </div>
              <button onClick={()=>setModal(null)} style={{background:'none',border:'none',color:'#8b949e',fontSize:20,cursor:'pointer'}}>×</button>
            </div>

            <div style={{display:'flex',flexDirection:'column',gap:14}}>

              {/* Order Search */}
              <div style={{position:'relative'}}>
                <label style={lbl}>SELECT ORDER *</label>
                {form.order_number ? (
                  <div style={{...inp, display:'flex', alignItems:'center', justifyContent:'space-between', background:'rgba(63,185,80,0.08)', border:'1px solid rgba(63,185,80,0.4)'}}>
                    <div>
                      <span style={{fontWeight:700, color:'#3fb950', fontFamily:'monospace'}}>{form.order_number}</span>
                      {form.customer_name && <span style={{color:'#8b949e', fontSize:11, marginLeft:8}}>{form.customer_name}</span>}
                    </div>
                    <button onClick={()=>{setForm(f=>({...f,order_id:'',order_number:'',customer_name:''}));setOrderSearch('');setOrderDropdown(false);}}
                      style={{background:'none',border:'none',color:'#f85149',fontSize:16,cursor:'pointer',padding:'0 4px'}}>×</button>
                  </div>
                ) : (
                  <div>
                    <input
                      value={orderSearch}
                      onChange={e=>{setOrderSearch(e.target.value);setOrderDropdown(true);}}
                      onFocus={()=>setOrderDropdown(true)}
                      style={inp}
                      placeholder="Search by order # or customer name…"
                      autoComplete="off"
                    />
                    {orderDropdown && (
                      <div style={{position:'absolute',top:'100%',left:0,right:0,background:'var(--bg2,#161b22)',border:'1px solid var(--bd,#30363d)',borderRadius:6,zIndex:100,maxHeight:220,overflowY:'auto',marginTop:2,boxShadow:'0 8px 24px rgba(0,0,0,0.5)'}}>
                        {orders
                          .filter(o=>{
                            if (!orderSearch) return true;
                            const q = orderSearch.toLowerCase();
                            const name = ((customers[o.customer_id]||{}).name||'').toLowerCase();
                            return (o.order_number||'').toLowerCase().includes(q) || name.includes(q);
                          })
                          .slice(0,20)
                          .map(o=>(
                            <div key={o.id}
                              onClick={()=>{
                                const custInfo = customers[o.customer_id] || {};
                                setForm(f=>({...f, order_id:Number(o.id), order_number:o.order_number||'', customer_name:custInfo.name||'', refund_amount: Math.round(o.total_amount||0) }));
                                setOrderSearch('');
                                setOrderDropdown(false);
                              }}
                              style={{padding:'9px 12px',cursor:'pointer',borderBottom:'1px solid rgba(48,54,61,0.5)',display:'flex',justifyContent:'space-between',alignItems:'center'}}
                              onMouseEnter={e=>e.currentTarget.style.background='rgba(255,255,255,0.04)'}
                              onMouseLeave={e=>e.currentTarget.style.background='transparent'}
                            >
                              <div>
                                <span style={{fontWeight:700,color:'#58a6ff',fontFamily:'monospace',fontSize:12}}>{o.order_number}</span>
                                <span style={{color:'#8b949e',fontSize:11,marginLeft:8}}>{(customers[o.customer_id]||{}).name||'Guest'}</span>
                                <span style={{fontSize:10,marginLeft:6,textTransform:'capitalize',color:'#6e7681'}}>{o.order_status}</span>
                              </div>
                              <div style={{fontSize:11,color:'#3fb950',fontWeight:600}}>₹{Math.round(o.total_amount||0).toLocaleString('en-IN')}</div>
                            </div>
                          ))
                        }
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Reason — drives restock auto-lock */}
              <div>
                <label style={lbl}>RETURN REASON *</label>
                <select value={form.reason} onChange={e=>onReasonChange(e.target.value)} style={inp}>
                  {RETURN_REASONS.map(r=><option key={r} value={r}>{r.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase())}</option>)}
                </select>
              </div>

              <div>
                <label style={lbl}>DESCRIPTION / NOTES</label>
                <textarea value={form.description} onChange={e=>setForm(f=>({...f,description:e.target.value}))}
                  style={{...inp,height:70,resize:'vertical'}} placeholder="Customer complaint or additional notes…"/>
              </div>

              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
                <div>
                  <label style={lbl}>REFUND AMOUNT (₹)</label>
                  <input type="number" value={form.refund_amount} onChange={e=>setForm(f=>({...f,refund_amount:e.target.value}))} style={inp} placeholder="0"/>
                </div>
                <div>
                  <label style={lbl}>RETURN STATUS</label>
                  <select value={form.status} onChange={e=>setForm(f=>({...f,status:e.target.value}))} style={inp}>
                    {RETURN_STATUSES.map(s=><option key={s} value={s}>{s.charAt(0).toUpperCase()+s.slice(1)}</option>)}
                  </select>
                </div>
              </div>

              {/* Payment effect preview */}
              <PaymentEffect returnStatus={form.status} />

              {/* Restock — locked by reason, manual only for 'other' */}
              <div>
                <label style={{...lbl,marginBottom:8}}>
                  RESTOCK ITEM?
                  {getAutoRestock(form.reason) !== null &&
                    <span style={{marginLeft:6,padding:'1px 6px',borderRadius:4,fontSize:9,fontWeight:700,background:'rgba(26,92,42,0.3)',color:'#4a9c5d'}}>AUTO</span>
                  }
                </label>
                {getAutoRestock(form.reason) !== null ? (
                  // Locked — based on reason
                  <div style={{padding:'8px 12px',borderRadius:6,fontSize:12,fontWeight:700,
                    background:'rgba(26,92,42,0.08)',border:'1px solid rgba(26,92,42,0.3)',
                    color:getAutoRestock(form.reason)?'#3fb950':'#f85149',
                    display:'flex',alignItems:'center',gap:8,cursor:'not-allowed'}}>
                    🔒 {getAutoRestock(form.reason)
                      ? '✓ Yes — restock (auto: item returnable)'
                      : '✗ No — not restocking (auto: damaged/missing)'}
                  </div>
                ) : (
                  // Manual — only for 'other' reason
                  <div style={{display:'flex',gap:10}}>
                    {[{v:true,l:'✓ Yes — add back to stock'},{v:false,l:'✗ No — item damaged/lost'}].map(opt=>(
                      <button key={String(opt.v)} onClick={()=>setForm(f=>({...f,restock:opt.v}))}
                        style={{flex:1,padding:'8px 10px',borderRadius:6,fontSize:12,fontWeight:600,cursor:'pointer',border:'1px solid var(--bd)',
                          background:form.restock===opt.v?'var(--accent,#1a5c2a)':'var(--bg)',color:form.restock===opt.v?'#fff':'var(--tx2)'}}>
                        {opt.l}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Return flow guide */}
              <div style={{background:'rgba(88,166,255,0.06)',border:'1px solid rgba(88,166,255,0.2)',borderRadius:6,padding:'10px 12px'}}>
                <div style={{fontSize:10,color:'#58a6ff',fontWeight:700,marginBottom:6}}>📋 RETURN FLOW</div>
                <div style={{display:'flex',gap:6,alignItems:'center',flexWrap:'wrap'}}>
                  {RETURN_STATUSES.map((s,i)=>(
                    <span key={s} style={{display:'flex',alignItems:'center',gap:6}}>
                      <span style={{fontSize:10,padding:'2px 8px',borderRadius:4,fontWeight:600,
                        background:form.status===s?'rgba(88,166,255,0.2)':'rgba(255,255,255,0.04)',
                        color:form.status===s?'#58a6ff':'#8b949e',border:`1px solid ${form.status===s?'rgba(88,166,255,0.4)':'transparent'}`}}>
                        {s}
                      </span>
                      {i<RETURN_STATUSES.length-1&&<span style={{color:'#444',fontSize:10}}>→</span>}
                    </span>
                  ))}
                </div>
              </div>

              <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:4}}>
                <button onClick={()=>setModal(null)} style={{padding:'8px 16px',borderRadius:6,border:'1px solid var(--bd)',background:'var(--bg)',color:'var(--tx2)',fontSize:13,cursor:'pointer'}}>Cancel</button>
                <button onClick={saveReturn} disabled={saving}
                  style={{padding:'8px 18px',borderRadius:6,border:'none',background:'var(--accent,#1a5c2a)',color:'#fff',fontWeight:700,fontSize:13,cursor:saving?'not-allowed':'pointer',opacity:saving?0.6:1}}>
                  {saving?'Saving…':'Save Return'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
