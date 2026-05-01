'use client';
import { useSearchParams } from 'next/navigation';
import { useState, useEffect, useCallback, Suspense} from 'react';
import { api, fmtCurrency, buildDateFilter } from '@/lib/api';
import { Card, Loader, ErrorMsg, StatusBadge, Badge } from '@/components/ui/index';
import Modal from '@/components/ui/Modal';

// -------------------------------------------------------------
// Orders -- FULLY AUTOMATED inventory + payment status
//
// STOCK FLOW (agreed):
//   Website creates order -> fires RESERVE (COD) or RESERVE+OUT (Razorpay)
//   Admin: pending->confirmed -> OUT
//   Admin: pending->cancelled -> RELEASE
//   Admin: confirmed/packed/shipped->cancelled -> IN (full restore)
//   Returns: received + restock=true -> RETURN | restock=false -> DAMAGE
//
// PAYMENT AUTO-RULES (locked, no override):
//   delivered                -> paid        (COD cleared)
//   cancelled (was pending)  -> pending     (no money moved)
//   cancelled (was paid)     -> refunded    (auto refund)
//   pending/confirmed/packed/shipped -> pending
//
// RETURN FLOW (separate lifecycle):
//   requested -> approved -> received -> refunded ✅
//                                   -> rejected ❌
//   Each step auto-updates payment_status on order
// -------------------------------------------------------------

// NOTE: 'returned' is NOT in order statuses — order stays 'delivered', return has its own lifecycle
const STATUSES     = ['pending','confirmed','packed','shipped','delivered','cancelled'];
const PAY_STATUSES = ['pending','paid','refund_pending','refunded','failed'];

// -- Reason -> Restock (auto, locked) --------------------------
const REASON_RESTOCK = {
  damaged:          false,
  missing_parts:    false,
  wrong_item:       true,
  not_as_described: true,
  changed_mind:     true,
  other:            null, // admin decides
};

const RETURN_REASONS  = ['damaged','wrong_item','not_as_described','changed_mind','missing_parts','other'];
const RETURN_STATUSES = ['requested','approved','received','refunded','rejected'];

// -- Auto payment based on order status (HARD RULES, no override) --
function getAutoPayment(orderStatus, currentPayStatus) {
  switch(orderStatus) {
    case 'delivered':  return currentPayStatus === 'refunded' ? 'refunded' : 'paid';
    case 'returned':   return 'refunded';  // returned = refund complete
    case 'cancelled':  return currentPayStatus === 'paid' || currentPayStatus === 'refund_pending' ? 'refunded' : 'pending';
    case 'shipped':
    case 'packed':
    case 'confirmed':
    case 'pending':    return currentPayStatus === 'paid' ? 'paid' : currentPayStatus === 'refunded' ? 'refunded' : 'pending';
    default:           return currentPayStatus;
  }
}

// -- Is payment dropdown locked for this status? --------------
function isPaymentLocked(orderStatus) {
  return ['delivered','cancelled','pending','confirmed','packed','shipped'].includes(orderStatus);
}

// -- Auto restock based on reason -----------------------------
function getAutoRestock(reason) {
  return REASON_RESTOCK[reason] ?? null; // null = admin decides (only for 'other')
}

function ReturnStatusBadge({ status }) {
  const map = { requested:'rgba(255,166,0,0.15)', approved:'var(--blue-bg)', received:'rgba(188,140,255,0.15)', refunded:'rgba(63,185,80,0.15)', rejected:'rgba(248,81,73,0.15)' };
  const col = { requested:'#ffa600', approved:'var(--blue)', received:'#bc8cff', refunded:'#3fb950', rejected:'#f85149' };
  const s = status || 'requested';
  return <span style={{background:map[s]||'color-mix(in srgb, var(--bd) 25%, transparent)',color:col[s]||'var(--tx2,#8b949e)',padding:'2px 8px',borderRadius:4,fontSize:10,fontWeight:700,textTransform:'uppercase'}}>{s}</span>;
}
function PayBadge({ status }) {
  const map = { paid:'green', pending:'yellow', failed:'red', refunded:'blue', refund_pending:'purple' };
  return <Badge type={map[status] || 'default'}>{status === 'refund_pending' ? 'Refund Pending' : status || 'pending'}</Badge>;
}

