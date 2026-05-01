'use client';
import { useState, useEffect } from 'react';
import { api, fmtCurrency } from '@/lib/api';
import { Card, Loader, ErrorMsg, Badge } from '@/components/ui/index';
import Modal from '@/components/ui/Modal';

export default function CouponsPage() {
  const [coupons,  setCoupons]  = useState([]);
  const [usage,    setUsage]    = useState({});
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState(null);
  const [modal,    setModal]    = useState(false);
  const [editing,  setEditing]  = useState(null);
  const [saving,   setSaving]   = useState(false);
  const [form,     setForm]     = useState({ code:'', type:'flat', value:'', min_order:'', max_uses:'', expires_at:'', is_active:true });

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true); setError(null);
    try {
      const [c, u] = await Promise.all([
        api.get('coupons', 'select=id,code,type,value,min_order,uses_count,max_uses,expires_at,is_active&order=created_at.desc'),
        api.get('coupon_usage', 'select=coupon_id,discount_amount').catch(() => []),
      ]);
      setCoupons(c || []);
      const umap = {};
      (u || []).forEach(x => {
        if (!umap[x.coupon_id]) umap[x.coupon_id] = { count: 0, total: 0 };
        umap[x.coupon_id].count++;
        umap[x.coupon_id].total += parseFloat(x.discount_amount) || 0;
      });
      setUsage(umap);
    } catch(e) { setError(e.message); }
    finally { setLoading(false); }
  }

  function openNew() {
    setEditing(null);
    setForm({ code:'', type:'flat', value:'', min_order:'', max_uses:'', expires_at:'', is_active:true });
    setModal(true);
  }

  function openEdit(c) {
    setEditing(c);
    setForm({
      code: c.code, type: c.type||'flat', value: c.value||'',
      min_order: c.min_order||'', max_uses: c.max_uses||'',
      expires_at: c.expires_at ? c.expires_at.split('T')[0] : '',
      is_active: !!c.is_active,
    });
    setModal(true);
  }

  async function save() {
    if (!form.code.trim()) { alert('Coupon code required'); return; }
    setSaving(true);
    try {
      const body = {
        code: form.code.trim().toUpperCase(),
        type: form.type,
        value: parseFloat(form.value) || 0,
        min_order: parseFloat(form.min_order) || 0,
        max_uses: parseInt(form.max_uses) || null,
        expires_at: form.expires_at || null,
        is_active: form.is_active,
      };
      if (editing) {
        await api.patch('coupons', `id=eq.${editing.id}`, body);
      } else {
        await api.post('coupons', body);
      }
      setModal(false);
      await load();
    } catch(e) { alert('Error: ' + e.message); }
    finally { setSaving(false); }
  }

  async function deleteCoupon(id, code) {
    if (!confirm(`Delete coupon "${code}"?`)) return;
    try {
      await api.delete('coupons', `id=eq.${id}`);
      await load();
    } catch(e) { alert('Error: ' + e.message); }
  }

  async function toggleActive(c) {
    try {
      await api.patch('coupons', `id=eq.${c.id}`, { is_active: !c.is_active });
      await load();
    } catch(e) { alert('Error: ' + e.message); }
  }

  const totalDiscount = Object.values(usage).reduce((s,u) => s + u.total, 0);
  const totalUses     = Object.values(usage).reduce((s,u) => s + u.count, 0);

  return (
    <div className="space-y-4">
      {/* Add/Edit Modal */}
      {modal && (
        <Modal title={editing ? `Edit Coupon — ${editing.code}` : 'Add New Coupon'} onClose={() => setModal(false)} width="480px">
          <div className="space-y-3">
            <div>
              <label className="text-[10.5px] font-bold text-[var(--tx3)] uppercase block mb-1.5">Coupon Code *</label>
              <input value={form.code} onChange={e=>setForm(f=>({...f,code:e.target.value.toUpperCase()}))}
                placeholder="e.g. SAVE50" className="w-full bg-[var(--input-bg)] border border-[var(--bd)] rounded-lg px-3 py-2 text-[13px] text-[var(--tx)] font-mono focus:outline-none focus:border-[var(--accent)]" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10.5px] font-bold text-[var(--tx3)] uppercase block mb-1.5">Type</label>
                <select value={form.type} onChange={e=>setForm(f=>({...f,type:e.target.value}))}
                  className="w-full bg-[var(--input-bg)] border border-[var(--bd)] rounded-lg px-3 py-2 text-[12px] text-[var(--tx)] focus:outline-none">
                  <option value="flat">Flat (₹)</option>
                  <option value="percent">Percent (%)</option>
                </select>
              </div>
              <div>
                <label className="text-[10.5px] font-bold text-[var(--tx3)] uppercase block mb-1.5">
                  Value {form.type === 'percent' ? '(%)' : '(₹)'}
                </label>
                <input type="number" value={form.value} onChange={e=>setForm(f=>({...f,value:e.target.value}))}
                  placeholder={form.type==='percent'?'e.g. 10':'e.g. 50'}
                  className="w-full bg-[var(--input-bg)] border border-[var(--bd)] rounded-lg px-3 py-2 text-[12px] text-[var(--tx)] focus:outline-none focus:border-[var(--accent)]" />
              </div>
              <div>
                <label className="text-[10.5px] font-bold text-[var(--tx3)] uppercase block mb-1.5">Min Order (₹)</label>
                <input type="number" value={form.min_order} onChange={e=>setForm(f=>({...f,min_order:e.target.value}))}
                  placeholder="e.g. 500"
                  className="w-full bg-[var(--input-bg)] border border-[var(--bd)] rounded-lg px-3 py-2 text-[12px] text-[var(--tx)] focus:outline-none focus:border-[var(--accent)]" />
              </div>
              <div>
                <label className="text-[10.5px] font-bold text-[var(--tx3)] uppercase block mb-1.5">Max Uses</label>
                <input type="number" value={form.max_uses} onChange={e=>setForm(f=>({...f,max_uses:e.target.value}))}
                  placeholder="Leave blank = unlimited"
                  className="w-full bg-[var(--input-bg)] border border-[var(--bd)] rounded-lg px-3 py-2 text-[12px] text-[var(--tx)] focus:outline-none focus:border-[var(--accent)]" />
              </div>
              <div className="col-span-2">
                <label className="text-[10.5px] font-bold text-[var(--tx3)] uppercase block mb-1.5">Expires At</label>
                <input type="date" value={form.expires_at} onChange={e=>setForm(f=>({...f,expires_at:e.target.value}))}
                  className="w-full bg-[var(--input-bg)] border border-[var(--bd)] rounded-lg px-3 py-2 text-[12px] text-[var(--tx)] focus:outline-none focus:border-[var(--accent)]" />
              </div>
            </div>
            <label className="flex items-center gap-3 cursor-pointer">
              <div onClick={()=>setForm(f=>({...f,is_active:!f.is_active}))}
                className={`w-10 h-5 rounded-full transition-colors relative ${form.is_active?'bg-[var(--accent)]':'bg-[#30363d]'}`}>
                <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${form.is_active?'translate-x-5':'translate-x-0.5'}`} />
              </div>
              <span className="text-[12px] text-[var(--tx)]">Active</span>
            </label>
            <button onClick={save} disabled={saving}
              className="w-full bg-[var(--accent)] hover:bg-[var(--accent)] text-[var(--tx)] text-[13px] font-bold py-2.5 rounded-lg transition disabled:opacity-50">
              {saving ? 'Saving…' : editing ? '💾 Update Coupon' : '+ Add Coupon'}
            </button>
          </div>
        </Modal>
      )}

      {/* Header Stats */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl p-4" style={{background:"var(--bg2,#161b22)",border:"1px solid var(--bd,#30363d)"}}>
          <div className="text-[10.5px] font-bold text-[var(--tx3)] uppercase mb-1">Total Coupons</div>
          <div className="text-2xl font-bold text-[var(--tx)]">{coupons.length}</div>
          <div className="text-[11px] text-[#3fb950] mt-1">{coupons.filter(c=>c.is_active).length} active</div>
        </div>
        <div className="rounded-xl p-4" style={{background:"var(--bg2,#161b22)",border:"1px solid var(--bd,#30363d)"}}>
          <div className="text-[10.5px] font-bold text-[var(--tx3)] uppercase mb-1">Total Uses</div>
          <div className="text-2xl font-bold text-[var(--tx)]">{totalUses}</div>
          <div className="text-[11px] text-[var(--tx3)] mt-1">all time</div>
        </div>
        <div className="rounded-xl p-4" style={{background:"var(--bg2,#161b22)",border:"1px solid var(--bd,#30363d)"}}>
          <div className="text-[10.5px] font-bold text-[var(--tx3)] uppercase mb-1">Total Discount Given</div>
          <div className="text-2xl font-bold text-[#f85149]">{fmtCurrency(totalDiscount)}</div>
          <div className="text-[11px] text-[var(--tx3)] mt-1">all time</div>
        </div>
      </div>

      {/* Table */}
      <Card title="All Coupons" action={
        <button onClick={openNew} className="px-3 py-1.5 bg-[var(--accent)] hover:bg-[var(--accent)] text-[var(--tx)] text-[11px] font-bold rounded-lg transition">
          + Add Coupon
        </button>
      }>
        {loading ? <Loader text="Loading coupons…" /> : error ? <ErrorMsg error={error} onRetry={load} /> : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr>
                {['Code','Type','Value','Min Order','Uses','Discount Given','Expires','Status','Actions'].map(h => (
                  <th key={h} className="text-left text-[10px] font-bold uppercase tracking-wider pb-3 pr-3" style={{color:"var(--tx2,#6e7681)"}}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {coupons.map(c => {
                  const u = usage[c.id] || { count:0, total:0 };
                  const expired = c.expires_at && new Date(c.expires_at) < new Date();
                  return (
                    <tr key={c.id} className="border-t border-[var(--bd)]/50 hover:bg-[var(--input-bg)]/20">
                      <td className="py-2.5 pr-3 text-[13px] text-[var(--blue)] font-mono font-bold">{c.code}</td>
                      <td className="py-2.5 pr-3"><Badge type={c.type==='percent'?'purple':'blue'}>{c.type}</Badge></td>
                      <td className="py-2.5 pr-3 text-[12px] text-[var(--tx)] font-bold">{c.type==='percent'?c.value+'%':'₹'+c.value}</td>
                      <td className="py-2.5 pr-3 text-[12px] text-[var(--tx3)]">{c.min_order?'₹'+c.min_order:'—'}</td>
                      <td className="py-2.5 pr-3 text-[12px] text-[var(--tx)]">{u.count}{c.max_uses?'/'+c.max_uses:''}</td>
                      <td className="py-2.5 pr-3 text-[12px] text-[#f85149] font-bold">{u.total>0?fmtCurrency(u.total):'—'}</td>
                      <td className="py-2.5 pr-3 text-[11px]" style={{color:expired?'#f85149':'var(--tx3,#6e7681)'}}>
                        {c.expires_at ? new Date(c.expires_at).toLocaleDateString('en-IN') : 'Never'}
                        {expired && <span className="ml-1 text-[9px]">(expired)</span>}
                      </td>
                      <td className="py-2.5 pr-3">
                        <button onClick={() => toggleActive(c)}
                          className={`text-[10px] font-bold px-2 py-0.5 rounded-full border transition ${c.is_active?'border-[#3fb950] text-[#3fb950] hover:bg-[#3fb950]/10':'border-[#f85149] text-[#f85149] hover:bg-[#f85149]/10'}`}>
                          {c.is_active ? '● Active' : '○ Off'}
                        </button>
                      </td>
                      <td className="py-2.5">
                        <div className="flex gap-1">
                          <button onClick={() => openEdit(c)} className="px-2 py-1 bg-[var(--input-bg)] hover:bg-[var(--bd)] border border-[var(--bd)] rounded text-[10px] text-[var(--tx)] transition">Edit</button>
                          <button onClick={() => deleteCoupon(c.id, c.code)} className="px-2 py-1 bg-red-950/30 hover:bg-red-950/50 border border-red-900/40 rounded text-[10px] text-[#f85149] transition">Del</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {coupons.length === 0 && !loading && (
                  <tr><td colSpan={9} className="py-8 text-center text-[var(--tx3)]">No coupons yet. Add your first coupon!</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
