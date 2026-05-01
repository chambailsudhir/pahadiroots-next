'use client';
import { useState, useEffect, useRef } from 'react';
import { api } from '@/lib/api';
import { Loader, Card } from '@/components/ui/index';
import ColourPicker from '@/components/ui/ColourPicker';

async function uploadToSupabase(file, folder = 'media') {
  const compressed = await new Promise(resolve => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      // Hero banners need full width — cap at 2400px wide, preserve aspect ratio exactly
      const MAX_W = 2400;
      let w = img.width, h = img.height;
      if (w > MAX_W) { h = Math.round(h * MAX_W / w); w = MAX_W; }
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      canvas.toBlob(b => resolve(b), 'image/jpeg', 0.92);
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

async function uploadVideoToSupabase(file, folder = 'media') {
  const MAX_MB = 100;
  if (file.size > MAX_MB * 1024 * 1024) throw new Error(`Video too large — max ${MAX_MB}MB`);
  const ext = file.name.split('.').pop().toLowerCase() || 'mp4';
  const mimeType = file.type || 'video/mp4';
  const base64 = await new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result.split(',')[1]);
    r.onerror = () => rej(new Error('Read failed'));
    r.readAsDataURL(file);
  });
  const fileName = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2,7)}.${ext}`;
  const pw = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('pr_pw') : '';
  const res = await fetch('/api/admin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-password': pw || '' },
    body: JSON.stringify({ action: 'storage_upload', fileName, fileType: mimeType, fileBase64: base64 }),
  });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || 'Upload failed'); }
  return (await res.json()).url;
}

async function loadSettings() {
  const rows = await api.get('site_settings', 'select=key,value').catch(() => []);
  return Object.fromEntries((rows || []).map(r => [r.key, r.value]));
}
async function saveSetting(key, value) {
  const ex = await api.get('site_settings', `key=eq.${encodeURIComponent(key)}&limit=1`).catch(() => []);
  if (ex?.length) await api.patch('site_settings', `key=eq.${encodeURIComponent(key)}`, { value });
  else            await api.post('site_settings', { key, value });
}
async function saveMany(pairs) { for (const [k, v] of pairs) await saveSetting(k, v); }

// ── Image Uploader ────────────────────────────────────────────
function ImageUploader({ value, onChange, folder, hint }) {
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState('');
  const [dragOver, setDragOver] = useState(false);
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
          padding: value ? '8px' : '18px 14px' }}>
        <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={e => handleFile(e.target.files[0])} />
        {uploading ? (
          <div className="flex items-center justify-center gap-2 py-1">
            <div className="w-4 h-4 border-2 rounded-full animate-spin" style={{ borderColor: 'var(--bd)', borderTopColor: 'var(--accent)' }} />
            <span className="text-[12px]" style={{ color: 'var(--tx2)' }}>Uploading & compressing…</span>
          </div>
        ) : value ? (
          <div className="flex items-center gap-3">
            <img src={value} alt="" className="rounded-lg object-cover flex-shrink-0"
              style={{ width: 96, height: 56, border: '1px solid var(--bd)' }}
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
            <div className="text-xl">📁</div>
            <div className="text-[11px] font-semibold" style={{ color: 'var(--tx)' }}>Click or drag & drop</div>
            <div className="text-[10px]" style={{ color: 'var(--tx2)' }}>JPG, PNG · Max 15MB · Auto-compressed</div>
          </div>
        )}
      </div>
      <input value={value} onChange={e => onChange(e.target.value)} placeholder="or paste image URL…"
        className="w-full rounded-lg px-3 py-2 text-[11px] outline-none"
        style={{ background: 'var(--bg)', border: '1px solid var(--bd)', color: 'var(--tx)', fontFamily: 'monospace' }} />
      {err && <div className="text-[10px] px-2 py-1 rounded" style={{ color: '#f85149', background: 'rgba(248,81,73,0.08)' }}>⚠️ {err}</div>}
      {hint && <div className="text-[10px]" style={{ color: 'var(--tx2)', opacity: 0.6 }}>{hint}</div>}
    </div>
  );
}

// ── Video Uploader ────────────────────────────────────────────
function VideoUploader({ value, onChange, folder, hint }) {
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef();

  async function handleFile(file) {
    if (!file) return;
    const allowed = ['video/mp4','video/webm','video/ogg','video/quicktime'];
    if (!allowed.includes(file.type) && !file.name.match(/\.(mp4|webm|ogg|mov)$/i)) {
      setErr('Please select a video file (MP4, WebM, MOV)'); return;
    }
    if (file.size > 100 * 1024 * 1024) { setErr('File too large — max 100MB'); return; }
    setErr(''); setUploading(true);
    try { onChange(await uploadVideoToSupabase(file, folder)); }
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
          padding: value ? '8px' : '18px 14px' }}>
        <input ref={inputRef} type="file" accept="video/mp4,video/webm,video/ogg,video/quicktime,.mp4,.webm,.mov" className="hidden"
          onChange={e => handleFile(e.target.files[0])} />
        {uploading ? (
          <div className="flex items-center justify-center gap-2 py-1">
            <div className="w-4 h-4 border-2 rounded-full animate-spin" style={{ borderColor: 'var(--bd)', borderTopColor: 'var(--accent)' }} />
            <span className="text-[12px]" style={{ color: 'var(--tx2)' }}>Uploading video…</span>
          </div>
        ) : value ? (
          <div className="space-y-2">
            <video src={value} controls className="w-full rounded-lg"
              style={{ maxHeight: 120, border: '1px solid var(--bd)', background: '#000' }}
              onError={e => e.target.style.opacity='0.3'} />
            <div className="flex gap-2">
              <div className="flex-1 text-[10px] truncate font-mono px-2 py-1 rounded" style={{ background:'var(--bg2)', color:'var(--tx2)', border:'1px solid var(--bd)' }}>
                {value.split('/').pop()}
              </div>
              <button onClick={e => { e.stopPropagation(); inputRef.current?.click(); }}
                className="text-[10px] px-2 py-0.5 rounded flex-shrink-0"
                style={{ color: 'var(--accent)', border: '1px solid color-mix(in srgb, var(--accent) 35%, transparent)', background: 'color-mix(in srgb, var(--accent) 8%, transparent)' }}>
                🔄 Replace
              </button>
              <button onClick={e => { e.stopPropagation(); onChange(''); }}
                className="text-[10px] px-2 py-0.5 rounded flex-shrink-0"
                style={{ color: '#f85149', border: '1px solid rgba(248,81,73,0.3)', background: 'rgba(248,81,73,0.08)' }}>
                ✕ Remove
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-1 text-center">
            <div className="text-xl">🎬</div>
            <div className="text-[11px] font-semibold" style={{ color: 'var(--tx)' }}>Click or drag & drop video</div>
            <div className="text-[10px]" style={{ color: 'var(--tx2)' }}>MP4, WebM, MOV · Max 100MB</div>
          </div>
        )}
      </div>
      <input value={value} onChange={e => onChange(e.target.value)} placeholder="or paste video URL…"
        className="w-full rounded-lg px-3 py-2 text-[11px] outline-none"
        style={{ background: 'var(--bg)', border: '1px solid var(--bd)', color: 'var(--tx)', fontFamily: 'monospace' }} />
      {err && <div className="text-[10px] px-2 py-1 rounded" style={{ color: '#f85149', background: 'rgba(248,81,73,0.08)' }}>⚠️ {err}</div>}
      {hint && <div className="text-[10px]" style={{ color: 'var(--tx2)', opacity: 0.6 }}>{hint}</div>}
    </div>
  );
}

function Field({ label, children, hint }) {  return (
    <div className="space-y-1">
      <div className="text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--tx2)' }}>{label}</div>
      {children}
      {hint && <div className="text-[10px]" style={{ color: 'var(--tx2)', opacity: 0.6 }}>{hint}</div>}
    </div>
  );
}

function TextInput({ value, onChange, placeholder, colour }) {
  return (
    <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
      className="w-full rounded-lg px-3 py-2 text-[12px] outline-none"
      style={{ background: 'var(--bg)', border: '1px solid var(--bd)', color: colour || 'var(--tx)' }} />
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

// ── Single Slide Editor ───────────────────────────────────────
function SlideEditor({ n, data, onChange }) {
  const k = `hero_slide_${n}_`;
  const g = field => data[k + field] || '';
  const s = (field, val) => onChange(k + field, val);

  const hasImg    = g('img');
  const hasCoupon = g('coupon_offer') || g('coupon_code');

  return (
    <div className="space-y-4">

      {/* Background Image */}
      <div className="rounded-xl overflow-hidden" style={{ border: `2px solid ${hasImg ? 'color-mix(in srgb, var(--accent) 30%, transparent)' : 'var(--bd)'}` }}>
        <div className="flex items-center justify-between px-4 py-3"
          style={{ background: 'var(--bg)', borderBottom: '1px solid var(--bd)' }}>
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-bold" style={{ color: 'var(--tx)' }}>🖼️ Background Image</span>
            <span className="text-[10px] px-2 py-0.5 rounded-full font-bold"
              style={hasImg ? { background: 'rgba(63,185,80,0.15)', color: '#3fb950' } : { background: 'rgba(110,118,129,0.12)', color: 'var(--tx2)' }}>
              {hasImg ? '● Active' : '○ No image'}
            </span>
          </div>
          {hasImg && (
            <button onClick={() => s('img', '')}
              className="text-[10px] px-2 py-0.5 rounded"
              style={{ color: '#f85149', border: '1px solid rgba(248,81,73,0.3)' }}>
              Clear
            </button>
          )}
        </div>
        <div className="p-4" style={{ background: 'var(--bg2)' }}>
          <ImageUploader value={g('img')} onChange={v => s('img', v)}
            folder={`hero/slide${n}`} hint="Landscape photo, min 1400px wide recommended." />
          {hasImg && (
            <div className="mt-3 rounded-xl overflow-hidden relative" style={{ height: 160, background: '#000' }}>
              <img src={g('img')} alt="" className="w-full h-full"
                style={{ objectFit: 'cover', objectPosition: 'center top' }}
                onError={e => e.target.style.opacity='0.3'} />
              <div style={{ position:'absolute', inset:0, background:'linear-gradient(100deg,rgba(5,20,8,0.78) 0%,rgba(5,20,8,0.2) 60%,transparent 100%)' }} />
              <div style={{ position:'absolute', bottom:12, left:16 }}>
                {g('eyebrow') && <div style={{ fontSize:9, letterSpacing:1, color: g('eyebrow_colour') || '#ffffffaa' }}>{g('eyebrow')}</div>}
                <div style={{ fontSize:15, fontWeight:900, lineHeight:1.2, color: g('title_colour') || '#ffffff' }}>{g('title') || 'Title preview'}</div>
                {g('sub') && <div style={{ fontSize:10, marginTop:3, color: g('sub_colour') || 'rgba(255,255,255,0.75)' }}>{g('sub')}</div>}
                {hasCoupon && g('coupon_offer') && (
                  <div style={{ marginTop:4, background:'rgba(255,255,255,0.95)', borderRadius:6, padding:'2px 8px', display:'inline-block' }}>
                    <span style={{ fontSize:11, fontWeight:900, color:'#1b4332' }}>{g('coupon_offer')}</span>
                    {g('coupon_code') && <span style={{ fontSize:9, color:'#bc4749', marginLeft:4 }}>· {g('coupon_code')}</span>}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Background Video (optional — plays instead of image if set) */}
      <div className="rounded-xl overflow-hidden" style={{ border: `2px solid ${g('video') ? 'color-mix(in srgb, #58a6ff 30%, transparent)' : 'var(--bd)'}` }}>
        <div className="flex items-center justify-between px-4 py-3"
          style={{ background: 'var(--bg)', borderBottom: '1px solid var(--bd)' }}>
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-bold" style={{ color: 'var(--tx)' }}>🎬 Background Video</span>
            <span className="text-[10px] px-2 py-0.5 rounded-full font-bold"
              style={g('video') ? { background: 'rgba(88,166,255,0.15)', color: '#58a6ff' } : { background: 'rgba(110,118,129,0.12)', color: 'var(--tx2)' }}>
              {g('video') ? '● Active' : '○ No video'}
            </span>
            <span className="text-[9px] px-2 py-0.5 rounded-full" style={{ background: 'rgba(210,153,34,0.12)', color: '#d29922' }}>
              optional
            </span>
          </div>
          {g('video') && (
            <button onClick={() => s('video', '')}
              className="text-[10px] px-2 py-0.5 rounded"
              style={{ color: '#f85149', border: '1px solid rgba(248,81,73,0.3)' }}>
              Clear
            </button>
          )}
        </div>
        <div className="p-4" style={{ background: 'var(--bg2)' }}>
          <div className="text-[10px] mb-3 px-3 py-2 rounded-lg" style={{ background: 'color-mix(in srgb, var(--blue-bg) 40%, transparent)', border: '1px solid rgba(88,166,255,0.18)', color: 'var(--tx2)' }}>
            💡 If set, the video will autoplay muted as the slide background. The background image above will be used as a fallback poster frame.
          </div>
          <VideoUploader value={g('video')} onChange={v => s('video', v)}
            folder={`hero/slide${n}/video`} hint="MP4 recommended for best browser support. Keep under 20MB for fast loading." />
        </div>
      </div>

      {/* Eyebrow */}
      <div className="rounded-xl overflow-hidden" style={{ border: '1.5px solid var(--bd)' }}>
        <div className="px-4 py-2.5" style={{ background: 'var(--bg)', borderBottom: '1px solid var(--bd)' }}>
          <span className="text-[12px] font-bold" style={{ color: 'var(--tx)' }}>🏷️ Eyebrow Text</span>
          <span className="text-[10px] ml-3" style={{ color: 'var(--tx2)' }}>Small tag shown above the headline</span>
        </div>
        <div className="p-4" style={{ background: 'var(--bg2)' }}>
          <div className="flex items-end gap-3">
            <div className="flex-1">
              <Field label="Eyebrow Text">
                <TextInput value={g('eyebrow')} onChange={v => s('eyebrow', v)}
                  placeholder="e.g. 🌿 Summer Collection" colour={g('eyebrow_colour')} />
              </Field>
            </div>
            <ColourPicker value={g('eyebrow_colour')} onChange={v => s('eyebrow_colour', v)} label="Eyebrow" />
          </div>
        </div>
      </div>

      {/* Headline */}
      <div className="rounded-xl overflow-hidden" style={{ border: '1.5px solid var(--bd)' }}>
        <div className="px-4 py-2.5" style={{ background: 'var(--bg)', borderBottom: '1px solid var(--bd)' }}>
          <span className="text-[12px] font-bold" style={{ color: 'var(--tx)' }}>✏️ Headline</span>
          <span className="text-[10px] ml-3" style={{ color: 'var(--tx2)' }}>Use *word* for italic gold highlight</span>
        </div>
        <div className="p-4" style={{ background: 'var(--bg2)' }}>
          <div className="flex items-end gap-3">
            <div className="flex-1">
              <Field label="Headline Text">
                <TextInput value={g('title')} onChange={v => s('title', v)}
                  placeholder="e.g. Born in the *Himalayas*" colour={g('title_colour')} />
              </Field>
            </div>
            <ColourPicker value={g('title_colour')} onChange={v => s('title_colour', v)} label="Headline" />
          </div>
        </div>
      </div>

      {/* Subtext */}
      <div className="rounded-xl overflow-hidden" style={{ border: '1.5px solid var(--bd)' }}>
        <div className="px-4 py-2.5" style={{ background: 'var(--bg)', borderBottom: '1px solid var(--bd)' }}>
          <span className="text-[12px] font-bold" style={{ color: 'var(--tx)' }}>📝 Subtext</span>
          <span className="text-[10px] ml-3" style={{ color: 'var(--tx2)' }}>Keep it short and punchy</span>
        </div>
        <div className="p-4" style={{ background: 'var(--bg2)' }}>
          <div className="flex items-end gap-3">
            <div className="flex-1">
              <Field label="Subtext">
                <TextInput value={g('sub')} onChange={v => s('sub', v)}
                  placeholder="Supporting message — keep it short" colour={g('sub_colour')} />
              </Field>
            </div>
            <ColourPicker value={g('sub_colour')} onChange={v => s('sub_colour', v)} label="Subtext" />
          </div>
        </div>
      </div>

      {/* Coupon Badge */}
      <div className="rounded-xl p-4 space-y-2" style={{ background: 'var(--bg)', border: '1px solid var(--bd)' }}>
        <div className="text-[10px] font-bold uppercase tracking-wide mb-2" style={{ color: 'var(--yellow)' }}>
          🏷️ Coupon Badge (optional)
        </div>
        <div className="grid grid-cols-3 gap-2">
          <Field label="Label">
            <TextInput value={g('coupon_label')} onChange={v => s('coupon_label', v)} placeholder="e.g. Limited Offer" />
          </Field>
          <Field label="Offer">
            <TextInput value={g('coupon_offer')} onChange={v => s('coupon_offer', v)} placeholder="e.g. FLAT 10% OFF" />
          </Field>
          <Field label="Code">
            <TextInput value={g('coupon_code')} onChange={v => s('coupon_code', v)} placeholder="e.g. SUMMER10" />
          </Field>
        </div>
      </div>

      {/* Buttons */}
      <div className="rounded-xl p-4 space-y-2" style={{ background: 'var(--bg)', border: '1px solid var(--bd)' }}>
        <div className="text-[10px] font-bold uppercase tracking-wide mb-2" style={{ color: 'var(--tx2)' }}>🔗 Buttons</div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Primary Button Text">
            <TextInput value={g('cta_text')} onChange={v => s('cta_text', v)} placeholder="Explore Our Store" />
          </Field>
          <Field label="Primary Button Link">
            <TextInput value={g('cta_link')} onChange={v => s('cta_link', v)} placeholder="#shop or /products" />
          </Field>
          <Field label="Secondary Button Text" hint="Optional">
            <TextInput value={g('cta2_text')} onChange={v => s('cta2_text', v)} placeholder="Our Story" />
          </Field>
          <Field label="Secondary Button Link">
            <TextInput value={g('cta2_link')} onChange={v => s('cta2_link', v)} placeholder="/our-story" />
          </Field>
        </div>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────
export default function HeroBannersPage() {
  const [data,      setData]      = useState({});
  const [loading,   setLoading]   = useState(true);
  const [saving,    setSaving]    = useState(false);
  const [saved,     setSaved]     = useState(false);
  const [bannerTab, setBannerTab] = useState(1);

  useEffect(() => { loadAllSettings().then(d => { setData(d); setLoading(false); }); }, []);

  function update(key, val) { setData(prev => ({ ...prev, [key]: val })); }

  async function save() {
    setSaving(true); setSaved(false);
    try {
      const keys = Object.keys(data).filter(k => k.startsWith('hero_slide_'));
      await saveMany(keys.map(k => [k, data[k]]));
      setSaved(true); setTimeout(() => setSaved(false), 3000);
    } catch(e) { alert('Save failed: ' + e.message); }
    setSaving(false);
  }

  const activeCount = [1,2,3].filter(n => data[`hero_slide_${n}_img`] || data[`hero_slide_${n}_video`]).length;

  if (loading) return <Loader text="Loading banner settings…" />;

  return (
    <div className="space-y-5 max-w-4xl mx-auto">
      <div>
        <h1 className="text-[20px] font-bold" style={{ color: 'var(--tx)' }}>🎨 Hero Banners</h1>
        <p className="text-[12px] mt-1" style={{ color: 'var(--tx2)' }}>
          Full-width slideshow on the homepage. Auto-rotates every 5 seconds. Touch swipe enabled.
        </p>
      </div>

      {/* Status bar */}
      <div className="flex items-center justify-between px-4 py-3 rounded-xl"
        style={{ background: activeCount > 0 ? 'rgba(63,185,80,0.08)' : 'color-mix(in srgb, var(--tx3) 8%, transparent)',
          border: `1px solid ${activeCount > 0 ? 'rgba(63,185,80,0.2)' : 'var(--bd)'}` }}>
        <div>
          <div className="text-[13px] font-bold" style={{ color: activeCount > 0 ? '#3fb950' : 'var(--tx2)' }}>
            {activeCount > 0 ? `● ${activeCount} banner${activeCount > 1 ? 's' : ''} active` : '○ No banners set'}
          </div>
          <div className="text-[11px] mt-0.5" style={{ color: 'var(--tx2)' }}>Changes go live instantly after saving.</div>
        </div>
        <SaveBtn onClick={save} saving={saving} saved={saved} label="Save All Banners" />
      </div>

      {/* Tip */}
      <div className="rounded-xl p-3.5 text-[11px]"
        style={{ background: 'color-mix(in srgb, var(--blue-bg) 40%, transparent)', border: '1px solid rgba(88,166,255,0.18)', color: 'var(--tx2)' }}>
        💡 <strong style={{ color: 'var(--tx)' }}>Tip:</strong> Upload a wide landscape photo, write a punchy headline, then use the colour pickers to make text stand out against your image.
      </div>

      {/* Banner tabs */}
      <div className="flex gap-1 p-1 rounded-xl" style={{ background: 'var(--bg2)', border: '1px solid var(--bd)' }}>
        {[1, 2, 3].map(n => (
          <button key={n} onClick={() => setBannerTab(n)}
            className="flex-1 py-2 rounded-lg text-[12px] font-semibold transition flex items-center justify-center gap-1.5"
            style={bannerTab === n
              ? { background: 'color-mix(in srgb, var(--accent) 18%, transparent)', color: 'var(--accent)' }
              : { color: 'var(--tx2)' }}>
            Banner {n}
            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full"
              style={data[`hero_slide_${n}_img`] || data[`hero_slide_${n}_video`]
                ? { background: 'rgba(63,185,80,0.15)', color: '#3fb950' }
                : { background: 'color-mix(in srgb, var(--tx3) 10%, transparent)', color: 'var(--tx2)' }}>
              {data[`hero_slide_${n}_img`] ? '●' : '○'}
            </span>
          </button>
        ))}
      </div>

      {/* Active slide editor */}
      <SlideEditor key={bannerTab} n={bannerTab} data={data} onChange={update} />

      <div className="flex justify-end pt-2">
        <SaveBtn onClick={save} saving={saving} saved={saved} label="Save All Banners" />
      </div>
    </div>
  );
}
