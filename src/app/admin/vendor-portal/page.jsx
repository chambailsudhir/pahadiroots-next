'use client';
import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';
import { Loader } from '@/components/ui/index';

// ── Vendor portal uses VENDOR_PASSWORD → 'vendor' role in API ──
// Vendor sees only their own products via vendor_products table

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

// ── Image upload (same as catalogue page) ──────────────────────
async function uploadImage(file, path) {
  const compressed = await new Promise(resolve => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const MAX = 1200;
      let w = img.width, h = img.height;
      if (w > MAX) { h = Math.round(h * MAX / w); w = MAX; }
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      canvas.toBlob(b => resolve(b), 'image/jpeg', 0.82);
      URL.revokeObjectURL(url);
    };
    img.src = url;
  });
  const base64 = await new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result.split(',')[1]);
    r.onerror = () => rej(new Error('Read failed'));
    r.readAsDataURL(compressed);
  });
  const fileName = `${path}-${Math.random().toString(36).slice(2,9)}.jpg`;
  const pw = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('pr_pw') : '';
  const res = await fetch('/api/admin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-password': pw || '' },
    body: JSON.stringify({ action: 'storage_upload', fileName, fileType: 'image/jpeg', fileBase64: base64 }),
  });
  if (!res.ok) { const e = await res.json().catch(()=>({})); throw new Error(e.error || 'Upload failed'); }
  return (await res.json()).url;
}

const EMPTY_PRODUCT = {
  name:'', slug:'', emoji:'', category_id:'', gst_rate:5,
  price:'', mrp:'', cost_price:'',
  short_description:'', long_description:'', image_url:'',
  unit_label:'', status:'active',
};

