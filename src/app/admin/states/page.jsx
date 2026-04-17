'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '@/lib/api';
import { Loader, Card } from '@/components/ui/index';
import Modal from '@/components/ui/Modal';

// ── Image compress + upload (same logic as catalogue page) ────────
async function uploadToStorage(file, path) {
  const compressed = await new Promise(resolve => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const MAX = 1600;
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
  const fileName = `${path}-${Math.random().toString(36).slice(2,7)}.jpg`;
  const pw = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('pr_pw') : '';
  const res = await fetch('/api/admin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-password': pw || '' },
    body: JSON.stringify({ action: 'storage_upload', fileName, fileType: 'image/jpeg', fileBase64: base64 }),
  });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || 'Upload failed'); }
  return (await res.json()).url;
}

// ── Toast helper ──────────────────────────────────────────────────
function useToast() {
  const [toast, setToast] = useState(null);
  const show = useCallback((msg, type = 'ok') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  }, []);
  return { toast, show };
}

// ── State Image Previews (existing DB images) ─────────────────────
function StateImagePreviews({ stateId, fallbackImg, onDelete }) {
  const [rows, setRows] = useState(null);

  useEffect(() => {
    if (!stateId) { setRows([]); return; }
    api.get('state_images', `state_id=eq.${stateId}&order=sort_order.asc`)
      .then(r => setRows(r || []))
      .catch(() => setRows([]));
  }, [stateId]);

  if (!stateId) return (
    <div className="text-[11px] px-3 py-2 rounded-lg"
      style={{ color: '#d29922', background: 'rgba(210,153,34,0.1)', border: '1px solid rgba(210,153,34,0.2)' }}>
      ⚠️ Save state info first, then upload images.
    </div>
  );

  if (rows === null) return <div className="text-[11px]" style={{ color: 'var(--tx2)' }}>Loading images…</div>;

  const display = rows.length > 0 ? rows : (fallbackImg ? [{ id: 'fallback', image_url: fallbackImg }] : []);

  return (
    <div className="flex flex-wrap gap-2 min-h-[44px] p-2 rounded-lg"
      style={{ background: 'var(--bg)', border: '1px solid var(--bd)' }}>
      {display.length === 0 ? (
        <span className="text-[11px] self-center" style={{ color: 'var(--tx2)' }}>No images yet — upload below ↓</span>
      ) : display.map((r, i) => (
        <div key={r.id} style={{ position: 'relative', display: 'inline-block', flexShrink: 0 }}>
          <img src={r.image_url} alt=""
            style={{ width: i === 0 ? 110 : 60, height: i === 0 ? 120 : 60, objectFit: 'cover',
              borderRadius: i === 0 ? 8 : 6, border: `2px solid ${i === 0 ? '#d29922' : 'var(--bd)'}` }}
            onError={e => e.target.style.opacity = '0.3'} />
          <div style={{ position: 'absolute', top: 3, left: 3, background: 'rgba(0,0,0,0.75)', color: '#fff',
            fontSize: 8, fontWeight: 700, padding: '1px 4px', borderRadius: 3 }}>
            {i === 0 ? 'Main' : `#${i+1}`}
          </div>
          {r.id !== 'fallback' && (
            <button onClick={() => onDelete(r.id, stateId, () =>
              api.get('state_images', `state_id=eq.${stateId}&order=sort_order.asc`).then(rr => setRows(rr || []))
            )} style={{ position: 'absolute', top: 3, right: 3, background: 'rgba(220,50,50,0.9)',
              color: '#fff', border: 'none', borderRadius: 3, width: 17, height: 17, fontSize: 11,
              cursor: 'pointer', lineHeight: 1, padding: 0, fontWeight: 700 }}>×</button>
          )}
        </div>
      ))}
      <div className="self-center text-[9px] ml-1" style={{ color: 'var(--tx2)' }}>
        {rows.length > 0 ? `${rows.length} image${rows.length > 1 ? 's' : ''} · 1st = main, rest = slideshow` : ''}
      </div>
    </div>
  );
}

