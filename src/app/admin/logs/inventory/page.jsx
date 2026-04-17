'use client';
import { useState, useEffect, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { api, buildDateFilter } from '@/lib/api';

const MOVEMENT_TYPES = ['IN','OUT','RESERVE','RELEASE','ADJUSTMENT','RETURN','DAMAGE','CORRECTION'];
const SOURCES        = ['manual','website_order','amazon_order','return','damage','restock','correction','transfer'];
// Only PENDING orders count as reserved — confirmed/packed/shipped already moved to SOLD via OUT movement
const ACTIVE_ORDER_STATUSES = ['pending'];

const TYPE_META = {
  IN:          { color:'#3fb950', bg:'rgba(63,185,80,0.12)',  sign:'+', label:'Stock In'    },
  OUT:         { color:'#f85149', bg:'rgba(248,81,73,0.12)',  sign:'−', label:'Stock Out'   },
  RESERVE:     { color:'#ffa600', bg:'rgba(255,166,0,0.12)',  sign:'−', label:'Reserved'    },
  RELEASE:     { color:'#58a6ff', bg:'rgba(88,166,255,0.12)', sign:'+', label:'Released'    },
  ADJUSTMENT:  { color:'#bc8cff', bg:'rgba(188,140,255,0.12)',sign:'=', label:'Adjustment'  },
  RETURN:      { color:'#56d364', bg:'rgba(86,211,100,0.12)', sign:'+', label:'Return'      },
  DAMAGE:      { color:'#f85149', bg:'rgba(248,81,73,0.08)',  sign:'−', label:'Damage/Loss' },
  CORRECTION:  { color:'#d29922', bg:'rgba(210,153,34,0.12)', sign:'±', label:'Correction'  },
};

const STATUS_META = {
  OK:           { color:'#3fb950', label:'OK'           },
  LOW:          { color:'#d29922', label:'Low Stock'    },
  CRITICAL:     { color:'#f85149', label:'Critical'     },
  OUT_OF_STOCK: { color:'#f85149', label:'Out of Stock' },
};

function MovBadge({ type }) {
  const m = TYPE_META[type] || { color:'#8b949e', bg:'rgba(139,148,158,0.15)', label: type };
  return (
    <span style={{ background:m.bg, color:m.color, padding:'2px 8px', borderRadius:4,
      fontSize:10, fontWeight:700, letterSpacing:'0.05em', whiteSpace:'nowrap' }}>
      {m.label}
    </span>
  );
}

const st = {
  inp:  { width:'100%', padding:'7px 10px', borderRadius:6, background:'var(--bg,#0d1117)',
          border:'1px solid var(--bd,#1a5c2a)', color:'var(--tx,#e6edf3)', fontSize:12, boxSizing:'border-box' },
  lbl:  { fontSize:10, fontWeight:700, color:'#8b949e', letterSpacing:'0.08em', marginBottom:4, display:'block' },
  card: { background:'var(--bg2,#161b22)', border:'1px solid var(--bd,#1a5c2a)', borderRadius:12, padding:16 },
};

function computeStatus(avail) {
  if (avail <= 0)  return 'OUT_OF_STOCK';
  if (avail <= 5)  return 'CRITICAL';
  if (avail <= 10) return 'LOW';
  return 'OK';
}

function fmtDate(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  return d.toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'2-digit'})
       + ' ' + d.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'});
}

