'use client';
import { useState, useEffect, useCallback, useReducer, useRef, useMemo, Suspense } from 'react';
import { useDebounce } from '@/hooks/useDebounce';
import { useSearchParams } from 'next/navigation';
import { api, fmtCurrency } from '@/lib/api';
import { Card, Loader, ErrorMsg, Badge } from '@/components/ui/index';
import Modal from '@/components/ui/Modal';
import { readAndClearPricingPrefill } from '@/lib/pricingPrefill';
import {
  toPaise, toRupees, addGst, removeGst, gstSplit,
  runCalc, calcVariantPrices, generateSku, parseGrams,
  psychologicalRound, smartPriceOptions,
  marginHealth, MARGIN_THRESHOLDS, MARGIN_LABELS,
  validateField, DEFAULT_F, GST_RATES,
  buildOrderSnapshot,
} from '@/lib/pricingCalc';

// ── Styling helpers ───────────────────────────────────────────
const inp = "w-full rounded-lg px-3 py-2 text-[12px] focus:outline-none focus:ring-1 focus:ring-[var(--accent)] bg-[var(--bg)] border border-[var(--accent)] text-[var(--tx)] placeholder-[var(--tx3)]";
function Field({ label, children }) {
  return (
    <div>
      <label className="block text-[10px] font-bold uppercase tracking-wider mb-1 text-[var(--tx3)]">{label}</label>
      {children}
    </div>
  );
}

// ── GST Auto-suggest rules ────────────────────────────────────
// FIX #18: Renamed — DB-driven rules loaded inside ProductsTab via gstHsnRules state
const GST_SUGGEST_FALLBACK = [
  { keywords: ['honey', 'shahad'],                                      rate: 5,  reason: 'Packaged honey — 5%' },
  { keywords: ['juice', 'buransh', 'rhododendron'],                     rate: 12, reason: 'Packaged fruit juice — 12%' },
  { keywords: ['rice', 'chawal', 'rajma', 'dal', 'pulse', 'grain'],     rate: 5,  reason: 'Staple food grains — 5%' },
  { keywords: ['tea', 'chai'],                                           rate: 5,  reason: 'Tea — 5%' },
  { keywords: ['spice', 'masala', 'turmeric', 'cardamom', 'haldi', 'jeera'], rate: 5, reason: 'Spices — 5%' },
  { keywords: ['oil', 'mustard', 'tel'],                                 rate: 5,  reason: 'Edible oil — 5%' },
  { keywords: ['shilajit', 'resin', 'supplement'],                       rate: 18, reason: 'Supplement — 18%' },
  { keywords: ['shoot', 'bamboo', 'pickle', 'achar'],                    rate: 12, reason: 'Processed veg — 12%' },
];
function getSuggest(catName, productName, dbRules) {
  const text  = ((catName || '') + ' ' + (productName || '')).toLowerCase();
  const rules = (dbRules && dbRules.length > 0) ? dbRules : GST_SUGGEST_FALLBACK;
  for (const rule of rules) {
    if (rule.keywords.some(k => text.includes(k))) return rule;
  }
  return null;
}

// ── FIX #55: Compress image in a Web Worker (off main thread) ─────────────────
// The worker lives at /public/image-compress.worker.js
// Falls back to main-thread canvas if Worker/OffscreenCanvas not supported.
function compressInWorker(file, maxPx = 1200, quality = 0.82) {
  return new Promise((resolve, reject) => {
    // Feature-detect Worker + OffscreenCanvas
    if (typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined') {
      const worker = new Worker('/image-compress.worker.js');
      worker.onmessage = ({ data }) => {
        worker.terminate();
        if (data.error) reject(new Error(data.error));
        else resolve(data.blob);
      };
      worker.onerror = (e) => { worker.terminate(); reject(e); };
      worker.postMessage({ file, maxPx, quality });
    } else {
      // Fallback: main-thread canvas (Safari <17, old browsers)
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        let w = img.width, h = img.height;
        if (w > maxPx) { h = Math.round(h * maxPx / w); w = maxPx; }
        if (h > maxPx) { w = Math.round(w * maxPx / h); h = maxPx; }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        canvas.toBlob(b => { URL.revokeObjectURL(url); resolve(b); }, 'image/jpeg', quality);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Image load failed')); };
      img.src = url;
    }
  });
}

// ── FIX #52/#37/#38: Upload directly to Supabase Storage via signed URL ──────
// File goes browser → Supabase — it NEVER passes through Vercel.
// No 4.5MB body limit. Works for any file size.
async function getSignedUploadUrl(fileName, fileType, token, maxRetries = 3) {
  // FIX #49: retry signed URL fetch on transient failures
  let lastErr;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch('/api/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-session-token': token },
        body: JSON.stringify({ action: 'get_upload_url', fileName, fileType }),
      });
      if (res.ok) return res.json();
      const e = await res.json().catch(() => ({}));
      if (res.status < 500) throw new Error(e.error || 'Could not get upload URL');
      lastErr = new Error(e.error || `Server error: ${res.status}`);
    } catch(e) {
      lastErr = e;
      if (!e.message.includes('Server error')) throw e;
    }
    if (attempt < maxRetries) await new Promise(r => setTimeout(r, 400 * attempt));
  }
  throw lastErr;
}

async function uploadToSignedUrl(signedURL, blob, fileType, maxRetries = 3) {
  // FIX #49: retry on transient network failures (exponential backoff)
  let lastErr;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(signedURL, {
        method: 'PUT',
        headers: { 'Content-Type': fileType },
        body: blob,
      });
      if (res.ok) return;
      // 4xx = don't retry (bad request / expired URL), 5xx = retry
      if (res.status < 500) throw new Error(`Upload failed: ${res.status}`);
      lastErr = new Error(`Upload server error: ${res.status}`);
    } catch (e) {
      lastErr = e;
      if (e.message.startsWith('Upload failed:')) throw e; // non-retryable
    }
    if (attempt < maxRetries) {
      await new Promise(r => setTimeout(r, 500 * attempt)); // 500ms, 1000ms backoff
    }
  }
  throw lastErr;
}

// ── Main image upload: compress (Worker) → sign → direct upload ──────────────
async function compressAndUpload(file, path) {
  const sessionToken = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('pr_token') : '';
  const compressed   = await compressInWorker(file);
  const fileName     = `${path}-${Math.random().toString(36).slice(2, 9)}.jpg`;
  const { signedURL, publicUrl } = await getSignedUploadUrl(fileName, 'image/jpeg', sessionToken);
  await uploadToSignedUrl(signedURL, compressed, 'image/jpeg');
  return publicUrl;
}

// ── Video upload: sign → direct upload (no base64, no Vercel limit) ──────────
async function uploadVideo(file, path) {
  const MAX_MB = 500;
  if (file.size > MAX_MB * 1024 * 1024) throw new Error(`Video too large — max ${MAX_MB}MB`);
  const sessionToken = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('pr_token') : '';
  const ext      = file.name.split('.').pop().toLowerCase() || 'mp4';
  const mimeType = file.type || 'video/mp4';
  const fileName = `${path}-${Math.random().toString(36).slice(2, 9)}.${ext}`;
  const { signedURL, publicUrl } = await getSignedUploadUrl(fileName, mimeType, sessionToken);
  await uploadToSignedUrl(signedURL, file, mimeType);  // raw File, no base64
  return publicUrl;
}

