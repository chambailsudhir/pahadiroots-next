'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '@/lib/api';
import { Loader } from '@/components/ui/index';

async function uploadToSupabase(file, folder = 'media') {
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
      canvas.toBlob(b => resolve(b), 'image/jpeg', 0.88);
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
  const fileName = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2,7)}.jpg`;
  const pw = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('pr_pw') : '';
  const res = await fetch('/api/admin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-password': pw || '' },
    body: JSON.stringify({ action: 'storage_upload', fileName, fileType: 'image/jpeg', fileBase64: base64 }),
  });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || 'Upload failed'); }
  return (await res.json()).url;
}

async function loadAllSettings() {
  const rows = await api.get('site_settings', 'select=key,value').catch(() => []);
  return Object.fromEntries((rows || []).map(r => [r.key, r.value]));
}
async function saveSetting(key, value) {
  const ex = await api.get('site_settings', `key=eq.${encodeURIComponent(key)}&limit=1`).catch(() => []);
  if (ex?.length) await api.patch('site_settings', `key=eq.${encodeURIComponent(key)}`, { value });
  else            await api.post('site_settings', { key, value });
}
async function saveMany(pairs) { for (const [k, v] of pairs) await saveSetting(k, v); }

function ImageUploader({ value, onChange, folder }) {
  const [uploading, setUploading] = useState(false);
  const [err, setErr]             = useState('');
  const [dragOver, setDragOver]   = useState(false);
  const inputRef = useRef();

  async function handleFile(file) {
    if (!file?.type.startsWith('image/')) { setErr('Please select an image file'); return; }
    if (file.size > 15 * 1024 * 1024) { setErr('File too large — max 15MB'); return; }
    setErr(''); setUploading(true);
    try { onChange(await uploadToSupabase(file, folder)); }
    catch (e) { setErr('Upload failed: ' + e.message); }
    setUploading(false);
  }

  return (
    <div className="space-y-1.5">
      <div onClick={() => !uploading && inputRef.current?.click()}
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={e => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files[0]); }}
        className="rounded-xl cursor-pointer transition-all"
        style={{ border: `2px dashed ${dragOver ? 'var(--accent)' : 'var(--bd)'}`,
          background: dragOver ? 'color-mix(in srgb, var(--accent) 6%, transparent)' : 'var(--bg)',
          padding: value ? '8px' : '12px' }}>
        <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={e => handleFile(e.target.files[0])} />
        {uploading ? (
          <div className="flex items-center justify-center gap-2 py-1">
            <div className="w-4 h-4 border-2 rounded-full animate-spin" style={{ borderColor: 'var(--bd)', borderTopColor: 'var(--accent)' }} />
            <span className="text-[11px]" style={{ color: 'var(--tx2)' }}>Uploading…</span>
          </div>
        ) : value ? (
          <div className="flex items-center gap-3">
            <img src={value} alt="" className="rounded-lg object-cover flex-shrink-0"
              style={{ width: 56, height: 56, border: '1px solid var(--bd)' }}
              onError={e => e.target.style.opacity='0.3'} />
            <div className="flex-1 min-w-0">
              <div className="text-[11px] font-semibold" style={{ color: '#3fb950' }}>✓ Image set</div>
              <div className="text-[10px] mt-0.5 truncate font-mono" style={{ color: 'var(--tx2)' }}>{value.split('/').pop()}</div>
              <div className="flex gap-2 mt-1">
                <button onClick={e => { e.stopPropagation(); inputRef.current?.click(); }}
                  className="text-[10px] px-2 py-0.5 rounded"
                  style={{ color: 'var(--accent)', border: '1px solid color-mix(in srgb, var(--accent) 35%, transparent)', background: 'color-mix(in srgb, var(--accent) 8%, transparent)' }}>
                  🔄 Replace
                </button>
                <button onClick={e => { e.stopPropagation(); onChange(''); }}
                  className="text-[10px] px-2 py-0.5 rounded"
                  style={{ color: '#f85149', border: '1px solid rgba(248,81,73,0.3)', background: 'rgba(248,81,73,0.08)' }}>
                  ✕ Remove
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-1 text-center">
            <div className="text-lg">📁</div>
            <div className="text-[11px] font-semibold" style={{ color: 'var(--tx)' }}>Click or drag & drop</div>
            <div className="text-[10px]" style={{ color: 'var(--tx2)' }}>Square photo works best</div>
          </div>
        )}
      </div>
      <input value={value} onChange={e => onChange(e.target.value)} placeholder="or paste image URL…"
        className="w-full rounded-lg px-3 py-1.5 text-[11px] outline-none"
        style={{ background: 'var(--bg)', border: '1px solid var(--bd)', color: 'var(--tx)', fontFamily: 'monospace' }} />
      {err && <div className="text-[10px] px-2 py-1 rounded" style={{ color: '#f85149', background: 'rgba(248,81,73,0.08)' }}>⚠️ {err}</div>}
    </div>
  );
}

function SaveBtn({ onClick, saving, saved, label = 'Save' }) {
  return (
    <button onClick={onClick} disabled={saving}
      className="px-5 py-2.5 rounded-lg text-[12px] font-bold transition"
      style={{ background: saved ? 'rgba(63,185,80,0.15)' : 'color-mix(in srgb, var(--accent) 18%, transparent)',
        color: saved ? '#3fb950' : 'var(--accent)',
        border: `1px solid ${saved ? '#3fb950' : 'color-mix(in srgb, var(--accent) 35%, transparent)'}`,
        opacity: saving ? 0.6 : 1 }}>
      {saving ? '⏳ Saving…' : saved ? '✅ Saved!' : `💾 ${label}`}
    </button>
  );
}

export default function CollectionImagesPage() {
  const [cats,    setCats]    = useState([]);
  const [imgs,    setImgs]    = useState({});
  const [hidden,  setHidden]  = useState({}); // key → true means hidden from homepage
  const [loading, setLoading] = useState(true);
  const [saving,  setSaving]  = useState(false);
  const [saved,   setSaved]   = useState(false);
  const [showHidden, setShowHidden] = useState(false); // toggle to show hidden categories

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [catRows, settings] = await Promise.all([
        api.get('categories', 'select=id,name,slug&order=name.asc'),
        loadAllSettings(),
      ]);
      setCats(catRows || []);
      const imgMap = {}, hiddenMap = {};
      (catRows || []).forEach(c => {
        const k = c.slug || String(c.id);
        imgMap[k]    = settings[`coll_img_${k}`]    || '';
        hiddenMap[k] = settings[`coll_hidden_${k}`] === 'true';
      });
      setImgs(imgMap);
      setHidden(hiddenMap);
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  function toggleHide(key) {
    setHidden(p => ({ ...p, [key]: !p[key] }));
  }

  async function save() {
    setSaving(true); setSaved(false);
    try {
      const imgPairs    = cats.map(c => { const k = c.slug || String(c.id); return [`coll_img_${k}`,    (imgs[k]||'').trim()]; });
      const hiddenPairs = cats.map(c => { const k = c.slug || String(c.id); return [`coll_hidden_${k}`, hidden[k] ? 'true' : 'false']; });
      await saveMany([...imgPairs, ...hiddenPairs]);
      setSaved(true); setTimeout(() => setSaved(false), 3000);
    } catch(e) { alert('Save failed: ' + e.message); }
    setSaving(false);
  }

  if (loading) return <Loader text="Loading categories…" />;

  const visibleCats = cats.filter(c => !hidden[c.slug || String(c.id)]);
  const hiddenCats  = cats.filter(c =>  hidden[c.slug || String(c.id)]);
  const filled      = visibleCats.filter(c => imgs[c.slug || String(c.id)]?.trim()).length;

  return (
    <div className="space-y-5 max-w-4xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-[20px] font-bold" style={{ color: 'var(--tx)' }}>🗂️ Collection Images</h1>
        <p className="text-[12px] mt-1" style={{ color: 'var(--tx2)' }}>
          Category card images shown on the homepage. New categories from Catalogue auto-appear here.
        </p>
      </div>

      {/* Status bar */}
      <div className="flex items-center justify-between px-4 py-3 rounded-xl"
        style={{ background: 'rgba(63,185,80,0.06)', border: '1px solid rgba(63,185,80,0.15)' }}>
        <div>
          <div className="text-[13px] font-bold" style={{ color: 'var(--tx)' }}>
            {filled}/{visibleCats.length} images set
            {hiddenCats.length > 0 && (
              <span className="ml-2 text-[11px] font-normal px-2 py-0.5 rounded-full"
                style={{ background: 'rgba(248,81,73,0.1)', color: '#f85149' }}>
                {hiddenCats.length} hidden from homepage
              </span>
            )}
          </div>
          <div className="text-[11px] mt-0.5" style={{ color: 'var(--tx2)' }}>
            Use <strong style={{ color: 'var(--tx)' }}>👁 Hide</strong> to remove a category from the homepage without deleting it. Restore anytime.
          </div>
        </div>
        <SaveBtn onClick={save} saving={saving} saved={saved} label="Save All" />
      </div>

      {/* Tip */}
      <div className="rounded-xl p-3 text-[11px]"
        style={{ background: 'rgba(88,166,255,0.06)', border: '1px solid rgba(88,166,255,0.18)', color: 'var(--tx2)' }}>
        💡 <strong style={{ color: 'var(--tx)' }}>Hide vs Delete:</strong> Hiding removes a category from the homepage display only — the category and its products stay untouched in your catalogue. To permanently delete a category, go to <strong style={{ color: 'var(--tx)' }}>Catalogue → Categories</strong>.
      </div>

      {/* Visible categories */}
      {cats.length === 0 ? (
        <div className="py-12 text-center text-[13px] rounded-xl"
          style={{ color: 'var(--tx2)', background: 'var(--bg2)', border: '1px solid var(--bd)' }}>
          No categories found.<br />
          <span className="text-[11px]">Add categories in Catalogue → Categories first.</span>
        </div>
      ) : (
        <>
          {visibleCats.length === 0 && (
            <div className="py-8 text-center text-[12px] rounded-xl"
              style={{ color: 'var(--tx2)', background: 'var(--bg2)', border: '1px solid var(--bd)' }}>
              All categories are hidden. Restore some below to show them on the homepage.
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            {visibleCats.map(cat => {
              const key    = cat.slug || String(cat.id);
              const hasImg = imgs[key]?.trim();
              return (
                <div key={cat.id} className="rounded-xl p-3 space-y-2"
                  style={{ background: 'var(--bg)', border: `1.5px solid ${hasImg ? 'color-mix(in srgb, var(--accent) 30%, transparent)' : 'var(--bd)'}` }}>
                  {/* Card header */}
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded flex items-center justify-center overflow-hidden" style={{ background: 'var(--bg2)' }}>
                      {hasImg ? <img src={imgs[key]} alt="" className="w-7 h-7 object-cover" onError={e => e.target.style.display='none'} /> : <span className="text-lg">📦</span>}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[12px] font-bold truncate" style={{ color: 'var(--tx)' }}>{cat.name}</div>
                      <div className="text-[9px] font-mono" style={{ color: 'var(--tx2)' }}>{key}</div>
                    </div>
                    {/* Hide button */}
                    <button onClick={() => toggleHide(key)}
                      title="Hide from homepage"
                      className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-lg transition"
                      style={{ color: 'var(--tx2)', border: '1px solid var(--bd)', background: 'var(--bg2)' }}>
                      👁 Hide
                    </button>
                  </div>
                  <ImageUploader value={imgs[key]||''} onChange={v => setImgs(p => ({...p,[key]:v}))}
                    folder={`collection/${key}`} />
                </div>
              );
            })}
          </div>

          {/* Hidden categories section */}
          {hiddenCats.length > 0 && (
            <div className="rounded-xl overflow-hidden" style={{ border: '1.5px solid rgba(248,81,73,0.25)' }}>
              <button
                onClick={() => setShowHidden(s => !s)}
                className="w-full flex items-center justify-between px-4 py-3 text-[12px] font-semibold"
                style={{ background: 'rgba(248,81,73,0.06)', color: '#f85149' }}>
                <span>🚫 {hiddenCats.length} hidden categor{hiddenCats.length > 1 ? 'ies' : 'y'} — not shown on homepage</span>
                <span className="text-[11px] opacity-60">{showHidden ? '▲ Collapse' : '▼ Show'}</span>
              </button>

              {showHidden && (
                <div className="p-3 grid grid-cols-2 gap-3" style={{ background: 'var(--bg2)' }}>
                  {hiddenCats.map(cat => {
                    const key    = cat.slug || String(cat.id);
                    const hasImg = imgs[key]?.trim();
                    return (
                      <div key={cat.id} className="rounded-xl p-3 space-y-2"
                        style={{ background: 'var(--bg)', border: '1.5px solid rgba(248,81,73,0.2)', opacity: 0.75 }}>
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded flex items-center justify-center overflow-hidden" style={{ background: 'var(--bg2)' }}>
                            {hasImg ? <img src={imgs[key]} alt="" className="w-7 h-7 object-cover" onError={e => e.target.style.display='none'} /> : <span className="text-lg">📦</span>}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-[12px] font-bold truncate" style={{ color: 'var(--tx2)' }}>{cat.name}</div>
                            <div className="text-[9px] px-1.5 py-0.5 rounded inline-block mt-0.5"
                              style={{ background: 'rgba(248,81,73,0.12)', color: '#f85149', fontSize: 9 }}>
                              Hidden from homepage
                            </div>
                          </div>
                          {/* Restore button */}
                          <button onClick={() => toggleHide(key)}
                            className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-lg transition font-semibold"
                            style={{ color: '#3fb950', border: '1px solid rgba(63,185,80,0.35)', background: 'rgba(63,185,80,0.08)' }}>
                            ✓ Restore
                          </button>
                        </div>
                        {/* Still allow image upload even if hidden */}
                        <ImageUploader value={imgs[key]||''} onChange={v => setImgs(p => ({...p,[key]:v}))}
                          folder={`collection/${key}`} />
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </>
      )}

      <div className="flex justify-end pt-2">
        <SaveBtn onClick={save} saving={saving} saved={saved} label="Save All" />
      </div>
    </div>
  );
}