function OrdersPage() {
  const searchParams = useSearchParams();
  const days = parseInt(searchParams.get('days') || '7', 10);
  const [orders,    setOrders]    = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState(null);
  const [statusF,   setStatusF]   = useState('');
  const [payF,      setPayF]      = useState('');
  const [search,    setSearch]    = useState('');
  const [page,      setPage]      = useState(1);
  const [hasMore,   setHasMore]   = useState(false);
  const [modal,     setModal]     = useState(null);
  const [saving,    setSaving]    = useState(false);
  const [custCache, setCustCache] = useState({});
  const [orderReturns,  setOrderReturns]  = useState([]);
  const [returnTab,     setReturnTab]     = useState('order');
  const [returnForm,    setReturnForm]    = useState({ reason:'damaged', description:'', refund_amount:'', status:'requested', restock:false });
  const [returnSaving,  setReturnSaving]  = useState(false);
  const [editingReturn, setEditingReturn] = useState(null);
  const [returnPopup,   setReturnPopup]   = useState(null);
  // Track current selected order status for live payment lock
  const [selectedStatus,  setSelectedStatus]  = useState('');
  const [trackingInput,   setTrackingInput]   = useState('');
  const [courierInput,    setCourierInput]    = useState('');
  const PAGE_SIZE = 25;

  const load = useCallback(async (pg = 1) => {
    setLoading(true); setError(null);
    try {
      const since = buildDateFilter(days);
      let q = `select=id,order_number,total_amount,order_status,payment_status,payment_method,payment_id,customer_id,created_at,subtotal,tax,shipping_charge,coupon_discount,tracking_number,courier,shipped_at,delivered_at&order=created_at.desc&limit=${PAGE_SIZE}&offset=${(pg-1)*PAGE_SIZE}&created_at=gte.${since}`;
      if (statusF) q += `&order_status=eq.${statusF}`;
      if (payF)    q += `&payment_status=eq.${payF}`;
      const data = await api.get('orders', q);
      setOrders(data || []);
      setHasMore((data || []).length === PAGE_SIZE);
      setPage(pg);
      const ids = [...new Set((data || []).map(o => o.customer_id).filter(Boolean))];
      if (ids.length) {
        const cs = await api.get('customers', `id=in.(${ids.join(',')})&select=id,first_name,last_name,email,phone,city,state,postal_code,address_line1,address_line2`).catch(() => []);
        const map = {};
        (cs || []).forEach(c => { map[c.id] = c; });
        setCustCache(prev => ({ ...prev, ...map }));
      }
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [statusF, payF, days]);

  useEffect(() => { load(1); }, [load]);

  async function openOrder(o) {
    const c = custCache[o.customer_id] || {};
    let items = [], prodMap = {}, variantMap = {};
    try {
      items = await api.get('order_items', `order_id=eq.${o.id}&select=product_id,variant_id,quantity,price_at_time`);
      const pids = [...new Set((items||[]).map(i=>i.product_id).filter(Boolean))];
      const vids = [...new Set((items||[]).map(i=>i.variant_id).filter(Boolean))];
      if (pids.length) {
        const ps = await api.get('products', `id=in.(${pids.join(',')})&select=id,name,emoji,image_url`).catch(()=>[]);
        (ps||[]).forEach(p => { prodMap[p.id] = p; });
      }
      if (vids.length) {
        const vs = await api.get('product_variants', `id=in.(${vids.join(',')})&select=id,variant_type,variant_value,sku`).catch(()=>[]);
        (vs||[]).forEach(v => {
          const label = (v.variant_value && v.variant_value !== 'Default' && v.variant_value !== 'default')
            ? v.variant_value
            : (v.variant_type && v.variant_type !== 'default' ? v.variant_type : '');
          variantMap[v.id] = label || v.sku || `#${v.id}`;
        });
      }
    } catch(e) { console.error('openOrder fetch error:', e); }
    setModal({ order: o, customer: c, items: items||[], prodMap, variantMap });
    setSelectedStatus(o.order_status);
    setTrackingInput(o.tracking_number || '');
    setCourierInput(o.courier || '');
    setReturnTab('order');
    setEditingReturn(null);
    setReturnForm({ reason:'damaged', description:'', refund_amount:'', status:'requested', restock:false });
    api.get('returns', `order_id=eq.${o.id}&order=created_at.desc`)
      .then(r => setOrderReturns(r||[]))
      .catch(() => setOrderReturns([]));
  }

  // When order status changes in dropdown -> auto-update payment dropdown (locked)
  function onOrderStatusChange(newStatus) {
    setSelectedStatus(newStatus);
  }

  async function saveOrder() {
    if (!modal) return;
    const status    = selectedStatus || modal.order.order_status;
    const tracking  = trackingInput;
    const courier   = courierInput;

    // -- Auto-compute payment -- no manual override -------------
    const payStatus = getAutoPayment(status, modal.order.payment_status);

    await doSaveOrder(status, payStatus, tracking, courier);
  }

  async function doSaveOrder(status, payStatus, tracking, courier) {
    if (!modal) return;
    setSaving(true);
    try {
      const body = { order_status: status, payment_status: payStatus, updated_at: new Date().toISOString() };
      if (tracking) body.tracking_number = tracking;
      if (courier)  body.courier = courier;
      if (status === 'shipped'   && !modal.order.shipped_at)   body.shipped_at   = new Date().toISOString();
      if (status === 'delivered' && !modal.order.delivered_at) body.delivered_at = new Date().toISOString();

      await api.patch('orders', `id=eq.${modal.order.id}`, body);

      // -- Stock flow -- matches agreed table exactly ------------
      //
      // WEBSITE fires on order creation:
      //   ALL orders (COD+Razorpay) -> RESERVE only
      //   Result: reserved+1, available-1, sold=0
      //
      // ADMIN fires on status change:
      //   pending  -> confirmed          : OUT   (reserved-1, sold+1, available stays)
      //   confirmed/packed/shipped -> delivered : nothing (already sold)
      //   pending  -> cancelled          : RELEASE (reserved-1, available+1)
      //   confirmed/packed/shipped -> cancelled : CORRECTION+qty (sold-1, available+1)
      //
      // DB trigger process_stock_movement handles all field math.
      // ---------------------------------------------------------

      const prevStatus = modal.order.order_status;
      const newStatus  = status;
      const items      = modal.items || [];

      // Issue 2 fix: valid forward-only transition map
      // Prevents firing stock movements if admin moves status backwards
      const VALID_STOCK_TRANSITIONS = {
        'pending':   ['confirmed', 'cancelled'],
        'confirmed': ['packed', 'shipped', 'delivered', 'cancelled'],
        'packed':    ['shipped', 'delivered', 'cancelled'],
        'shipped':   ['delivered', 'cancelled'],
        'delivered': [], // terminal -- no stock movements
        'cancelled': [], // terminal -- no stock movements
      };
      const validNextStatuses = VALID_STOCK_TRANSITIONS[prevStatus] || [];
      const isValidTransition = validNextStatuses.includes(newStatus);

      if (prevStatus !== newStatus && items.length > 0 && isValidTransition) {
        const ref = modal.order.order_number || modal.order.id;

        // Determine which movement to fire for this transition
        let movType = null, movNote = '';
        if (newStatus === 'confirmed' && prevStatus === 'pending') {
          movType = 'OUT';  movNote = `Order ${ref} confirmed -- stock sold`;
        } else if (newStatus === 'cancelled' && prevStatus === 'pending') {
          movType = 'RELEASE'; movNote = `Order ${ref} cancelled -- stock released`;
        } else if (newStatus === 'cancelled' && ['confirmed','packed','shipped'].includes(prevStatus)) {
          movType = 'IN'; movNote = `Order ${ref} cancelled after confirmation -- stock fully restored`;
        }
        // confirmed/packed/shipped -> delivered: nothing (stock already sold at confirmed)

        // Issue 4 fix: Promise.allSettled fires all items together -- no partial update
        // Issue 5 fix: check results and alert admin if any failed -- no silent ignore
        if (movType) {
          const movItems = items.filter(i => i.variant_id);
          if (movItems.length > 0) {
            const results = await Promise.allSettled(
              movItems.map(item => api.post('stock_movements', {
                variant_id:   item.variant_id,
                type:         movType,
                quantity:     parseInt(item.quantity) || 1,
                source:       'website_order',
                notes:        movNote,
                performed_by: 'admin',
              }))
            );
            const failed = results.filter(r => r.status === 'rejected');
            if (failed.length > 0) {
              // Order already saved -- alert admin to fix stock manually
              alert(`⚠️ Order updated but ${failed.length} stock movement(s) failed.\nPlease go to Inventory -> Record Movement and manually add a "${movType}" for order ${ref}.`);
            }
          }
        }
      }
      // ---------------------------------------------------------

      // -- Send status email --
      if (status !== modal.order.order_status && modal.customer?.email) {
        const pw = typeof window !== 'undefined' ? sessionStorage.getItem('pr_pw') : null;
        if (pw) {
          fetch('/api/admin', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-admin-password': pw },
            body: JSON.stringify({
              action:         'send_status_email',
              to:             modal.customer.email,
              status,
              orderNumber:    modal.order.order_number || String(modal.order.id),
              orderId:        modal.order.id,
              name:           `${modal.customer.first_name||''} ${modal.customer.last_name||''}`.trim() || 'Customer',
              trackingNumber: tracking || modal.order.tracking_number || '',
              courier:        courier  || modal.order.courier || '',
              totalAmount:    modal.order.total_amount || 0,
              subtotal:       modal.order.subtotal || 0,
              shippingCharge: modal.order.shipping_charge || 0,
              discount:       modal.order.coupon_discount || 0,
              address:        `${modal.customer.address_line1||''} ${modal.customer.address_line2||''}`.trim(),
              city:           modal.customer.city || '',
              state:          modal.customer.state || '',
              postal:         modal.customer.postal_code || '',
              items: (modal.items||[]).map(it => ({
                name:  modal.prodMap?.[it.product_id]?.name || 'Product',
                image: modal.prodMap?.[it.product_id]?.image_url || '',
                qty:   it.quantity,
                price: it.price_at_time,
              })),
            }),
          }).catch(() => {});
        }
      }

      try {
        await api.post('order_status_history', {
          order_id: Number(modal.order.id), old_status: modal.order.order_status,
          new_status: status, changed_at: new Date().toISOString(),
        });
      } catch(e) { console.warn('order_status_history insert failed:', e); }

      setModal(null);
      await load(page);
    } catch(e) { alert('Error: ' + e.message); }
    finally { setSaving(false); }
  }

  // -- Return popup (when admin initiates return from order view) --
  async function confirmReturnAndSave() {
    if (!returnPopup) return;
    setSaving(true);
    try {
      const { order, customer, form, tracking, courier } = returnPopup;

      // Order stays 'delivered' -- only payment changes to refund_pending
      const orderBody = {
        payment_status: 'refund_pending',
        updated_at:     new Date().toISOString(),
      };
      if (tracking) orderBody.tracking_number = tracking;
      if (courier)  orderBody.courier = courier;
      await api.patch('orders', `id=eq.${order.id}`, orderBody);

      // Create return record
      const customerName = `${customer.first_name||''} ${customer.last_name||''}`.trim() || null;
      await api.post('returns', {
        order_id:      Number(order.id),
        order_number:  order.order_number || String(order.id),
        customer_name: customerName,
        reason:        form.reason,
        description:   form.description || null,
        refund_amount: form.refund_amount ? parseFloat(form.refund_amount) : null,
        status:        'requested',
        restock:       form.restock,
        created_at:    new Date().toISOString(),
        updated_at:    new Date().toISOString(),
      });

      try {
        await api.post('order_status_history', {
          order_id: Number(order.id), old_status: order.order_status,
          new_status: 'return_requested', changed_at: new Date().toISOString(),
        });
      } catch(e) { console.warn('order_status_history insert failed:', e); }

      // Email customer -- return requested
      const pw = typeof window !== 'undefined' ? sessionStorage.getItem('pr_pw') : null;
      if (pw && customer?.email) {
        fetch('/api/admin', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-admin-password': pw },
          body: JSON.stringify({
            action:      'send_status_email',
            to:          customer.email,
            status:      'return_requested',
            orderNumber: order.order_number || String(order.id),
            orderId:     order.id,
            name:        `${customer.first_name||''} ${customer.last_name||''}`.trim() || 'Customer',
          }),
        }).catch(() => {});
      }

      setReturnPopup(null);
      setModal(null);
      await load(page);
    } catch(e) { alert('Error: ' + e.message); }
    finally { setSaving(false); }
  }

  // -- Save return from inside order modal --
  async function saveReturn() {
    if (!modal) return;
    const o = modal.order, c = modal.customer;
    if (!returnForm.reason) return alert('Select a reason');
    setReturnSaving(true);
    try {
      const oldStatus = editingReturn?.status;
      const newStatus = returnForm.status;

      // Auto restock based on reason (locked for non-'other' reasons)
      const autoRestock = getAutoRestock(returnForm.reason);
      const restock = autoRestock !== null ? autoRestock : returnForm.restock;

      const body = {
        order_id:      Number(o.id),
        order_number:  o.order_number || String(o.id),
        customer_name: `${c.first_name||''} ${c.last_name||''}`.trim() || null,
        reason:        returnForm.reason,
        description:   returnForm.description || null,
        refund_amount: returnForm.refund_amount ? parseFloat(returnForm.refund_amount) : null,
        status:        newStatus,
        restock,
        updated_at:    new Date().toISOString(),
      };

      if (editingReturn) {
        await api.patch('returns', `id=eq.${editingReturn.id}`, body);

        // -- Auto payment update based on return status --------
        if (newStatus !== oldStatus) {
          if (newStatus === 'approved') {
            await api.patch('orders', `id=eq.${o.id}`, { payment_status: 'refund_pending' }).catch(()=>{});
          } else if (newStatus === 'refunded') {
            await api.patch('orders', `id=eq.${o.id}`, { payment_status: 'refunded' }).catch(()=>{});
          } else if (newStatus === 'rejected') {
            await api.patch('orders', `id=eq.${o.id}`, { payment_status: 'paid' }).catch(()=>{});
          }
        }

        // -- Auto stock movement when return is received -------
        // Fires ONCE only when transitioning TO 'received'
        // Issue 12 fix: check existing movements before firing to prevent double-trigger
        if (newStatus === 'received' && oldStatus !== 'received') {
          const existingMov = await api.get(
            'stock_movements',
            `source=eq.return&notes=ilike.*${o.order_number}*&type=in.(RETURN,DAMAGE)&select=id`
          ).catch(() => []);
          if (existingMov && existingMov.length > 0) {
            console.warn(`Return stock movement already exists for ${o.order_number} -- skipping`);
          } else {
            const movItems = (modal.items || []).filter(i => i.variant_id);
            if (movItems.length > 0) {
              const results = await Promise.allSettled(
                movItems.map(item => api.post('stock_movements', {
                  variant_id:   item.variant_id,
                  type:         restock ? 'RETURN' : 'DAMAGE',
                  quantity:     parseInt(item.quantity) || 1,
                  source:       'return',
                  notes:        restock
                    ? `Return received -- order ${o.order_number} restocked`
                    : `Return received -- order ${o.order_number} damaged, written off`,
                  performed_by: 'admin',
                }))
              );
              const failed = results.filter(r => r.status === 'rejected');
              if (failed.length > 0) {
                alert(`⚠️ Return updated but ${failed.length} stock movement(s) failed. Please manually record in Inventory -> Record Movement.`);
              }
            }
          }
        }
        // -----------------------------------------------------

        // -- Email customer on return status change ------------
        if (newStatus !== oldStatus) {
          const emailMap = {
            approved: 'return_approved',
            received: 'return_received',
            refunded: 'refund_initiated',
            rejected: 'return_rejected',
          };
          const emailStatus = emailMap[newStatus];
          if (emailStatus && c?.email) {
            const pw = typeof window !== 'undefined' ? sessionStorage.getItem('pr_pw') : null;
            if (pw) {
              fetch('/api/admin', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-admin-password': pw },
                body: JSON.stringify({
                  action:      'send_status_email',
                  to:          c.email,
                  status:      emailStatus,
                  orderNumber: o.order_number || String(o.id),
                  orderId:     o.id,
                  name:        `${c.first_name||''} ${c.last_name||''}`.trim() || 'Customer',
                }),
              }).catch(() => {});
            }
          }
        }
      } else {
        await api.post('returns', { ...body, created_at: new Date().toISOString() });
        // New return created -> payment: refund_pending
        await api.patch('orders', `id=eq.${o.id}`, { payment_status: 'refund_pending' }).catch(()=>{});
      }

      const updated = await api.get('returns', `order_id=eq.${o.id}&order=created_at.desc`).catch(()=>[]);
      setOrderReturns(updated||[]);
      setEditingReturn(null);
      setReturnForm({ reason:'damaged', description:'', refund_amount:'', status:'requested', restock:false });
    } catch(e) {
      alert(e.message?.includes('42P01') ? '⚠️ Returns table missing. Run SQL migration first.' : 'Error: ' + e.message);
    } finally { setReturnSaving(false); }
  }

  function startEditReturn(r) {
    setEditingReturn(r);
    const autoRestock = getAutoRestock(r.reason);
    setReturnForm({
      reason:        r.reason||'damaged',
      description:   r.description||'',
      refund_amount: r.refund_amount||'',
      status:        r.status||'requested',
      restock:       autoRestock !== null ? autoRestock : (r.restock !== false),
    });
  }

  function exportCSV() {
    const rows = [['Order #','Customer','Email','Phone','City','State','Total','Order Status','Payment Status','Payment Method','Date']];
    filtered.forEach(o => {
      const c = custCache[o.customer_id] || {};
      rows.push([o.order_number||String(o.id).slice(-8).toUpperCase(),`${c.first_name||''} ${c.last_name||''}`.trim()||'Guest',c.email||'',c.phone||'',c.city||'',c.state||'',o.total_amount||0,o.order_status||'',o.payment_status||'',o.payment_method||'',new Date(o.created_at).toLocaleDateString('en-IN')]);
    });
    const csv = rows.map(r=>r.map(x=>`"${String(x).replace(/"/g,'""')}"`).join(',')).join('\n');
    const a = document.createElement('a'); a.href='data:text/csv;charset=utf-8,'+encodeURIComponent(csv); a.download='pahadi-orders-'+Date.now()+'.csv'; a.click();
  }

  const filtered = search
    ? orders.filter(o => { const c=custCache[o.customer_id]||{}; const q=search.toLowerCase(); return (o.order_number||'').toLowerCase().includes(q)||`${c.first_name||''} ${c.last_name||''}`.toLowerCase().includes(q)||(c.phone||'').includes(q); })
    : orders;

  // Compute what payment will be for current selected status
  const previewPayment = modal ? getAutoPayment(selectedStatus, modal.order.payment_status) : '';
  const payLocked = isPaymentLocked(selectedStatus);

  return (
    <div className="space-y-4">
      {modal && (
        <Modal title={modal.order.order_number || '#' + String(modal.order.id).slice(-8).toUpperCase()} onClose={() => setModal(null)} width="780px">
          <div className="flex gap-1 mb-4 p-1 rounded-lg" style={{background:'var(--bg,#0d1117)',border:'1px solid var(--bd,#30363d)'}}>
            {[{key:'order',label:'📦 Order Details'},{key:'returns',label:'↩️ Returns',count:orderReturns.length}].map(t=>(
              <button key={t.key} onClick={()=>{setReturnTab(t.key);setEditingReturn(null);setReturnForm({reason:'damaged',description:'',refund_amount:'',status:'requested',restock:false});}}
                className="flex-1 py-1.5 rounded-md text-[12px] font-semibold transition relative"
                style={returnTab===t.key?{background:'var(--accent,#1a5c2a)',color:'#fff'}:{color:'var(--tx2,#6e7681)'}}>
                {t.label}
                {t.count>0&&<span className="absolute -top-1 -right-1 bg-[#f85149] text-[var(--tx)] text-[9px] font-bold rounded-full w-4 h-4 flex items-center justify-center">{t.count}</span>}
              </button>
            ))}
          </div>

          {returnTab==='order'&&(<>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div className="rounded-xl p-4 space-y-2" style={{background:"var(--bg,#0d1117)"}}>
              <h4 className="text-[12px] font-bold text-[#3fb950] mb-3">👤 Customer & Delivery</h4>
              {[['Name',`${modal.customer.first_name||''} ${modal.customer.last_name||''}`.trim()||'Guest'],['Phone',modal.customer.phone||'--'],['Email',modal.customer.email||'--'],['Address',[modal.customer.address_line1,modal.customer.address_line2].filter(Boolean).join(', ')||'--'],['City',modal.customer.city||'--'],['State',modal.customer.state||'--'],['Postal',modal.customer.postal_code||'--']].map(([l,v])=>(
                <div key={l} className="flex justify-between text-[12px]"><span className="text-[var(--tx3)]">{l}</span><span className="text-[var(--tx)] font-medium text-right max-w-[55%]">{v}</span></div>
              ))}
            </div>
            <div className="rounded-xl p-4 space-y-2" style={{background:"var(--bg,#0d1117)"}}>
              <h4 className="text-[12px] font-bold text-[var(--blue)] mb-3">📦 Order Info</h4>
              {[['Date',new Date(modal.order.created_at).toLocaleString('en-IN')],['Subtotal',fmtCurrency(parseFloat(modal.order.subtotal)||0)],...(modal.order.coupon_discount>0?[['Coupon Disc.','-'+fmtCurrency(parseFloat(modal.order.coupon_discount)||0)]]:[]),['Tax (GST)',fmtCurrency(parseFloat(modal.order.tax)||0)],['Shipping',fmtCurrency(parseFloat(modal.order.shipping_charge)||0)],['Total',fmtCurrency(parseFloat(modal.order.total_amount)||0)],['Payment ID',modal.order.payment_id||'--']].map(([l,v])=>(
                <div key={l} className="flex justify-between text-[12px]"><span className="text-[var(--tx3)]">{l}</span><span className={`font-medium ${l==='Total'?'text-[#3fb950]':l==='Coupon Disc.'?'text-[#3fb950]':'text-[var(--tx)]'}`}>{v}</span></div>
              ))}
            </div>
          </div>

          <div className="rounded-xl p-4 mb-4" style={{background:"var(--bg,#0d1117)"}}>
            <h4 className="text-[12px] font-bold text-[var(--yellow)] mb-3">🛒 Items ({modal.items.length})</h4>
            <table className="w-full"><thead><tr>
              {['Product','Variant','Qty','Unit Price','Total'].map(h=><th key={h} className="text-left text-[10px] font-bold text-[var(--tx3)] uppercase pb-2 pr-3">{h}</th>)}
            </tr></thead><tbody>
              {modal.items.map((it,i)=>{const p=modal.prodMap[it.product_id];return(
                <tr key={i} className="border-t border-[var(--bd)]/50">
                  <td className="py-2 pr-3 text-[12px] text-[var(--tx)]">{p?.emoji} {p?.name||'#'+it.product_id}</td>
                  <td className="py-2 pr-3 text-[11px] text-[var(--tx2)]">{modal.variantMap?.[it.variant_id] || '--'}</td>
                  <td className="py-2 pr-3 text-[12px]">{it.quantity}</td>
                  <td className="py-2 pr-3 text-[12px]">{fmtCurrency(parseFloat(it.price_at_time)||0)}</td>
                  <td className="py-2 text-[12px] font-bold text-[#3fb950]">{fmtCurrency((it.quantity||1)*(parseFloat(it.price_at_time)||0))}</td>
                </tr>
              );})}
            </tbody></table>
          </div>

          <div className="rounded-xl p-4" style={{background:"var(--bg,#0d1117)"}}>
            <h4 className="text-[12px] font-bold text-[var(--tx)] mb-1">✏️ Update Order</h4>
            <p className="text-[10px] text-[#3fb950] mb-3">✓ Stock + payment update automatically -- no manual steps needed</p>

            {/* -- Auto-rule info bar -- */}
            <div className="rounded-lg px-3 py-2 mb-3 text-[10px]" style={{background:'rgba(26,92,42,0.12)',border:'1px solid rgba(26,92,42,0.3)',color:'#4a9c5d'}}>
              💡 <strong>Auto-rules (locked):</strong> Delivered → Paid &nbsp;·&nbsp; Cancelled+Paid → Refunded &nbsp;·&nbsp; Return Approved → Refund Pending &nbsp;·&nbsp; Return Refunded → Refunded
            </div>

            <div className="grid grid-cols-2 gap-3 mb-3">
              {/* Order Status -- admin controls this */}
              <div>
                <label className="text-[10.5px] font-bold text-[var(--tx3)] uppercase block mb-1.5">Order Status</label>
                <select
                  id="m-ord-status"
                  value={selectedStatus}
                  onChange={e => onOrderStatusChange(e.target.value)}
                  className="w-full bg-[var(--input-bg)] border border-[var(--bd)] rounded-lg px-3 py-2 text-[12px] text-[var(--tx)] focus:outline-none focus:border-[var(--accent)]">
                  {STATUSES.map(s=><option key={s} value={s}>{s.charAt(0).toUpperCase()+s.slice(1)}</option>)}
                </select>
              </div>

              {/* Payment Status -- LOCKED, auto-computed, read-only */}
              <div>
                <label className="text-[10.5px] font-bold text-[var(--tx3)] uppercase block mb-1.5">
                  Payment Status
                  <span className="ml-1 px-1.5 py-0.5 rounded text-[8px] font-bold" style={{background:'rgba(26,92,42,0.3)',color:'#4a9c5d'}}>AUTO</span>
                </label>
                <div className="w-full rounded-lg px-3 py-2 text-[12px] font-bold flex items-center gap-2"
                  style={{background:'rgba(26,92,42,0.08)',border:'1px solid rgba(26,92,42,0.3)',color:'#4a9c5d',cursor:'not-allowed'}}>
                  <span>🔒</span>
                  <span style={{textTransform:'capitalize'}}>{previewPayment === 'refund_pending' ? 'Refund Pending' : previewPayment}</span>
                </div>
                <div className="text-[9px] mt-1" style={{color:'#3d5c41'}}>Auto-set based on order status</div>
              </div>

              <div>
                <label className="text-[10.5px] font-bold text-[var(--tx3)] uppercase block mb-1.5">Courier</label>
                <input value={courierInput} onChange={e=>setCourierInput(e.target.value)} placeholder="e.g. Shiprocket, Delhivery" className="w-full bg-[var(--input-bg)] border border-[var(--bd)] rounded-lg px-3 py-2 text-[12px] text-[var(--tx)] focus:outline-none focus:border-[var(--accent)]"/>
              </div>
              <div>
                <label className="text-[10.5px] font-bold text-[var(--tx3)] uppercase block mb-1.5">Tracking Number</label>
                <input value={trackingInput} onChange={e=>setTrackingInput(e.target.value)} placeholder="e.g. SR1234567890" className="w-full bg-[var(--input-bg)] border border-[var(--bd)] rounded-lg px-3 py-2 text-[12px] text-[var(--tx)] focus:outline-none focus:border-[var(--accent)]"/>
              </div>
            </div>

            {/* Return initiation button -- only if delivered */}
            {selectedStatus === 'delivered' && (
              <button
                onClick={() => setReturnPopup({
                  order: modal.order, customer: modal.customer,
                  items: modal.items, prodMap: modal.prodMap,
                  tracking: trackingInput,
                  courier:  courierInput,
                  form: { reason:'damaged', description:'', refund_amount: Math.round(modal.order.total_amount||0), restock:false },
                })}
                className="w-full mb-2 py-2 rounded-lg text-[12px] font-bold transition"
                style={{background:'rgba(248,81,73,0.1)',border:'1px solid rgba(248,81,73,0.3)',color:'#f85149'}}>
                ↩️ Initiate Return Request
              </button>
            )}

            <button onClick={saveOrder} disabled={saving} className="w-full bg-[var(--accent)] text-[var(--tx)] text-[13px] font-bold py-2.5 rounded-lg transition disabled:opacity-50">
              {saving?'Saving…':'💾 Update Order'}
            </button>
          </div>
          </>)}

          {returnTab==='returns'&&(
            <div className="space-y-4">
              {orderReturns.length>0&&(
                <div className="rounded-xl p-4 space-y-2" style={{background:'var(--bg,#0d1117)'}}>
                  <h4 className="text-[12px] font-bold mb-3" style={{color:'var(--accent)'}}>↩️ Return History ({orderReturns.length})</h4>
                  {orderReturns.map((r,i)=>(
                    <div key={r.id||i} className="rounded-lg p-3 flex items-start justify-between gap-3" style={{background:'var(--bg2,#161b22)',border:'1px solid var(--bd,#30363d)'}}>
                      <div className="space-y-1 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <ReturnStatusBadge status={r.status}/>
                          <span className="text-[11px] text-[var(--tx2)] capitalize">{(r.reason||'').replace(/_/g,' ')}</span>
                          {r.refund_amount&&<span className="text-[11px] font-bold text-[#3fb950]">₹{Math.round(r.refund_amount).toLocaleString('en-IN')}</span>}
                          <span className="text-[10px] text-[var(--tx3)]">{r.created_at?new Date(r.created_at).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}):''}</span>
                        </div>
                        {r.description&&<div className="text-[11px] text-[var(--tx2)]">{r.description}</div>}
                        <div className="text-[10px] text-[var(--tx3)]">Restock: {r.restock?'✓ Yes':'✗ No'} {REASON_RESTOCK[r.reason]!==null?'(auto)':'(manual)'}</div>
                      </div>
                      <button onClick={()=>startEditReturn(r)} className="text-[11px] px-2 py-1 rounded flex-shrink-0" style={{background:'var(--blue-bg)',color:'var(--blue)',border:'1px solid var(--blue-bd)'}}>Edit</button>
                    </div>
                  ))}
                </div>
              )}
              <div className="rounded-xl p-4 space-y-3" style={{background:'var(--bg,#0d1117)'}}>
                <h4 className="text-[12px] font-bold text-[var(--tx)] mb-1">{editingReturn?'✏️ Edit Return':'+ New Return Request'}</h4>

                {/* Status flow progress */}
                <div className="flex items-center gap-1 flex-wrap mb-1">
                  {RETURN_STATUSES.map((s,i)=><span key={s} className="flex items-center gap-1">
                    <span className="text-[10px] px-2 py-0.5 rounded" style={{background:returnForm.status===s?'var(--blue-bg)':'color-mix(in srgb, var(--bd) 15%, transparent)',color:returnForm.status===s?'var(--blue)':'var(--tx3,#6e7681)',border:`1px solid ${returnForm.status===s?'var(--blue-bd)':'transparent'}`,fontWeight:returnForm.status===s?700:400}}>{s}</span>
                    {i<RETURN_STATUSES.length-1&&<span className="text-[#444] text-[10px]">→</span>}
                  </span>)}
                </div>

                {/* Auto-action preview */}
                <div className="rounded-lg px-3 py-2 text-[10px]" style={{background:'color-mix(in srgb, var(--blue-bg) 40%, transparent)',border:'1px solid var(--blue-bg)',color:'var(--blue)'}}>
                  {returnForm.status==='approved'  && '🔄 Will set payment → Refund Pending'}
                  {returnForm.status==='refunded'  && '✅ Will set payment → Refunded + email customer'}
                  {returnForm.status==='rejected'  && '❌ Will revert payment → Paid + email customer'}
                  {returnForm.status==='received'  && '📬 Will notify customer items received'}
                  {returnForm.status==='requested' && '📋 Return request logged'}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-bold text-[var(--tx3)] uppercase block mb-1">Reason *</label>
                    <select value={returnForm.reason}
                      onChange={e => {
                        const reason = e.target.value;
                        const autoRestock = getAutoRestock(reason);
                        setReturnForm(f=>({...f, reason, restock: autoRestock !== null ? autoRestock : f.restock}));
                      }}
                      className="w-full bg-[var(--input-bg)] border border-[var(--bd)] rounded-lg px-3 py-2 text-[12px] text-[var(--tx)] focus:outline-none">
                      {RETURN_REASONS.map(r=><option key={r} value={r}>{r.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase())}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-[var(--tx3)] uppercase block mb-1">Status</label>
                    <select value={returnForm.status} onChange={e=>setReturnForm(f=>({...f,status:e.target.value}))} className="w-full bg-[var(--input-bg)] border border-[var(--bd)] rounded-lg px-3 py-2 text-[12px] text-[var(--tx)] focus:outline-none">
                      {RETURN_STATUSES.map(s=><option key={s} value={s}>{s.charAt(0).toUpperCase()+s.slice(1)}</option>)}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="text-[10px] font-bold text-[var(--tx3)] uppercase block mb-1">Refund Amount ₹</label>
                  <input type="number" value={returnForm.refund_amount} onChange={e=>setReturnForm(f=>({...f,refund_amount:e.target.value}))} placeholder={`Max: ₹${Math.round(modal.order.total_amount||0).toLocaleString('en-IN')}`} className="w-full bg-[var(--input-bg)] border border-[var(--bd)] rounded-lg px-3 py-2 text-[12px] text-[var(--tx)] focus:outline-none"/>
                </div>

                <div>
                  <label className="text-[10px] font-bold text-[var(--tx3)] uppercase block mb-1">Notes</label>
                  <textarea value={returnForm.description} onChange={e=>setReturnForm(f=>({...f,description:e.target.value}))} placeholder="Customer complaint, item condition…" className="w-full bg-[var(--input-bg)] border border-[var(--bd)] rounded-lg px-3 py-2 text-[12px] text-[var(--tx)] focus:outline-none resize-none" rows={2}/>
                </div>

                {/* Restock -- auto-locked based on reason, only manual for 'other' */}
                <div>
                  <label className="text-[10px] font-bold text-[var(--tx3)] uppercase block mb-1.5">
                    Restock Item?
                    {getAutoRestock(returnForm.reason) !== null &&
                      <span className="ml-1 px-1.5 py-0.5 rounded text-[8px] font-bold" style={{background:'rgba(26,92,42,0.3)',color:'#4a9c5d'}}>AUTO</span>
                    }
                  </label>
                  {getAutoRestock(returnForm.reason) !== null ? (
                    // Auto-locked based on reason
                    <div className="rounded-lg px-3 py-2 text-[12px] font-bold flex items-center gap-2"
                      style={{background:'rgba(26,92,42,0.08)',border:'1px solid rgba(26,92,42,0.3)',color: getAutoRestock(returnForm.reason) ? '#3fb950' : '#f85149',cursor:'not-allowed'}}>
                      🔒 {getAutoRestock(returnForm.reason) ? '✓ Yes -- restock (auto based on reason)' : '✗ No -- not restocking (damaged/missing)'}
                    </div>
                  ) : (
                    // Manual choice only for 'other' reason
                    <div className="flex gap-2">
                      {[{v:true,l:'✓ Yes -- restock'},{v:false,l:'✗ No -- damaged/lost'}].map(opt=>(
                        <button key={String(opt.v)} onClick={()=>setReturnForm(f=>({...f,restock:opt.v}))}
                          className="flex-1 py-2 rounded-lg text-[11px] font-semibold transition"
                          style={{border:'1px solid var(--bd)',background:returnForm.restock===opt.v?'var(--accent,#1a5c2a)':'var(--bg2)',color:returnForm.restock===opt.v?'#fff':'var(--tx2)'}}>
                          {opt.l}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="flex gap-2">
                  {editingReturn&&<button onClick={()=>{setEditingReturn(null);setReturnForm({reason:'damaged',description:'',refund_amount:'',status:'requested',restock:false});}} className="px-4 py-2 rounded-lg text-[12px] border border-[var(--bd)] text-[var(--tx2)]">Cancel Edit</button>}
                  <button onClick={saveReturn} disabled={returnSaving} className="flex-1 py-2 rounded-lg text-[13px] font-bold text-white transition disabled:opacity-50" style={{background:returnSaving?'#333':'var(--accent,#1a5c2a)'}}>
                    {returnSaving?'Saving…':editingReturn?'💾 Update Return':'↩️ Create Return'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </Modal>
      )}

      {/* -- Return Initiation Popup -- */}
      {returnPopup && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4" style={{background:'rgba(0,0,0,0.85)'}}>
          <div className="w-full max-w-md rounded-2xl overflow-hidden shadow-2xl" style={{background:'var(--bg2,#161b22)',border:'1px solid var(--bd,#30363d)'}}>
            <div className="px-6 py-4 flex items-center justify-between" style={{background:'linear-gradient(135deg,#1a3a1e,#2d5233)',borderBottom:'1px solid var(--bd,#30363d)'}}>
              <div>
                <div className="text-[var(--tx)] font-bold text-[15px]">↩️ Initiate Return</div>
                <div className="text-[11px] mt-0.5" style={{color:'rgba(255,255,255,0.6)'}}>
                  {returnPopup.order.order_number} · {`${returnPopup.customer.first_name||''} ${returnPopup.customer.last_name||''}`.trim()||'Customer'}
                </div>
              </div>
              <button onClick={()=>setReturnPopup(null)} className="text-[var(--tx2)] hover:text-[var(--tx)] text-xl leading-none">×</button>
            </div>

            <div className="p-5 space-y-4">
              {/* Items */}
              <div className="rounded-xl p-3 space-y-1.5" style={{background:'var(--bg,#0d1117)',border:'1px solid var(--bd,#30363d)'}}>
                <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--tx3)] mb-2">Items Being Returned</div>
                {(returnPopup.items||[]).map((item,i)=>{
                  const pname = returnPopup.prodMap?.[item.product_id]?.name || 'Product';
                  const emoji = returnPopup.prodMap?.[item.product_id]?.emoji || '🌿';
                  return <div key={i} className="flex justify-between text-[12px]">
                    <span className="text-[var(--tx)]">{emoji} {pname} <span className="text-[var(--tx3)]">×{item.quantity||1}</span></span>
                    <span className="text-[#3fb950] font-bold">₹{Math.round((item.price_at_time||0)*(item.quantity||1)).toLocaleString('en-IN')}</span>
                  </div>;
                })}
                <div className="border-t border-[var(--bd)] mt-2 pt-2 flex justify-between">
                  <span className="text-[11px] font-bold text-[var(--tx3)]">Order Total</span>
                  <span className="text-[13px] font-bold text-[#3fb950]">₹{Math.round(returnPopup.order.total_amount||0).toLocaleString('en-IN')}</span>
                </div>
              </div>

              {/* Reason */}
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-[var(--tx3)] block mb-1.5">Return Reason *</label>
                <select value={returnPopup.form.reason}
                  onChange={e => {
                    const reason = e.target.value;
                    const autoRestock = getAutoRestock(reason);
                    setReturnPopup(p=>({...p,form:{...p.form,reason,restock: autoRestock !== null ? autoRestock : p.form.restock}}));
                  }}
                  className="w-full rounded-lg px-3 py-2 text-[12px] text-[var(--tx)] focus:outline-none"
                  style={{background:'var(--input-bg,#21262d)',border:'1px solid var(--bd,#30363d)'}}>
                  {RETURN_REASONS.map(r=><option key={r} value={r}>{r.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase())}</option>)}
                </select>
              </div>

              {/* Refund amount */}
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-[var(--tx3)] block mb-1.5">Refund Amount ₹</label>
                <input type="number"
                  value={returnPopup.form.refund_amount}
                  onChange={e=>setReturnPopup(p=>({...p,form:{...p.form,refund_amount:e.target.value}}))}
                  className="w-full rounded-lg px-3 py-2 text-[12px] text-[var(--tx)] focus:outline-none"
                  style={{background:'var(--input-bg,#21262d)',border:'1px solid var(--bd,#30363d)'}}/>
              </div>

              {/* Notes */}
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-[var(--tx3)] block mb-1.5">Notes (optional)</label>
                <textarea value={returnPopup.form.description}
                  onChange={e=>setReturnPopup(p=>({...p,form:{...p.form,description:e.target.value}}))}
                  placeholder="Customer complaint, condition of item…"
                  rows={2}
                  className="w-full rounded-lg px-3 py-2 text-[12px] text-[var(--tx)] focus:outline-none resize-none"
                  style={{background:'var(--input-bg,#21262d)',border:'1px solid var(--bd,#30363d)'}}/>
              </div>

              {/* Restock -- auto based on reason */}
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-[var(--tx3)] block mb-1.5">
                  Restock Item?
                  {getAutoRestock(returnPopup.form.reason) !== null &&
                    <span className="ml-1 px-1.5 py-0.5 rounded text-[8px] font-bold" style={{background:'rgba(26,92,42,0.3)',color:'#4a9c5d'}}>AUTO</span>
                  }
                </label>
                {getAutoRestock(returnPopup.form.reason) !== null ? (
                  <div className="rounded-lg px-3 py-2 text-[12px] font-bold flex items-center gap-2"
                    style={{background:'rgba(26,92,42,0.08)',border:'1px solid rgba(26,92,42,0.3)',color:getAutoRestock(returnPopup.form.reason)?'#3fb950':'#f85149',cursor:'not-allowed'}}>
                    🔒 {getAutoRestock(returnPopup.form.reason) ? '✓ Yes -- restock (auto)' : '✗ No -- not restocking (auto)'}
                  </div>
                ) : (
                  <div className="flex gap-2">
                    {[{v:true,l:'✓ Yes -- restock inventory'},{v:false,l:'✗ No -- damaged/lost'}].map(opt=>(
                      <button key={String(opt.v)}
                        onClick={()=>setReturnPopup(p=>({...p,form:{...p.form,restock:opt.v}}))}
                        className="flex-1 py-2 rounded-lg text-[11px] font-bold transition"
                        style={{border:'1px solid',borderColor:returnPopup.form.restock===opt.v?'#3fb950':'var(--bd,#30363d)',background:returnPopup.form.restock===opt.v?'rgba(63,185,80,0.15)':'#21262d',color:returnPopup.form.restock===opt.v?'#3fb950':'#8b949e'}}>
                        {opt.l}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* What will happen */}
              <div className="rounded-lg p-3 text-[11px]" style={{background:'color-mix(in srgb, var(--blue-bg) 40%, transparent)',border:'1px solid var(--blue-bg)',color:'var(--blue)'}}>
                📋 This will: create return record (Requested) · set payment → <strong>Refund Pending</strong> · email customer "Return Request Received"
              </div>

              <div className="flex gap-3 pt-1">
                <button onClick={()=>setReturnPopup(null)}
                  className="flex-1 py-2.5 rounded-xl text-[13px] font-bold transition"
                  style={{border:'1px solid var(--bd,#30363d)',color:'var(--tx2,#8b949e)',background:'transparent'}}>
                  Cancel
                </button>
                <button onClick={confirmReturnAndSave} disabled={saving}
                  className="flex-1 py-2.5 rounded-xl text-[13px] font-bold text-[var(--tx)] transition disabled:opacity-50"
                  style={{background:saving?'#333':'linear-gradient(135deg,#f85149,#c93535)'}}>
                  {saving ? 'Processing…' : '↩️ Initiate Return'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex gap-2 flex-wrap">
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search order #, customer, phone…" className="bg-[var(--input-bg)] border border-[var(--bd)] rounded-lg px-3 py-1.5 text-[12px] text-[var(--tx)] w-56 focus:outline-none focus:border-[var(--accent)]"/>
          <select value={statusF} onChange={e=>setStatusF(e.target.value)} className="bg-[var(--input-bg)] border border-[var(--bd)] rounded-lg px-3 py-1.5 text-[12px] text-[var(--tx2)]">
            <option value="">All Status</option>
            {STATUSES.map(s=><option key={s} value={s}>{s.charAt(0).toUpperCase()+s.slice(1)}</option>)}
          </select>
          <select value={payF} onChange={e=>setPayF(e.target.value)} className="bg-[var(--input-bg)] border border-[var(--bd)] rounded-lg px-3 py-1.5 text-[12px] text-[var(--tx2)]">
            <option value="">All Payments</option>
            {PAY_STATUSES.map(s=><option key={s} value={s}>{s==='refund_pending'?'Refund Pending':s.charAt(0).toUpperCase()+s.slice(1)}</option>)}
          </select>
        </div>
        <div className="flex gap-2">
          <span className="text-[11px] text-[var(--tx3)] self-center">{filtered.length} orders</span>
          <button onClick={exportCSV} className="px-3 py-1.5 bg-[var(--input-bg)] border border-[var(--bd)] rounded-lg text-[11px] text-[var(--tx2)] hover:text-[var(--tx)] transition">↓ Export CSV</button>
        </div>
      </div>

      <Card>
        {loading?<Loader text="Loading orders…"/>:error?<ErrorMsg error={error} onRetry={()=>load(1)}/>:(
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr>
                {['Order #','Customer','Contact','Amount','Order Status','Payment','Method','Date','Action'].map(h=>(
                  <th key={h} className="text-left text-[10px] font-bold uppercase tracking-wider pb-3 pr-3" style={{color:"var(--tx2,#6e7681)"}}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {filtered.map(o=>{const c=custCache[o.customer_id]||{};const name=`${c.first_name||''} ${c.last_name||''}`.trim()||'Guest';return(
                  <tr key={o.id} className="border-t border-[var(--bd)]/50 hover:bg-[var(--input-bg)]/20">
                    <td className="py-2.5 pr-3"><button onClick={()=>openOrder(o)} className="text-[11px] text-[var(--blue)] font-mono hover:underline">{o.order_number||'#'+String(o.id).slice(-8).toUpperCase()}</button></td>
                    <td className="py-2.5 pr-3"><div className="text-[12px] text-[var(--tx)] font-semibold">{name}</div><div className="text-[10.5px] text-[var(--tx3)]">{c.email||''}</div></td>
                    <td className="py-2.5 pr-3 text-[11px] text-[var(--tx3)]">{c.phone||'--'}<br/><span className="text-[10px]">{c.city||''}</span></td>
                    <td className="py-2.5 pr-3 text-[12px] font-bold text-[var(--tx)]">{fmtCurrency(parseFloat(o.total_amount)||0)}</td>
                    <td className="py-2.5 pr-3"><StatusBadge status={o.order_status}/></td>
                    <td className="py-2.5 pr-3"><PayBadge status={o.payment_status}/></td>
                    <td className="py-2.5 pr-3"><Badge type={o.payment_method==='razorpay_online'?'blue':'purple'}>{o.payment_method==='razorpay_online'?'Online':'COD'}</Badge></td>
                    <td className="py-2.5 pr-3 text-[11px] text-[var(--tx3)]">{new Date(o.created_at).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'2-digit'})}</td>
                    <td className="py-2.5"><button onClick={()=>openOrder(o)} className="px-2.5 py-1 bg-[var(--input-bg)] hover:bg-[var(--bd)] border border-[var(--bd)] rounded-md text-[11px] text-[var(--tx)] transition">View</button></td>
                  </tr>
                );})}
                {filtered.length===0&&!loading&&<tr><td colSpan={9} className="py-8 text-center text-[var(--tx3)] text-[12px]">No orders found</td></tr>}
              </tbody>
            </table>
            <div className="flex gap-2 mt-4 justify-end">
              <button disabled={page===1} onClick={()=>load(page-1)} className="px-3 py-1.5 bg-[var(--input-bg)] border border-[var(--bd)] rounded-lg text-[11px] text-[var(--tx2)] hover:text-[var(--tx)] disabled:opacity-40 transition">← Prev</button>
              <span className="text-[11px] text-[var(--tx3)] self-center">Page {page}</span>
              <button disabled={!hasMore} onClick={()=>load(page+1)} className="px-3 py-1.5 bg-[var(--input-bg)] border border-[var(--bd)] rounded-lg text-[11px] text-[var(--tx2)] hover:text-[var(--tx)] disabled:opacity-40 transition">Next →</button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

export default function OrdersPageWrapper(props) {
  return (
    <Suspense fallback={<div className="flex items-center justify-center py-24" style={{color:'var(--tx2,#6e7681)'}}>Loading…</div>}>
      <OrdersPage {...props} />
    </Suspense>
  );
}