// ── Products Tab ──────────────────────────────────────────────
function ProductsTab({ prefillPricing = null }) {
  const [products, setProducts]       = useState([]);
  const [categories, setCategories]   = useState([]);
  const [states, setStates]           = useState([]);
  const [vendors, setVendors]         = useState([]);
  const [gstRates, setGstRates]       = useState([
    { value: 0,  label: '0% (Exempted)' },
    { value: 5,  label: '5% (Food items — honey, spices)' },
    { value: 12, label: '12% (Processed food, ghee)' },
    { value: 18, label: '18% (Premium packaged goods)' },
    { value: 28, label: '28% (Luxury goods)' },
  ]);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState(null);
  const [modal, setModal]             = useState(null);
  const [saving, setSaving]           = useState(false);
  const [search, setSearch]           = useState('');
  const debouncedSearch = useDebounce(search, 300); // P2.1: debounce — wait 300ms after typing stops
  const [filterCat, setFilterCat]     = useState('');
  const [filterSize, setFilterSize]   = useState('');
  const [filterStock, setFilterStock] = useState('');
  // P2.3: Server-side pagination
  const PAGE_SIZE = 50;
  const [page, setPage]               = useState(0);
  const [totalCount, setTotalCount]   = useState(0);
  // P3.1: Bulk operations
  const [selected, setSelected]       = useState(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);
  const [imgModal, setImgModal]       = useState(false);
  const [prodImages, setProdImages]   = useState([]);
  const [uploading, setUploading]     = useState(false);
  const [uploadStatus, setUploadStatus] = useState('');
  const [videoUploading, setVideoUploading] = useState(false);
  const [videoUploadStatus, setVideoUploadStatus] = useState('');
  const [variants, setVariants]       = useState([]);
  const [autoPanel, setAutoPanel]     = useState(false);
  const [variantStockMap, setVariantStockMap] = useState({});
  const [avBasePrice, setAvBasePrice] = useState('');
  const [avBaseUnit, setAvBaseUnit]   = useState('250g');
  const [avUnitType, setAvUnitType]   = useState('weight');
  const [variantStrategy, setVariantStrategy] = useState('psychological');
  const WEIGHT_SIZES = ['50g', '100g', '250g', '500g', '1kg', '2kg', '5kg'];
  const LIQUID_SIZES = ['50ml', '100ml', '200ml', '250ml', '500ml', '1L', '2L', '5L'];
  const ALL_SIZES = avUnitType === 'liquid' ? LIQUID_SIZES : WEIGHT_SIZES;
  const [avSelectedSizes, setAvSelectedSizes] = useState(['100g', '250g', '500g', '1kg']);

  // AI content state
  const [aiLoading, setAiLoading]   = useState(false);
  const [modalTab, setModalTab]     = useState('basic');
  const [aiPreview, setAiPreview]   = useState(null);
  const [aiSaved, setAiSaved]       = useState(null);
  const [aiError, setAiError]       = useState('');
  const aiAbortRef                  = useRef(null);  // FIX #41: cancel in-flight AI requests

  // FIX #1 — CORRECT form field mapping:
  //   price          = base excl GST (computed, read-only in UI)
  //   selling_price  = customer pays incl GST  → DB selling_price
  //   mrp            = legal MRP on package    → DB mrp
  //   compare_at_price = strikethrough on site → DB compare_at_price
  //   cost_price     = landed cost             → DB cost_price
  const EMPTY = {
    name: '', slug: '', emoji: '', category_id: '', state_id: '', status: 'active',
    unit_label: '', gst_rate: 5,
    price: '',           // base excl GST — computed from selling_price
    selling_price: '',   // customer-facing incl GST — PRIMARY FIELD
    mrp: '',             // legal MRP printed on package
    compare_at_price: '', // strikethrough anchor shown on site
    cost_price: '',
    short_description: '', long_description: '', image_url: '', video_url: '',
    vendor_id: '', tags: '',
    badges_bestseller: false, badges_organic: false, badges_new: false,
    price_version: 1,    // FIX #8: optimistic locking
  };

  // FIX #43/#56: useReducer instead of useState — single dispatch point,
  // cleaner state transitions, no "setForm(f => ({...f, x}))" proliferation.
  function formReducer(state, action) {
    switch (action.type) {
      case 'SET_FIELD':  return { ...state, [action.key]: action.value };
      case 'SET_FIELDS': return { ...state, ...action.fields };
      case 'RESET':      return { ...EMPTY, ...action.fields };
      default:           return state;
    }
  }
  const [form, formDispatch] = useReducer(formReducer, EMPTY);
  // Backward-compatible setForm shim — all existing setForm calls continue to work
  const setForm = useCallback((updater) => {
    if (typeof updater === 'function') {
      formDispatch({ type: 'SET_FIELDS', fields: updater({}) });
    } else {
      formDispatch({ type: 'RESET', fields: updater });
    }
  }, []);
  const [mrpError, setMrpError] = useState(''); // FIX: separate from form state

  // Load GST rates from DB (FIX #45: not hardcoded anymore)
  useEffect(() => {
    api.get('gst_rates', 'select=rate,label&is_active=eq.true&order=sort_order.asc')
      .then(rows => {
        if (rows?.length) setGstRates(rows.map(r => ({ value: Number(r.rate), label: `${r.rate}% — ${r.label}` })));
      })
      .catch(() => {}); // silent — fall back to defaults above
  }, []);

  // FIX #18: GST/HSN keyword rules from DB — update rates without redeploy
  const [gstHsnRules, setGstHsnRules] = useState([]);
  useEffect(() => {
    api.get('gst_hsn_mapping', 'select=keywords,gst_rate,description&is_active=eq.true')
      .then(rows => {
        if (rows?.length) setGstHsnRules(rows.map(r => ({
          keywords: Array.isArray(r.keywords) ? r.keywords : [],
          rate:     Number(r.gst_rate),
          reason:   r.description,
        })));
      }).catch(() => {});
  }, []);

  // Auto-open Add Product modal when arriving from Pricing Engine
  useEffect(() => {
    if (!prefillPricing || typeof prefillPricing !== 'object') return;
    setForm({
      ...EMPTY,
      price:            String(prefillPricing.price        ?? ''),
      selling_price:    String(prefillPricing.mrp          ?? ''),   // FIX #1: correct field
      mrp:              String(prefillPricing.mrp_display  ?? ''),
      cost_price:       String(prefillPricing.cost_price   ?? ''),
      gst_rate:         prefillPricing.gst_rate            ?? 5,
    });
    setVariants([]);
    setModalTab('pricing');
    setModal('add');
  }, [prefillPricing]); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadAiContent(productId) {
    if (!productId) return;
    try {
      // FIX #47: Load from dedicated product_ai_content table first
      const aiRows = await api.get('product_ai_content',
        `product_id=eq.${productId}&order=generated_at.desc`
      ).catch(() => null);

      if (aiRows?.length) {
        // Build aiSaved object from separate rows per field_name
        const byField = {};
        aiRows.forEach(r => { byField[r.field_name] = r; });
        setAiSaved({
          description:    byField.description?.content || '',
          benefits:       safeParse(byField.benefits?.content, []),
          how_to_use:     safeParse(byField.how_to_use?.content, []),
          storage_tips:   safeParse(byField.storage_tips?.content, []),
          who_should_buy: byField.who_should_buy?.content || '',
          generated_at:   byField.description?.generated_at || new Date().toISOString(),
          provider:       byField.description?.provider || 'gemini',
          approved:       byField.description?.approved || false,
        });
        return;
      }

      // Fallback: legacy columns in products table (migration period)
      const rows = await api.get('products',
        `select=ai_description,ai_health_benefits,ai_how_to_use,ai_storage_tips,ai_who_should_buy,ai_generated_at,ai_provider&id=eq.${productId}`
      );
      const p = rows?.[0];
      if (p?.ai_description) {
        setAiSaved({
          description:    p.ai_description,
          benefits:       safeParse(p.ai_health_benefits, []),
          how_to_use:     safeParse(p.ai_how_to_use, []),
          storage_tips:   safeParse(p.ai_storage_tips, []),
          who_should_buy: p.ai_who_should_buy || '',
          generated_at:   p.ai_generated_at,
          provider:       p.ai_provider || 'gemini',
        });
      } else {
        setAiSaved(null);
      }
    } catch { setAiSaved(null); }
  }

  function safeParse(str, fallback) {
    if (!str) return fallback;
    try { return JSON.parse(str); } catch { return fallback; }
  }

  // FIX #41: AbortController so closing modal cancels in-flight request
  async function handleGenerateAI() {
    if (!modal || modal === 'add') {
      alert('Please save the product first before generating AI content.');
      return;
    }
    if (aiAbortRef.current) aiAbortRef.current.abort();
    aiAbortRef.current = new AbortController();
    setAiLoading(true);
    setAiError('');
    try {
      const pw = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('pr_token') : '';
      const catName = categories.find(c => c.id === form.category_id)?.name || '';
      const res = await fetch('/api/admin', {
        method: 'POST',
        signal: aiAbortRef.current.signal,
        headers: { 'Content-Type': 'application/json', 'x-session-token': pw || '' },
        body: JSON.stringify({
          action: 'generate_ai_content', productId: modal.id,
          name: form.name, category: catName, ingredients: form.tags || '',
        }),
      });
      const json = await res.json();
      if (!res.ok) { setAiError(json.error || 'Generation failed. Please try again.'); return; }
      await loadAiContent(modal.id);
      setAiError('');
    } catch (e) {
      if (e.name !== 'AbortError') setAiError('Network error — check your connection and try again.');
    } finally {
      setAiLoading(false);
    }
  }

  async function handleSaveAI() {
    if (!aiPreview || !modal?.id) return;
    try {
      // FIX #47: Save to dedicated product_ai_content table
      const fields = [
        { field_name: 'description',    content: aiPreview.description || '' },
        { field_name: 'benefits',       content: JSON.stringify(aiPreview.benefits || []) },
        { field_name: 'how_to_use',     content: JSON.stringify(aiPreview.how_to_use || []) },
        { field_name: 'storage_tips',   content: JSON.stringify(aiPreview.storage_tips || []) },
        { field_name: 'who_should_buy', content: aiPreview.who_should_buy || '' },
      ];
      await Promise.all(fields.map(f =>
        api.post('product_ai_content', {
          product_id:  modal.id,
          field_name:  f.field_name,
          content:     f.content,
          provider:    aiPreview.provider || 'gemini',
          approved:    false,
          generated_at: new Date().toISOString(),
        }).catch(() =>
          // Fallback: upsert via PATCH if POST fails (row may exist)
          api.patch('product_ai_content',
            `product_id=eq.${modal.id}&field_name=eq.${f.field_name}`,
            { content: f.content, provider: aiPreview.provider || 'gemini',
              approved: false, generated_at: new Date().toISOString() })
        )
      ));
      // Also update legacy columns for backward compatibility
      await api.patch('products', `id=eq.${modal.id}`, {
        ai_description:  aiPreview.description,
        ai_generated_at: new Date().toISOString(),
        ai_provider:     aiPreview.provider || 'gemini',
      }).catch(() => {});
      setAiSaved({ ...aiPreview, generated_at: new Date().toISOString() });
      setAiPreview(null);
    } catch (e) {
      setAiError('Failed to save: ' + e.message);
    }
  }

  function handleDiscardAI() { setAiPreview(null); setAiError(''); }

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [p, c, s, varRows, v_list] = await Promise.all([
        // FIX #1: fetch selling_price + compare_at_price in addition to price + mrp
        api.get('products', `select=id,name,slug,emoji,price,selling_price,mrp,compare_at_price,cost_price,gst_rate,available_stock,status,category_id,state_id,vendor_id,unit_label,short_description,long_description,image_url,video_url,tags,badges,ai_description,ai_generated_at,ai_provider,price_version&is_deleted=eq.false&order=name.asc&limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}`),
        api.get('categories', 'select=id,name&order=name.asc'),
        api.get('states', 'select=id,name&order=name.asc'),
        api.get('product_variants', 'select=product_id,sku,variant_value,price,initial_stock,available_stock&is_active=eq.true&order=product_id.asc,sort_order.asc').catch(() => []),
        api.get('vendors', 'select=id,name,business_name,status&order=business_name.asc').catch(() => []),
      ]);
      const vcMap = (varRows || []).reduce((acc, v) => { acc[v.product_id] = (acc[v.product_id] || 0) + 1; return acc; }, {});
      const vsMap = (varRows || []).reduce((acc, v) => {
        if (!acc[v.product_id]) acc[v.product_id] = [];
        acc[v.product_id].push(v);
        return acc;
      }, {});
      setVariantStockMap(vsMap);
      setProducts((p || []).map(prod => ({ ...prod, _variantCount: vcMap[prod.id] || 0 })));
      setCategories(c || []);
      setStates(s || []);
      setVendors(v_list || []);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Race condition fix: sync state_id when states array loads AFTER modal opens
  useEffect(() => {
    if (!states || states.length === 0) return;
    if (!modal || modal === 'add') return;
    if (!modal.state_id) return;
    const correctSid = String(modal.state_id).trim();
    if (!correctSid) return;
    if (form.state_id !== correctSid) {
      setForm(f => ({ ...f, state_id: correctSid }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [states]);



  function openEdit(p) {
    const tags = Array.isArray(p.tags) ? p.tags.join(', ') : (p.tags || '');
    const badges = p.badges || [];
    const gstRate = parseFloat(p.gst_rate) || 5;

    // FIX #1: read from correct DB columns now
    // selling_price = customer pays. mrp = legal MRP. price = base excl GST.
    const selling = parseFloat(p.selling_price || p.mrp || 0);
    const base    = selling > 0 ? toRupees(removeGst(toPaise(selling), gstRate)) : parseFloat(p.price || 0);

    // state_id: DB stores text abbreviation (e.g. "hp", "as", "uk") — use as-is
    const _stateId = p.state_id ? String(p.state_id).trim() : '';

    setForm({
      ...EMPTY,
      // Spread p AFTER EMPTY but override all typed fields explicitly below
      // Do NOT use ...p directly — it overwrites our String() conversions
      name:             p.name || '',
      slug:             p.slug || '',
      emoji:            p.emoji || '',
      status:           p.status || 'active',
      unit_label:       p.unit_label || '',
      gst_rate:         p.gst_rate || 5,
      short_description: p.short_description || '',
      price:            String(base || ''),
      selling_price:    String(selling || ''),
      mrp:              String(parseFloat(p.mrp) || ''),
      compare_at_price: String(parseFloat(p.compare_at_price) || ''),
      cost_price:       String(parseFloat(p.cost_price) || ''),
      state_id:         _stateId,
      category_id:      p.category_id != null ? String(p.category_id) : '',  // FIX-B1: was missing — category never loaded in edit modal
      vendor_id:        p.vendor_id != null ? String(p.vendor_id) : '',
      price_version:    p.price_version || 1,
      tags,
      badges_bestseller: badges.includes('bestseller'),
      badges_organic:    badges.includes('organic'),
      badges_new:        badges.includes('new'),
      long_description:  p.long_description || '',
      image_url:         p.image_url  || '',
      video_url:         p.video_url  || '',
    });
    setMrpError('');
    setVariants([]);
    setAiPreview(null); setAiSaved(null); setAiError('');
    setModalTab('basic');
    setModal(p);
    loadAiContent(p.id);
    api.get('product_variants', `product_id=eq.${p.id}&order=sort_order.asc`).then(vars => {
      const loaded = (vars || []).map(v => ({ ...v, _id: v.id }));
      setVariants(loaded);
      syncPricingFromVariants(loaded, gstRate);
    }).catch(() => {});
  }

  function openAdd() {
    setForm(EMPTY); setVariants([]); setModalTab('basic');
    setAiPreview(null); setAiSaved(null); setAiError(''); setMrpError('');
    setModal('add');
  }

  // FIX #3: use paise math for price calculations
  function calcGST() {
    const sell_p  = toPaise(form.selling_price || 0);
    const rate    = parseFloat(form.gst_rate) || 0;
    const base_p  = removeGst(sell_p, rate);
    const gst_p   = sell_p - base_p;
    const cgst_p  = Math.floor(gst_p / 2);
    const sgst_p  = gst_p - cgst_p;   // gets odd paise — cgst_p + sgst_p === gst_p always
    return {
      base:    toRupees(base_p).toFixed(2),
      gstAmt:  toRupees(gst_p).toFixed(2),
      selling: toRupees(sell_p).toFixed(2),
      cgst:    toRupees(cgst_p).toFixed(2),
      sgst:    toRupees(sgst_p).toFixed(2),
    };
  }

  // FIX #3: paise-based. selling_price is primary input; price auto-computed.
  function handleSellingPriceChange(val) {
    const sell_p   = toPaise(val || 0);
    const rate     = parseFloat(form.gst_rate) || 0;
    const base_p   = removeGst(sell_p, rate);
    const base_r   = toRupees(base_p);
    setForm(f => ({ ...f, selling_price: val, price: String(base_r) }));
    // Update auto-generated variants proportionally with chosen strategy
    if (variants.length > 0 && sell_p > 0) {
      const gst = parseFloat(form.gst_rate) || 5;
      setVariants(vs => vs.map(v => {
        if (!v.variant_value || !v._autoGenerated) return v;
        const calcd = calcVariantPrices(toRupees(sell_p), avBaseUnit || '250g', [v.variant_value], gst, variantStrategy);
        return { ...v, price: calcd[0]?.price ?? v.price, _base: calcd[0]?.original_price ?? v._base };
      }));
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // FIX #1 + #6 + #8 + #25 + #32: Complete save() rewrite
  // ─────────────────────────────────────────────────────────────────────────
  async function save() {
    // selling_price OR price (fallback for existing products not yet migrated)
    const hasSellPrice = form.selling_price || form.price || form.mrp;
    if (!form.name || !hasSellPrice) return alert('Name and Selling Price are required');
    // state_id validation — read directly from DOM as final source of truth
    const stateEl = document.querySelector('select[data-field="state_id"]');
    const domStateVal = stateEl ? (stateEl.value || '').trim() : '';
    const _sid = domStateVal || (form.state_id ? String(form.state_id).trim() : '');
    if (!_sid) return alert('Please select a State for this product');
    // Sync DOM value back to form state if they differ
    if (domStateVal && domStateVal !== form.state_id) {
      setForm(f => ({ ...f, state_id: domStateVal }));
    }
    if (variants.length === 0) return alert('⚠️ At least one variant is required.\nUse ⚡ Auto-generate or + Add Variant.');

    // For existing products loaded from DB, use available_stock as fallback
    const missingStock = variants.filter(v =>
      v.variant_value && v.price &&
      !v._id &&  // only check NEW variants (existing ones already have stock in DB)
      (!v.initial_stock || parseInt(v.initial_stock) <= 0)
    );
    if (missingStock.length > 0)
      return alert(`⚠️ Initial Stock required for: ${missingStock.map(v => v.variant_value).join(', ')}\n\nThis is needed for inventory tracking.`);

    const varVals = variants.map(v => v.variant_value?.toLowerCase().trim()).filter(Boolean);
    if (varVals.length !== new Set(varVals).size)
      return alert('❌ Duplicate variant sizes. Each variant must be unique.');

    // ── FIX #1: CORRECT field mapping ────────────────────────────────────────
    const sellingPrice   = parseFloat(form.selling_price)    || 0;
    const gstRate        = parseFloat(form.gst_rate)         || 5;
    const basePrice      = toRupees(removeGst(toPaise(sellingPrice), gstRate));
    const legalMrp       = parseFloat(form.mrp)              || sellingPrice;
    const compareAt      = parseFloat(form.compare_at_price) || legalMrp;
    const costPrice      = parseFloat(form.cost_price)       || null;

    // MRP guard
    if (legalMrp > 0 && legalMrp < sellingPrice) {
      setMrpError(`Legal MRP (₹${legalMrp}) cannot be less than Selling Price (₹${sellingPrice.toFixed(0)})`);
      return alert(`❌ Legal MRP (₹${legalMrp}) cannot be less than Selling Price (₹${sellingPrice.toFixed(0)}).\n\nMRP is the maximum price printed on the package. It must be ≥ what you charge.`);
    }

    // ── FIX #6: Margin guard ─────────────────────────────────────────────────
    if (costPrice && sellingPrice > 0) {
      const grossMargin = (sellingPrice - costPrice) / sellingPrice * 100;
      if (grossMargin < 0) {
        return alert(`❌ Cannot save: Selling price (₹${sellingPrice}) is BELOW cost price (₹${costPrice}).\nYou would lose ₹${(costPrice - sellingPrice).toFixed(2)} on every sale.`);
      }
      if (grossMargin < 8) {
        const proceed = window.confirm(
          `⚠️ Warning: Gross margin is only ${grossMargin.toFixed(1)}%\n\n` +
          `The safe minimum is 8%. After logistics, returns and fees, this product will likely run at a loss.\n\n` +
          `Continue anyway?`
        );
        if (!proceed) return;
      }
    }

    setSaving(true);
    try {
      const badges = [];
      if (form.badges_bestseller) badges.push('bestseller');
      if (form.badges_organic)    badges.push('organic');
      if (form.badges_new)        badges.push('new');
      const tags    = form.tags ? form.tags.split(',').map(t => t.trim()).filter(Boolean) : [];
      // Use _sid computed above from DOM (reliable) or fall back to form
      const stateId = _sid || null;
      if (!stateId) { setSaving(false); return alert('Please select a valid State'); }

      const body = {
        name:               form.name,
        slug:               form.slug || form.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''),
        emoji:              form.emoji || null,
        category_id:        form.category_id ? parseInt(form.category_id) : null, // FIX-B4: was sending string — DB expects integer
        state_id:           stateId,
        vendor_id:          form.vendor_id ? parseInt(form.vendor_id) : null,
        status:             form.status,
        unit_label:         form.unit_label || null,
        gst_rate:           gstRate,

        // ── FIX #1: CORRECT column mapping ─────────────────────────────────
        price:              basePrice,          // base excl GST (for calculation)
        selling_price:      sellingPrice,       // customer pays incl GST → DB selling_price
        mrp:                legalMrp,           // legal MRP on package
        compare_at_price:   compareAt,          // strikethrough shown on website
        cost_price:         costPrice,          // landed cost at warehouse

        short_description:  form.short_description || null,
        long_description:   form.long_description  || null,
        image_url:          form.image_url  || null,
        video_url:          form.video_url  || null,
        tags:               tags.length ? tags : null,
        badges:             badges.length ? badges : null,
        available_stock:    0,  // trigger trg_sync_product_stock will update this
      };

      let prodId = modal === 'add' ? null : modal.id;

      if (modal === 'add') {
        const r = await api.post('products', { ...body, is_deleted: false });
        prodId = r?.[0]?.id || r?.id || null;
        if (!prodId) throw new Error('Product created but ID not returned — please check and try again.');
      } else {
        // FIX #8: Optimistic locking via Postgres RPC — checks price_version atomically
        const lockRes = await api.rpc('update_product_with_version', {
          p_id: modal.id, p_expected_version: form.price_version || 1, p_body: body,
        }).catch(() => null);
        if (lockRes?.ok === false && lockRes?.conflict) {
          setSaving(false);
          return alert('⚠️ Version conflict!\n\nAnother admin changed this product while you were editing.\nPlease close and reopen to get the latest version.');
        }
        // FIX-B5: RPC may not be deployed or may not update all fields (e.g. category_id).
        // Always do a direct PATCH with the full body to guarantee all fields are saved.
        await api.patch('products', `id=eq.${modal.id}`, body);
        prodId = modal.id;
      }

      if (prodId) await saveVariants(prodId);

      // Silent background AI generation
      const needsAI = modal === 'add' || !form.short_description?.trim() || (modal !== 'add' && form.name !== modal.name);
      if (needsAI && prodId) {
        const pw = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('pr_token') : '';
        const catName = categories.find(c => c.id === form.category_id)?.name || '';
        fetch('/api/admin', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-session-token': pw || '' },
          body: JSON.stringify({
            action: 'generate_ai_content', productId: prodId,
            name: form.name, category: catName,
            ingredients: Array.isArray(form.tags) ? form.tags.join(', ') : (form.tags || ''),
          }),
        }).catch(() => {});
      }

      // Price history handled by DB trigger trg_price_history
      // Trigger fires automatically on products.selling_price/mrp/cost_price UPDATE

      // P1.2 — Product versioning handled by DB trigger trg_product_version
      // Trigger fires automatically on products UPDATE/INSERT — no client code needed

      // P1.3 — GST audit trail handled by DB trigger trg_gst_audit
      // Trigger fires automatically on products.gst_rate UPDATE — no client code needed

      setModal(null);
      setMrpError('');
      load();
    } catch (e) {
      alert('Error saving: ' + e.message);
    } finally {
      setSaving(false);
    }
  }

  async function saveVariants(prodId) {
    // Uses categories from outer ProductsTab scope (closure) — same as the memoized catMap.
    // Rebuilt locally here as a plain object since useMemo value isn't directly accessible
    // inside this async function's closure without prop drilling. At variant-save time,
    // categories is a small array so this single rebuild is negligible.
    const catMap   = Object.fromEntries(categories.map(cat => [cat.id, cat.name]));
    const dbVars   = await api.get('product_variants', `product_id=eq.${prodId}`).catch(() => []);
    const keptIds  = new Set(variants.filter(v => v._id).map(v => String(v._id)));
    const keptVals = new Set(variants.map(v => v.variant_value?.toLowerCase().trim()).filter(Boolean));
    const toDelete = (dbVars || []).filter(dbV =>
      !keptIds.has(String(dbV.id)) && !keptVals.has(dbV.variant_value?.toLowerCase().trim())
    );
    if (toDelete.length > 0) {
      await Promise.all(toDelete.map(dbV => api.delete('product_variants', `id=eq.${dbV.id}`).catch(() => {})));
      await new Promise(r => setTimeout(r, 400));
    }
    const freshDbVars = await api.get('product_variants', `product_id=eq.${prodId}`).catch(() => []);
    const dbByVal = Object.fromEntries((freshDbVars || []).map(v => [v.variant_value?.toLowerCase().trim(), v]));
    for (let i = 0; i < variants.length; i++) {
      const v = variants[i];
      if (!v.variant_value || !v.price) continue;
      const initialStock = parseInt(v.initial_stock) || parseInt(v.available_stock) || 0;
      const stockQty     = parseInt(v.available_stock) || initialStock;
      const sellPrice    = parseFloat(v.price) || 0;
      const gst          = parseFloat(form.gst_rate) || 5;
      const baseP        = parseFloat(v._base) || toRupees(removeGst(toPaise(sellPrice), gst));

      // ── Non-stock fields only — stock is managed through adjust_variant_stock RPC
      // RULE: Never write available_stock directly for existing variants.
      //   Direct writes bypass the advisory lock, the stock_movements ledger,
      //   and the trg_sync_product_stock trigger, causing concurrent drift.
      const vBodyBase = {
        product_id:      prodId,
        variant_type:    v.variant_type || 'weight',
        variant_value:   v.variant_value,
        sku:             v.sku || generateSku(form.name, v.variant_value, catMap[String(form.category_id)] || ''),
        price:           sellPrice,           // selling price incl GST
        original_price:  baseP,               // base excl GST
        initial_stock:   initialStock,
        orders_reserved: v.orders_reserved || 0,
        is_active:       v.is_active !== false,
        sort_order:      i,
      };

      try {
        const existingById  = v._id ? String(v._id) : null;
        const existingByVal = dbByVal[v.variant_value?.toLowerCase().trim()];

        // FIX #9: DB-side SKU collision check before inserting new variant
        if (!existingById && !existingByVal && vBodyBase.sku) {
          let finalSku = vBodyBase.sku;
          for (let attempt = 0; attempt < 5; attempt++) {
            const hit = await api.rpc('sku_exists', { p_sku: finalSku, p_exclude_variant_id: null }).catch(() => false);
            if (!hit) break;
            finalSku = generateSku(form.name, v.variant_value, catMap[String(form.category_id)] || '');
          }
          vBodyBase.sku = finalSku;
        }

        if (existingById || existingByVal) {
          // EXISTING VARIANT — update non-stock fields only
          const variantId = existingById || String(existingByVal.id);
          await api.patch('product_variants', `id=eq.${variantId}`, vBodyBase);

          // Stock adjustment via RPC — atomic, advisory-locked, ledger-tracked
          const dbStock = existingById
            ? (freshDbVars.find(r => String(r.id) === variantId)?.available_stock ?? 0)
            : (existingByVal.available_stock ?? 0);
          const delta = stockQty - dbStock;
          if (delta !== 0) {
            let retries = 0;
            while (retries < 3) {
              const res = await api.rpc('adjust_variant_stock', {
                p_variant_id:   parseInt(variantId),
                p_delta:        delta,
                p_reason:       'manual',
                p_reference_id: `catalogue_save_${prodId}`,
              }).catch(e => ({ ok: false, error: e.message }));
              if (res?.ok) break;
              if (!res?.retry) throw new Error(`Stock adjust failed for "${v.variant_value}": ${res?.error}`);
              await new Promise(r => setTimeout(r, 150 * (retries + 1)));
              retries++;
            }
          }
        } else {
          // NEW VARIANT — INSERT with initial stock (no prior DB record to delta against)
          await api.post('product_variants', { ...vBodyBase, available_stock: stockQty });
          // trg_variant_insert fires → stock_movements 'stock_in' entry created automatically
        }
      } catch (e) {
        throw new Error(`Variant "${v.variant_value}" failed: ${e.message}`);
      }
    }
  }

  function addVariant() {
    const gst = parseFloat(form.gst_rate) || 5;
    setVariants(vs => [...vs, { variant_type: 'weight', variant_value: '', price: '', available_stock: 0, initial_stock: 0, returned_good: 0, is_active: true, _gst: gst, sku: '' }]);
  }

  function removeVariant(i) {
    setVariants(vs => { const next = vs.filter((_, idx) => idx !== i); syncPricingFromVariants(next); return next; });
  }

  function updateVariant(i, key, val) {
    if (key === 'variant_value' && val.trim()) {
      const dup = variants.some((v, idx) => idx !== i && v.variant_value?.toLowerCase().trim() === val.toLowerCase().trim());
      if (dup) { alert(`❌ Variant "${val}" already exists.`); return; }
    }
    setVariants(vs => {
      const next = vs.map((v, idx) => {
        if (idx !== i) return v;
        const updated = { ...v, [key]: val };
        if (key === 'price') {
          const gst = parseFloat(form.gst_rate) || 5;
          updated._base = parseFloat(val) > 0 ? String(toRupees(removeGst(toPaise(val), gst))) : '';
        }
        if (key === 'variant_value' && !v._skuManual) {
          // IMMUTABLE SKU: only generate for NEW variants (no existing sku)
          // Once a SKU is saved to DB, it must NEVER change — breaks orders/invoices/3PL
          if (!v.sku && !v._id) {
            updated.sku = generateSku(form.name, val, catMap[String(form.category_id)] || '');
          }
        }
        return updated;
      });
      if (key === 'price' || key === 'is_active') syncPricingFromVariants(next);
      return next;
    });
  }

  function syncPricingFromVariants(updatedVariants, gstRateOverride) {
    const gst    = gstRateOverride || parseFloat(form.gst_rate) || 5;
    const active = updatedVariants.filter(v => v.price && parseFloat(v.price) > 0 && v.is_active !== false);
    if (active.length === 0) return;
    const lowestSell  = Math.min(...active.map(v => parseFloat(v.price)));
    const lowestBase  = toRupees(removeGst(toPaise(lowestSell), gst));
    setForm(f => ({ ...f, selling_price: String(lowestSell), price: String(lowestBase) }));
  }

  // P3.1: Bulk operations helpers
  function toggleSelect(id) {
    setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function toggleSelectAll() {
    setSelected(s => s.size === filtered.length ? new Set() : new Set(filtered.map(p => p.id)));
  }
  async function bulkArchive() {
    if (selected.size === 0) return;
    if (!confirm(`Archive ${selected.size} products? They will be hidden from the store.`)) return;
    setBulkLoading(true);
    try {
      for (const id of selected) {
        await api.patch('products', `id=eq.${id}`, { status: 'archived', is_deleted: true, deleted_at: new Date().toISOString() });
      }
      setSelected(new Set());
      load();
    } catch (e) { alert('Error: ' + e.message); }
    finally { setBulkLoading(false); }
  }
  async function bulkStatusChange(newStatus) {
    if (selected.size === 0) return;
    if (!confirm(`Set ${selected.size} products to "${newStatus}"?`)) return;
    setBulkLoading(true);
    try {
      for (const id of selected) {
        await api.patch('products', `id=eq.${id}`, { status: newStatus });
      }
      setSelected(new Set());
      load();
    } catch (e) { alert('Error: ' + e.message); }
    finally { setBulkLoading(false); }
  }
  function exportCSV() {
    // P3.2: Export current filtered products as CSV
    const cols = ['id','name','status','category_id','selling_price','mrp','cost_price','gst_rate','available_stock'];
    const header = cols.join(',');
    const rows = filtered.map(p =>
      cols.map(c => {
        const v = p[c] ?? '';
        return typeof v === 'string' && v.includes(',') ? `"${v}"` : v;
      }).join(',')
    );
    const csv = [header, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url;
    a.download = `catalogue-export-${new Date().toISOString().split('T')[0]}.csv`;
    a.click(); URL.revokeObjectURL(url);
  }

  // FIX #4: Use calcVariantPrices with strategy instead of linear math
  function autoGenerate() {
    const basePrice = parseFloat(avBasePrice) || parseFloat(form.selling_price) || 0;
    if (!basePrice) return alert('Set a selling price or base price first');
    if (!avSelectedSizes.length) return alert('Select at least one size');
    const existingNow   = new Set(variants.map(v => v.variant_value?.toLowerCase().trim()).filter(Boolean));
    const alreadyExists = avSelectedSizes.filter(s => existingNow.has(s.toLowerCase().trim()));
    const fresh         = avSelectedSizes.filter(s => !existingNow.has(s.toLowerCase().trim()));
    if (alreadyExists.length > 0) {
      if (fresh.length === 0) return alert(`❌ All selected sizes already exist.`);
      if (!confirm(`"${alreadyExists.join(', ')}" already exist — will be skipped.\nGenerate only: ${fresh.join(', ')}?`)) return;
    }
    setAutoPanel(false);
    setVariants(vs => {
      const existing = new Set(vs.map(v => v.variant_value?.toLowerCase().trim()).filter(Boolean));
      const gst = parseFloat(form.gst_rate) || 5;
      const newSizes = avSelectedSizes.filter(s => !existing.has(s.toLowerCase().trim()));
      // FIX #4: use calcVariantPrices with chosen strategy
      const calculated = calcVariantPrices(basePrice, avBaseUnit, newSizes, gst, variantStrategy);
      const newVars = calculated.map(c => ({
        variant_type:  avUnitType === 'liquid' ? 'volume' : 'weight',
        variant_value: c.variant_value,
        price:         c.price,
        available_stock: 0, initial_stock: 0, returned_good: 0, is_active: true,
        _base:         c.original_price,
        _autoGenerated: true,
        // New auto-generated variant — no existing SKU so safe to generate
        sku:           generateSku(form.name, c.variant_value, catMap[String(form.category_id)] || ''),
      }));
      const next = [...vs, ...newVars];
      syncPricingFromVariants(next);
      return next;
    });
  }

  // FIX #32: soft delete instead of hard delete
  async function softDeleteProduct(p) {
    if (!confirm(`Archive "${p.name}"? It will be hidden from the store and cannot be ordered.`)) return;
    try {
      await api.patch('products', `id=eq.${p.id}`, {
        is_deleted:  true,
        deleted_at:  new Date().toISOString(),
        status:      'archived', // FIX-B3: was 'inactive' — now correctly sets archived state
      });
      load();
    } catch (e) { alert('Error: ' + e.message); }
  }

  async function toggleStatus(p) {
    // Enterprise states: active ↔ out_of_stock (not 'inactive' — removed from state machine)
    const next = p.status === 'active' ? 'out_of_stock' : 'active';
    await api.patch('products', `id=eq.${p.id}`, { status: next });
    load();
  }

  // Image modal
  async function openImgModal() {
    setImgModal(true); setUploadStatus('');
    if (modal !== 'add' && modal?.id) {
      const rows = await api.get('product_images', `product_id=eq.${modal.id}&order=sort_order.asc`).catch(() => []);
      setProdImages(rows || []);
    } else {
      setProdImages([]);
    }
  }

  async function handleImageUpload(files) {
    if (!files.length) return;
    if (modal === 'add' || !modal?.id) { alert('Save the product first, then upload images'); return; }
    setUploading(true);
    try {
      const existing = await api.get('product_images', `product_id=eq.${modal.id}&order=sort_order.desc&limit=1`).catch(() => []);
      let nextOrder = existing?.[0]?.sort_order !== undefined ? existing[0].sort_order + 1 : 0;
      const urls = [];
      for (let i = 0; i < files.length; i++) {
        setUploadStatus(`⏳ Uploading ${i + 1}/${files.length}…`);
        const url = await compressAndUpload(files[i], `products/prod-${modal.id}-${Date.now()}-${i}`);
        await api.post('product_images', { product_id: modal.id, image_url: url, sort_order: nextOrder + i });
        urls.push(url);
      }
      const first = await api.get('product_images', `product_id=eq.${modal.id}&order=sort_order.asc&limit=1`).catch(() => []);
      const mainUrl = first?.[0]?.image_url || urls[0];
      setForm(f => ({ ...f, image_url: mainUrl }));
      await api.patch('products', `id=eq.${modal.id}`, { image_url: mainUrl }).catch(() => {});
      setUploadStatus(`✅ ${urls.length} image(s) uploaded!`);
      const rows = await api.get('product_images', `product_id=eq.${modal.id}&order=sort_order.asc`).catch(() => []);
      setProdImages(rows || []);
    } catch (e) { setUploadStatus('❌ ' + e.message); }
    finally { setUploading(false); }
  }

  async function deleteImage(imgId) {
    await api.delete('product_images', `id=eq.${imgId}`).catch(() => {});
    const rows = await api.get('product_images', `product_id=eq.${modal.id}&order=sort_order.asc`).catch(() => []);
    setProdImages(rows || []);
    const mainUrl = rows?.[0]?.image_url || '';
    setForm(f => ({ ...f, image_url: mainUrl }));
    if (modal?.id) await api.patch('products', `id=eq.${modal.id}`, { image_url: mainUrl }).catch(() => {});
  }

  async function handleVideoUpload(file) {
    if (!file) return;
    if (modal === 'add' || !modal?.id) { alert('Save the product first, then upload a video'); return; }
    const allowed = ['video/mp4', 'video/webm', 'video/ogg', 'video/quicktime'];
    if (!allowed.includes(file.type) && !file.name.match(/\.(mp4|webm|ogg|mov)$/i)) {
      alert('Please select a video file (MP4, WebM, MOV)'); return;
    }
    setVideoUploading(true);
    setVideoUploadStatus('⏳ Uploading video…');
    try {
      const url = await uploadVideo(file, `products/video-prod-${modal.id}-${Date.now()}`);
      setForm(f => ({ ...f, video_url: url }));
      await api.patch('products', `id=eq.${modal.id}`, { video_url: url }).catch(() => {});
      setVideoUploadStatus('✅ Video uploaded!');
    } catch (e) {
      setVideoUploadStatus('❌ ' + e.message);
    } finally {
      setVideoUploading(false);
    }
  }

  const gst = calcGST();
  // FIX-A4: Memoized category map — O(1) lookup instead of O(n) scan on every render.
  // FIX-B4: Keys are String(id) so lookups work whether category_id is int or string.
  const catMap = useMemo(
    () => Object.fromEntries(categories.map(c => [String(c.id), c.name])),
    [categories]
  );

  const filtered = products.filter(p => {
    if (debouncedSearch && !p.name.toLowerCase().includes(debouncedSearch.toLowerCase())) return false;
    if (filterCat && catMap[String(p.category_id)] !== filterCat) return false;
    if (filterSize || filterStock) {
      const vars = variantStockMap[p.id] || [];
      const match = vars.some(v => {
        if (filterSize && v.variant_value !== filterSize) return false;
        if (filterStock === 'out' && v.available_stock !== 0) return false;
        if (filterStock === 'low' && !(v.available_stock > 0 && v.available_stock <= 5)) return false;
        if (filterStock === 'ok' && !(v.available_stock > 10)) return false;
        return true;
      });
      if (!match) return false;
    }
    return true;
  });
  const hasFilter = search || filterCat || filterSize || filterStock;
  const allSizes = [...new Set(products.flatMap(p => (variantStockMap[p.id] || []).map(v => v.variant_value)).filter(Boolean))].sort((a, b) => parseGrams(a) - parseGrams(b));
  const totalVariants = filtered.reduce((s, p) => s + (variantStockMap[p.id] || []).length, 0);

  // Live margin health for pricing tab
  const sellingF  = parseFloat(form.selling_price) || 0;
  const costF     = parseFloat(form.cost_price)     || 0;
  const liveMargin = sellingF > 0 && costF > 0 ? (sellingF - costF) / sellingF * 100 : null;
  const liveHealth = liveMargin !== null ? marginHealth(liveMargin) : null;
  const liveMeta   = liveHealth ? MARGIN_LABELS[liveHealth] : null;

  // Psychological price suggestions
  const psySell = sellingF > 0 ? psychologicalRound(sellingF) : null;

  if (loading) return <Loader text="Loading products…" />;
  if (error)   return <ErrorMsg error={error} onRetry={load} />;

  return (
    <div className="space-y-4">
      {/* Image Upload Sub-Modal */}
      {imgModal && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.7)' }}>
          <div className="rounded-2xl p-6 w-full max-w-lg" style={{ background: 'var(--bg2,#161b22)', border: '1px solid var(--bd,#1a5c2a)' }}>
            <div className="flex justify-between items-center mb-4">
              <div className="text-[13px] font-bold" style={{ color: 'var(--tx,#fff)' }}>📸 Product Images</div>
              <button onClick={() => setImgModal(false)} className="text-[var(--tx3)] hover:text-[var(--tx)] text-lg">×</button>
            </div>
            {prodImages.length > 0 ? (
              <div className="flex flex-wrap gap-2 mb-4">
                {prodImages.map((img, i) => (
                  <div key={img.id} className="relative">
                    <img src={img.image_url} alt="" className="rounded-lg object-cover border-2"
                      style={{ width: i === 0 ? '100%' : '72px', height: i === 0 ? '160px' : '72px', borderColor: i === 0 ? 'var(--accent,#1a5c2a)' : 'var(--bd,#1a5c2a)' }}
                      onError={e => { e.target.style.opacity = '0.3'; }} />
                    <div className="absolute top-1 left-1 text-[8px] font-bold px-1 rounded" style={{ background: 'rgba(0,0,0,0.7)', color: '#fff' }}>{i === 0 ? 'Main' : `#${i + 1}`}</div>
                    <button onClick={() => deleteImage(img.id)} className="absolute top-1 right-1 w-4 h-4 rounded text-[var(--tx)] flex items-center justify-center text-[10px]" style={{ background: 'rgba(220,50,50,0.85)' }}>×</button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-6 text-[12px] text-gray-500 mb-4">
                {modal === 'add' || !modal?.id ? 'Save product first to upload images' : 'No images yet'}
              </div>
            )}
            {modal !== 'add' && modal?.id && (
              <div className="space-y-2">
                <label className="block text-[10px] font-bold uppercase tracking-wider text-[var(--tx3)]">Upload New Images</label>
                <input type="file" accept="image/*" multiple
                  onChange={e => handleImageUpload(Array.from(e.target.files))}
                  disabled={uploading}
                  className="w-full text-[12px] text-[var(--tx2)] file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-[11px] file:font-bold file:text-[var(--tx)] cursor-pointer" />
                {uploadStatus && <div className="text-[11px] mt-1" style={{ color: uploadStatus.startsWith('✅') ? '#3fb950' : uploadStatus.startsWith('❌') ? '#f85149' : '#d29922' }}>{uploadStatus}</div>}
              </div>
            )}
            {/* Video Upload */}
            <div className="mt-4 pt-4" style={{ borderTop: '1px solid var(--bd,#1a5c2a)' }}>
              <div className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--tx3)' }}>🎬 Product Video (optional)</div>
              {form.video_url ? (
                <div className="mb-3">
                  <video src={form.video_url} controls className="w-full rounded-lg" style={{ maxHeight: '160px', border: '1px solid var(--bd,#1a5c2a)', background: '#000' }} />
                  <div className="flex gap-2 mt-2">
                    <div className="flex-1 text-[10px] truncate font-mono py-1 px-2 rounded" style={{ background: 'var(--bg,#0d1117)', color: 'var(--tx2)', border: '1px solid var(--bd)' }}>
                      {form.video_url.split('/').pop()}
                    </div>
                    <button onClick={() => { setForm(f => ({ ...f, video_url: '' })); setVideoUploadStatus(''); if (modal?.id) api.patch('products', `id=eq.${modal.id}`, { video_url: null }).catch(() => {}); }}
                      className="px-2 py-1 rounded text-[11px] font-bold flex-shrink-0"
                      style={{ background: 'rgba(248,81,73,0.12)', color: '#f85149', border: '1px solid rgba(248,81,73,0.3)' }}>
                      ✕ Remove
                    </button>
                  </div>
                </div>
              ) : (
                <div className="text-[11px] mb-2 py-2 text-center rounded-lg" style={{ color: 'var(--tx3)', background: 'var(--bg,#0d1117)', border: '1px dashed var(--bd)' }}>No video yet</div>
              )}
              {modal !== 'add' && modal?.id && (
                <div className="space-y-2">
                  <input type="file" accept="video/mp4,video/webm,video/ogg,video/quicktime,.mp4,.webm,.mov"
                    onChange={e => handleVideoUpload(e.target.files[0])}
                    disabled={videoUploading}
                    className="w-full text-[12px] text-[var(--tx2)] file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-[11px] file:font-bold file:text-[var(--tx)] cursor-pointer" />
                  <div className="text-[10px]" style={{ color: 'var(--tx3)' }}>MP4, WebM or MOV · Max 50MB</div>
                  {videoUploadStatus && <div className="text-[11px]" style={{ color: videoUploadStatus.startsWith('✅') ? '#3fb950' : videoUploadStatus.startsWith('❌') ? '#f85149' : '#d29922' }}>{videoUploadStatus}</div>}
                  <input value={form.video_url || ''} onChange={e => setForm(f => ({ ...f, video_url: e.target.value }))}
                    placeholder="or paste video URL…"
                    className="w-full rounded-lg px-3 py-1.5 text-[11px] outline-none font-mono"
                    style={{ background: 'var(--bg,#0d1117)', border: '1px solid var(--bd)', color: 'var(--tx)' }} />
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Product Add/Edit Modal */}
      {modal && (
        <Modal
          title={modal === 'add' ? '+ Add Product' : `Edit — ${modal.name}`}
          onClose={() => {
            // FIX #41: cancel any in-flight AI request on modal close
            if (aiAbortRef.current) aiAbortRef.current.abort();
            setModal(null); setModalTab('basic'); setMrpError('');
          }}
          fullscreen
        >
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            {/* Tab nav */}
            <div style={{ display: 'flex', gap: 0, borderBottom: '2px solid var(--bd,#1a5c2a)', marginBottom: '18px', flexShrink: 0 }}>
              {[
                { id: 'basic',   label: '📋 Basic Info' },
                { id: 'pricing', label: '💰 Pricing & Variants' },
                { id: 'ai',      label: '🤖 AI Content', badge: aiSaved ? '✓' : null },
              ].map(tab => (
                <button key={tab.id} onClick={() => setModalTab(tab.id)}
                  className="px-4 py-2 text-[12px] font-bold transition flex items-center gap-1.5"
                  style={{
                    borderBottom: modalTab === tab.id ? '2px solid var(--accent,#1a5c2a)' : '2px solid transparent',
                    marginBottom: '-2px', color: modalTab === tab.id ? 'var(--accent,#1a5c2a)' : 'var(--tx2,#6e9a75)',
                    background: 'transparent',
                  }}>
                  {tab.label}
                  {tab.badge && <span className="text-[9px] px-1.5 py-0.5 rounded-full font-bold" style={{ background: 'rgba(63,185,80,0.2)', color: '#3fb950' }}>{tab.badge}</span>}
                </button>
              ))}
            </div>

            {/* Pricing prefill banner */}
            {prefillPricing && modal === 'add' && (
              <div style={{ margin: '0 0 16px 0', padding: '12px 20px', background: 'rgba(63,185,80,0.07)', border: '1px solid rgba(63,185,80,0.25)', borderRadius: 10, flexShrink: 0 }}>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#6e9a75', marginBottom: 8 }}>
                  ✓ Pricing pre-filled from calculator — add name, category &amp; state to complete
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
                  {[
                    { label: 'Base price (excl GST)',   val: '₹' + prefillPricing.price },
                    { label: 'Selling price (incl GST)', val: '₹' + prefillPricing.mrp, accent: true },
                    { label: 'Legal MRP',                val: '₹' + prefillPricing.mrp_display },
                    { label: 'Cost price',               val: '₹' + prefillPricing.cost_price },
                    { label: 'GST rate',                 val: prefillPricing.gst_rate + '%' },
                    { label: 'Gross margin',             val: prefillPricing._margin_pct + '%' },
                  ].map((item, i) => (
                    <div key={i}>
                      <div style={{ fontSize: 10, color: '#6e9a75' }}>{item.label}</div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: item.accent ? '#3fb950' : 'var(--tx,#e6edf3)' }}>{item.val}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, paddingRight: '4px' }}>

              {/* ── BASIC INFO TAB ── */}
              {modalTab === 'basic' && (
                <div className="space-y-3">
                  <div className="text-[10px] font-bold uppercase tracking-widest mb-3 pb-1" style={{ color: 'var(--accent,#1a5c2a)', borderBottom: '1px solid var(--bd,#1a5c2a)' }}>📋 Basic Info</div>
                  {/* NAME + STATUS — same Field component as every other row */}
                  <div className="grid gap-2" style={{ gridTemplateColumns: '1fr 130px' }}>
                    <Field label="NAME *">
                      <input value={form.name} onChange={e => {
                        const name = e.target.value;
                        setForm(f => ({ ...f, name, slug: f.slug || name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') }));
                      }} className={inp} placeholder="Product name" />
                    </Field>
                    <Field label="STATUS">
                      <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))} className={inp}>
                        <option value="active">✅ Active</option>
                        <option value="draft">📝 Draft</option>
                        <option value="out_of_stock">⏸ Out of Stock</option>
                        <option value="review">🔍 Under Review</option>
                        <option value="discontinued">🚫 Discontinued</option>
                        <option value="blocked">🔒 Blocked</option>
                      </select>
                    </Field>
                  </div>

                  {/* SLUG + VENDOR side by side */}
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="SLUG"><input value={form.slug} onChange={e => setForm(f => ({ ...f, slug: e.target.value }))} className={inp} placeholder="auto-generated from name" /></Field>
                    <Field label="VENDOR / SUPPLIER">
                      <select value={form.vendor_id || ''} onChange={e => setForm(f => ({ ...f, vendor_id: e.target.value }))} className={inp}>
                        <option value="">— None —</option>
                        {vendors.filter(v => v.status === 'active').map(v => (
                          <option key={v.id} value={String(v.id)}>{v.business_name} ({v.name})</option>
                        ))}
                      </select>
                    </Field>
                  </div>

                  {/* EMOJI | UNIT LABEL | CATEGORY | STATE — 2x2 balanced grid */}
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="EMOJI"><input value={form.emoji} onChange={e => setForm(f => ({ ...f, emoji: e.target.value }))} className={inp} placeholder="🍯" /></Field>
                    <Field label="UNIT LABEL"><input value={form.unit_label || ''} onChange={e => setForm(f => ({ ...f, unit_label: e.target.value }))} className={inp} placeholder="e.g. per 500g jar" /></Field>
                    <Field label="CATEGORY">
                      <select
                        value={form.category_id || ''}
                        onChange={e => setForm(f => ({ ...f, category_id: e.target.value }))}
                        className={inp}
                        style={{ borderColor: !form.category_id ? '#f85149' : undefined }}
                      >
                        <option value="">⚠️ Select…</option>
                        {categories.map(c => <option key={c.id} value={String(c.id)}>{c.name}</option>)}
                      </select>
                      {!form.category_id && (
                        <div className="mt-1 text-[11px] font-semibold" style={{ color: '#f85149' }}>
                          Required — won't show in store
                        </div>
                      )}
                    </Field>
                    <Field label="STATE *">
                      <select data-field="state_id" value={form.state_id || ''} onChange={e => setForm(f => ({ ...f, state_id: e.target.value }))} className={inp}>
                        <option value="">Select…</option>
                        {states.map(s => <option key={s.id} value={String(s.id)}>{s.name}</option>)}
                      </select>
                    </Field>
                  </div>
                  <Field label="SHORT DESCRIPTION">
                    <textarea value={form.short_description} onChange={e => setForm(f => ({ ...f, short_description: e.target.value }))} className={inp + ' resize-none'} style={{ height: '72px' }} placeholder="Shown in product cards…" />
                  </Field>
                  <Field label="LONG DESCRIPTION">
                    <textarea value={form.long_description} onChange={e => setForm(f => ({ ...f, long_description: e.target.value }))} className={inp + ' resize-none'} style={{ height: '96px' }} placeholder="Full description…" />
                  </Field>
                  <Field label="TAGS (comma separated)">
                    <input value={form.tags} onChange={e => setForm(f => ({ ...f, tags: e.target.value }))} className={inp} placeholder="himalayan, natural, raw…" />
                  </Field>
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider mb-2 text-[var(--tx3)]">BADGES</label>
                    <div className="flex gap-2 flex-wrap">
                      {[
                        { key: 'badges_bestseller', label: '🏆 Bestseller', color: 'var(--yellow)' },
                        { key: 'badges_organic',    label: '🌿 Natural',    color: '#3fb950' },
                        { key: 'badges_new',        label: '✨ New',         color: 'var(--blue)' },
                      ].map(b => (
                        <label key={b.key} className="flex items-center gap-1.5 cursor-pointer px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition"
                          style={{ background: form[b.key] ? `${b.color}22` : 'var(--bg,#0d1117)', border: `1px solid ${form[b.key] ? b.color : 'var(--bd,#1a5c2a)'}`, color: form[b.key] ? b.color : 'var(--tx2,#6e9a75)' }}>
                          <input type="checkbox" checked={form[b.key]} onChange={e => setForm(f => ({ ...f, [b.key]: e.target.checked }))} className="accent-green-600" />
                          {b.label}
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* ── PRICING & VARIANTS TAB ── */}
              {modalTab === 'pricing' && (
                <div style={{ display: 'flex', gap: '20px', alignItems: 'flex-start' }}>
                  {/* LEFT: Pricing */}
                  <div className="space-y-3" style={{ flex: '1', minWidth: 0 }}>
                    <div className="text-[10px] font-bold uppercase tracking-widest mb-3 pb-1" style={{ color: 'var(--accent,#1a5c2a)', borderBottom: '1px solid var(--bd,#1a5c2a)' }}>💰 Pricing</div>

                    <div className="grid grid-cols-2 gap-2">
                      <Field label="GST RATE">
                        <select value={form.gst_rate} onChange={e => {
                          const rate = parseFloat(e.target.value) || 0;
                          const sell_p = toPaise(form.selling_price || 0);
                          const base_p = removeGst(sell_p, rate);
                          setForm(f => ({ ...f, gst_rate: e.target.value, price: String(toRupees(base_p)) }));
                        }} className={inp}>
                          {gstRates.map(r => <option key={r.value} value={r.value}>{r.value}%</option>)}
                        </select>
                      </Field>
                      <Field label="COST PRICE ₹ (landed cost)">
                        <input type="number" value={form.cost_price} onChange={e => setForm(f => ({ ...f, cost_price: e.target.value }))} className={inp} placeholder="What you paid" />
                      </Field>
                    </div>

                    {/* FIX-B2: LIVE GST BREAKDOWN moved to top — visible immediately */}
                    <div className="rounded-xl p-3" style={{ background: 'var(--bg,#0d1117)', border: '2px solid var(--accent,#1a5c2a)' }}>
                      <div className="text-[10px] font-bold text-yellow-400 mb-2 tracking-wider">⚡ LIVE GST BREAKDOWN</div>
                      <div className="flex items-center justify-center gap-2 mb-2 text-center">
                        <div><div className="text-[9px] text-[var(--tx3)]">Base (excl. GST)</div><div className="text-[18px] font-bold text-[var(--tx)]">₹{gst.base}</div></div>
                        <div className="text-gray-500">+</div>
                        <div><div className="text-[9px] text-[var(--tx3)]">GST @{form.gst_rate}%</div><div className="text-[18px] font-bold text-orange-400">₹{gst.gstAmt}</div></div>
                        <div className="text-gray-500">=</div>
                        <div><div className="text-[9px] text-[var(--tx3)]">Customer Pays</div><div className="text-[18px] font-bold text-green-400">₹{gst.selling}</div></div>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="rounded p-2 text-center" style={{ background: 'rgba(0,0,0,0.3)' }}><div className="text-[9px] text-[var(--tx3)]">CGST (intrastate)</div><div className="text-[14px] font-bold text-[var(--tx)]">₹{gst.cgst}</div></div>
                        <div className="rounded p-2 text-center" style={{ background: 'rgba(0,0,0,0.3)' }}><div className="text-[9px] text-[var(--tx3)]">SGST (intrastate)</div><div className="text-[14px] font-bold text-[var(--tx)]">₹{gst.sgst}</div></div>
                      </div>
                    </div>

                    {/* FIX #1: SELLING PRICE is now the primary input */}
                    <Field label="SELLING PRICE ₹ (what customer pays — incl. GST) *">
                      <div style={{ position: 'relative' }}>
                        <input type="number" value={form.selling_price}
                          onChange={e => handleSellingPriceChange(e.target.value)}
                          className={inp} placeholder="0.00"
                          style={{ paddingRight: variants.length > 0 ? '90px' : undefined, color: '#3fb950', borderColor: variants.length > 0 ? 'rgba(31,111,60,0.6)' : undefined }} />
                        {variants.length > 0 && (
                          <span style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', fontSize: '9px', fontWeight: 700, color: '#3fb950', background: 'rgba(31,111,60,0.15)', padding: '2px 6px', borderRadius: '4px', pointerEvents: 'none' }}>⚡ AUTO</span>
                        )}
                      </div>
                      {/* Psychological pricing suggestion */}
                      {psySell && psySell !== Math.round(sellingF) && (
                        <button type="button"
                          onClick={() => handleSellingPriceChange(String(psySell))}
                          className="mt-1 text-[10px] font-semibold px-2 py-0.5 rounded"
                          style={{ background: 'rgba(88,166,255,0.1)', color: 'var(--blue)', border: '1px solid rgba(88,166,255,0.25)' }}>
                          💡 Snap to ₹{psySell} (psychological price)
                        </button>
                      )}
                    </Field>

                    {/* BASE PRICE — auto-computed, read-only */}
                    <Field label="BASE PRICE ₹ (excl. GST — auto-computed)">
                      <input type="number" value={form.price} readOnly className={inp}
                        style={{ color: 'var(--tx2)', opacity: 0.7, cursor: 'not-allowed' }} placeholder="Auto" />
                    </Field>

                    {/* FIX #1: LEGAL MRP — correct field now */}
                    <div className="rounded-lg px-3 py-2 text-[11px]" style={{ background: 'rgba(88,166,255,0.07)', border: '1px solid rgba(88,166,255,0.2)' }}>
                      <span className="text-[var(--blue)] font-semibold">Legal MRP</span>
                      <span className="text-[var(--tx3)]"> = maximum price printed on package. Required by law. Must be ≥ selling price.</span>
                    </div>
                    <Field label="LEGAL MRP ₹ (printed on package — must be ≥ selling price)">
                      <input type="number" value={form.mrp}
                        onChange={e => {
                          const val = e.target.value;
                          const mrp = parseFloat(val) || 0;
                          const selling = parseFloat(form.selling_price) || 0;
                          setMrpError(mrp > 0 && mrp < selling ? `MRP (₹${mrp}) cannot be less than Selling Price (₹${selling.toFixed(0)})` : '');
                          setForm(f => ({ ...f, mrp: val }));
                        }}
                        className={inp} placeholder="Leave blank = same as selling price"
                        style={{ borderColor: mrpError ? '#f85149' : undefined }} />
                      {mrpError && <div className="mt-1 text-[11px] font-semibold" style={{ color: '#f85149' }}>⚠️ {mrpError}</div>}
                      {!mrpError && form.mrp && parseFloat(form.mrp) > sellingF && (
                        <div className="mt-1 text-[11px] font-semibold" style={{ color: '#3fb950' }}>
                          ✓ {Math.round((1 - sellingF / parseFloat(form.mrp)) * 100)}% discount shown to customer
                        </div>
                      )}
                    </Field>

                    {/* FIX #1: COMPARE AT PRICE — new field, was missing entirely */}
                    <Field label="COMPARE AT PRICE ₹ (strikethrough shown on site, optional)">
                      <input type="number" value={form.compare_at_price}
                        onChange={e => setForm(f => ({ ...f, compare_at_price: e.target.value }))}
                        className={inp} placeholder="e.g. was ₹599, now ₹399" />
                      <div className="mt-1 text-[10px]" style={{ color: 'var(--tx3)' }}>
                        This is the "was ₹X" price crossed out on the product page. Separate from legal MRP.
                      </div>
                    </Field>

                    {/* FIX #6: Live margin health indicator */}
                    {liveMargin !== null && liveMeta && (
                      <div className="rounded-xl p-3" style={{ background: liveMeta.bg, border: `1px solid ${liveMeta.color}33` }}>
                        <div className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: liveMeta.color }}>📊 Gross Margin</div>
                        <div className="text-[22px] font-bold" style={{ color: liveMeta.color }}>{liveMargin.toFixed(1)}%</div>
                        <div className="text-[11px] mt-1" style={{ color: liveMeta.color }}>
                          {liveMeta.label}
                          {liveHealth === 'block' && ' — fix pricing before saving'}
                          {liveHealth === 'danger' && ' — check logistics & platform fees'}
                        </div>
                        {liveMargin > 0 && (
                          <div className="text-[10px] mt-1 text-gray-500">
                            After ~12% logistics + returns, net margin ≈ {Math.max(0, liveMargin - 12).toFixed(1)}%
                          </div>
                        )}
                      </div>
                    )}

                    {/* Image URL */}
                    <Field label="IMAGE URL">
                      <div className="flex gap-2">
                        <input value={form.image_url} onChange={e => setForm(f => ({ ...f, image_url: e.target.value }))} className={inp} placeholder="https://…" />
                        <button type="button" onClick={openImgModal} className="flex-shrink-0 px-3 py-2 rounded-lg text-[11px] font-bold text-[var(--tx)]" style={{ background: 'var(--accent,#1a5c2a)' }}>📤</button>
                      </div>
                    </Field>
                    {form.image_url && (
                      <img src={form.image_url} alt="" className="w-full rounded-xl object-cover" style={{ height: '160px', border: '1px solid var(--bd,#1a5c2a)' }} onError={e => { e.target.style.display = 'none'; }} />
                    )}

                    {/* Video URL */}
                    <Field label="VIDEO URL (optional)">
                      <div className="flex gap-2">
                        <input value={form.video_url || ''} onChange={e => setForm(f => ({ ...f, video_url: e.target.value }))} className={inp} placeholder="https://… (auto-filled after upload)" />
                        <button type="button" onClick={openImgModal} className="flex-shrink-0 px-3 py-2 rounded-lg text-[11px] font-bold text-[var(--tx)]" title="Open media manager" style={{ background: 'var(--accent,#1a5c2a)' }}>🎬</button>
                      </div>
                    </Field>
                  </div>

                  {/* RIGHT: Variants */}
                  <div className="space-y-3" style={{ flex: '1', minWidth: 0 }}>
                    <div className="text-[10px] font-bold uppercase tracking-widest mb-3 pb-1" style={{ color: 'var(--accent,#1a5c2a)', borderBottom: '1px solid var(--bd,#1a5c2a)' }}>📦 Variants</div>

                    <div className="flex gap-2 mb-2 flex-wrap">
                      <button type="button" onClick={() => { setAutoPanel(p => !p); }}
                        className="text-[11px] px-3 py-1.5 rounded-lg font-bold flex items-center gap-1.5"
                        style={{ background: autoPanel ? 'rgba(210,153,34,0.25)' : 'var(--yellow-bg)', border: '1px solid rgba(210,153,34,0.4)', color: 'var(--yellow)' }}>
                        ⚡ Auto-generate {autoPanel ? '▲' : '▼'}
                      </button>
                      <button type="button" onClick={addVariant}
                        className="text-[11px] px-3 py-1.5 rounded-lg font-bold"
                        style={{ background: 'var(--bg,#0d1117)', border: '1px solid var(--bd,#1a5c2a)', color: 'var(--accent,#1a5c2a)' }}>
                        + Add Variant
                      </button>
                    </div>

                    {autoPanel && (
                      <div className="rounded-xl p-3 space-y-3" style={{ background: 'rgba(210,153,34,0.06)', border: '1px solid rgba(210,153,34,0.25)' }}>
                        <div className="text-[11px] font-bold text-yellow-400">⚡ Auto-generate variants</div>

                        {/* FIX #4: Pricing strategy selector */}
                        <div>
                          <div className="text-[10px] font-bold text-gray-500 uppercase mb-1.5">Pricing Strategy</div>
                          <div className="grid grid-cols-3 gap-1.5">
                            {[
                              { v: 'linear',           l: '📏 Linear',         desc: 'Strict proportional — same margin % at all sizes' },
                              { v: 'margin-protected', l: '🛡️ Margin-safe',     desc: 'Large packs cheaper per-gram but margin protected' },
                              { v: 'psychological',    l: '🧠 Psychological',   desc: 'Snap to ₹99/₹199/₹499 anchors' },
                            ].map(opt => (
                              <button key={opt.v} type="button" onClick={() => setVariantStrategy(opt.v)}
                                title={opt.desc}
                                className="py-1.5 rounded-lg text-[10px] font-bold transition"
                                style={{ background: variantStrategy === opt.v ? 'rgba(210,153,34,0.25)' : 'transparent', border: `1px solid ${variantStrategy === opt.v ? 'rgba(210,153,34,0.5)' : 'rgba(255,255,255,0.08)'}`, color: variantStrategy === opt.v ? '#d29922' : 'var(--tx3)' }}>
                                {opt.l}
                              </button>
                            ))}
                          </div>
                          <div className="text-[10px] mt-1 text-gray-600">
                            {variantStrategy === 'linear' && 'Same margin % across all sizes. Simple but ignores real buying behaviour.'}
                            {variantStrategy === 'margin-protected' && 'Larger packs get ~8% per-gram discount; smaller packs get ~8% premium. Margin protected.'}
                            {variantStrategy === 'psychological' && 'Same as margin-protected but rounds to nearest ₹99/₹199/₹499 anchor. Best for FMCG.'}
                          </div>
                        </div>

                        {/* Weight / Liquid toggle */}
                        <div className="flex gap-2">
                          {[{ v: 'weight', l: '⚖️ Weight (g/kg)' }, { v: 'liquid', l: '💧 Liquid (ml/L)' }].map(opt => (
                            <button key={opt.v} type="button"
                              onClick={() => { setAvUnitType(opt.v); setAvSelectedSizes([]); setAvBaseUnit(opt.v === 'liquid' ? '250ml' : '250g'); }}
                              className="flex-1 py-1.5 rounded-lg text-[11px] font-bold transition"
                              style={{ background: avUnitType === opt.v ? 'color-mix(in srgb, var(--yellow-bg) 60%, transparent)' : 'transparent', border: `1px solid ${avUnitType === opt.v ? 'rgba(210,153,34,0.5)' : 'rgba(255,255,255,0.08)'}`, color: avUnitType === opt.v ? '#d29922' : 'var(--tx3)' }}>
                              {opt.l}
                            </button>
                          ))}
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                          <Field label="Base Unit">
                            <select value={avBaseUnit} onChange={e => setAvBaseUnit(e.target.value)} className={inp}>
                              {ALL_SIZES.map(u => <option key={u}>{u}</option>)}
                            </select>
                          </Field>
                          <Field label={`Price for ${avBaseUnit} ₹`}>
                            <input type="number" value={avBasePrice} onChange={e => setAvBasePrice(e.target.value)} className={inp}
                              placeholder={form.selling_price || '0'} />
                          </Field>
                        </div>

                        <div>
                          <div className="text-[10px] font-bold text-gray-500 uppercase mb-1.5">Select Sizes</div>
                          <div className="grid grid-cols-3 gap-1.5">
                            {ALL_SIZES.map(sz => {
                              const checked = avSelectedSizes.includes(sz);
                              const alreadyExists = variants.some(v => v.variant_value?.toLowerCase().trim() === sz.toLowerCase().trim());
                              const bp = parseFloat(avBasePrice) || parseFloat(form.selling_price) || 0;
                              // FIX #4: use calcVariantPrices for preview too
                              const gst = parseFloat(form.gst_rate) || 5;
                              const previewArr = bp > 0 ? calcVariantPrices(bp, avBaseUnit, [sz], gst, variantStrategy) : null;
                              const previewPrice = previewArr?.[0]?.price || null;
                              return (
                                <label key={sz} className="flex flex-col rounded-lg px-2 py-1.5 cursor-pointer select-none"
                                  style={{ background: checked ? 'rgba(210,153,34,0.18)' : 'transparent', border: `1px solid ${checked ? 'rgba(210,153,34,0.5)' : 'rgba(255,255,255,0.08)'}`, opacity: alreadyExists ? 0.4 : 1 }}>
                                  <div className="flex items-center gap-1.5">
                                    <input type="checkbox" checked={checked} disabled={alreadyExists}
                                      onChange={() => setAvSelectedSizes(s => checked ? s.filter(x => x !== sz) : [...s, sz])}
                                      className="accent-yellow-500 w-3 h-3" />
                                    <span className="text-[11px] font-bold" style={{ color: checked ? '#d29922' : 'var(--tx2)' }}>{sz}</span>
                                    {alreadyExists && <span className="text-[9px] text-gray-600 ml-auto">✓</span>}
                                  </div>
                                  {previewPrice && !alreadyExists && (
                                    <span className="text-[10px] font-bold text-yellow-500 ml-4">₹{previewPrice}</span>
                                  )}
                                </label>
                              );
                            })}
                          </div>
                          <div className="flex gap-2 mt-1.5">
                            <button type="button" onClick={() => setAvSelectedSizes(ALL_SIZES.filter(sz => !variants.some(v => v.variant_value?.toLowerCase().trim() === sz.toLowerCase().trim())))} className="text-[10px] text-yellow-500 underline">Select All</button>
                            <button type="button" onClick={() => setAvSelectedSizes([])} className="text-[10px] text-gray-500 underline">Clear</button>
                          </div>
                        </div>

                        <div className="flex gap-2">
                          <button type="button" onClick={autoGenerate} disabled={!avSelectedSizes.length}
                            className="flex-1 py-2 rounded-lg text-[12px] font-bold text-[var(--tx)] disabled:opacity-40"
                            style={{ background: 'var(--yellow)' }}>
                            ⚡ Generate {avSelectedSizes.length} variant{avSelectedSizes.length !== 1 ? 's' : ''} →
                          </button>
                          <button type="button" onClick={() => setAutoPanel(false)} className="px-4 py-2 rounded-lg text-[11px] text-[var(--tx3)] border border-[var(--bd)]">Cancel</button>
                        </div>
                      </div>
                    )}

                    {variants.length === 0 && !autoPanel && (
                      <div className="rounded-xl p-4 text-center" style={{ background: 'var(--bg,#0d1117)', border: '1px dashed var(--bd,#1a5c2a)' }}>
                        <div className="text-[12px] text-gray-500 mb-1">No variants yet</div>
                        <div className="text-[10px] text-gray-600">Add variants for multiple sizes (250g, 500g, 1kg etc.)</div>
                      </div>
                    )}

                    <div className="space-y-2">
                      {variants.map((v, i) => (
                        <div key={i} className="rounded-xl p-3 space-y-2" style={{ background: 'var(--bg,#0d1117)', border: '1px solid var(--bd,#1a5c2a)' }}>
                          <div className="flex items-center justify-between">
                            <div className="text-[10px] font-bold text-[var(--tx3)] uppercase">Variant #{i + 1}</div>
                            <button onClick={() => removeVariant(i)} className="w-6 h-6 rounded flex items-center justify-center text-[var(--tx)] text-[11px]" style={{ background: '#e74c3c' }}>✕</button>
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <Field label="Type">
                              <select value={v.variant_type || 'weight'} onChange={e => updateVariant(i, 'variant_type', e.target.value)} className={inp} style={{ padding: '6px 8px' }}>
                                {['weight', 'volume', 'pack_size', 'grade'].map(t => <option key={t}>{t}</option>)}
                              </select>
                            </Field>
                            <Field label="Value">
                              <input value={v.variant_value || ''} onChange={e => updateVariant(i, 'variant_value', e.target.value)} placeholder="e.g. 250g" className={inp} style={{ padding: '6px 8px' }} />
                            </Field>
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <Field label="Sell ₹ (incl GST)">
                              <input type="number" value={v.price || ''} onChange={e => updateVariant(i, 'price', e.target.value)} className={inp} style={{ padding: '6px 8px' }} />
                            </Field>
                            <Field label="Status">
                              <select value={v.is_active !== false ? 'true' : 'false'} onChange={e => updateVariant(i, 'is_active', e.target.value === 'true')} className={inp} style={{ padding: '6px 8px' }}>
                                <option value="true">✓ Active</option>
                                <option value="false">✗ Off</option>
                              </select>
                            </Field>
                          </div>
                          <div>
                            <label className="block text-[10px] font-bold uppercase tracking-wider mb-1"
                              style={{ color: (!v.initial_stock || parseInt(v.initial_stock) <= 0) ? '#f85149' : 'var(--tx2)' }}>
                              Initial Stock <span style={{ color: '#f85149' }}>*</span>
                            </label>
                            <input type="number" value={v.initial_stock || ''} onChange={e => updateVariant(i, 'initial_stock', e.target.value)}
                              className={inp} style={{ padding: '5px 8px', borderColor: (!v.initial_stock || parseInt(v.initial_stock) <= 0) ? 'rgba(248,81,73,0.5)' : undefined }}
                              placeholder="Total purchased *" />
                          </div>
                          <div>
                            <label className="block text-[10px] font-bold uppercase tracking-wider mb-1 text-gray-500">
                              SKU {v._id && v.sku ? '🔒' : ''}
                            </label>
                            <div className={inp} style={{ padding: '6px 8px', fontFamily: 'monospace', fontSize: 11, color: v._id && v.sku ? 'var(--blue)' : '#aaa', opacity: 0.9, userSelect: 'all', cursor: 'default' }}
                              title={v._id && v.sku ? 'Immutable — SKU cannot change after creation (appears on orders & invoices)' : 'Will be generated on save'}>
                              {v.sku || generateSku(form.name, v.variant_value, catMap[String(form.category_id)] || '') || '—'}
                            </div>
                          </div>
                          {v._base && <div className="text-[10px] text-gray-500">Base excl. GST: ₹{v._base}</div>}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* ── AI CONTENT TAB ── */}
              {modalTab === 'ai' && (
                <div className="space-y-3 max-w-xl">
                  <div className="flex items-center justify-between mb-3">
                    <div className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--purple)' }}>🤖 AI Content</div>
                    {aiSaved && !aiPreview && (
                      <span className="text-[9px] px-2 py-0.5 rounded-full font-semibold" style={{ background: 'rgba(63,185,80,0.12)', border: '1px solid rgba(63,185,80,0.3)', color: '#3fb950' }}>✓ Content saved</span>
                    )}
                  </div>
                  {aiError && (
                    <div className="text-[11px] mb-2 px-3 py-2 rounded-lg" style={{ background: 'rgba(248,81,73,0.08)', border: '1px solid rgba(248,81,73,0.2)', color: '#f85149' }}>⚠ {aiError}</div>
                  )}
                  {!aiPreview && (
                    <button onClick={handleGenerateAI} disabled={aiLoading || modal === 'add'}
                      className="w-full rounded-xl font-bold transition mb-2 flex items-center justify-center gap-2"
                      style={{ padding: '14px 20px', fontSize: '14px', letterSpacing: '0.02em', background: aiLoading ? 'rgba(137,87,229,0.1)' : 'linear-gradient(135deg, rgba(137,87,229,0.25) 0%, rgba(99,60,180,0.35) 100%)', border: '2px solid rgba(137,87,229,0.6)', color: '#c0a0ff', cursor: modal === 'add' ? 'not-allowed' : 'pointer', opacity: modal === 'add' ? 0.4 : 1, boxShadow: modal !== 'add' && !aiLoading ? '0 0 16px rgba(137,87,229,0.2)' : 'none' }}>
                      {aiLoading
                        ? <><span style={{ display: 'inline-block', width: 16, height: 16, borderRadius: '50%', border: '2.5px solid #8957e5', borderTopColor: 'transparent', animation: 'spin 0.7s linear infinite' }} /> Generating content…</>
                        : aiSaved
                          ? <><span style={{ fontSize: 24 }}>🔄</span> Regenerate with Claude Haiku</>
                          : <><span style={{ fontSize: 24 }}>✨</span> Generate AI Content with Claude Haiku</>}
                    </button>
                  )}
                  {aiPreview && (
                    <div className="rounded-lg p-3 mb-2 text-[11px] space-y-2" style={{ background: 'color-mix(in srgb, var(--purple-bg) 40%, transparent)', border: '1px solid var(--purple-bg)' }}>
                      <div style={{ color: 'var(--tx2)', fontWeight: 700, fontSize: 9, textTransform: 'uppercase' }}>Preview — not yet saved</div>
                      {aiPreview.description && <div><div style={{ color: 'var(--purple)', fontWeight: 700, fontSize: 10 }}>📄 Description</div><div style={{ color: 'var(--tx)', lineHeight: 1.5 }}>{aiPreview.description}</div></div>}
                      <div className="flex gap-2 pt-1">
                        <button onClick={handleSaveAI} className="flex-1 py-1.5 rounded-lg text-[11px] font-bold" style={{ background: 'rgba(63,185,80,0.15)', border: '1px solid rgba(63,185,80,0.35)', color: '#3fb950' }}>✓ Save & Go Live</button>
                        <button onClick={handleGenerateAI} disabled={aiLoading} className="py-1.5 px-3 rounded-lg text-[11px] font-bold" style={{ background: 'var(--purple-bg)', border: '1px solid rgba(137,87,229,0.3)', color: 'var(--purple)' }}>🔄 Retry</button>
                        <button onClick={handleDiscardAI} className="py-1.5 px-3 rounded-lg text-[11px] font-bold" style={{ background: 'rgba(248,81,73,0.08)', border: '1px solid rgba(248,81,73,0.2)', color: '#f85149' }}>✕</button>
                      </div>
                    </div>
                  )}
                  {aiSaved && !aiPreview && (
                    <div className="rounded-lg p-2.5 text-[10px]" style={{ background: 'rgba(63,185,80,0.05)', border: '1px solid rgba(63,185,80,0.15)' }}>
                      <div style={{ color: '#3fb950', fontWeight: 700, marginBottom: 4 }}>✓ Live on customer site</div>
                      <div style={{ color: 'var(--tx2)', lineHeight: 1.5, marginBottom: 4 }} className="line-clamp-2">{aiSaved.description}</div>
                      <div className="flex flex-wrap gap-x-3" style={{ color: 'var(--tx3)', fontSize: 9 }}>
                        <span>💚 {aiSaved.benefits?.length || 0} benefits</span>
                        <span>🍽️ {aiSaved.how_to_use?.length || 0} steps</span>
                        <span>📦 {aiSaved.storage_tips?.length || 0} tips</span>
                      </div>
                    </div>
                  )}
                  {modal === 'add' && <div className="text-[10px] text-center mt-1" style={{ color: 'var(--tx3)' }}>Save product first, then generate AI content</div>}
                </div>
              )}
            </div>

            {/* Save bar */}
            <div className="flex gap-3 mt-4 pt-4 flex-shrink-0" style={{ borderTop: '1px solid var(--bd,#1a5c2a)' }}>
              <button onClick={save} disabled={saving || liveHealth === 'block'}
                className="flex-1 py-2.5 rounded-lg text-[13px] font-bold text-[var(--tx)] transition"
                style={{ background: saving ? '#333' : (liveHealth === 'block' ? '#333' : 'var(--accent,#1a5c2a)'), opacity: liveHealth === 'block' ? 0.6 : 1 }}>
                {saving ? 'Saving…' : liveHealth === 'block' ? '❌ Fix margin before saving' : modal === 'add' ? '+ Add Product' : '💾 Save Product'}
              </button>
              <button onClick={() => { if (aiAbortRef.current) aiAbortRef.current.abort(); setModal(null); setMrpError(''); }}
                className="px-6 py-2.5 rounded-lg text-[13px] text-[var(--tx3)] border border-[var(--bd)] hover:border-gray-500 transition">
                Cancel
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search products…"
          className="rounded-lg px-3 py-1.5 text-[12px] focus:outline-none flex-[2] min-w-0"
          style={{ background: 'var(--bg2,#161b22)', border: '1px solid var(--bd,#1a5c2a)', color: 'var(--tx,#fff)', height: 30 }} />
        <select value={filterCat} onChange={e => setFilterCat(e.target.value)}
          className="rounded-lg px-2 py-1.5 text-[12px] focus:outline-none flex-[1.2] min-w-0"
          style={{ background: 'var(--bg2,#161b22)', border: '1px solid var(--bd,#1a5c2a)', color: 'var(--tx,#fff)', height: 30 }}>
          <option value="">All Categories</option>
          {categories.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
        </select>
        <select value={filterSize} onChange={e => setFilterSize(e.target.value)}
          className="rounded-lg px-2 py-1.5 text-[12px] focus:outline-none flex-[1.2] min-w-0"
          style={{ background: 'var(--bg2,#161b22)', border: '1px solid var(--bd,#1a5c2a)', color: 'var(--tx,#fff)', height: 30 }}>
          <option value="">All Sizes</option>
          {allSizes.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={filterStock} onChange={e => setFilterStock(e.target.value)}
          className="rounded-lg px-2 py-1.5 text-[12px] focus:outline-none flex-[1.2] min-w-0"
          style={{ background: 'var(--bg2,#161b22)', border: '1px solid var(--bd,#1a5c2a)', color: 'var(--tx,#fff)', height: 30 }}>
          <option value="">All Status</option>
          <option value="out">Out of stock</option>
          <option value="low">Low (≤5)</option>
          <option value="ok">Good (&gt;10)</option>
        </select>
        <span className="text-[11px] whitespace-nowrap px-1" style={{ color: 'var(--tx2,#6e9a75)' }}>{totalVariants} variant{totalVariants !== 1 ? 's' : ''}</span>
        {hasFilter && (
          <button onClick={() => { setSearch(''); setFilterCat(''); setFilterSize(''); setFilterStock(''); }}
            className="text-[11px] px-3 py-1 rounded-lg whitespace-nowrap"
            style={{ color: '#f85149', border: '1px solid rgba(248,81,73,0.3)', background: 'transparent', height: 30 }}>
            ✕ Clear
          </button>
        )}
        <button onClick={openAdd} className="px-4 py-2 rounded-lg text-[12px] font-bold text-[var(--tx)] whitespace-nowrap" style={{ background: 'var(--accent,#1a5c2a)', height: 30 }}>
          + Add Product
        </button>
        {/* P3.2: Export CSV */}
        <button onClick={exportCSV} className="px-3 py-1 rounded-lg text-[12px] font-semibold whitespace-nowrap"
          style={{ background: 'rgba(88,166,255,0.12)', border: '1px solid rgba(88,166,255,0.3)', color: '#58a6ff', height: 30 }}>
          ⬇ Export CSV
        </button>
      </div>

      {/* P3.1: Bulk action toolbar — shows when items selected */}
      {selected.size > 0 && (
        <div className="flex items-center gap-2 flex-wrap rounded-lg px-4 py-2"
          style={{ background: 'rgba(88,166,255,0.08)', border: '1px solid rgba(88,166,255,0.25)' }}>
          <span className="text-[12px] font-bold" style={{ color: '#58a6ff' }}>
            {selected.size} selected
          </span>
          <button onClick={() => bulkStatusChange('active')} disabled={bulkLoading}
            className="px-3 py-1 rounded text-[11px] font-bold"
            style={{ background: 'rgba(63,185,80,0.15)', border: '1px solid rgba(63,185,80,0.4)', color: '#3fb950', cursor: 'pointer' }}>
            ✅ Set Active
          </button>
          <button onClick={() => bulkStatusChange('out_of_stock')} disabled={bulkLoading}
            className="px-3 py-1 rounded text-[11px] font-bold"
            style={{ background: 'rgba(139,148,158,0.15)', border: '1px solid rgba(139,148,158,0.4)', color: '#8b949e', cursor: 'pointer' }}>
            ⏸ Out of Stock
          </button>
          <button onClick={() => bulkStatusChange('discontinued')} disabled={bulkLoading}
            className="px-3 py-1 rounded text-[11px] font-bold"
            style={{ background: 'rgba(255,166,0,0.15)', border: '1px solid rgba(255,166,0,0.4)', color: '#ffa600', cursor: 'pointer' }}>
            🚫 Discontinue
          </button>
          <button onClick={() => bulkStatusChange('draft')} disabled={bulkLoading}
            className="px-3 py-1 rounded text-[11px] font-bold"
            style={{ background: 'rgba(188,140,255,0.15)', border: '1px solid rgba(188,140,255,0.4)', color: '#bc8cff', cursor: 'pointer' }}>
            📝 Set Draft
          </button>
          <button onClick={bulkArchive} disabled={bulkLoading}
            className="px-3 py-1 rounded text-[11px] font-bold"
            style={{ background: 'rgba(248,81,73,0.15)', border: '1px solid rgba(248,81,73,0.4)', color: '#f85149', cursor: 'pointer' }}>
            🗄 Archive
          </button>
          {bulkLoading && <span className="text-[11px]" style={{ color: 'var(--tx3)' }}>Processing…</span>}
          <button onClick={() => setSelected(new Set())} className="ml-auto text-[11px]" style={{ color: 'var(--tx3)', background: 'none', border: 'none', cursor: 'pointer' }}>
            ✕ Clear
          </button>
        </div>
      )}

      {/* Products table */}
      <Card title={`Products (${filtered.length})`}>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead><tr>
              {/* P3.1: Select all checkbox */}
              <th style={{ width: 32, paddingBottom: 8 }}>
                <input type="checkbox" checked={selected.size > 0 && selected.size === filtered.length}
                  onChange={toggleSelectAll}
                  style={{ cursor: 'pointer', accentColor: 'var(--accent)' }} />
              </th>
              {['Product', 'Category', 'SKU', 'Size', 'Selling Price', 'Stock', 'Status', ''].map(h => (
                <th key={h} className="text-left text-[10px] font-bold uppercase tracking-wider pb-2 pr-4" style={{ color: 'var(--tx2,#6e9a75)' }}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {filtered.map(p => {
                const pVars = variantStockMap[p.id] || [];
                const displayVars = pVars.filter(v => {
                  if (filterSize && v.variant_value !== filterSize) return false;
                  if (filterStock === 'out' && v.available_stock !== 0) return false;
                  if (filterStock === 'low' && !(v.available_stock > 0 && v.available_stock <= 5)) return false;
                  if (filterStock === 'ok' && !(v.available_stock > 10)) return false;
                  return true;
                });
                const rowVars = displayVars.length > 0 ? displayVars : pVars;
                const rowCount = rowVars.length || 1;

                return rowVars.length > 0 ? rowVars.map((v, i) => {
                  const avail = v.available_stock ?? 0;
                  const stockColor = avail === 0 ? '#f85149' : avail <= 5 ? 'var(--yellow)' : '#3fb950';
                  const isFirst = i === 0;
                  return (
                    <tr key={`${p.id}-${i}`} className="border-t hover:opacity-90 transition" style={{ borderColor: isFirst ? 'var(--bd,#1a5c2a)' : 'rgba(26,92,42,0.15)' }}>
                      {isFirst && (
                        <>
                          {/* P3.1: Row checkbox */}
                          <td rowSpan={rowCount} style={{ width: 32, paddingRight: 4, verticalAlign: 'middle' }}>
                            <input type="checkbox" checked={selected.has(p.id)}
                              onChange={() => toggleSelect(p.id)}
                              style={{ cursor: 'pointer', accentColor: 'var(--accent)' }} />
                          </td>
                          <td className="py-2.5 pr-4" rowSpan={rowCount}>
                            <div className="flex items-center gap-2">
                              {p.image_url && <img src={p.image_url} alt="" className="w-8 h-8 rounded object-cover flex-shrink-0" style={{ border: '1px solid var(--bd,#1a5c2a)' }} onError={e => e.target.style.display = 'none'} />}
                              <div>
                                <div className="text-[13px] font-semibold" style={{ color: 'var(--tx,#fff)' }}>{p.emoji} {p.name}</div>
                                {p._variantCount > 0 && <div className="text-[10px] mt-0.5" style={{ color: 'var(--blue)', background: 'var(--blue-bg)', borderRadius: 4, display: 'inline-block', padding: '1px 6px' }}>{p._variantCount} variants</div>}
                                {p.badges?.length > 0 && (
                                  <div className="flex gap-1 mt-0.5">
                                    {p.badges.includes('bestseller') && <span className="text-[9px] px-1.5 rounded-full" style={{ background: 'var(--yellow-bg)', color: 'var(--yellow)' }}>🏆</span>}
                                    {p.badges.includes('organic') && <span className="text-[9px] px-1.5 rounded-full" style={{ background: 'rgba(63,185,80,0.2)', color: '#3fb950' }}>🌿</span>}
                                    {p.badges.includes('new') && <span className="text-[9px] px-1.5 rounded-full" style={{ background: 'var(--blue-bg)', color: 'var(--blue)' }}>✨</span>}
                                  </div>
                                )}
                              </div>
                            </div>
                          </td>
                          <td className="py-2.5 pr-4" rowSpan={rowCount}><Badge type="blue">{catMap[String(p.category_id)] || '—'}</Badge></td>
                        </>
                      )}
                      <td className="py-1.5 pr-4 text-[10px]" style={{ color: 'var(--tx2)', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>{v.sku || '—'}</td>
                      <td className="py-1.5 pr-4 text-[11px]" style={{ color: 'var(--tx,#fff)' }}>{v.variant_value || '—'}</td>
                      <td className="py-1.5 pr-4">
                        {/* FIX #1: Show selling_price (what customer pays) not confusingly named mrp */}
                        <div className="text-[12px] font-bold" style={{ color: 'var(--tx,#fff)' }}>₹{parseFloat(v.price || 0).toFixed(0)}</div>
                        {p.mrp && parseFloat(p.mrp) > parseFloat(v.price || 0) && (
                          <div className="text-[10px] line-through" style={{ color: 'var(--tx3)' }}>₹{parseFloat(p.mrp).toFixed(0)}</div>
                        )}
                      </td>
                      <td className="py-1.5 pr-4 text-[11px] font-bold" style={{ color: stockColor }}>{avail}</td>
                      {isFirst && (
                        <>
                          <td className="py-2.5 pr-4" rowSpan={rowCount}>
                            <button onClick={() => toggleStatus(p)}><Badge type={p.status === 'active' ? 'green' : 'default'}>{p.status || 'active'}</Badge></button>
                          </td>
                          <td className="py-2.5" rowSpan={rowCount}>
                            <div className="flex flex-col gap-1 items-start">
                              <button onClick={() => openEdit(p)} className="text-[11px] px-3 py-1 rounded transition" style={{ color: 'var(--accent,#1a5c2a)', border: '1px solid var(--bd,#1a5c2a)' }}>Edit</button>
                              {/* FIX #32: soft delete button */}
                              <button onClick={() => softDeleteProduct(p)} className="text-[11px] px-3 py-1 rounded transition" style={{ color: '#f85149', border: '1px solid rgba(248,81,73,0.3)' }}>Archive</button>
                              {p.ai_description
                                ? <span className="text-[9px] px-1.5 py-0.5 rounded-full" style={{ background: 'var(--purple-bg)', color: 'var(--purple)' }}>🤖 AI</span>
                                : <span className="text-[9px] px-1.5 py-0.5 rounded-full" style={{ background: 'transparent', color: 'var(--tx3)' }}>No AI</span>}
                            </div>
                          </td>
                        </>
                      )}
                    </tr>
                  );
                }) : (
                  <tr key={p.id} className="border-t" style={{ borderColor: 'var(--bd,#1a5c2a)' }}>
                    <td className="py-2.5 pr-4 text-[13px] font-semibold" style={{ color: 'var(--tx,#fff)' }}>{p.emoji} {p.name}</td>
                    <td><Badge type="blue">{catMap[String(p.category_id)] || '—'}</Badge></td>
                    <td colSpan={4} className="py-2.5 text-[11px]" style={{ color: 'var(--tx3)' }}>No variants</td>
                    <td className="py-2.5 pr-4"><button onClick={() => toggleStatus(p)}><Badge type={p.status === 'active' ? 'green' : 'default'}>{p.status}</Badge></button></td>
                    <td className="py-2.5">
                      <div className="flex flex-col gap-1 items-start">
                        <button onClick={() => openEdit(p)} className="text-[11px] px-3 py-1 rounded" style={{ color: 'var(--accent,#1a5c2a)', border: '1px solid var(--bd,#1a5c2a)' }}>Edit</button>
                        <button onClick={() => softDeleteProduct(p)} className="text-[11px] px-3 py-1 rounded" style={{ color: '#f85149', border: '1px solid rgba(248,81,73,0.3)' }}>Archive</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* P2.3: Pagination controls */}
      {!loading && products.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 12, flexWrap: 'wrap', gap: 8 }}>
          <div style={{ fontSize: 12, color: 'var(--tx3)' }}>
            Page {page + 1} · {products.length} products shown
            {products.length === PAGE_SIZE ? ' · More available →' : ' · End of results'}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
              style={{ padding: '6px 14px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: page === 0 ? 'not-allowed' : 'pointer', opacity: page === 0 ? 0.4 : 1, background: 'var(--bg2)', border: '1px solid var(--bd)', color: 'var(--tx)' }}>
              ← Prev
            </button>
            <button onClick={() => setPage(p => p + 1)} disabled={products.length < PAGE_SIZE}
              style={{ padding: '6px 14px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: products.length < PAGE_SIZE ? 'not-allowed' : 'pointer', opacity: products.length < PAGE_SIZE ? 0.4 : 1, background: 'var(--bg2)', border: '1px solid var(--bd)', color: 'var(--tx)' }}>
              Next →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Categories Tab (unchanged) ────────────────────────────────
function CategoriesTab() {
  const [cats, setCats]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal]   = useState(null);
  const [form, setForm]     = useState({ name: '', slug: '', description: '' });
  const [saving, setSaving] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    try { setCats(await api.get('categories', 'select=id,name,slug,description&order=name.asc') || []); }
    catch (e) { }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);


  async function save() {
    if (!form.name) return alert('Name required');
    setSaving(true);
    try {
      const body = { name: form.name, slug: form.slug || form.name.toLowerCase().replace(/\s+/g, '-'), description: form.description };
      if (modal === 'add') await api.post('categories', body);
      else await api.patch('categories', `id=eq.${modal.id}`, body);
      setModal(null); load();
    } catch (e) { alert('Error: ' + e.message); }
    finally { setSaving(false); }
  }
  async function del(c) {
    if (!confirm(`Delete "${c.name}"?`)) return;
    await api.delete('categories', `id=eq.${c.id}`);
    load();
  }
  if (loading) return <Loader text="Loading categories…" />;
  return (
    <div className="space-y-4">
      {modal && (
        <Modal title={modal === 'add' ? '+ Add Category' : `Edit — ${modal.name}`} onClose={() => setModal(null)} width="480px">
          <div className="space-y-3">
            <Field label="NAME *"><input value={form.name} onChange={e => { const n = e.target.value; setForm(f => ({ ...f, name: n, slug: f.slug || n.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') })); }} className={inp} /></Field>
            <Field label="SLUG"><input value={form.slug} onChange={e => setForm(f => ({ ...f, slug: e.target.value }))} className={inp} /></Field>
            <Field label="DESCRIPTION"><textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} className={inp + ' h-16 resize-none'} /></Field>
          </div>
          <div className="flex gap-3 mt-5 pt-4" style={{ borderTop: '1px solid var(--bd,#1a5c2a)' }}>
            <button onClick={save} disabled={saving} className="flex-1 py-2.5 rounded-lg text-[13px] font-bold text-white" style={{ background: 'var(--accent,#1a5c2a)' }}>{saving ? 'Saving…' : modal === 'add' ? '+ Add' : '✓ Save'}</button>
            <button onClick={() => setModal(null)} className="px-5 py-2.5 rounded-lg text-[13px] text-[var(--tx3)] border border-[var(--bd)]">Cancel</button>
          </div>
        </Modal>
      )}
      <div className="flex justify-end">
        <button onClick={() => { setForm({ name: '', slug: '', description: '' }); setModal('add'); }} className="px-4 py-2 rounded-lg text-[12px] font-bold text-white" style={{ background: 'var(--accent,#1a5c2a)' }}>+ Add Category</button>
      </div>
      <Card title={`Categories (${cats.length})`}>
        <table className="w-full">
          <thead><tr>{['Name', 'Slug', 'Description', ''].map(h => (<th key={h} className="text-left text-[10px] font-bold uppercase tracking-wider pb-2 pr-4" style={{ color: 'var(--tx2,#6e9a75)' }}>{h}</th>))}</tr></thead>
          <tbody>
            {cats.map(c => (
              <tr key={c.id} className="border-t" style={{ borderColor: 'var(--bd,#1a5c2a)' }}>
                <td className="py-2.5 pr-4 text-[13px] font-semibold" style={{ color: 'var(--tx,#fff)' }}>{c.name}</td>
                <td className="py-2.5 pr-4 text-[11px] font-mono" style={{ color: 'var(--tx2)' }}>{c.slug || '—'}</td>
                <td className="py-2.5 pr-4 text-[11px]" style={{ color: 'var(--tx2)' }}>{c.description || '—'}</td>
                <td className="py-2.5 flex gap-2">
                  <button onClick={() => { setForm({ name: c.name, slug: c.slug || '', description: c.description || '' }); setModal(c); }} className="text-[11px] px-3 py-1 rounded" style={{ color: 'var(--accent)', border: '1px solid var(--bd)' }}>Edit</button>
                  <button onClick={() => del(c)} className="text-[11px] px-3 py-1 rounded border border-red-900 text-red-400">Del</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

// ── GST Manager Tab (unchanged logic, uses gst_rates from DB now) ─────────────
const GST_RATES_STATIC = [
  { value: 0,  label: '0% — Exempted' },
  { value: 5,  label: '5% — Food items' },
  { value: 12, label: '12% — Processed food' },
  { value: 18, label: '18% — Premium goods' },
  { value: 28, label: '28% — Luxury goods' },
];

function GSTManagerTab() {
  const [products, setProducts]     = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading]       = useState(true);
  const [saving, setSaving]         = useState({});
  const [bulkSaving, setBulkSaving] = useState(false);
  const [search, setSearch]         = useState('');
  const [filterCat, setFilterCat]   = useState('');
  const [bulkRate, setBulkRate]     = useState('');
  const [selected, setSelected]     = useState(new Set());
  const [autoApplying, setAutoApplying] = useState(false);
  // FIX: gstHsnRules needed here too — GSTManagerTab is a separate component
  const [gstHsnRules, setGstHsnRules] = useState([]);
  useEffect(() => {
    api.get('gst_hsn_mapping', 'select=keywords,gst_rate,description&is_active=eq.true')
      .then(rows => {
        if (rows?.length) setGstHsnRules(rows.map(r => ({
          keywords: Array.isArray(r.keywords) ? r.keywords : [],
          rate:     Number(r.gst_rate),
          reason:   r.description,
        })));
      }).catch(() => {});
  }, []);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [p, c] = await Promise.all([
        api.get('products', 'select=id,name,emoji,price,selling_price,gst_rate,status,category_id&is_deleted=eq.false&order=name.asc'),
        api.get('categories', 'select=id,name&order=name.asc'),
      ]);
      setProducts(p || []); setCategories(c || []);
    } catch (e) { }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);


  // FIX-A4b: Memoized catMap in GST tab — same fix as ProductsTab
  // FIX-B4: String(c.id) key so int/string category_id both resolve
  const catMap = useMemo(
    () => Object.fromEntries((categories || []).map(c => [String(c.id), c.name])),
    [categories]
  );
  async function updateGST(p, newRate) {
    setSaving(s => ({ ...s, [p.id]: true }));
    const rate = parseFloat(newRate);
    // FIX #3: use paise math for recalculation
    const selling_p = toPaise(p.selling_price || p.price || 0);
    const base_p    = removeGst(selling_p, parseFloat(p.gst_rate) || 5);
    const newSell_p = addGst(base_p, rate);
    try {
      await api.patch('products', `id=eq.${p.id}`, { gst_rate: rate, selling_price: toRupees(newSell_p), price: toRupees(base_p) });
      setProducts(ps => ps.map(x => x.id === p.id ? { ...x, gst_rate: rate, selling_price: toRupees(newSell_p) } : x));
    } catch (e) { alert('Error: ' + e.message); }
    finally { setSaving(s => ({ ...s, [p.id]: false })); }
  }
  async function applyBulk() {
    if (!bulkRate) return alert('Select a GST rate');
    const targets = filtered.filter(p => selected.size === 0 || selected.has(p.id));
    if (!targets.length) return;
    if (!confirm(`Apply ${bulkRate}% GST to ${targets.length} products?`)) return;
    setBulkSaving(true);
    for (const p of targets) {
      const rate = parseFloat(bulkRate);
      const selling_p = toPaise(p.selling_price || p.price || 0);
      const base_p = removeGst(selling_p, parseFloat(p.gst_rate) || 5);
      const newSell_p = addGst(base_p, rate);
      try { await api.patch('products', `id=eq.${p.id}`, { gst_rate: rate, selling_price: toRupees(newSell_p), price: toRupees(base_p) }); } catch (e) { }
    }
    setBulkSaving(false); setSelected(new Set()); setBulkRate('');
    load();
  }
  async function applyAutoSuggest() {
    const toFix = products.filter(p => { const s = getSuggest(catMap[String(p.category_id)], p.name, gstHsnRules); return s && s.rate !== (parseFloat(p.gst_rate) || 5); });
    if (!toFix.length) return alert('All products already have correct GST rates!');
    if (!confirm(`Auto-fix GST for ${toFix.length} products?`)) return;
    setAutoApplying(true);
    for (const p of toFix) {
      const s = getSuggest(catMap[String(p.category_id)], p.name, gstHsnRules);
      const rate = s.rate;
      const selling_p = toPaise(p.selling_price || p.price || 0);
      const base_p = removeGst(selling_p, parseFloat(p.gst_rate) || 5);
      const newSell_p = addGst(base_p, rate);
      try { await api.patch('products', `id=eq.${p.id}`, { gst_rate: rate, selling_price: toRupees(newSell_p), price: toRupees(base_p) }); } catch (e) { }
    }
    setAutoApplying(false); load();
  }
  function toggleSelect(id) { setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; }); }
  const filtered = products.filter(p => { const matchSearch = !search || p.name.toLowerCase().includes(search.toLowerCase()); const matchCat = !filterCat || String(p.category_id) === filterCat; return matchSearch && matchCat; });
  const allSelected = filtered.length > 0 && selected.size === filtered.length;
  const autoFixCount = products.filter(p => { const s = getSuggest(catMap[String(p.category_id)], p.name, gstHsnRules); return s && s.rate !== (parseFloat(p.gst_rate) || 5); }).length;
  const summary = GST_RATES_STATIC.map(r => ({ rate: r.value, count: products.filter(p => (p.gst_rate || 5) === r.value).length })).filter(r => r.count > 0);
  if (loading) return <Loader text="Loading GST data…" />;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-5 gap-3">{summary.map(s => (<div key={s.rate} className="rounded-xl p-3 text-center" style={{ background: 'var(--bg2)', border: '1px solid var(--bd)' }}><div className="text-[22px] font-bold" style={{ color: 'var(--accent)' }}>{s.rate}%</div><div className="text-[11px]" style={{ color: 'var(--tx2)' }}>{s.count} products</div></div>))}</div>
      <div className="rounded-xl p-4" style={{ background: 'color-mix(in srgb, var(--blue-bg) 33%, transparent)', border: '2px solid var(--blue)' }}>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="text-[11px] font-bold text-[var(--blue)] mb-1">🤖 SMART GST AUTO-SUGGEST</div>
            {autoFixCount > 0 ? <div className="mt-1 text-[11px] text-yellow-400 font-semibold">⚠️ {autoFixCount} product{autoFixCount > 1 ? 's have' : ' has'} a wrong GST rate</div>
              : <div className="mt-1 text-[11px] text-green-400 font-semibold">✓ All products look correct</div>}
          </div>
          <button onClick={applyAutoSuggest} disabled={autoApplying} className="rounded-xl font-bold flex items-center gap-2" style={{ padding: '10px 20px', fontSize: '13px', background: autoApplying ? '#333' : 'var(--blue)', color: '#000', boxShadow: !autoApplying ? '0 2px 12px rgba(88,166,255,0.3)' : 'none' }}>
            {autoApplying ? '⏳ Applying…' : `🤖 Auto-Fix All (${autoFixCount})`}
          </button>
        </div>
      </div>
      <Card title="GST Rate Manager">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead><tr>
              <th className="pb-2 pr-2 w-8"><input type="checkbox" checked={allSelected} onChange={() => setSelected(s => s.size === filtered.length ? new Set() : new Set(filtered.map(p => p.id)))} className="accent-green-500 cursor-pointer" /></th>
              {['Product', 'Category', 'Selling Price', 'GST Rate', 'Suggest', 'Base (excl.)'].map(h => (<th key={h} className="text-left text-[10px] font-bold uppercase tracking-wider pb-2 pr-3" style={{ color: 'var(--tx2)' }}>{h}</th>))}
            </tr></thead>
            <tbody>
              {filtered.map(p => {
                const rate = parseFloat(p.gst_rate) || 5;
                const selling = parseFloat(p.selling_price || p.price || 0);
                const base = toRupees(removeGst(toPaise(selling), rate));
                const suggest = getSuggest(catMap[String(p.category_id)], p.name, gstHsnRules);
                const isMismatch = suggest && suggest.rate !== rate;
                return (
                  <tr key={p.id} className="border-t" style={{ borderColor: 'var(--bd)', background: selected.has(p.id) ? 'rgba(210,153,34,0.05)' : '' }}>
                    <td className="py-2.5 pr-2"><input type="checkbox" checked={selected.has(p.id)} onChange={() => toggleSelect(p.id)} className="accent-green-500 cursor-pointer" /></td>
                    <td className="py-2.5 pr-3 text-[12px] font-semibold" style={{ color: 'var(--tx)' }}>{p.emoji} {p.name}</td>
                    <td className="py-2.5 pr-3 text-[11px]" style={{ color: 'var(--tx2)' }}>{catMap[String(p.category_id)] || '—'}</td>
                    <td className="py-2.5 pr-3 text-[12px] font-bold" style={{ color: 'var(--tx)' }}>₹{selling.toFixed(0)}</td>
                    <td className="py-2.5 pr-3">
                      <select value={rate} onChange={e => updateGST(p, e.target.value)} disabled={saving[p.id]}
                        className="rounded px-2 py-1 text-[11px] focus:outline-none"
                        style={{ background: 'var(--bg)', border: `1px solid ${isMismatch ? '#f85149' : 'var(--bd)'}`, color: 'var(--tx)' }}>
                        {GST_RATES_STATIC.map(r => <option key={r.value} value={r.value}>{r.value}%</option>)}
                      </select>
                    </td>
                    <td className="py-2.5 pr-3">
                      {suggest ? (
                        <button onClick={() => updateGST(p, suggest.rate)} disabled={saving[p.id] || !isMismatch} title={suggest.reason}
                          className="text-[10px] px-2 py-1 rounded font-semibold"
                          style={{ background: isMismatch ? 'var(--blue-bg)' : 'rgba(63,185,80,0.1)', color: isMismatch ? 'var(--blue)' : '#3fb950', border: `1px solid ${isMismatch ? '#58a6ff44' : '#3fb95044'}` }}>
                          {isMismatch ? `→ ${suggest.rate}%` : `✓ ${suggest.rate}%`}
                        </button>
                      ) : <span className="text-[10px] text-gray-600">—</span>}
                    </td>
                    <td className="py-2.5 text-[12px]" style={{ color: 'var(--tx2)' }}>₹{base.toFixed(2)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────
function CataloguePage() {
  const searchParams = useSearchParams();
  const [tab, setTab] = useState(searchParams.get('tab') || 'products');
  useEffect(() => { setTab(searchParams.get('tab') || 'products'); }, [searchParams]);
  const [prefillPricing] = useState(() => {
    if (typeof window === 'undefined') return null;
    if (searchParams.get('fromPricing') !== '1') return null;
    try { return readAndClearPricingPrefill() ?? null; } catch { return null; }
  });
  const TABS = [
    { id: 'products',   icon: '📦', label: 'Products'    },
    { id: 'categories', icon: '🏷️', label: 'Categories'  },
    { id: 'gst',        icon: '📋', label: 'GST Manager' },
  ];
  return (
    <div className="space-y-4">
      <div className="flex gap-1 p-1 rounded-xl w-fit" style={{ background: 'var(--bg2,#161b22)', border: '1px solid var(--bd,#1a5c2a)' }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className="px-4 py-2 rounded-lg text-[12px] font-medium transition"
            style={tab === t.id ? { background: 'var(--accent,#1a5c2a)', color: '#fff', fontWeight: 700 } : { color: 'var(--tx2,#6e9a75)' }}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>
      {tab === 'products'   && <ProductsTab prefillPricing={prefillPricing} />}
      {tab === 'categories' && <CategoriesTab />}
      {tab === 'gst'        && <GSTManagerTab />}
    </div>
  );
}

export default function CataloguePageWrapper(props) {
  return (
    <Suspense fallback={<div className="flex items-center justify-center py-24" style={{ color: 'var(--tx2,#6e7681)' }}>Loading…</div>}>
      <CataloguePage {...props} />
    </Suspense>
  );
}
