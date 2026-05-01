'use client';
import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';
import { Card, Loader, ErrorMsg } from '@/components/ui/index';
import Modal from '@/components/ui/Modal';

const STATUS_COLORS = {
  active:   { bg:'rgba(63,185,80,0.1)',  color:'#3fb950', label:'Active'  },
  inactive: { bg:'rgba(110,118,129,0.1)',color:'#8b949e', label:'Inactive'},
  pending:  { bg:'rgba(210,153,34,0.1)', color:'#d29922', label:'Pending' },
};

const inp = 'w-full rounded-lg px-3 py-2 text-[12px] outline-none bg-[var(--bg,#0d1117)] border border-[var(--bd,#30363d)] text-[var(--tx,#e6edf3)] focus:border-[var(--accent,#1a5c2a)]';

function Field({ label, children, required, hint }) {
  return (
    <div className="space-y-1">
      <div className="text-[10px] font-bold uppercase tracking-wide" style={{color:'var(--tx2)'}}>
        {label}{required && <span style={{color:'#f85149'}}> *</span>}
      </div>
      {children}
      {hint && <div className="text-[10px]" style={{color:'var(--tx3)'}}>{hint}</div>}
    </div>
  );
}

const EMPTY_VENDOR = {
  name:'', business_name:'', email:'', phone:'',
  state_id:'', region:'', gstin:'', pan:'',
  bank_name:'', bank_account:'', bank_ifsc:'', bank_holder:'',
  default_commission_pct:'10', status:'active', notes:'',
};