// ── State Edit Modal ──────────────────────────────────────────────
function StateModal({ state, onClose, onSaved, showToast }) {
  const isEdit = !!state?.id;
  const [id,       setId]       = useState(state?.id || '');
  const [name,     setName]     = useState(state?.name || '');
  const [slug,     setSlug]     = useState(state?.id || '');
  const [desc,     setDesc]     = useState(state?.description || '');
  const [active,   setActive]   = useState(state?.is_active !== false);
  const [saving,   setSaving]   = useState(false);
  const [saveMsg,  setSaveMsg]  = useState('');
  const [imgUrl,   setImgUrl]   = useState('');
  const [files,    setFiles]    = useState([]);
  const [previews, setPreviews] = useState([]);
  const [uploading,setUploading]= useState(false);
  const [upMsg,    setUpMsg]    = useState('');
  const fileRef = useRef();
  const savedId = id; // tracks id after first save

  async function save() {
    if (!name.trim()) { showToast('State name required', 'er'); return; }
    setSaving(true); setSaveMsg('');
    try {
      const body = { name: name.trim(), description: desc.trim() || null, is_active: active, updated_at: new Date().toISOString() };
      if (id) {
        await api.patch('states', `id=eq.${id}`, body);
        setSaveMsg('✅ Saved!');
      } else {
        const manualSlug = slug.trim().toLowerCase().replace(/[^a-z0-9]/g,'');
        const autoSlug   = name.toLowerCase().replace(/[^a-z]/g,'').slice(0,4) + '-' + Date.now().toString().slice(-4);
        const newId = manualSlug || autoSlug;
        await api.post('states', { ...body, id: newId });
        setId(newId);
        setSaveMsg('✅ State created! Now upload images below.');
      }
      showToast('State saved ✓', 'ok');
      onSaved();
    } catch(e) { setSaveMsg('❌ ' + e.message); showToast('Error: ' + e.message, 'er'); }
    setSaving(false);
  }

  function handleFiles(selected) {
    const arr = Array.from(selected);
    setFiles(arr);
    const ps = [];
    arr.forEach((f, i) => {
      const r = new FileReader();
      r.onload = e => { ps[i] = e.target.result; if (ps.filter(Boolean).length === arr.length) setPreviews([...ps]); };
      r.readAsDataURL(f);
    });
    if (!arr.length) setPreviews([]);
  }

  async function upload() {
    if (!id) { showToast('Save info first', 'er'); return; }
    if (!files.length) { showToast('Select at least one image', 'er'); return; }
    setUploading(true); setUpMsg('');
    try {
      const stateName = name.trim().toLowerCase().replace(/\s+/g,'-');
      const urls = [];
      for (let i = 0; i < files.length; i++) {
        setUpMsg(`⏳ Uploading ${i+1}/${files.length}…`);
        const url = await uploadToStorage(files[i], `states/${id}-${stateName}-${i}`);
        urls.push(url);
      }
      setUpMsg('⏳ Saving to DB…');
      const existing = await api.get('state_images', `state_id=eq.${id}&order=sort_order.desc&limit=1`).catch(() => []);
      let nextOrder = (existing?.[0]?.sort_order != null) ? existing[0].sort_order + 1 : 0;
      for (let i = 0; i < urls.length; i++) {
        await api.post('state_images', { state_id: id, image_url: urls[i], sort_order: nextOrder + i });
      }
      const first = await api.get('state_images', `state_id=eq.${id}&order=sort_order.asc&limit=1`).catch(() => []);
      if (first?.[0]?.image_url) await api.patch('states', `id=eq.${id}`, { image_path: first[0].image_url }).catch(() => {});
      const all = await api.get('state_images', `state_id=eq.${id}&select=id`).catch(() => []);
      setUpMsg(`✅ ${urls.length} image(s) added! Total: ${all.length}`);
      setFiles([]); setPreviews([]); if (fileRef.current) fileRef.current.value = '';
      showToast(`Added ${urls.length} image(s) ✓`, 'ok');
      onSaved();
    } catch(e) { setUpMsg('❌ ' + e.message); showToast('Upload failed: ' + e.message, 'er'); }
    setUploading(false);
  }

  async function addUrl() {
    if (!id) { showToast('Save info first', 'er'); return; }
    if (!imgUrl.startsWith('http')) { showToast('Enter a valid URL', 'er'); return; }
    try {
      const existing = await api.get('state_images', `state_id=eq.${id}&order=sort_order.desc&limit=1`).catch(() => []);
      const nextOrder = (existing?.[0]?.sort_order != null) ? existing[0].sort_order + 1 : 0;
      await api.post('state_images', { state_id: id, image_url: imgUrl, sort_order: nextOrder });
      if (nextOrder === 0) await api.patch('states', `id=eq.${id}`, { image_path: imgUrl }).catch(() => {});
      setImgUrl('');
      showToast('Image URL added ✓', 'ok');
      onSaved();
    } catch(e) { showToast('Error: ' + e.message, 'er'); }
  }

  async function deleteImg(rowId, stateId, refresh) {
    try {
      await api.delete('state_images', `id=eq.${rowId}`);
      const rows = await api.get('state_images', `state_id=eq.${stateId}&order=sort_order.asc&limit=1`).catch(() => []);
      if (rows?.[0]?.image_url) await api.patch('states', `id=eq.${stateId}`, { image_path: rows[0].image_url }).catch(() => {});
      else await api.patch('states', `id=eq.${stateId}`, { image_path: null }).catch(() => {});
      showToast('Image removed ✓', 'ok');
      refresh();
      onSaved();
    } catch(e) { showToast('Delete failed: ' + e.message, 'er'); }
  }

  const inp = 'w-full rounded-lg px-3 py-2 text-[12px] outline-none';
  const inpStyle = { background: 'var(--bg)', border: '1px solid var(--bd)', color: 'var(--tx)' };

  return (
    <Modal title={isEdit ? `Edit — ${state.name}` : '+ Add State'} onClose={onClose} width="520px">
      <div className="space-y-4 px-1">
        <input type="hidden" value={id} readOnly />

        {/* Info fields */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="text-[10px] font-bold mb-1" style={{ color: 'var(--tx2)' }}>STATE NAME *</div>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Manipur"
              className={inp} style={inpStyle} />
          </div>
          <div>
            <div className="text-[10px] font-bold mb-1" style={{ color: 'var(--tx2)' }}>
              STATE ID <span className="font-normal" style={{ color: 'var(--tx2)' }}>(e.g. mn, hp)</span>
            </div>
            <input value={slug} onChange={e => setSlug(e.target.value)} placeholder="e.g. mn"
              maxLength={10} disabled={isEdit || !!id}
              className={inp} style={{ ...inpStyle, opacity: (isEdit || !!id) ? 0.5 : 1 }} />
            {!(isEdit || id) && <div className="text-[9.5px] mt-0.5" style={{ color: 'var(--tx2)' }}>Cannot change after save.</div>}
          </div>
        </div>

        <div>
          <div className="text-[10px] font-bold mb-1" style={{ color: 'var(--tx2)' }}>DESCRIPTION</div>
          <textarea value={desc} onChange={e => setDesc(e.target.value)} rows={2}
            placeholder="Brief description about this region…"
            className={`${inp} resize-none`} style={inpStyle} />
        </div>

        <div className="flex items-center justify-between">
          <label className="flex items-center gap-2 text-[13px] font-semibold cursor-pointer" style={{ color: 'var(--tx)' }}>
            <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)}
              className="w-4 h-4" />
            Active (visible on site)
          </label>
          <button onClick={save} disabled={saving}
            className="px-4 py-2 rounded-lg text-[12px] font-bold text-white transition"
            style={{ background: 'var(--accent)', opacity: saving ? 0.6 : 1 }}>
            {saving ? 'Saving…' : '💾 Save Info'}
          </button>
        </div>
        {saveMsg && (
          <div className="text-[11px]" style={{ color: saveMsg.startsWith('✅') ? '#3fb950' : '#f85149' }}>{saveMsg}</div>
        )}

        <hr style={{ border: 'none', borderTop: '1px solid var(--bd)' }} />

        {/* Images */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--tx2)' }}>State Images</div>
            <div className="text-[10px]" style={{ color: 'var(--tx2)' }}>1st = main · rest = slideshow every 2.5s</div>
          </div>

          <StateImagePreviews stateId={id} fallbackImg={state?.image_path} onDelete={deleteImg} />

          {/* Upload */}
          <div className="rounded-lg p-3 space-y-2" style={{ background: 'var(--bg)', border: '1px dashed var(--bd)' }}>
            <div className="text-[10.5px] font-bold" style={{ color: 'var(--tx2)' }}>➕ ADD MORE IMAGES</div>
            {previews.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {previews.map((src, i) => (
                  <div key={i} style={{ position: 'relative' }}>
                    <img src={src} style={{ width: 54, height: 54, objectFit: 'cover', borderRadius: 6,
                      border: '2px solid rgba(210,153,34,0.6)' }} />
                    <div style={{ position: 'absolute', top: 2, left: 2, background: 'rgba(180,100,0,0.9)',
                      color: '#fff', fontSize: 8, fontWeight: 700, padding: '1px 3px', borderRadius: 3 }}>
                      +{i+1}
                    </div>
                  </div>
                ))}
              </div>
            )}
            <input ref={fileRef} type="file" accept="image/*" multiple
              onChange={e => handleFiles(e.target.files)}
              className="w-full text-[11px]" style={{ color: 'var(--tx2)' }} />
            <button onClick={upload} disabled={uploading || !id}
              className="w-full py-2 rounded-lg text-[12px] font-bold text-white transition flex items-center justify-center gap-2"
              style={{ background: 'var(--accent)', opacity: (uploading || !id) ? 0.5 : 1 }}>
              {uploading ? '⏳ Uploading…' : '📤 Upload & Add to Slideshow'}
            </button>
            {upMsg && (
              <div className="text-[11px]" style={{ color: upMsg.startsWith('✅') ? '#3fb950' : upMsg.startsWith('⏳') ? 'var(--tx2)' : '#f85149' }}>
                {upMsg}
              </div>
            )}
          </div>

          {/* Or paste URL */}
          <div>
            <div className="text-[10px] font-bold mb-1" style={{ color: 'var(--tx2)' }}>OR PASTE IMAGE URL</div>
            <div className="flex gap-2">
              <input value={imgUrl} onChange={e => setImgUrl(e.target.value)}
                placeholder="https://..." className={`${inp} flex-1`} style={inpStyle} />
              <button onClick={addUrl} disabled={!id}
                className="px-3 py-2 rounded-lg text-[12px] font-semibold transition"
                style={{ color: 'var(--accent)', border: '1px solid color-mix(in srgb, var(--accent) 35%, transparent)',
                  background: 'color-mix(in srgb, var(--accent) 8%, transparent)', opacity: !id ? 0.4 : 1 }}>
                + Add URL
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="flex justify-end pt-3 mt-3" style={{ borderTop: '1px solid var(--bd)' }}>
        <button onClick={onClose} className="px-4 py-2 rounded-lg text-[12px]"
          style={{ color: 'var(--tx2)', border: '1px solid var(--bd)' }}>
          Close
        </button>
      </div>
    </Modal>
  );
}