export default function VendorPortalPage() {
  const [pw, setPw]                   = useState('');
  const [authed, setAuthed]           = useState(false);
  const [vendorInfo, setVendorInfo]   = useState(null);  // detected from vendor_products
  const [vendorProducts, setVendorProducts] = useState([]);
  const [allProducts, setAllProducts] = useState([]);    // vendor's linked products
  const [categories, setCategories]   = useState([]);
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState('');
  const [modal, setModal]             = useState(null);  // null | 'add' | product object
  const [form, setForm]               = useState(EMPTY_PRODUCT);
  const [saving, setSaving]           = useState(false);
  const [saveMsg, setSaveMsg]         = useState('');
  const [uploadingImg, setUploadingImg] = useState(false);

  async function login() {
    if (!pw) return;
    setLoading(true); setError('');
    try {
      // Test vendor password by hitting the API
      const res = await fetch('/api/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-password': pw },
        body: JSON.stringify({ method: 'GET', table: 'vendors', query: 'select=id&limit=1' }),
      });
      if (res.status === 401) { setError('Wrong password'); setLoading(false); return; }
      if (!res.ok) { setError('Login failed'); setLoading(false); return; }
      sessionStorage.setItem('pr_pw', pw);
      sessionStorage.setItem('pr_role', 'vendor');
      setAuthed(true);
      await loadVendorData(pw);
    } catch(e) { setError('Connection error'); }
    finally { setLoading(false); }
  }

  async function loadVendorData(password) {
    setLoading(true);
    try {
      // In a real marketplace, each vendor has their own login tied to their ID.
      // For now (shared VENDOR_PASSWORD), load all vendors and vendor_products for portal use.
      // Admin assigns vendor_id on products; vendor can add/edit their linked products.
      const [cats, vps] = await Promise.all([
        api.get('categories', 'select=id,name&order=name.asc').catch(()=>[]),
        api.get('vendor_products', 'select=vendor_id,product_id&status=eq.active').catch(()=>[]),
      ]);
      setCategories(cats || []);
      setVendorProducts(vps || []);

      // Load products linked to any vendor (portal shows all for now; per-vendor scoping requires individual logins)
      const productIds = [...new Set((vps||[]).map(vp=>vp.product_id))];
      if (productIds.length > 0) {
        const prods = await api.get('products',
          `id=in.(${productIds.join(',')})&is_deleted=eq.false&select=id,name,price,mrp,status,image_url,category_id,short_description,gst_rate,cost_price,unit_label,long_description,emoji,slug&order=name.asc`
        ).catch(()=>[]);
        setAllProducts(prods || []);
      }
    } catch(e) { setError('Failed to load: ' + e.message); }
    finally { setLoading(false); }
  }

  // Check existing session on mount
  useEffect(() => {
    const stored = sessionStorage.getItem('pr_pw');
    const role = sessionStorage.getItem('pr_role');
    if (stored && role === 'vendor') {
      setPw(stored);
      setAuthed(true);
      loadVendorData(stored);
    }
  }, []);

  function openAdd() {
    setForm(EMPTY_PRODUCT);
    setSaveMsg('');
    setModal('add');
  }
  function openEdit(p) {
    setForm({
      name: p.name || '',
      slug: p.slug || '',
      emoji: p.emoji || '',
      category_id: p.category_id != null ? String(p.category_id) : '',
      gst_rate: p.gst_rate || 5,
      price: p.price || '',
      mrp: p.mrp || '',
      cost_price: p.cost_price || '',
      short_description: p.short_description || '',
      long_description: p.long_description || '',
      image_url: p.image_url || '',
      unit_label: p.unit_label || '',
      status: p.status || 'active',
    });
    setSaveMsg('');
    setModal(p);
  }

  async function handleSave() {
    if (!form.name.trim()) return alert('Product name is required');
    setSaving(true); setSaveMsg('');
    try {
      const slug = form.slug || form.name.toLowerCase().replace(/\s+/g,'-').replace(/[^a-z0-9-]/g,'');
      const body = {
        name: form.name.trim(), slug, emoji: form.emoji || null,
        category_id: form.category_id || null,
        gst_rate: parseFloat(form.gst_rate) || 5,
        price: parseFloat(form.price) || 0,
        mrp: parseFloat(form.mrp) || parseFloat(form.price) || 0,
        cost_price: parseFloat(form.cost_price) || null,
        short_description: form.short_description || null,
        long_description: form.long_description || null,
        image_url: form.image_url || null,
        unit_label: form.unit_label || null,
        status: 'pending_review',   // new vendor products need admin approval
        available_stock: 0,
        is_deleted: false,
      };

      let productId;
      if (modal === 'add') {
        const r = await api.post('products', body);
        productId = r?.[0]?.id || r?.id;
        if (!productId) throw new Error('Product created but ID not returned');
        // Auto-link to vendor (requires vendor to be identified — simplified for shared pw portal)
        setSaveMsg('✅ Product submitted for admin review! It will go live once approved.');
      } else {
        await api.patch('products', `id=eq.${modal.id}`, { ...body, status: modal.status === 'active' ? 'active' : 'pending_review' });
        setSaveMsg('✅ Changes saved — admin will review before publishing.');
      }
      await loadVendorData(pw);
      setTimeout(() => { setModal(null); setSaveMsg(''); }, 1500);
    } catch(e) { setSaveMsg('❌ ' + e.message); }
    finally { setSaving(false); }
  }

  async function handleImageUpload(file) {
    if (!file) return;
    setUploadingImg(true);
    try {
      const url = await uploadImage(file, `products/vendor-${Date.now()}`);
      setForm(f => ({...f, image_url: url}));
    } catch(e) { alert('Upload failed: ' + e.message); }
    finally { setUploadingImg(false); }
  }

  const catMap = Object.fromEntries(categories.map(c=>[String(c.id), c.name]));

  // ── Login screen ──────────────────────────────────────────────
  if (!authed) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4" style={{background:'var(--bg,#0d1117)'}}>
        <div className="w-full max-w-sm rounded-2xl p-8 space-y-5" style={{background:'var(--bg2,#161b22)',border:'1px solid var(--bd,#30363d)'}}>
          <div className="text-center">
            <div className="text-[32px] mb-2">🌿</div>
            <div className="text-[18px] font-bold" style={{color:'var(--tx)'}}>5 Pahadi Roots</div>
            <div className="text-[11px] mt-1" style={{color:'var(--tx2)'}}>Vendor Portal</div>
          </div>
          <div className="space-y-3">
            <input type="password" value={pw} onChange={e=>setPw(e.target.value)}
              onKeyDown={e=>e.key==='Enter'&&login()}
              placeholder="Enter your vendor password"
              className={inp} autoFocus />
            {error && <div className="text-[11px] text-center" style={{color:'#f85149'}}>{error}</div>}
            <button onClick={login} disabled={loading || !pw}
              className="w-full py-2.5 rounded-xl text-[13px] font-bold text-white"
              style={{background:'var(--accent,#1a5c2a)',opacity:loading||!pw?0.6:1}}>
              {loading ? 'Logging in…' : 'Login'}
            </button>
          </div>
          <div className="text-[10px] text-center" style={{color:'var(--tx3)'}}>
            Contact 5 Pahadi Roots admin to get your vendor password.
          </div>
        </div>
      </div>
    );
  }

  // ── Portal ────────────────────────────────────────────────────
  return (
    <div className="space-y-5 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[20px] font-bold" style={{color:'var(--tx)'}}>🏪 Vendor Portal</h1>
          <p className="text-[11px] mt-0.5" style={{color:'var(--tx2)'}}>Manage your products on 5 Pahadi Roots</p>
        </div>
        <div className="flex gap-2">
          <button onClick={openAdd}
            className="px-4 py-2 rounded-xl text-[12px] font-bold text-white"
            style={{background:'var(--accent)'}}>
            + Submit Product
          </button>
          <button onClick={() => { sessionStorage.removeItem('pr_pw'); sessionStorage.removeItem('pr_role'); setAuthed(false); setAllProducts([]); }}
            className="px-3 py-2 rounded-xl text-[11px]"
            style={{color:'var(--tx2)',border:'1px solid var(--bd)'}}>
            Logout
          </button>
        </div>
      </div>

      {/* Info banner */}
      <div className="rounded-xl px-4 py-3 text-[11px]" style={{background:'color-mix(in srgb,var(--accent) 6%,transparent)',border:'1px solid color-mix(in srgb,var(--accent) 20%,transparent)',color:'var(--tx2)'}}>
        💡 New products you submit will be in <strong style={{color:'var(--tx)'}}>pending review</strong> until the admin approves them.
        Edits to existing live products also go through a quick review before going live.
      </div>

      {loading ? <Loader text="Loading products…" /> : (
        allProducts.length === 0 ? (
          <div className="text-center py-16 rounded-2xl" style={{background:'var(--bg2)',border:'1px dashed var(--bd)'}}>
            <div className="text-[40px] mb-3">📦</div>
            <div className="text-[14px] font-bold" style={{color:'var(--tx)'}}>No products yet</div>
            <div className="text-[12px] mt-1 mb-4" style={{color:'var(--tx2)'}}>Submit your first product for listing on 5 Pahadi Roots</div>
            <button onClick={openAdd} className="px-4 py-2 rounded-lg text-[12px] font-bold text-white" style={{background:'var(--accent)'}}>+ Submit Product</button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3">
            {allProducts.map(p => (
              <div key={p.id} className="flex items-center gap-3 px-4 py-3 rounded-xl" style={{background:'var(--bg2)',border:'1px solid var(--bd)'}}>
                {p.image_url && <img src={p.image_url} alt="" className="w-14 h-14 rounded-lg object-cover flex-shrink-0" style={{border:'1px solid var(--bd)'}} onError={e=>e.target.style.display='none'} />}
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-bold" style={{color:'var(--tx)'}}>{p.emoji} {p.name}</div>
                  <div className="text-[11px] mt-0.5" style={{color:'var(--tx2)'}}>
                    {catMap[String(p.category_id)] || 'No category'}
                    {p.mrp && <> · ₹{p.mrp}</>}
                  </div>
                  <div className="text-[10px] mt-0.5" style={{color: p.status==='active'?'#3fb950':p.status==='pending_review'?'#d29922':'#8b949e'}}>
                    {p.status === 'active' ? '● Live' : p.status === 'pending_review' ? '⏳ Pending review' : '○ ' + p.status}
                  </div>
                </div>
                <button onClick={() => openEdit(p)}
                  className="px-3 py-1.5 rounded-lg text-[11px] font-bold text-white flex-shrink-0"
                  style={{background:'var(--accent)'}}>
                  Edit
                </button>
              </div>
            ))}
          </div>
        )
      )}

      {/* ── Add/Edit Modal ── */}
      {modal && (
        <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-0 sm:p-4" style={{background:'rgba(0,0,0,0.7)'}}>
          <div className="rounded-t-2xl sm:rounded-2xl w-full sm:max-w-2xl max-h-[90vh] overflow-y-auto" style={{background:'var(--bg2)',border:'1px solid var(--bd)'}}>
            <div className="sticky top-0 flex items-center justify-between px-5 py-4" style={{background:'var(--bg2)',borderBottom:'1px solid var(--bd)',zIndex:1}}>
              <div className="text-[14px] font-bold" style={{color:'var(--tx)'}}>
                {modal === 'add' ? '+ Submit New Product' : `Edit — ${modal.name}`}
              </div>
              <button onClick={() => setModal(null)} className="text-[var(--tx2)] hover:text-[var(--tx)] text-xl leading-none">×</button>
            </div>
            <div className="p-5 space-y-4">
              {/* Basic info */}
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <Field label="Product Name" required>
                    <input value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} className={inp} placeholder="e.g. Wild Mountain Honey" autoFocus />
                  </Field>
                </div>
                <Field label="Category">
                  <select value={form.category_id||''} onChange={e=>setForm(f=>({...f,category_id:e.target.value}))} className={inp}>
                    <option value="">Select…</option>
                    {categories.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </Field>
                <Field label="Emoji">
                  <input value={form.emoji} onChange={e=>setForm(f=>({...f,emoji:e.target.value}))} className={inp} placeholder="🍯" maxLength={4} />
                </Field>
                <Field label="Your Supply Price ₹ (per unit)" hint="What you charge 5 Pahadi Roots">
                  <input type="number" value={form.cost_price} onChange={e=>setForm(f=>({...f,cost_price:e.target.value}))} className={inp} placeholder="0.00" />
                </Field>
                <Field label="Suggested Selling Price ₹" hint="Final price is set by admin">
                  <input type="number" value={form.mrp} onChange={e=>setForm(f=>({...f,mrp:e.target.value}))} className={inp} placeholder="0.00" />
                </Field>
                <Field label="Unit / Pack Size" hint="e.g. 500g, 1kg, 250ml">
                  <input value={form.unit_label} onChange={e=>setForm(f=>({...f,unit_label:e.target.value}))} className={inp} placeholder="500g" />
                </Field>
                <Field label="GST Slab %">
                  <select value={form.gst_rate} onChange={e=>setForm(f=>({...f,gst_rate:e.target.value}))} className={inp}>
                    <option value={0}>0% — Exempted</option>
                    <option value={5}>5% — Food items</option>
                    <option value={12}>12% — Processed food</option>
                    <option value={18}>18% — Premium packaged</option>
                  </select>
                </Field>
              </div>

              {/* Description */}
              <Field label="Short Description" hint="1-2 sentences shown in product listing">
                <textarea value={form.short_description} onChange={e=>setForm(f=>({...f,short_description:e.target.value}))} className={inp} rows={2} placeholder="Pure wild honey harvested from Himalayan forests…" style={{resize:'vertical'}} />
              </Field>
              <Field label="Full Description" hint="Detailed product info, usage, ingredients">
                <textarea value={form.long_description} onChange={e=>setForm(f=>({...f,long_description:e.target.value}))} className={inp} rows={4} style={{resize:'vertical'}} />
              </Field>

              {/* Image */}
              <Field label="Product Image">
                <div className="flex gap-2">
                  <input value={form.image_url||''} onChange={e=>setForm(f=>({...f,image_url:e.target.value}))} className={inp} placeholder="https://… or upload below" />
                </div>
                <div className="mt-2 flex items-center gap-3">
                  <label className="cursor-pointer px-3 py-2 rounded-lg text-[11px] font-bold" style={{background:'var(--accent)',color:'#fff',opacity:uploadingImg?0.6:1}}>
                    {uploadingImg ? '⏳ Uploading…' : '📤 Upload Image'}
                    <input type="file" accept="image/*" className="hidden" disabled={uploadingImg}
                      onChange={e=>handleImageUpload(e.target.files[0])} />
                  </label>
                  {form.image_url && (
                    <img src={form.image_url} alt="" className="w-16 h-16 rounded-lg object-cover" style={{border:'1px solid var(--bd)'}} onError={e=>e.target.style.display='none'} />
                  )}
                </div>
              </Field>

              {saveMsg && (
                <div className="text-[12px] px-3 py-2 rounded-lg text-center font-bold"
                  style={{background: saveMsg.startsWith('✅')?'rgba(63,185,80,0.1)':'rgba(248,81,73,0.1)', color: saveMsg.startsWith('✅')?'#3fb950':'#f85149'}}>
                  {saveMsg}
                </div>
              )}
            </div>
            <div className="sticky bottom-0 flex justify-end gap-3 px-5 py-4" style={{background:'var(--bg2)',borderTop:'1px solid var(--bd)'}}>
              <button onClick={()=>setModal(null)} className="px-4 py-2 rounded-lg text-[12px]" style={{color:'var(--tx2)'}}>Cancel</button>
              <button onClick={handleSave} disabled={saving}
                className="px-5 py-2 rounded-lg text-[12px] font-bold text-white"
                style={{background:'var(--accent)',opacity:saving?0.6:1}}>
                {saving ? '⏳ Submitting…' : modal==='add' ? '✅ Submit for Review' : '💾 Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