export default function VendorsPage() {
  const [vendors, setVendors]         = useState([]);
  const [states, setStates]           = useState([]);
  const [products, setProducts]       = useState([]);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState(null);
  const [modal, setModal]             = useState(null);   // null | 'add' | vendor object
  const [form, setForm]               = useState(EMPTY_VENDOR);
  const [saving, setSaving]           = useState(false);
  const [tab, setTab]                 = useState('info'); // 'info' | 'banking' | 'products'
  const [vendorProducts, setVendorProducts] = useState([]);
  const [loadingVP, setLoadingVP]     = useState(false);
  const [search, setSearch]           = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [addingProduct, setAddingProduct] = useState(false);
  const [newVP, setNewVP]             = useState({ product_id:'', commission_pct:'', supply_price:'', is_primary:false });

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [v, s, p] = await Promise.all([
        api.get('vendors', 'order=business_name.asc'),
        api.get('states', 'select=id,name&order=name.asc').catch(() => []),
        api.get('products', 'select=id,name,status&is_deleted=eq.false&order=name.asc').catch(() => []),
      ]);
      setVendors(v || []);
      setStates(s || []);
      setProducts(p || []);
    } catch(e) { setError(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function loadVendorProducts(vendorId) {
    setLoadingVP(true);
    try {
      const rows = await api.get('vendor_products',
        `vendor_id=eq.${vendorId}&select=id,product_id,commission_pct,supply_price,is_primary,status,notes`
      ).catch(() => []);
      setVendorProducts(rows || []);
    } finally { setLoadingVP(false); }
  }

  function openAdd() {
    setForm(EMPTY_VENDOR);
    setTab('info');
    setVendorProducts([]);
    setModal('add');
  }

  function openEdit(v) {
    setForm({
      name: v.name || '',
      business_name: v.business_name || '',
      email: v.email || '',
      phone: v.phone || '',
      state_id: v.state_id != null ? String(v.state_id) : '',
      region: v.region || '',
      gstin: v.gstin || '',
      pan: v.pan || '',
      bank_name: v.bank_name || '',
      bank_account: v.bank_account || '',
      bank_ifsc: v.bank_ifsc || '',
      bank_holder: v.bank_holder || '',
      default_commission_pct: v.default_commission_pct != null ? String(v.default_commission_pct) : '10',
      status: v.status || 'active',
      notes: v.notes || '',
    });
    setTab('info');
    setVendorProducts([]);
    setModal(v);
    loadVendorProducts(v.id);
  }

  async function handleSave() {
    if (!form.name.trim())          return alert('Contact name is required');
    if (!form.business_name.trim()) return alert('Business name is required');
    setSaving(true);
    try {
      const body = {
        name:                   form.name.trim(),
        business_name:          form.business_name.trim(),
        email:                  form.email.trim() || null,
        phone:                  form.phone.trim() || null,
        state_id:               form.state_id ? parseInt(form.state_id) : null,
        region:                 form.region.trim() || null,
        gstin:                  form.gstin.trim() || null,
        pan:                    form.pan.trim() || null,
        bank_name:              form.bank_name.trim() || null,
        bank_account:           form.bank_account.trim() || null,
        bank_ifsc:              form.bank_ifsc.trim().toUpperCase() || null,
        bank_holder:            form.bank_holder.trim() || null,
        default_commission_pct: parseFloat(form.default_commission_pct) || 10,
        status:                 form.status,
        notes:                  form.notes.trim() || null,
      };
      if (modal === 'add') {
        await api.post('vendors', body);
      } else {
        await api.patch('vendors', `id=eq.${modal.id}`, body);
      }
      await load();
      setModal(null);
    } catch(e) { alert('Save failed: ' + e.message); }
    finally { setSaving(false); }
  }

  async function handleDelete(v) {
    if (!confirm(`Delete vendor "${v.business_name}"?\n\nThis will unlink all their products but NOT delete the products.`)) return;
    try {
      await api.delete('vendors', `id=eq.${v.id}`);
      await load();
    } catch(e) { alert('Delete failed: ' + e.message); }
  }

  async function addVendorProduct() {
    if (!newVP.product_id) return alert('Select a product');
    if (modal === 'add' || !modal?.id) return;
    try {
      await api.post('vendor_products', {
        vendor_id:      modal.id,
        product_id:     parseInt(newVP.product_id),
        commission_pct: newVP.commission_pct ? parseFloat(newVP.commission_pct) : null,
        supply_price:   newVP.supply_price ? parseFloat(newVP.supply_price) : null,
        is_primary:     newVP.is_primary,
        status:         'active',
      });
      // If marked primary, also update products.vendor_id
      if (newVP.is_primary) {
        await api.patch('products', `id=eq.${newVP.product_id}`, { vendor_id: modal.id }).catch(() => {});
      }
      setNewVP({ product_id:'', commission_pct:'', supply_price:'', is_primary:false });
      setAddingProduct(false);
      await loadVendorProducts(modal.id);
    } catch(e) { alert('Failed: ' + e.message); }
  }

  async function removeVendorProduct(vpId, productId) {
    if (!confirm('Remove this product from vendor?')) return;
    await api.delete('vendor_products', `id=eq.${vpId}`).catch(() => {});
    // Clear vendor_id on product if it pointed to this vendor
    await api.patch('products', `id=eq.${productId}&vendor_id=eq.${modal.id}`, { vendor_id: null }).catch(() => {});
    await loadVendorProducts(modal.id);
  }

  async function toggleVendorStatus(v) {
    const next = v.status === 'active' ? 'inactive' : 'active';
    await api.patch('vendors', `id=eq.${v.id}`, { status: next }).catch(() => {});
    await load();
  }

  const filtered = vendors.filter(v => {
    const q = search.toLowerCase();
    const matchSearch = !q || v.business_name?.toLowerCase().includes(q) || v.name?.toLowerCase().includes(q) || v.email?.toLowerCase().includes(q);
    const matchStatus = !filterStatus || v.status === filterStatus;
    return matchSearch && matchStatus;
  });

  // Product name lookup map
  const prodMap = Object.fromEntries(products.map(p => [String(p.id), p.name]));

  if (loading) return <Loader text="Loading vendors…" />;
  if (error)   return <ErrorMsg msg={error} />;

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[20px] font-bold" style={{color:'var(--tx)'}}>🤝 Vendors</h1>
          <p className="text-[12px] mt-0.5" style={{color:'var(--tx2)'}}>
            Manage your supplier/vendor network. Assign vendors to products and track commissions.
          </p>
        </div>
        <button onClick={openAdd}
          className="px-4 py-2 rounded-xl text-[12px] font-bold text-white"
          style={{background:'var(--accent,#1a5c2a)'}}>
          + Add Vendor
        </button>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label:'Total Vendors', value: vendors.length, color:'var(--tx)' },
          { label:'Active',        value: vendors.filter(v=>v.status==='active').length,   color:'#3fb950' },
          { label:'Pending',       value: vendors.filter(v=>v.status==='pending').length,  color:'#d29922' },
        ].map(s => (
          <div key={s.label} className="rounded-xl px-4 py-3 text-center" style={{background:'var(--bg2)',border:'1px solid var(--bd)'}}>
            <div className="text-[22px] font-bold" style={{color:s.color}}>{s.value}</div>
            <div className="text-[10px] mt-0.5" style={{color:'var(--tx2)'}}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Vendor portal info card */}
      <div className="rounded-xl px-4 py-3 flex items-start gap-3" style={{background:'color-mix(in srgb, var(--accent) 6%, transparent)',border:'1px solid color-mix(in srgb, var(--accent) 25%, transparent)'}}>
        <div className="text-[18px] mt-0.5">🏪</div>
        <div>
          <div className="text-[12px] font-bold" style={{color:'var(--tx)'}}>Vendor Portal</div>
          <div className="text-[11px] mt-0.5" style={{color:'var(--tx2)'}}>
            Vendors log in at <code className="text-[10px] px-1.5 py-0.5 rounded" style={{background:'var(--bg)',color:'var(--accent)'}}>pahadiroots.com/admin/vendor-portal</code> using the <strong>VENDOR_PASSWORD</strong> set in Vercel environment variables.
            Once inside, they can add and edit only their own products.
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-2">
        <input value={search} onChange={e=>setSearch(e.target.value)}
          placeholder="Search name, business, email…"
          className={inp + ' flex-1'} />
        <select value={filterStatus} onChange={e=>setFilterStatus(e.target.value)} className={inp} style={{width:'140px',flex:'none'}}>
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="pending">Pending</option>
          <option value="inactive">Inactive</option>
        </select>
      </div>

      {/* Vendor list */}
      {filtered.length === 0 ? (
        <Card>
          <div className="text-center py-12">
            <div className="text-[40px] mb-3">🤝</div>
            <div className="text-[14px] font-bold" style={{color:'var(--tx)'}}>No vendors yet</div>
            <div className="text-[12px] mt-1 mb-4" style={{color:'var(--tx2)'}}>Add your first vendor to start building your marketplace</div>
            <button onClick={openAdd} className="px-4 py-2 rounded-lg text-[12px] font-bold text-white" style={{background:'var(--accent)'}}>+ Add Vendor</button>
          </div>
        </Card>
      ) : (
        <div className="space-y-2">
          {filtered.map(v => {
            const sc = STATUS_COLORS[v.status] || STATUS_COLORS.inactive;
            return (
              <div key={v.id} className="rounded-xl px-4 py-3 flex items-center gap-3" style={{background:'var(--bg2)',border:'1px solid var(--bd)'}}>
                {/* Avatar */}
                <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 text-[16px] font-bold"
                  style={{background:'color-mix(in srgb, var(--accent) 12%, transparent)',color:'var(--accent)'}}>
                  {v.business_name?.[0]?.toUpperCase() || '?'}
                </div>
                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[13px] font-bold" style={{color:'var(--tx)'}}>{v.business_name}</span>
                    <span className="text-[10px] px-2 py-0.5 rounded-full font-bold" style={{background:sc.bg, color:sc.color}}>{sc.label}</span>
                  </div>
                  <div className="text-[11px] mt-0.5" style={{color:'var(--tx2)'}}>
                    {v.name}
                    {v.email && <> · <span style={{color:'var(--tx3)'}}>{v.email}</span></>}
                    {v.phone && <> · {v.phone}</>}
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-[10px]" style={{color:'var(--tx3)'}}>
                    {v.state_id && states.find(s=>s.id===v.state_id) && <span>📍 {states.find(s=>s.id===v.state_id).name}{v.region && ` · ${v.region}`}</span>}
                    <span>Commission: {v.default_commission_pct}%</span>
                    {v.gstin && <span>GSTIN: {v.gstin}</span>}
                  </div>
                </div>
                {/* Actions */}
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button onClick={() => toggleVendorStatus(v)}
                    className="px-2 py-1 rounded-lg text-[10px] font-bold"
                    style={{background: v.status==='active' ? 'rgba(248,81,73,0.1)' : 'rgba(63,185,80,0.1)', color: v.status==='active'?'#f85149':'#3fb950', border:`1px solid ${v.status==='active'?'rgba(248,81,73,0.25)':'rgba(63,185,80,0.25)'}`}}>
                    {v.status==='active' ? 'Deactivate' : 'Activate'}
                  </button>
                  <button onClick={() => openEdit(v)}
                    className="px-3 py-1.5 rounded-lg text-[11px] font-bold text-white"
                    style={{background:'var(--accent)'}}>
                    Edit
                  </button>
                  <button onClick={() => handleDelete(v)}
                    className="px-2 py-1.5 rounded-lg text-[11px]"
                    style={{color:'#f85149',border:'1px solid rgba(248,81,73,0.25)'}}>
                    ✕
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Add/Edit Modal ── */}
      {modal && (
        <Modal title={modal === 'add' ? '+ Add Vendor' : `Edit — ${modal.business_name}`} onClose={() => setModal(null)}>
          {/* Tab nav */}
          <div className="flex gap-0 mb-5" style={{borderBottom:'2px solid var(--bd)'}}>
            {[
              { id:'info',     label:'📋 Info'    },
              { id:'banking',  label:'🏦 Banking'  },
              { id:'products', label:'📦 Products', disabled: modal==='add' },
            ].map(t => (
              <button key={t.id}
                disabled={t.disabled}
                onClick={() => !t.disabled && setTab(t.id)}
                className="px-4 py-2.5 text-[11px] font-bold transition-all"
                style={{
                  borderBottom: tab===t.id ? '2px solid var(--accent)' : '2px solid transparent',
                  marginBottom: '-2px',
                  color: t.disabled ? 'var(--tx3)' : tab===t.id ? 'var(--accent)' : 'var(--tx2)',
                  cursor: t.disabled ? 'not-allowed' : 'pointer',
                  opacity: t.disabled ? 0.4 : 1,
                }}>
                {t.label}
                {t.disabled && <span className="ml-1 text-[9px]">(save first)</span>}
              </button>
            ))}
          </div>

          {/* ── INFO TAB ── */}
          {tab === 'info' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Business / Shop Name" required>
                  <input value={form.business_name} onChange={e=>setForm(f=>({...f,business_name:e.target.value}))} className={inp} placeholder="e.g. Sharma Honey Farm" />
                </Field>
                <Field label="Contact Person Name" required>
                  <input value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} className={inp} placeholder="e.g. Ramesh Sharma" />
                </Field>
                <Field label="Email">
                  <input type="email" value={form.email} onChange={e=>setForm(f=>({...f,email:e.target.value}))} className={inp} placeholder="vendor@email.com" />
                </Field>
                <Field label="Phone">
                  <input value={form.phone} onChange={e=>setForm(f=>({...f,phone:e.target.value}))} className={inp} placeholder="+91 98XXX XXXXX" />
                </Field>
                <Field label="State / Region">
                  <select value={form.state_id||''} onChange={e=>setForm(f=>({...f,state_id:e.target.value}))} className={inp}>
                    <option value="">Select state…</option>
                    {states.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </Field>
                <Field label="Specific Region / Village" hint="e.g. Kangra Valley, Spiti">
                  <input value={form.region} onChange={e=>setForm(f=>({...f,region:e.target.value}))} className={inp} placeholder="Village, tehsil, district…" />
                </Field>
                <Field label="Default Commission %" hint="Applied to all their products unless overridden per-product">
                  <input type="number" min="0" max="100" step="0.5" value={form.default_commission_pct} onChange={e=>setForm(f=>({...f,default_commission_pct:e.target.value}))} className={inp} placeholder="10" />
                </Field>
                <Field label="Status">
                  <select value={form.status} onChange={e=>setForm(f=>({...f,status:e.target.value}))} className={inp}>
                    <option value="active">Active</option>
                    <option value="pending">Pending (not yet verified)</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </Field>
                <Field label="GSTIN" hint="For GST compliance">
                  <input value={form.gstin} onChange={e=>setForm(f=>({...f,gstin:e.target.value.toUpperCase()}))} className={inp} placeholder="22AAAAA0000A1Z5" maxLength={15} />
                </Field>
                <Field label="PAN">
                  <input value={form.pan} onChange={e=>setForm(f=>({...f,pan:e.target.value.toUpperCase()}))} className={inp} placeholder="AAAAA0000A" maxLength={10} />
                </Field>
              </div>
              <Field label="Internal Notes">
                <textarea value={form.notes} onChange={e=>setForm(f=>({...f,notes:e.target.value}))} className={inp} rows={2} placeholder="Any notes about this vendor…" style={{resize:'vertical'}} />
              </Field>
            </div>
          )}

          {/* ── BANKING TAB ── */}
          {tab === 'banking' && (
            <div className="space-y-4">
              <div className="rounded-xl px-4 py-3 text-[11px]" style={{background:'color-mix(in srgb,var(--accent) 5%,transparent)',border:'1px solid color-mix(in srgb,var(--accent) 20%,transparent)',color:'var(--tx2)'}}>
                🔒 Bank details are stored securely and used only for processing vendor payments.
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Bank Name">
                  <input value={form.bank_name} onChange={e=>setForm(f=>({...f,bank_name:e.target.value}))} className={inp} placeholder="e.g. SBI, HDFC, PNB" />
                </Field>
                <Field label="Account Holder Name">
                  <input value={form.bank_holder} onChange={e=>setForm(f=>({...f,bank_holder:e.target.value}))} className={inp} placeholder="Name on bank account" />
                </Field>
                <Field label="Account Number">
                  <input value={form.bank_account} onChange={e=>setForm(f=>({...f,bank_account:e.target.value}))} className={inp} placeholder="Bank account number" />
                </Field>
                <Field label="IFSC Code">
                  <input value={form.bank_ifsc} onChange={e=>setForm(f=>({...f,bank_ifsc:e.target.value.toUpperCase()}))} className={inp} placeholder="SBIN0001234" maxLength={11} />
                </Field>
              </div>
            </div>
          )}

          {/* ── PRODUCTS TAB ── */}
          {tab === 'products' && modal !== 'add' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="text-[11px]" style={{color:'var(--tx2)'}}>
                  Products supplied by <strong style={{color:'var(--tx)'}}>{modal.business_name}</strong>
                </div>
                <button onClick={()=>setAddingProduct(p=>!p)}
                  className="px-3 py-1.5 rounded-lg text-[11px] font-bold text-white"
                  style={{background:'var(--accent)'}}>
                  {addingProduct ? 'Cancel' : '+ Link Product'}
                </button>
              </div>

              {/* Add new vendor-product row */}
              {addingProduct && (
                <div className="rounded-xl p-3 space-y-3" style={{background:'var(--bg)',border:'1px solid var(--accent)'}}>
                  <div className="text-[10px] font-bold uppercase tracking-wide" style={{color:'var(--accent)'}}>Link a Product</div>
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="Product *">
                      <select value={newVP.product_id} onChange={e=>setNewVP(v=>({...v,product_id:e.target.value}))} className={inp}>
                        <option value="">Select product…</option>
                        {products.filter(p=>!vendorProducts.find(vp=>String(vp.product_id)===String(p.id))).map(p=>(
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Commission % Override" hint="Blank = use default">
                      <input type="number" min="0" max="100" step="0.5" value={newVP.commission_pct} onChange={e=>setNewVP(v=>({...v,commission_pct:e.target.value}))} className={inp} placeholder={`Default: ${modal.default_commission_pct}%`} />
                    </Field>
                    <Field label="Supply Price ₹ / unit" hint="What vendor charges you">
                      <input type="number" min="0" value={newVP.supply_price} onChange={e=>setNewVP(v=>({...v,supply_price:e.target.value}))} className={inp} placeholder="0.00" />
                    </Field>
                    <Field label="Primary Supplier?" hint="Sets as default vendor on this product">
                      <label className="flex items-center gap-2 cursor-pointer mt-1">
                        <input type="checkbox" checked={newVP.is_primary} onChange={e=>setNewVP(v=>({...v,is_primary:e.target.checked}))}
                          className="w-4 h-4 rounded" style={{accentColor:'var(--accent)'}} />
                        <span className="text-[12px]" style={{color:'var(--tx)'}}>Mark as primary supplier</span>
                      </label>
                    </Field>
                  </div>
                  <button onClick={addVendorProduct}
                    className="px-4 py-2 rounded-lg text-[12px] font-bold text-white"
                    style={{background:'var(--accent)'}}>
                    Link Product
                  </button>
                </div>
              )}

              {/* Existing vendor-product list */}
              {loadingVP ? (
                <div className="text-[12px] text-center py-4" style={{color:'var(--tx2)'}}>Loading…</div>
              ) : vendorProducts.length === 0 ? (
                <div className="text-center py-8 rounded-xl" style={{background:'var(--bg)',border:'1px dashed var(--bd)'}}>
                  <div className="text-[12px]" style={{color:'var(--tx2)'}}>No products linked yet</div>
                </div>
              ) : (
                <div className="space-y-2">
                  {vendorProducts.map(vp => {
                    const effectiveComm = vp.commission_pct != null ? vp.commission_pct : modal.default_commission_pct;
                    return (
                      <div key={vp.id} className="flex items-center gap-3 px-3 py-2.5 rounded-xl" style={{background:'var(--bg)',border:'1px solid var(--bd)'}}>
                        <div className="flex-1 min-w-0">
                          <div className="text-[12px] font-bold" style={{color:'var(--tx)'}}>{prodMap[String(vp.product_id)] || `Product #${vp.product_id}`}</div>
                          <div className="flex gap-3 mt-0.5 text-[10px]" style={{color:'var(--tx2)'}}>
                            <span>Commission: {effectiveComm}%{vp.commission_pct == null ? ' (default)' : ' (override)'}</span>
                            {vp.supply_price && <span>Supply: ₹{vp.supply_price}</span>}
                            {vp.is_primary && <span className="font-bold" style={{color:'#3fb950'}}>★ Primary</span>}
                          </div>
                        </div>
                        <span className="text-[10px] px-2 py-0.5 rounded-full" style={{
                          background: vp.status==='active'?'rgba(63,185,80,0.1)':'rgba(110,118,129,0.1)',
                          color: vp.status==='active'?'#3fb950':'#8b949e',
                        }}>{vp.status}</span>
                        <button onClick={() => removeVendorProduct(vp.id, vp.product_id)}
                          className="text-[11px] px-2 py-1 rounded-lg"
                          style={{color:'#f85149',border:'1px solid rgba(248,81,73,0.25)'}}>
                          Remove
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Footer */}
          <div className="flex justify-end gap-3 mt-6 pt-4" style={{borderTop:'1px solid var(--bd)'}}>
            <button onClick={() => setModal(null)} className="px-4 py-2 rounded-lg text-[12px]" style={{color:'var(--tx2)'}}>
              Cancel
            </button>
            {tab !== 'products' && (
              <button onClick={handleSave} disabled={saving}
                className="px-5 py-2 rounded-lg text-[12px] font-bold text-white"
                style={{background:'var(--accent)',opacity:saving?0.6:1}}>
                {saving ? '⏳ Saving…' : modal==='add' ? '✅ Add Vendor' : '💾 Save Changes'}
              </button>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