// ── Main States Page ──────────────────────────────────────────────
export default function StatesPage() {
  const [states,  setStates]  = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal,   setModal]   = useState(null); // null | 'add' | stateObj
  const { toast, show: showToast } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try { setStates(await api.get('states', 'order=name.asc') || []); }
    catch {}
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function deleteState(id, name) {
    if (!confirm(`Delete "${name}"? This will also remove all its images.`)) return;
    try {
      await api.delete('state_images', `state_id=eq.${id}`).catch(() => {});
      await api.delete('states', `id=eq.${id}`);
      showToast('State deleted ✓', 'ok');
      load();
    } catch(e) { showToast('Delete failed: ' + e.message, 'er'); }
  }

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-[20px] font-bold" style={{ color: 'var(--tx)' }}>🗺️ States Management</h1>
          <p className="text-[12px] mt-1" style={{ color: 'var(--tx2)' }}>
            Manage Himalayan state images shown on the homepage regional section.
          </p>
        </div>
        <button onClick={() => setModal('add')}
          className="px-4 py-2 rounded-lg text-[12px] font-bold text-white flex items-center gap-2"
          style={{ background: 'var(--accent)' }}>
          + Add State
        </button>
      </div>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 px-4 py-3 rounded-xl text-[13px] font-semibold shadow-xl z-50 transition-all"
          style={{
            background: toast.type === 'ok' ? 'rgba(63,185,80,0.95)' : 'rgba(248,81,73,0.95)',
            color: '#fff',
          }}>
          {toast.msg}
        </div>
      )}

      {/* Grid */}
      {loading ? <Loader text="Loading states…" /> : (
        states.length === 0 ? (
          <div className="text-center py-16 text-[13px]" style={{ color: 'var(--tx2)' }}>
            No states yet. Click "+ Add State" to begin.
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 16 }}>
            {states.map(s => (
              <div key={s.id} className="rounded-xl overflow-hidden"
                style={{ background: 'var(--bg2)', border: '1px solid var(--bd)' }}>

                {/* Image */}
                <div style={{ position: 'relative', height: 150, background: 'var(--bg)' }}>
                  {s.image_path
                    ? <img src={s.image_path} alt={s.name}
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        onError={e => e.target.style.display='none'} />
                    : <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 48 }}>🏔️</div>
                  }
                  <span className="absolute top-2 right-2 text-[10px] font-bold px-2 py-0.5 rounded-full"
                    style={s.is_active
                      ? { background: 'rgba(63,185,80,0.9)', color: '#fff' }
                      : { background: 'rgba(110,118,129,0.9)', color: '#fff' }}>
                    {s.is_active ? 'Active' : 'Inactive'}
                  </span>
                </div>

                {/* Info */}
                <div className="p-3 space-y-2">
                  <div className="text-[14px] font-bold" style={{ color: 'var(--tx)' }}>{s.name}</div>
                  {s.description && (
                    <div className="text-[11px] line-clamp-2" style={{ color: 'var(--tx2)' }}>{s.description}</div>
                  )}
                  <div className="flex gap-2 pt-1">
                    <button onClick={() => setModal(s)}
                      className="flex-1 py-1.5 rounded-lg text-[11px] font-semibold transition"
                      style={{ color: 'var(--accent)', border: '1px solid color-mix(in srgb, var(--accent) 35%, transparent)',
                        background: 'color-mix(in srgb, var(--accent) 8%, transparent)' }}>
                      ✏️ Edit
                    </button>
                    <button onClick={() => deleteState(s.id, s.name)}
                      className="px-3 py-1.5 rounded-lg text-[11px] font-semibold transition"
                      style={{ color: '#f85149', border: '1px solid rgba(248,81,73,0.3)', background: 'rgba(248,81,73,0.08)' }}>
                      🗑️
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {/* Modal */}
      {modal && (
        <StateModal
          state={modal === 'add' ? null : modal}
          onClose={() => setModal(null)}
          onSaved={load}
          showToast={showToast}
        />
      )}
    </div>
  );
}