function InventoryPage() {
  const searchParams = useSearchParams();
  // days only controls stock_movements date range — overview/reserved is always current snapshot
  const days = parseInt(searchParams?.get('days') || '7', 10);

  const [tab, setTab]               = useState('overview');
  const [overview, setOverview]     = useState([]);
  const [movements, setMovements]   = useState([]);
  const [channels, setChannels]     = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [products, setProducts]     = useState([]);
  const [loading, setLoading]       = useState(true);
  const [loadError, setLoadError]   = useState(null);
  const [saving, setSaving]         = useState(false);

  const [filterStatus, setFilterStatus]   = useState('');
  const [search, setSearch]               = useState('');
  const [filterType, setFilterType]       = useState('');
  const [searchMov, setSearchMov]         = useState('');
  const [filterProduct, setFilterProduct] = useState('');
  const [filterSize, setFilterSize]       = useState('');

  const [showMovModal, setShowMovModal]     = useState(false);
  const [variantsForMov, setVariantsForMov] = useState([]);
  const [movForm, setMovForm] = useState({
    product_id:'', variant_id:'', type:'IN', quantity:'', source:'manual', notes:''
  });

  const [showChanModal, setShowChanModal] = useState(false);
  const [chanForm, setChanForm] = useState({ variant_id:'', channel_id:'', allocated_stock:'' });

  const [soldExpanded, setSoldExpanded] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [ovRaw, mv, mv1d, mv7d, mv30d, mv90d, ch, wh, pr, allVariants, pendingItems] = await Promise.all([
        api.get('inventory_overview', 'select=*').catch(() => []),

        // Stock movements respect the ?days= date filter (for Movements tab)
        api.get('stock_movements',
          `select=id,variant_id,type,quantity,source,reference_id,notes,performed_by,before_stock,after_stock,created_at&order=created_at.desc&limit=500&created_at=gte.${buildDateFilter(days)}`
        ).catch(() => []),

        // 1-day (today) OUT movements for sold column
        api.get('stock_movements',
          `select=variant_id,quantity&type=eq.OUT&created_at=gte.${buildDateFilter(1)}`
        ).catch(() => []),

        // 7-day OUT movements for sold column
        api.get('stock_movements',
          `select=variant_id,quantity&type=eq.OUT&created_at=gte.${buildDateFilter(7)}`
        ).catch(() => []),

        // 30-day OUT movements for sold column
        api.get('stock_movements',
          `select=variant_id,quantity&type=eq.OUT&created_at=gte.${buildDateFilter(30)}`
        ).catch(() => []),

        // 90-day OUT movements for sold column
        api.get('stock_movements',
          `select=variant_id,quantity&type=eq.OUT&created_at=gte.${buildDateFilter(90)}`
        ).catch(() => []),

        api.get('channels',   'select=*&order=name.asc').catch(() => []),
        api.get('warehouses', 'select=*&order=name.asc').catch(() => []),
        api.get('products',   'select=id,name,emoji&is_deleted=eq.false&order=name.asc').catch(() => []),
        api.get('product_variants',
          'select=id,product_id,sku,variant_type,variant_value,available_stock,initial_stock,orders_reserved,barcode,is_active&is_active=eq.true&order=product_id.asc,sort_order.asc'
        ).catch(() => []),

        // FIX: correct PostgREST alias syntax for filtering on joined table.
        // `order:orders!inner` creates alias, `order.order_status` uses it.
        // Without alias, the filter is silently ignored → ALL order_items returned → wrong reserved count.
        // orders_reserved intentionally has NO date filter — reserved = all currently active orders.
        api.get('order_items',
          `select=variant_id,quantity,order:orders!inner(order_status)&order.order_status=in.(${ACTIVE_ORDER_STATUSES.join(',')})`
        ).catch(() => []),
      ]);

      const prodMap = {};
      (pr || []).forEach(p => { prodMap[p.id] = p; });

      const ovMap = {};
      (ovRaw || []).forEach(o => { ovMap[o.variant_id] = o; });

      // Build reserved count from live PENDING orders only
      // confirmed/packed/shipped orders already moved to SOLD via OUT movement
      const reservedMap = {};
      (pendingItems || []).forEach(item => {
        const vid = item.variant_id;
        const qty = item.quantity;
        if (vid && typeof qty === 'number' && qty > 0) {
          reservedMap[vid] = (reservedMap[vid] || 0) + qty;
        }
      });

      // Build period-wise sold from movements (only within selected days)
      const periodSoldMap = {};
      (mv || []).forEach(m => {
        if (m.type === 'OUT' && m.variant_id) {
          periodSoldMap[m.variant_id] = (periodSoldMap[m.variant_id] || 0) + (m.quantity || 0);
        }
      });

      // 1-day (today) sold map
      const sold1dMap = {};
      (mv1d || []).forEach(m => {
        if (m.variant_id) sold1dMap[m.variant_id] = (sold1dMap[m.variant_id] || 0) + (m.quantity || 0);
      });

      // 7-day sold map
      const sold7dMap = {};
      (mv7d || []).forEach(m => {
        if (m.variant_id) sold7dMap[m.variant_id] = (sold7dMap[m.variant_id] || 0) + (m.quantity || 0);
      });

      // 30-day sold map
      const sold30dMap = {};
      (mv30d || []).forEach(m => {
        if (m.variant_id) sold30dMap[m.variant_id] = (sold30dMap[m.variant_id] || 0) + (m.quantity || 0);
      });

      // 90-day sold map
      const sold90dMap = {};
      (mv90d || []).forEach(m => {
        if (m.variant_id) sold90dMap[m.variant_id] = (sold90dMap[m.variant_id] || 0) + (m.quantity || 0);
      });

      const merged = (allVariants || []).map(v => {
        const ov   = ovMap[v.id] || {};
        const prod = prodMap[v.product_id] || {};

        // reserved = only pending orders (confirmed+ already moved to sold via OUT)
        const reserved  = reservedMap[v.id] ?? 0;
        const initialStk = ov.initial_stock ?? v.initial_stock ?? 0;

        // sold = ALL-TIME from inventory_overview (Amazon/Shopify standard)
        // inventory_overview.sold_count = lifetime OUT movements = true units ever sold
        // Time-filtered sold data is in the Movements tab (filter by OUT type)
        const sold = ov.sold_count ?? 0;

        // available = always recompute from source of truth
        // Use DB's generated available_stock column as primary source
        // It is auto-computed by the process_stock_movement trigger
        const available = v.available_stock ?? Math.max(0, initialStk - sold - reserved);

        const sizeVal = v.variant_value;
        const size = (sizeVal === 'Default' || sizeVal === 'default')
          ? (v.variant_type !== 'default' ? v.variant_type : 'Single')
          : (sizeVal || ov.size || '—');

        return {
          variant_id:      v.id,
          product_name:    prod.name  || ov.product_name || '—',
          emoji:           prod.emoji || ov.emoji        || '',
          sku:             v.sku      || ov.sku          || null,
          size,
          initial_stock:   initialStk,
          orders_reserved: reserved,
          available_stock: available,
          sold_count:      sold,
          sold_1d:         sold1dMap[v.id]  ?? 0,
          sold_7d:         sold7dMap[v.id]  ?? 0,
          sold_30d:        sold30dMap[v.id] ?? 0,
          sold_90d:        sold90dMap[v.id] ?? 0,
          return_count:    ov.return_count ?? 0,
          barcode:         v.barcode  || ov.barcode      || null,
          stock_status:    ov.stock_status || computeStatus(available),
        };
      });

      setOverview(merged);
      setMovements(mv  || []);
      setChannels(ch   || []);
      setWarehouses(wh || []);
      setProducts(pr   || []);
    } catch(e) {
      console.error('Inventory load error:', e);
      setLoadError(e?.message || 'Failed to load inventory data');
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!movForm.product_id) { setVariantsForMov([]); setMovForm(f=>({...f,variant_id:''})); return; }
    api.get('product_variants',
      `product_id=eq.${movForm.product_id}&is_active=eq.true&order=sort_order.asc&select=id,sku,variant_type,variant_value,available_stock`
    ).then(v => setVariantsForMov(v || [])).catch(() => {});
  }, [movForm.product_id]);

  async function saveMovement() {
    if (!movForm.variant_id) return alert('Select a variant (SKU) — required for stock tracking');
    const qty = parseInt(movForm.quantity);
    if (!qty || qty <= 0) return alert('Enter a valid quantity (> 0)');
    setSaving(true);
    try {
      await api.post('stock_movements', {
        variant_id:   parseInt(movForm.variant_id),
        type:         movForm.type,
        quantity:     qty,
        source:       movForm.source,
        notes:        movForm.notes || null,
        performed_by: 'admin',
      });
      setShowMovModal(false);
      setMovForm({ product_id:'', variant_id:'', type:'IN', quantity:'', source:'manual', notes:'' });
      await load();
    } catch(e) { alert('Error saving movement: ' + e.message); }
    finally { setSaving(false); }
  }

  async function saveChanAlloc() {
    if (!chanForm.variant_id || !chanForm.channel_id) return alert('Select variant and channel');
    const qty = parseInt(chanForm.allocated_stock);
    if (isNaN(qty) || qty < 0) return alert('Enter valid stock (≥ 0)');
    setSaving(true);
    try {
      await api.post('channel_inventory', {
        variant_id:      parseInt(chanForm.variant_id),
        channel_id:      parseInt(chanForm.channel_id),
        allocated_stock: qty,
      });
      setShowChanModal(false);
      setChanForm({ variant_id:'', channel_id:'', allocated_stock:'' });
      await load();
    } catch(e) { alert('Error saving allocation: ' + e.message); }
    finally { setSaving(false); }
  }

  const totalSKUs      = overview.length;
  const totalAvailable = overview.reduce((s,o) => s + (o.available_stock||0), 0);
  const totalReserved  = overview.reduce((s,o) => s + (o.orders_reserved||0), 0);
  const outOfStock     = overview.filter(o => o.stock_status === 'OUT_OF_STOCK').length;
  const critical       = overview.filter(o => o.stock_status === 'CRITICAL').length;
  const low            = overview.filter(o => o.stock_status === 'LOW').length;

  function handleKpiClick(statusFilter) {
    setFilterStatus(prev => prev === statusFilter ? '' : statusFilter);
    setTab('overview');
    setTimeout(() => {
      document.getElementById('inv-overview-table')?.scrollIntoView({ behavior:'smooth', block:'start' });
    }, 80);
  }

  const uniqueProducts = [...new Map(overview.map(o => [o.product_name, o.product_name])).values()].sort();
  const uniqueSizes    = [...new Set(overview.map(o => o.size).filter(Boolean))].sort();

  const filteredOverview = overview.filter(o => {
    if (filterStatus  && o.stock_status  !== filterStatus)  return false;
    if (filterProduct && o.product_name  !== filterProduct) return false;
    if (filterSize    && o.size          !== filterSize)     return false;
    if (search) {
      const q = search.toLowerCase();
      return (o.product_name||'').toLowerCase().includes(q)
          || (o.sku||'').toLowerCase().includes(q)
          || (o.size||'').toLowerCase().includes(q);
    }
    return true;
  });

  const filteredMovements = movements.filter(m => {
    if (filterType && m.type !== filterType) return false;
    if (searchMov) {
      const q  = searchMov.toLowerCase();
      const ov = overview.find(o => o.variant_id === m.variant_id);
      return (ov?.product_name||'').toLowerCase().includes(q)
          || (ov?.sku||'').toLowerCase().includes(q)
          || (m.notes||'').toLowerCase().includes(q)
          || (m.source||'').toLowerCase().includes(q);
    }
    return true;
  });

  const TABS = [
    { id:'overview',   label:'📦 Stock Overview'   },
    { id:'movements',  label:'🔄 Stock Movements'  },
    { id:'channels',   label:'🌐 Channel Inventory' },
    { id:'warehouses', label:'🏭 Warehouses'        },
  ];

  const KPIS = [
    { label:'Total SKUs',     value:totalSKUs,      color:'#58a6ff', filter:null,           clickable:false },
    { label:'Available Now',  value:totalAvailable, color:'#3fb950', filter:null,           clickable:false },
    { label:'Orders Pending', value:totalReserved,  color:'#ffa600', filter:null,           clickable:false },
    { label:'Out of Stock',   value:outOfStock,     color:'#f85149', filter:'OUT_OF_STOCK', clickable:true  },
    { label:'Critical (≤5)',  value:critical,       color:'#f85149', filter:'CRITICAL',     clickable:true  },
    { label:'Low (≤10)',      value:low,            color:'#d29922', filter:'LOW',          clickable:true  },
  ];

  return (
    <div style={{padding:20}}>

      {showMovModal && (
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.82)',zIndex:1000,
          display:'flex',alignItems:'center',justifyContent:'center',padding:20}}>
          <div style={{...st.card,maxWidth:520,width:'100%',border:'2px solid var(--accent,#1a5c2a)'}}>
            <div style={{fontSize:14,fontWeight:700,color:'var(--tx,#fff)',marginBottom:4}}>
              📥 Record Stock Movement
            </div>
            <div style={{fontSize:10,color:'#3fb950',marginBottom:14}}>
              ✓ before_stock, after_stock and inventory auto-updated by DB trigger
            </div>
            <div style={{display:'grid',gap:12}}>
              <div>
                <label style={st.lbl}>PRODUCT</label>
                <select value={movForm.product_id}
                  onChange={e=>setMovForm(f=>({...f,product_id:e.target.value,variant_id:''}))}
                  style={st.inp}>
                  <option value="">Select product…</option>
                  {products.map(p=><option key={p.id} value={p.id}>{p.emoji} {p.name}</option>)}
                </select>
              </div>
              {movForm.product_id && variantsForMov.length === 0 && (
                <div style={{fontSize:11,color:'#d29922',padding:'6px 10px',borderRadius:6,
                  background:'rgba(210,153,34,0.08)',border:'1px solid rgba(210,153,34,0.2)'}}>
                  ⚠️ No active variants found for this product
                </div>
              )}
              {variantsForMov.length > 0 && (
                <div>
                  <label style={st.lbl}>VARIANT / SKU <span style={{color:'#f85149'}}>*</span></label>
                  <select value={movForm.variant_id}
                    onChange={e=>setMovForm(f=>({...f,variant_id:e.target.value}))}
                    style={st.inp}>
                    <option value="">— Select variant (required) —</option>
                    {variantsForMov.map(v=><option key={v.id} value={v.id}>
                      {v.sku?`[${v.sku}] `:''}{v.variant_value} — Stock: {v.available_stock}
                    </option>)}
                  </select>
                </div>
              )}
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
                <div>
                  <label style={st.lbl}>TYPE</label>
                  <select value={movForm.type} onChange={e=>setMovForm(f=>({...f,type:e.target.value}))} style={st.inp}>
                    {MOVEMENT_TYPES.map(t=><option key={t} value={t}>{TYPE_META[t]?.label||t}</option>)}
                  </select>
                </div>
                <div>
                  <label style={st.lbl}>QUANTITY</label>
                  <input type="number" min="1" value={movForm.quantity}
                    onChange={e=>setMovForm(f=>({...f,quantity:e.target.value}))}
                    style={st.inp} placeholder="e.g. 50" />
                </div>
              </div>
              <div>
                <label style={st.lbl}>SOURCE</label>
                <select value={movForm.source} onChange={e=>setMovForm(f=>({...f,source:e.target.value}))} style={st.inp}>
                  {SOURCES.map(src=><option key={src} value={src}>{src.replace(/_/g,' ')}</option>)}
                </select>
              </div>
              <div>
                <label style={st.lbl}>NOTES (optional)</label>
                <input value={movForm.notes} onChange={e=>setMovForm(f=>({...f,notes:e.target.value}))}
                  style={st.inp} placeholder="Batch no., supplier, reason…" />
              </div>
              {movForm.type && (
                <div style={{padding:'10px 14px',borderRadius:8,
                  background:TYPE_META[movForm.type]?.bg,
                  border:`1px solid ${TYPE_META[movForm.type]?.color}33`}}>
                  <div style={{fontSize:11,fontWeight:700,color:TYPE_META[movForm.type]?.color,marginBottom:2}}>
                    {TYPE_META[movForm.type]?.label}
                  </div>
                  <div style={{fontSize:10,color:'#8b949e'}}>
                    {movForm.type==='IN'         && 'Stock arrives → initial_stock + qty, available_stock + qty'}
                    {movForm.type==='OUT'        && 'Order shipped → initial_stock − qty, orders_reserved − qty'}
                    {movForm.type==='RESERVE'    && 'Order placed → orders_reserved + qty, available_stock − qty'}
                    {movForm.type==='RELEASE'    && 'Order cancelled → orders_reserved − qty, available_stock + qty'}
                    {movForm.type==='RETURN'     && 'Customer return → initial_stock + qty'}
                    {movForm.type==='ADJUSTMENT' && 'Set absolute value (use after physical count)'}
                    {movForm.type==='DAMAGE'     && 'Write off damaged/lost → initial_stock − qty'}
                    {movForm.type==='CORRECTION' && 'Manual correction (+qty) with audit note'}
                  </div>
                </div>
              )}
            </div>
            <div style={{display:'flex',gap:10,marginTop:16}}>
              <button onClick={saveMovement} disabled={saving}
                style={{flex:1,padding:'9px 0',borderRadius:8,border:'none',
                  background:'var(--accent,#1a5c2a)',color:'#fff',fontWeight:700,fontSize:13,cursor:'pointer'}}>
                {saving?'Saving…':'✓ Record Movement'}
              </button>
              <button onClick={()=>setShowMovModal(false)}
                style={{padding:'9px 18px',borderRadius:8,border:'1px solid #30363d',
                  background:'transparent',color:'#8b949e',fontSize:13,cursor:'pointer'}}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {showChanModal && (
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.82)',zIndex:1000,
          display:'flex',alignItems:'center',justifyContent:'center',padding:20}}>
          <div style={{...st.card,maxWidth:420,width:'100%',border:'1px solid #58a6ff'}}>
            <div style={{fontSize:14,fontWeight:700,color:'var(--tx,#fff)',marginBottom:16}}>
              🌐 Set Channel Allocation
            </div>
            <div style={{display:'grid',gap:12}}>
              <div>
                <label style={st.lbl}>VARIANT (SKU)</label>
                <select value={chanForm.variant_id} onChange={e=>setChanForm(f=>({...f,variant_id:e.target.value}))} style={st.inp}>
                  <option value="">Select variant…</option>
                  {overview.map(o=><option key={o.variant_id} value={o.variant_id}>
                    {o.sku?`[${o.sku}] `:''}{o.product_name} — {o.size} (Avail: {o.available_stock})
                  </option>)}
                </select>
              </div>
              <div>
                <label style={st.lbl}>CHANNEL</label>
                <select value={chanForm.channel_id} onChange={e=>setChanForm(f=>({...f,channel_id:e.target.value}))} style={st.inp}>
                  <option value="">Select channel…</option>
                  {channels.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label style={st.lbl}>ALLOCATED STOCK</label>
                <input type="number" min="0" value={chanForm.allocated_stock}
                  onChange={e=>setChanForm(f=>({...f,allocated_stock:e.target.value}))}
                  style={st.inp} placeholder="Units to allocate to this channel" />
              </div>
            </div>
            <div style={{display:'flex',gap:10,marginTop:16}}>
              <button onClick={saveChanAlloc} disabled={saving}
                style={{flex:1,padding:'9px 0',borderRadius:8,border:'none',
                  background:'#58a6ff',color:'#000',fontWeight:700,fontSize:13,cursor:'pointer'}}>
                {saving?'Saving…':'✓ Save Allocation'}
              </button>
              <button onClick={()=>setShowChanModal(false)}
                style={{padding:'9px 18px',borderRadius:8,border:'1px solid #30363d',
                  background:'transparent',color:'#8b949e',fontSize:13,cursor:'pointer'}}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:12}}>
        <div>
          <div style={{fontSize:20,fontWeight:700,color:'var(--tx,#fff)'}}>📦 Inventory Management</div>
          <div style={{fontSize:11,color:'#8b949e',marginTop:2}}>
            Variant-level stock · Auto-updated by DB triggers · Full audit trail
            <span style={{marginLeft:8,color:'#444'}}>
              · Movements: {days===1?'today':`last ${days} days`} · Reserved: all active orders
            </span>
          </div>
        </div>
        <button onClick={()=>setShowMovModal(true)}
          style={{padding:'8px 18px',borderRadius:8,border:'none',
            background:'var(--accent,#1a5c2a)',color:'#fff',fontWeight:700,fontSize:13,cursor:'pointer'}}>
          + Record Movement
        </button>
      </div>

      {/* Approach info banner */}
      <div style={{marginBottom:16,padding:'10px 16px',borderRadius:8,
        background:'rgba(88,166,255,0.06)',border:'1px solid rgba(88,166,255,0.2)',
        display:'flex',alignItems:'flex-start',gap:10}}>
        <span style={{fontSize:15,flexShrink:0}}>📊</span>
        <div style={{fontSize:11,color:'#8b949e',lineHeight:1.7}}>
          <span style={{color:'#58a6ff',fontWeight:700}}>Sold Column — Industry Standard Approach: </span>
          <span style={{color:'#79c0ff',fontWeight:600}}>ALL</span> = lifetime units ever sold ·{' '}
          <span style={{color:'#e8c070',fontWeight:600}}>TODAY</span> = last 24 hours ·{' '}
          <span style={{color:'#d29922',fontWeight:600}}>7D</span> = last 7 days ·{' '}
          <span style={{color:'#58a6ff',fontWeight:600}}>30D</span> = last 30 days ·{' '}
          <span style={{color:'#3fb950',fontWeight:600}}>90D</span> = last 90 days.
          {' '}For detailed period analysis, use the{' '}
          <span style={{color:'#3fb950',fontWeight:600}}>🔄 Stock Movements tab</span> → filter by <em>Stock Out</em>.
          {' '}The date buttons above only affect the Movements tab.
        </div>
      </div>

      {loadError && (
        <div style={{marginBottom:16,padding:'10px 16px',borderRadius:8,
          background:'rgba(248,81,73,0.08)',border:'1px solid rgba(248,81,73,0.3)',
          display:'flex',alignItems:'center',justifyContent:'space-between',gap:10}}>
          <span style={{fontSize:12,color:'#f85149'}}>⚠️ Error loading inventory: {loadError}</span>
          <button onClick={load} style={{fontSize:11,color:'#f85149',background:'transparent',
            border:'1px solid #f8514944',borderRadius:6,padding:'3px 10px',cursor:'pointer'}}>
            Retry
          </button>
        </div>
      )}

      {overview.some(o => !o.sku) && (
        <div style={{marginBottom:16,padding:'10px 16px',borderRadius:8,
          background:'rgba(210,153,34,0.08)',border:'1px solid rgba(210,153,34,0.3)',
          display:'flex',alignItems:'center',gap:10}}>
          <span style={{fontSize:16}}>⚠️</span>
          <div>
            <span style={{fontSize:12,fontWeight:700,color:'#d29922'}}>SKU missing on some variants — </span>
            <span style={{fontSize:11,color:'#8b949e'}}>
              Go to Catalogue → Edit product → Variants → SKU field. SKU is needed for barcode scanning and stock tracking.
            </span>
          </div>
        </div>
      )}

      {/* Stale orders hint — shown when reserved count is high */}
      {totalReserved > 10 && (
        <div style={{marginBottom:16,padding:'10px 16px',borderRadius:8,
          background:'rgba(255,166,0,0.06)',border:'1px solid rgba(255,166,0,0.2)',
          display:'flex',alignItems:'center',gap:10}}>
          <span style={{fontSize:14}}>📋</span>
          <div style={{fontSize:11,color:'#8b949e'}}>
            <span style={{color:'#ffa600',fontWeight:700}}>{totalReserved} units</span>
            {' '}reserved across active orders. If this seems high, check the{' '}
            <a href="/admin/orders" style={{color:'#58a6ff',textDecoration:'underline'}}>Orders page</a>
            {' '}— old pending/confirmed orders may need to be marked as delivered or cancelled.
          </div>
        </div>
      )}

      {/* KPI Cards */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(6,1fr)',gap:12,marginBottom:20}}>
        {KPIS.map(k => {
          const isActive = filterStatus === k.filter;
          return (
            <div key={k.label}
              onClick={k.clickable ? () => handleKpiClick(k.filter) : undefined}
              style={{
                ...st.card, textAlign:'center', padding:'14px 8px',
                cursor: k.clickable ? 'pointer' : 'default',
                border: isActive ? `2px solid ${k.color}` : `1px solid ${k.clickable ? 'rgba(26,92,42,0.6)' : 'var(--bd,#1a5c2a)'}`,
                background: isActive ? `${k.color}12` : 'var(--bg2,#161b22)',
                transform: isActive ? 'translateY(-2px)' : 'none',
                transition: 'all 0.15s ease',
              }}>
              <div style={{fontSize:24,fontWeight:800,color:k.color}}>{k.value}</div>
              <div style={{fontSize:10,color: isActive ? k.color : '#8b949e',marginTop:3,fontWeight: isActive ? 700 : 400}}>
                {k.label}
              </div>
              {k.clickable && (
                <div style={{fontSize:9,color: isActive ? k.color : '#555',marginTop:3}}>
                  {isActive ? '✓ Filtering ↓' : 'Click to filter ↓'}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {filterStatus && (
        <div style={{marginBottom:12,padding:'8px 14px',borderRadius:8,
          background:`${STATUS_META[filterStatus]?.color}12`,
          border:`1px solid ${STATUS_META[filterStatus]?.color}44`,
          display:'flex',alignItems:'center',justifyContent:'space-between'}}>
          <span style={{fontSize:12,fontWeight:600,color:STATUS_META[filterStatus]?.color}}>
            Showing: {STATUS_META[filterStatus]?.label} variants ({filteredOverview.length})
          </span>
          <button onClick={()=>setFilterStatus('')}
            style={{background:'transparent',border:'none',color:'#8b949e',fontSize:12,cursor:'pointer',fontWeight:600}}>
            ✕ Clear filter
          </button>
        </div>
      )}

      {/* Tabs */}
      <div style={{display:'flex',gap:4,marginBottom:16,background:'var(--bg,#0d1117)',padding:4,
        borderRadius:10,width:'fit-content',border:'1px solid var(--bd,#1a5c2a)'}}>
        {TABS.map(t => (
          <button key={t.id} onClick={()=>setTab(t.id)}
            style={{padding:'7px 16px',borderRadius:7,border:'none',fontSize:12,
              fontWeight:tab===t.id?700:500,cursor:'pointer',
              background:tab===t.id?'var(--accent,#1a5c2a)':'transparent',
              color:tab===t.id?'#fff':'#8b949e'}}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div id="inv-overview-table">
          <div style={{display:'flex',gap:10,marginBottom:14,flexWrap:'wrap',alignItems:'center'}}>
            <input value={search} onChange={e=>setSearch(e.target.value)}
              placeholder="Search product, SKU, size…" style={{...st.inp,width:200}} />
            <select value={filterProduct} onChange={e=>setFilterProduct(e.target.value)} style={{...st.inp,width:180}}>
              <option value="">All Products</option>
              {uniqueProducts.map(p=><option key={p} value={p}>{p}</option>)}
            </select>
            <select value={filterSize} onChange={e=>setFilterSize(e.target.value)} style={{...st.inp,width:110}}>
              <option value="">All Sizes</option>
              {uniqueSizes.map(s=><option key={s} value={s}>{s}</option>)}
            </select>
            <select value={filterStatus} onChange={e=>setFilterStatus(e.target.value)} style={{...st.inp,width:140}}>
              <option value="">All Status</option>
              {Object.entries(STATUS_META).map(([k,v])=><option key={k} value={k}>{v.label}</option>)}
            </select>
            {(filterProduct||filterSize||filterStatus||search) && (
              <button onClick={()=>{setFilterProduct('');setFilterSize('');setFilterStatus('');setSearch('');}}
                style={{padding:'5px 10px',borderRadius:6,border:'1px solid rgba(248,81,73,0.4)',
                  background:'rgba(248,81,73,0.08)',color:'#f85149',fontSize:11,cursor:'pointer'}}>
                ✕ Clear
              </button>
            )}
            <span style={{fontSize:11,color:'#8b949e'}}>{filteredOverview.length} variants</span>
            <button onClick={load} disabled={loading}
              style={{marginLeft:'auto',padding:'5px 12px',borderRadius:6,border:'1px solid var(--bd,#1a5c2a)',
                background:'transparent',color:'#8b949e',fontSize:11,cursor:'pointer'}}>
              {loading ? '⟳ Loading…' : '⟳ Refresh'}
            </button>
          </div>
          <div style={st.card}>
            <table style={{width:'100%',borderCollapse:'collapse'}}>
              <thead>
                <tr>
                  {['SKU','Product','Size','Initial','Reserved'].map((h,i)=>(
                    <th key={h} style={{textAlign:'left',fontSize:10,fontWeight:700,color:'#8b949e',
                      textTransform:'uppercase',letterSpacing:'0.06em',paddingBottom:10,paddingRight:12,
                      ...(i===4 ? {paddingRight:16, borderRight:'1px solid rgba(26,92,42,0.5)'} : {})}}>
                      {h}
                    </th>
                  ))}
                  {soldExpanded ? (<>
                    <th style={{textAlign:'right',paddingBottom:10,paddingRight:16,paddingLeft:14,width:52}}>
                      <div onClick={() => setSoldExpanded(false)}
                        style={{display:'inline-flex',alignItems:'center',gap:4,cursor:'pointer',userSelect:'none'}}
                        title="Click to collapse">
                        <span style={{fontSize:10,fontWeight:700,color:'#8b949e',textTransform:'uppercase',letterSpacing:'0.06em'}}>Sold</span>
                        <span style={{fontSize:9,color:'#8b949e',opacity:0.7}}>▾</span>
                      </div>
                      <div style={{marginTop:4}}>
                        <span style={{fontSize:9,color:'#f85149',fontWeight:700,background:'rgba(248,81,73,0.12)',padding:'2px 6px',borderRadius:3}}>ALL</span>
                      </div>
                    </th>
                    <th style={{textAlign:'right',paddingBottom:10,paddingRight:16,width:52}}>
                      <div style={{marginTop:18}}>
                        <span style={{fontSize:9,color:'#e8c070',fontWeight:700,background:'rgba(232,192,112,0.12)',padding:'2px 6px',borderRadius:3}}>TODAY</span>
                      </div>
                    </th>
                    <th style={{textAlign:'right',paddingBottom:10,paddingRight:16,width:44}}>
                      <div style={{marginTop:18}}>
                        <span style={{fontSize:9,color:'#d29922',fontWeight:700,background:'rgba(210,153,34,0.12)',padding:'2px 6px',borderRadius:3}}>7D</span>
                      </div>
                    </th>
                    <th style={{textAlign:'right',paddingBottom:10,paddingRight:16,width:44}}>
                      <div style={{marginTop:18}}>
                        <span style={{fontSize:9,color:'#58a6ff',fontWeight:700,background:'rgba(88,166,255,0.12)',padding:'2px 6px',borderRadius:3}}>30D</span>
                      </div>
                    </th>
                    <th style={{textAlign:'right',paddingBottom:10,paddingRight:20,width:44}}>
                      <div style={{marginTop:18}}>
                        <span style={{fontSize:9,color:'#3fb950',fontWeight:700,background:'rgba(63,185,80,0.12)',padding:'2px 6px',borderRadius:3}}>90D</span>
                      </div>
                    </th>
                  </>) : (
                    <th style={{textAlign:'right',paddingBottom:10,paddingRight:16,paddingLeft:14,width:52}}>
                      <div onClick={() => setSoldExpanded(true)}
                        style={{display:'inline-flex',alignItems:'center',gap:4,cursor:'pointer',userSelect:'none'}}
                        title="Click to expand sold periods">
                        <span style={{fontSize:10,fontWeight:700,color:'#8b949e',textTransform:'uppercase',letterSpacing:'0.06em'}}>Sold</span>
                        <span style={{fontSize:9,color:'#8b949e',opacity:0.7}}>▸</span>
                      </div>
                      <div style={{marginTop:4}}>
                        <span style={{fontSize:9,color:'#f85149',fontWeight:700,background:'rgba(248,81,73,0.12)',padding:'2px 6px',borderRadius:3}}>ALL</span>
                      </div>
                    </th>
                  )}
                  {['Available','Returned','Status','Barcode'].map((h,i)=>(
                    <th key={h} style={{textAlign:'left',fontSize:10,fontWeight:700,color:'#8b949e',
                      textTransform:'uppercase',letterSpacing:'0.06em',paddingBottom:10,paddingRight:12,
                      ...(i===0 ? {paddingLeft:16, borderLeft:'1px solid rgba(26,92,42,0.5)'} : {})}}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading && overview.length === 0 && (
                  <tr><td colSpan={10} style={{padding:48,textAlign:'center',color:'#555',fontSize:13}}>
                    Loading inventory…
                  </td></tr>
                )}
                {filteredOverview.map(o => {
                  const sm = STATUS_META[o.stock_status] || STATUS_META.OK;
                  return (
                    <tr key={o.variant_id} style={{borderTop:'1px solid rgba(26,92,42,0.25)'}}>
                      <td style={{padding:'10px 12px 10px 0',fontSize:11,fontFamily:'monospace',color:'#58a6ff',fontWeight:700}}>
                        {o.sku ? <span>{o.sku}</span> : <span style={{color:'#555',fontSize:10}}>No SKU set</span>}
                      </td>
                      <td style={{paddingRight:12,fontSize:12,fontWeight:600,color:'var(--tx,#fff)'}}>
                        {o.emoji} {o.product_name}
                      </td>
                      <td style={{paddingRight:12,fontSize:11,color:'#8b949e'}}>{o.size||'—'}</td>
                      <td style={{paddingRight:12,fontSize:13,fontWeight:700,color:'var(--tx,#fff)'}}>
                        {o.initial_stock??'—'}
                      </td>
                      <td style={{paddingRight:16,paddingLeft:0,fontSize:13,color:'#ffa600',fontWeight:600,borderRight:'1px solid rgba(26,92,42,0.5)'}}>
                        {o.orders_reserved > 0
                          ? <span title="Active orders not yet delivered">{o.orders_reserved}</span>
                          : <span style={{color:'#444'}}>0</span>}
                      </td>
                      <td style={{textAlign:'right',paddingRight:16,paddingLeft:14,width:52}}>
                        <span style={{fontSize:13,fontWeight:800,color:o.sold_count>0?'#f85149':'#444'}}>
                          {o.sold_count||'0'}
                        </span>
                      </td>
                      {soldExpanded && (<>
                        <td style={{textAlign:'right',paddingRight:16,width:52}}>
                          <span style={{fontSize:13,fontWeight:700,color:o.sold_1d>0?'#e8c070':'#444'}}>
                            {o.sold_1d||'0'}
                          </span>
                        </td>
                        <td style={{textAlign:'right',paddingRight:16,width:44}}>
                          <span style={{fontSize:13,fontWeight:700,color:o.sold_7d>0?'#d29922':'#444'}}>
                            {o.sold_7d||'0'}
                          </span>
                        </td>
                        <td style={{textAlign:'right',paddingRight:16,width:44}}>
                          <span style={{fontSize:13,fontWeight:700,color:o.sold_30d>0?'#58a6ff':'#444'}}>
                            {o.sold_30d||'0'}
                          </span>
                        </td>
                        <td style={{textAlign:'right',paddingRight:20,width:44}}>
                          <span style={{fontSize:13,fontWeight:700,color:o.sold_90d>0?'#3fb950':'#444'}}>
                            {o.sold_90d||'0'}
                          </span>
                        </td>
                      </>)}
                      <td style={{paddingRight:12, paddingLeft:16, borderLeft:'1px solid rgba(26,92,42,0.5)'}}>
                        <span style={{fontSize:15,fontWeight:800,
                          color:o.available_stock<=0?'#f85149':o.available_stock<=5?'#f85149':o.available_stock<=10?'#d29922':'#3fb950'}}>
                          {o.available_stock??'—'}
                        </span>
                      </td>
                      <td style={{paddingRight:12,fontSize:12,color:o.return_count>0?'#58a6ff':'#444',fontWeight:o.return_count>0?700:400}}>
                        {o.return_count>0?o.return_count:'—'}
                      </td>
                      <td style={{paddingRight:12}}>
                        <span style={{fontSize:10,fontWeight:700,padding:'3px 9px',borderRadius:4,
                          background:`${sm.color}18`,color:sm.color}}>
                          {sm.label}
                        </span>
                      </td>
                      <td style={{fontSize:10,color:'#555',fontFamily:'monospace'}}>
                        {o.barcode||<span style={{color:'#2a2a2a'}}>—</span>}
                      </td>
                    </tr>
                  );
                })}
                {filteredOverview.length === 0 && !loading && (
                  <tr><td colSpan={10} style={{padding:48,textAlign:'center',color:'#555',fontSize:13}}>
                    {filterStatus
                      ? `No ${STATUS_META[filterStatus]?.label} variants found`
                      : 'No variants found. Add products with variants first.'}
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'movements' && (
        <div>
          <div style={{display:'flex',gap:10,marginBottom:14,flexWrap:'wrap',alignItems:'center'}}>
            <input value={searchMov} onChange={e=>setSearchMov(e.target.value)}
              placeholder="Search product, SKU, notes…" style={{...st.inp,width:220}} />
            <select value={filterType} onChange={e=>setFilterType(e.target.value)} style={{...st.inp,width:160}}>
              <option value="">All Types</option>
              {MOVEMENT_TYPES.map(t=><option key={t} value={t}>{TYPE_META[t]?.label||t}</option>)}
            </select>
            <span style={{fontSize:11,color:'#8b949e'}}>{filteredMovements.length} movements</span>
            <span style={{fontSize:10,color:'#555',marginLeft:4}}>
              ({days===1?'today':`last ${days} days`} — use date buttons above to change)
            </span>
            <button onClick={()=>setShowMovModal(true)}
              style={{marginLeft:'auto',padding:'7px 14px',borderRadius:8,border:'none',
                background:'var(--accent,#1a5c2a)',color:'#fff',fontWeight:700,fontSize:12,cursor:'pointer'}}>
              + Record Movement
            </button>
          </div>
          <div style={st.card}>
            <table style={{width:'100%',borderCollapse:'collapse'}}>
              <thead>
                <tr>
                  {['Date','SKU / Variant','Type','Qty','Before','After','Source','Notes','By'].map(h=>(
                    <th key={h} style={{textAlign:'left',fontSize:10,fontWeight:700,color:'#8b949e',
                      textTransform:'uppercase',letterSpacing:'0.06em',paddingBottom:10,paddingRight:10}}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredMovements.map(m => {
                  const ov   = overview.find(o => o.variant_id === m.variant_id);
                  const meta = TYPE_META[m.type] || { color:'#8b949e', sign:'+' };
                  return (
                    <tr key={m.id} style={{borderTop:'1px solid rgba(26,92,42,0.2)'}}>
                      <td style={{padding:'8px 10px 8px 0',fontSize:10,color:'#8b949e',whiteSpace:'nowrap'}}>{fmtDate(m.created_at)}</td>
                      <td style={{paddingRight:10}}>
                        {ov ? (
                          <div>
                            <div style={{fontSize:11,fontFamily:'monospace',color:'#58a6ff',fontWeight:700}}>{ov.sku||'—'}</div>
                            <div style={{fontSize:10,color:'#8b949e'}}>{ov.product_name} · {ov.size}</div>
                          </div>
                        ) : <span style={{color:'#555',fontSize:11}}>variant #{m.variant_id}</span>}
                      </td>
                      <td style={{paddingRight:10}}><MovBadge type={m.type}/></td>
                      <td style={{paddingRight:10,fontSize:14,fontWeight:800,color:meta.color,whiteSpace:'nowrap'}}>
                        {meta.sign}{Math.abs(m.quantity)}
                      </td>
                      <td style={{paddingRight:10,fontSize:11,color:'#8b949e'}}>{m.before_stock??'—'}</td>
                      <td style={{paddingRight:10,fontSize:12,fontWeight:700,color:'var(--tx,#fff)'}}>{m.after_stock??'—'}</td>
                      <td style={{paddingRight:10,fontSize:10,color:'#8b949e'}}>{(m.source||'').replace(/_/g,' ')}</td>
                      <td style={{paddingRight:10,fontSize:10,color:'#8b949e',maxWidth:160,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                        {m.notes||'—'}
                      </td>
                      <td style={{fontSize:10,color:'#555'}}>{m.performed_by||'—'}</td>
                    </tr>
                  );
                })}
                {filteredMovements.length === 0 && (
                  <tr><td colSpan={9} style={{padding:40,textAlign:'center',color:'#555',fontSize:13}}>
                    No stock movements in this period.
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'channels' && (
        <div>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:14}}>
            <div style={{fontSize:12,color:'#8b949e'}}>
              Allocate stock per sales channel — Website, Amazon, Offline share the same inventory pool.
            </div>
            <button onClick={()=>setShowChanModal(true)}
              style={{padding:'7px 14px',borderRadius:8,border:'none',
                background:'#58a6ff',color:'#000',fontWeight:700,fontSize:12,cursor:'pointer'}}>
              + Set Allocation
            </button>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:16}}>
            {channels.map(ch => (
              <div key={ch.id} style={{...st.card,border:'1px solid rgba(88,166,255,0.3)'}}>
                <div style={{fontSize:15,fontWeight:700,color:'var(--tx,#fff)',marginBottom:4}}>
                  🌐 {ch.name.charAt(0).toUpperCase()+ch.name.slice(1)}
                </div>
                <div style={{fontSize:10,color:ch.is_active?'#3fb950':'#f85149',fontWeight:700}}>
                  {ch.is_active?'● Active':'● Inactive'}
                </div>
              </div>
            ))}
            {channels.length === 0 && (
              <div style={{...st.card,gridColumn:'1/-1',textAlign:'center',color:'#555',padding:40}}>
                Run the inventory migration SQL to seed channels.
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'warehouses' && (
        <div>
          <div style={{fontSize:12,color:'#8b949e',marginBottom:14}}>
            Physical storage locations for bin-level tracking. Future barcode scanning ready.
          </div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:16}}>
            {warehouses.map(w => (
              <div key={w.id} style={{...st.card,border:'1px solid rgba(210,153,34,0.3)'}}>
                <div style={{fontSize:15,fontWeight:700,color:'var(--tx,#fff)',marginBottom:4}}>🏭 {w.name}</div>
                {w.address && <div style={{fontSize:11,color:'#8b949e'}}>{w.address}</div>}
                <div style={{fontSize:10,color:w.is_active?'#3fb950':'#f85149',fontWeight:700,marginTop:6}}>
                  {w.is_active?'● Active':'● Inactive'}
                </div>
              </div>
            ))}
            {warehouses.length === 0 && (
              <div style={{...st.card,gridColumn:'1/-1',textAlign:'center',color:'#555',padding:40}}>
                No warehouses found. Run the inventory migration SQL first.
              </div>
            )}
          </div>
        </div>
      )}

    </div>
  );
}

export default function InventoryPageWrapper() {
  return (
    <Suspense fallback={
      <div style={{display:'flex',alignItems:'center',justifyContent:'center',padding:48,color:'var(--tx2,#6e7681)'}}>
        Loading…
      </div>
    }>
      <InventoryPage />
    </Suspense>
  );
}
