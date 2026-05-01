'use client';
import { useState, useEffect, useCallback, Suspense} from 'react';
import { useSearchParams } from 'next/navigation';
import { api, fmtCurrency } from '@/lib/api';
import { Card, Loader, ErrorMsg, Badge } from '@/components/ui/index';
import Modal from '@/components/ui/Modal';
import { readAndClearPricingPrefill } from '@/lib/pricingPrefill';

const GST_RATES = [
  { value: 0,   label: '0% (Exempted — fresh produce, milk, eggs)' },
  { value: 5,   label: '5% (Food items — honey, juice, spices)' },
  { value: 12,  label: '12% (Processed food, ghee, butter)' },
  { value: 18,  label: '18% (Premium / packaged goods)' },
  { value: 28,  label: '28% (Luxury goods)' },
];

// ── Image upload helper (calls /api/admin with action=storage_upload) ─────────
async function compressAndUpload(file, path) {
  // Compress via canvas
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
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || 'Upload failed'); }
  const data = await res.json();
  return data.url;
}

// ── Video upload helper (no canvas compression — raw upload) ───────────────
async function uploadVideo(file, path) {
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
  const fileName = `${path}-${Math.random().toString(36).slice(2,9)}.${ext}`;
  const pw = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('pr_pw') : '';
  const res = await fetch('/api/admin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-password': pw || '' },
    body: JSON.stringify({ action: 'storage_upload', fileName, fileType: mimeType, fileBase64: base64 }),
  });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || 'Upload failed'); }
  return (await res.json()).url;
}

// ── Products Tab ──────────────────────────────────────────────
function ProductsTab({ prefillPricing = null }) {
  const [products, setProducts]     = useState([]);
  const [categories, setCategories] = useState([]);
  const [states, setStates]         = useState([]);
  const [vendors, setVendors]       = useState([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState(null);
  const [modal, setModal]           = useState(null);
  const [saving, setSaving]         = useState(false);
  const [search, setSearch]         = useState('');
  const [filterCat, setFilterCat]   = useState('');
  const [filterSize, setFilterSize] = useState('');
  const [filterStock, setFilterStock] = useState('');
  const [imgModal, setImgModal]     = useState(false);
  const [prodImages, setProdImages] = useState([]);
  const [uploading, setUploading]   = useState(false);
  const [uploadStatus, setUploadStatus] = useState('');
  const [videoUploading, setVideoUploading] = useState(false);
  const [videoUploadStatus, setVideoUploadStatus] = useState('');
  const [variants, setVariants]     = useState([]);
  const [autoPanel, setAutoPanel]   = useState(false);
  const [variantStockMap, setVariantStockMap] = useState({});
  const [avBasePrice, setAvBasePrice] = useState('');
  const [avBaseUnit, setAvBaseUnit]   = useState('250g');
  const [avUnitType, setAvUnitType]   = useState('weight'); // 'weight' | 'liquid'
  const WEIGHT_SIZES = ['50g','100g','250g','500g','1kg','2kg','5kg'];
  const LIQUID_SIZES = ['50ml','100ml','200ml','250ml','500ml','1L','2L','5L'];
  const ALL_SIZES = avUnitType === 'liquid' ? LIQUID_SIZES : WEIGHT_SIZES;
  const [avSelectedSizes, setAvSelectedSizes] = useState(['100g','250g','500g','1kg']);

  // ── AI Content state ──────────────────────────────────────────
  const [aiLoading, setAiLoading]   = useState(false);
  const [modalTab,   setModalTab]    = useState('basic'); // 'basic' | 'pricing' | 'ai'
  const [aiPreview, setAiPreview]   = useState(null);   // generated but not yet saved
  const [aiSaved,   setAiSaved]     = useState(null);   // what's currently in Supabase
  const [aiError,   setAiError]     = useState('');

  // ── Load saved AI content when a product modal opens ─────────
  async function loadAiContent(productId) {
    if (!productId) return;
    try {
      const rows = await api.get('products',
        `select=ai_description,ai_health_benefits,ai_how_to_use,ai_storage_tips,ai_who_should_buy,ai_generated_at,ai_provider&id=eq.${productId}`
      );
      const p = rows && rows[0];
      if (p && p.ai_description) {
        setAiSaved({
          description:    p.ai_description,
          benefits:       safeParse(p.ai_health_benefits, []),
          how_to_use:     safeParse(p.ai_how_to_use, []),
          storage_tips:   safeParse(p.ai_storage_tips, []),
          who_should_buy: p.ai_who_should_buy || '',
          generated_at:   p.ai_generated_at,
          provider:       p.ai_provider || 'claude',
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

  async function handleGenerateAI() {
    if (!modal || modal === 'add') {
      alert('Please save the product first before generating AI content.');
      return;
    }
    setAiLoading(true);
    setAiError('');
    try {
      const pw = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('pr_pw') : '';
      const catName = categories.find(c => c.id === form.category_id)?.name || '';
      // Call /api/admin — same domain, zero CORS, ANTHROPIC_KEY stays server-side
      const res = await fetch('/api/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-password': pw || '' },
        body: JSON.stringify({
          action:      'generate_ai_content',
          productId:   modal.id,
          name:        form.name,
          category:    catName,
          ingredients: form.tags || '',
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setAiError(json.error || 'Generation failed. Please try again.');
        return;
      }
      // API saves directly to DB — just refresh saved state
      await loadAiContent(modal.id);
      setAiError('');
    } catch (e) {
      setAiError('Network error — check your connection and try again.');
    } finally {
      setAiLoading(false);
    }
  }

  async function handleSaveAI() {
    if (!aiPreview || !modal?.id) return;
    try {
      await api.patch('products', `id=eq.${modal.id}`, {
        ai_description:    aiPreview.description,
        ai_health_benefits: JSON.stringify(aiPreview.benefits || []),
        ai_how_to_use:     JSON.stringify(aiPreview.how_to_use || []),
        ai_storage_tips:   JSON.stringify(aiPreview.storage_tips || []),
        ai_who_should_buy: aiPreview.who_should_buy || null,
        ai_generated_at:   new Date().toISOString(),
        ai_provider:       'claude',
      });
      setAiSaved({ ...aiPreview, generated_at: new Date().toISOString(), provider: 'claude' });
      setAiPreview(null);
    } catch (e) {
      setAiError('Failed to save to database: ' + e.message);
    }
  }

  function handleDiscardAI() {
    setAiPreview(null);
    setAiError('');
  }

  const EMPTY = {
    name:'', slug:'', emoji:'', sku:'', category_id:'', state_id:'', status:'active',
    unit_label:'', gst_rate:5, price:'', selling:'', mrp:'', cost_price:'', available_stock:'',
     short_description:'', long_description:'', image_url:'', video_url:'', vendor_id:'',
    tags:'', badges_bestseller: false, badges_organic: false, badges_new: false,
    _mrpError: false,
  };
  const [form, setForm] = useState(EMPTY);

  // ── Auto-open Add Product modal when arriving from Pricing Engine ────────
  useEffect(() => {
    if (!prefillPricing || typeof prefillPricing !== 'object') return;
    setForm({
      ...EMPTY,
      price:      String(prefillPricing.price       ?? ''),
      selling:    String(prefillPricing.mrp         ?? ''),
      mrp:        String(prefillPricing.mrp_display ?? ''),
      cost_price: String(prefillPricing.cost_price  ?? ''),
      gst_rate:   prefillPricing.gst_rate           ?? 5,
    });
    setVariants([]);
    setModalTab('pricing');
    setModal('add');
  }, [prefillPricing]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── SKU Generation: CATEGORY-PRODUCTNAME-SIZE format ──────────
  // e.g. Cold Pressed Mustard Oil, Oil, 250ml → OIL-MUSTAR-250ML
  // e.g. Himalayan Wild Honey, Honey, 500g    → HON-HONEY-500G
  // e.g. Joha Rice, Rice, 1kg                 → RIC-JOHA-1KG
  const SKU_FILLER = new Set([
    'PRESSED','COLD','WILD','NATURAL','RAW','PURE','ORGANIC',
    'FRESH','DRIED','GROUND','WHOLE','HIMALAYAN',
  ]);

  function generateSku(productName, variantValue, categoryName) {
    if (!productName) return '';

    // Category prefix (3 chars, alphanumeric only)
    const catUpper  = (categoryName || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const catPrefix = catUpper.slice(0, 3);

    // Category words — strip from product name to avoid duplication (OIL-MUSTARD-OIL)
    const catWords  = new Set((categoryName || '').toUpperCase().split(/\s+/));

    // Clean product name
    const cleaned   = productName.replace(/[–—\-]/g, ' ').replace(/\s+/g, ' ').trim();
    const allWords  = cleaned.toUpperCase().split(/\s+/).filter(Boolean);
    // Remove filler words and category words
    const words     = allWords.filter(w => !SKU_FILLER.has(w) && !catWords.has(w));
    const chosen    = words.length > 0 ? words : allWords.filter(w => !SKU_FILLER.has(w));
    const final     = chosen.length > 0 ? chosen : allWords;

    // Build name part: 1 word → up to 6 chars, 2+ words → first two up to 4 chars each
    let namePart;
    if (final.length === 1) {
      namePart = final[0].slice(0, 6);
    } else {
      namePart = final[0].slice(0, 4) + (final[1] ? '-' + final[1].slice(0, 4) : '');
    }

    // Size suffix
    const sizePart = variantValue
      ? variantValue.trim().toUpperCase().replace(/\s+/g, '')
      : '';

    // Join: CAT-NAME-SIZE
    return [catPrefix, namePart, sizePart].filter(Boolean).join('-');
  }

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [p, c, s, varRows, v_list] = await Promise.all([
        api.get('products', 'select=id,name,slug,emoji,price,mrp,cost_price,gst_rate,available_stock,status,category_id,state_id,vendor_id,unit_label,short_description,long_description,image_url,video_url,tags,badges,ai_description,ai_generated_at,ai_provider&is_deleted=eq.false&order=name.asc'),
        api.get('categories', 'select=id,name&order=name.asc'),
        api.get('states', 'select=id,name&order=name.asc'),
        api.get('product_variants', 'select=product_id,sku,variant_value,price,initial_stock,available_stock&is_active=eq.true&order=product_id.asc,sort_order.asc').catch(() => []),
        api.get('vendors', 'select=id,name,business_name,status&order=business_name.asc').catch(() => []),
      ]);
      // Build variant count map per product
      const vcMap = (varRows || []).reduce((acc, v) => {
        acc[v.product_id] = (acc[v.product_id] || 0) + 1; return acc;
      }, {});
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
    } catch(e) { setError(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  function openEdit(p) {
    const tags = Array.isArray(p.tags) ? p.tags.join(', ') : (p.tags || '');
    const badges = p.badges || [];
    // price = base (excl. GST), selling = base+GST (what customer pays), mrp = strikethrough
    const basePrice = parseFloat(p.price) || 0;
    const gstRate   = parseFloat(p.gst_rate) || 5;
    // In DB: products.mrp = the selling price (customer pays, incl. GST)
    // We treat products.mrp as "selling" for display, and let user set separate MRP strikethrough
    const sellingVal = p.mrp ? parseFloat(p.mrp) : parseFloat((basePrice * (1 + gstRate/100)).toFixed(2));
    setForm({
      ...EMPTY, ...p,
      price: basePrice || '',
      selling: sellingVal || '',
      mrp: p.mrp || sellingVal || '',
      cost_price: p.cost_price || '',
      state_id: p.state_id != null ? String(p.state_id) : '',
      vendor_id: p.vendor_id != null ? String(p.vendor_id) : '',
      tags,
      badges_bestseller: badges.includes('bestseller'),
      badges_organic:    badges.includes('organic'),
      badges_new:        badges.includes('new'),
      long_description:  p.long_description || '',
      image_url:         p.image_url || '',
      video_url:         p.video_url || '',
    });
    setVariants([]);
    setAiPreview(null);
    setAiSaved(null);
    setAiError('');
    setModalTab('basic');
    setModal(p);
    // Load AI content for this product
    loadAiContent(p.id);
    // Load variants
    api.get('product_variants', `product_id=eq.${p.id}&order=sort_order.asc`).then(vars => {
      const loaded = (vars || []).map(v => ({ ...v, _id: v.id }));
      setVariants(loaded);
      // Auto-sync pricing from loaded variants
      const active = loaded.filter(v => v.price && parseFloat(v.price) > 0 && v.is_active !== false);
      if (active.length > 0) {
        const lowestSell = Math.min(...active.map(v => parseFloat(v.price)));
        const gst = parseFloat(p.gst_rate) || 5;
        const lowestBase = (lowestSell / (1 + gst / 100)).toFixed(2);
        setForm(f => ({ ...f, price: lowestBase, selling: String(lowestSell) }));
      }
    }).catch(() => {});
  }

  function openAdd() {
    setForm(EMPTY);
    setVariants([]);
    setModalTab('basic');
    setAiPreview(null);
    setAiSaved(null);
    setAiError('');
    setModal('add');
  }

  function calcGST() {
    const base = parseFloat(form.price) || 0;
    const rate = parseFloat(form.gst_rate) || 0;
    const gstAmt = base * rate / 100;
    const selling = parseFloat(form.selling) || (base + gstAmt);
    return { base, gstAmt: gstAmt.toFixed(2), selling: selling.toFixed(2), cgst: (gstAmt/2).toFixed(2), sgst: (gstAmt/2).toFixed(2) };
  }

  // price = base excl. GST, selling = incl. GST (customer pays), mrp = strikethrough (independent)
  function handlePriceChange(val) {
    const base = parseFloat(val) || 0;
    const rate = parseFloat(form.gst_rate) || 0;
    const selling = (base + base * rate / 100).toFixed(2);
    setForm(f => ({ ...f, price: val, selling: selling }));
    // Issue 1: also update auto-generated variants proportionally if they exist
    if (variants.length > 0 && base > 0) {
      setVariants(vs => vs.map(v => {
        if (!v.variant_value || !v._autoGenerated) return v;
        const gst = parseFloat(form.gst_rate) || 5;
        const baseGrams = parseGrams(avBaseUnit || '250g');
        const ratio = parseGrams(v.variant_value) / baseGrams;
        const newPrice = Math.round(base * (1 + gst/100) * ratio);
        return { ...v, price: newPrice, _base: (newPrice / (1 + gst/100)).toFixed(2) };
      }));
    }
  }

  function handleSellingChange(val) {
    const sell = parseFloat(val) || 0;
    const rate = parseFloat(form.gst_rate) || 0;
    const base = (sell / (1 + rate/100)).toFixed(2);
    setForm(f => ({ ...f, selling: val, price: base }));
  }

  async function save() {
    if (!form.name || !form.price) return alert('Name and price required');
    if (!form.state_id) return alert('Please select a State for this product');
    if (variants.length === 0) return alert('⚠️ At least one variant is required (e.g. 250g).\nUse ⚡ Auto-generate or + Add Variant.');
    // Mandatory initial stock check
    const missingStock = variants.filter(v => v.variant_value && v.price && (!v.initial_stock || parseInt(v.initial_stock) <= 0));
    if (missingStock.length > 0) {
      return alert(`⚠️ Initial Stock is required for: ${missingStock.map(v=>v.variant_value).join(', ')}\n\nInitial stock is needed for inventory tracking.`);
    }
    // Block duplicate variant values
    const varVals = variants.map(v => v.variant_value?.toLowerCase().trim()).filter(Boolean);
    if (varVals.length !== new Set(varVals).size) {
      return alert('❌ Duplicate variant sizes detected. Each variant must be unique before saving.');
    }
    const sellingVal = parseFloat(form.selling) || 0;
    const mrpVal     = parseFloat(form.mrp) || 0;
    if (mrpVal > 0 && mrpVal < sellingVal) {
      setForm(f => ({ ...f, _mrpError: true }));
      return alert(`❌ MRP (₹${mrpVal}) cannot be less than Selling Price (₹${sellingVal.toFixed(0)}). Please fix before saving.`);
    }
    setSaving(true);
    try {
      const badges = [];
      if (form.badges_bestseller) badges.push('bestseller');
      if (form.badges_organic)    badges.push('organic');
      if (form.badges_new)        badges.push('new');
      const tags = form.tags ? form.tags.split(',').map(t => t.trim()).filter(Boolean) : [];
      const stateId = form.state_id || null;
      if (!stateId) { setSaving(false); return alert('Please select a valid State'); }
      const body = {
        name: form.name,
        slug: form.slug || form.name.toLowerCase().replace(/\s+/g,'-').replace(/[^a-z0-9-]/g,''),
        emoji: form.emoji || null,
        category_id: form.category_id || null,
        state_id: stateId,
        vendor_id: form.vendor_id ? parseInt(form.vendor_id) : null,
        status: form.status, unit_label: form.unit_label || null,
        gst_rate: parseFloat(form.gst_rate) || 5,
        price: parseFloat(form.price) || 0,
        // DB products.mrp = selling price (incl. GST) — what customer actually pays
        // The strikethrough MRP (form.mrp) is display-only and not a separate DB column
        mrp: sellingVal || parseFloat(form.price) || 0,
        cost_price: parseFloat(form.cost_price) || null,
        short_description: form.short_description || null,
        long_description: form.long_description || null,
        image_url: form.image_url || null,
        video_url: form.video_url || null,
        tags: tags.length ? tags : null,
        badges: badges.length ? badges : null,
        available_stock: 0,   // required NOT NULL; real stock lives in product_variants
      };
      let prodId = modal === 'add' ? null : modal.id;
      if (modal === 'add') {
        const r = await api.post('products', { ...body, is_deleted: false });
        prodId = r?.[0]?.id || r?.id || null;
        if (!prodId) throw new Error('Product created but ID not returned — please try saving again.');
      } else {
        await api.patch('products', `id=eq.${modal.id}`, body);
        prodId = modal.id;
      }
      // Always save variants (handles add, edit, and deletions)
      if (prodId) await saveVariants(prodId);
      setModal(null);
      load();
    } catch(e) { alert('Error: ' + e.message); }
    finally { setSaving(false); }
  }

  async function saveVariants(prodId) {
    // Step 1: fetch all DB variants for this product
    const dbVars = await api.get('product_variants', `product_id=eq.${prodId}`).catch(() => []);
    const keptIds  = new Set(variants.filter(v => v._id).map(v => String(v._id)));
    const keptVals = new Set(variants.map(v => v.variant_value?.toLowerCase().trim()).filter(Boolean));
    // Delete rows not in UI — must be absent by BOTH id AND value to be considered removed
    const toDelete = (dbVars || []).filter(dbV =>
      !keptIds.has(String(dbV.id)) && !keptVals.has(dbV.variant_value?.toLowerCase().trim())
    );
    if (toDelete.length > 0) {
      await Promise.all(toDelete.map(dbV => api.delete('product_variants', `id=eq.${dbV.id}`).catch(() => {})));
      await new Promise(r => setTimeout(r, 500));
    }
    // Step 2: re-fetch after deletions to get clean state
    const freshDbVars = await api.get('product_variants', `product_id=eq.${prodId}`).catch(() => []);
    const dbByVal = Object.fromEntries((freshDbVars || []).map(v => [v.variant_value?.toLowerCase().trim(), v]));
    // Step 3: upsert remaining variants
    for (let i = 0; i < variants.length; i++) {
      const v = variants[i];
      if (!v.variant_value || !v.price) continue;
      const initialStock   = parseInt(v.initial_stock) || parseInt(v.available_stock) || 0;
      const stockQty       = parseInt(v.available_stock) || initialStock;
      const sellPrice      = parseFloat(v.price) || 0;
      const gst            = parseFloat(form.gst_rate) || 5;
      const basePrice      = parseFloat(v._base) || (sellPrice > 0 ? parseFloat((sellPrice / (1 + gst/100)).toFixed(2)) : 0);
      const vBody = {
        product_id:     prodId,
        variant_type:   v.variant_type || 'weight',
        variant_value:  v.variant_value,
        price:          sellPrice,
        original_price: basePrice,
        available_stock: stockQty,
        initial_stock:   initialStock,
        orders_reserved: v.orders_reserved || 0,
        is_active:      v.is_active !== false,
        sort_order:     i,
      };
      try {
        const existingById  = v._id ? String(v._id) : null;
        const existingByVal = dbByVal[v.variant_value?.toLowerCase().trim()];
        if (existingById) {
          await api.patch('product_variants', `id=eq.${existingById}`, vBody);
        } else if (existingByVal) {
          // Row survived delete (e.g. kept variant) — patch it, preserve its SKU
          await api.patch('product_variants', `id=eq.${existingByVal.id}`, vBody);
        } else {
          // Truly new row — omit SKU so DB trigger generates a fresh unique one
          await api.post('product_variants', vBody);
        }
      } catch(e) {
        console.error('Variant save error:', e.message, vBody);
        throw new Error(`Variant "${v.variant_value}" save failed: ${e.message}`);
      }
    }
  }

  function addVariant() {
    const gst = parseFloat(form.gst_rate) || 5;
    setVariants(vs => [...vs, { variant_type:'weight', variant_value:'', price:'', available_stock: 0, initial_stock: 0, returned_good: 0, is_active: true, _gst: gst, sku: '' }]);
  }

  function removeVariant(i) {
    setVariants(vs => {
      const next = vs.filter((_, idx) => idx !== i);
      syncPricingFromVariants(next);
      return next;
    });
  }

  function updateVariant(i, key, val) {
    // Block duplicate variant_value
    if (key === 'variant_value' && val.trim()) {
      const dup = variants.some((v, idx) => idx !== i && v.variant_value?.toLowerCase().trim() === val.toLowerCase().trim());
      if (dup) { alert(`❌ Variant "${val}" already exists. Each size must be unique.`); return; }
    }
    setVariants(vs => {
      const next = vs.map((v, idx) => {
        if (idx !== i) return v;
        const updated = { ...v, [key]: val };
        if (key === 'price') {
          const gst = parseFloat(form.gst_rate) || 5;
          updated._base = parseFloat(val) > 0 ? (parseFloat(val) / (1 + gst/100)).toFixed(2) : '';
        }
        if (key === 'variant_value' && !v._skuManual) {
          updated.sku = generateSku(form.name, val, catMap[form.category_id] || '');
        }
        return updated;
      });
      if (key === 'price' || key === 'is_active') syncPricingFromVariants(next);
      return next;
    });
  }

  // ── Auto-sync: whenever variants change, push lowest variant price → form.price + form.selling ──
  function syncPricingFromVariants(updatedVariants) {
    const active = updatedVariants.filter(v => v.price && parseFloat(v.price) > 0 && v.is_active !== false);
    if (active.length === 0) return;
    const lowestSell = Math.min(...active.map(v => parseFloat(v.price)));
    const gst = parseFloat(form.gst_rate) || 5;
    const lowestBase = (lowestSell / (1 + gst / 100)).toFixed(2);
    setForm(f => ({ ...f, price: lowestBase, selling: String(lowestSell) }));
  }

  function parseGrams(unit) {
    const s = unit.toLowerCase().trim();
    if (s.includes('kg')) return parseFloat(s) * 1000;
    if (s.includes('ml')) return parseFloat(s);
    if (s.endsWith('l') && !s.includes('ml')) return parseFloat(s) * 1000;
    if (s.includes('g')) return parseFloat(s);
    return 250;
  }

  function autoGenerate() {
    const basePrice = parseFloat(avBasePrice) || parseFloat(form.selling) || 0;
    if (!basePrice) return alert('Set base price or selling price first');
    if (!avSelectedSizes.length) return alert('Select at least one size to generate');
    const existingNow = new Set(variants.map(v => v.variant_value?.toLowerCase().trim()).filter(Boolean));
    const alreadyExists = avSelectedSizes.filter(s => existingNow.has(s.toLowerCase().trim()));
    const fresh = avSelectedSizes.filter(s => !existingNow.has(s.toLowerCase().trim()));
    if (alreadyExists.length > 0) {
      if (fresh.length === 0) return alert(`❌ All selected sizes (${alreadyExists.join(', ')}) already exist. Nothing to generate.`);
      if (!confirm(`⚠️ "${alreadyExists.join(', ')}" already exist — will be skipped.\n\nGenerate only: ${fresh.join(', ')}?`)) return;
    }
    setAutoPanel(false);
    setVariants(vs => {
      const existing = new Set(vs.map(v => v.variant_value?.toLowerCase().trim()).filter(Boolean));
      const gst = parseFloat(form.gst_rate) || 5;
      const baseGrams = parseGrams(avBaseUnit);
      const newVars = avSelectedSizes
        .filter(s => !existing.has(s.toLowerCase().trim()))
        .map(s => {
          const ratio = parseGrams(s) / baseGrams;
          const price = Math.round(basePrice * ratio);
          return { variant_type: avUnitType === 'liquid' ? 'volume' : 'weight', variant_value:s, price, available_stock: 0, initial_stock: 0, returned_good: 0, is_active:true, _base:(price/(1+gst/100)).toFixed(2), _autoGenerated: true, sku: generateSku(form.name, s, catMap[form.category_id] || '') };
        });
      const next = [...vs, ...newVars];
      syncPricingFromVariants(next);
      return next;
    });
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
    if (modal === 'add' || !modal?.id) {
      alert('Save the product first, then upload images');
      return;
    }
    setUploading(true);
    try {
      const existing = await api.get('product_images', `product_id=eq.${modal.id}&order=sort_order.desc&limit=1`).catch(() => []);
      let nextOrder = existing?.[0]?.sort_order !== undefined ? existing[0].sort_order + 1 : 0;
      const urls = [];
      for (let i = 0; i < files.length; i++) {
        setUploadStatus(`⏳ Uploading ${i+1}/${files.length}…`);
        const url = await compressAndUpload(files[i], `products/prod-${modal.id}-${Date.now()}-${i}`);
        await api.post('product_images', { product_id: modal.id, image_url: url, sort_order: nextOrder + i });
        urls.push(url);
      }
      // Sync image_url on product to first image
      const first = await api.get('product_images', `product_id=eq.${modal.id}&order=sort_order.asc&limit=1`).catch(() => []);
      const mainUrl = first?.[0]?.image_url || urls[0];
      setForm(f => ({ ...f, image_url: mainUrl }));
      await api.patch('products', `id=eq.${modal.id}`, { image_url: mainUrl }).catch(() => {});
      setUploadStatus(`✅ ${urls.length} image(s) uploaded!`);
      // Refresh preview
      const rows = await api.get('product_images', `product_id=eq.${modal.id}&order=sort_order.asc`).catch(() => []);
      setProdImages(rows || []);
    } catch(e) { setUploadStatus('❌ ' + e.message); }
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
    if (modal === 'add' || !modal?.id) {
      alert('Save the product first, then upload a video');
      return;
    }
    const allowed = ['video/mp4','video/webm','video/ogg','video/quicktime'];
    if (!allowed.includes(file.type) && !file.name.match(/\.(mp4|webm|ogg|mov)$/i)) {
      alert('Please select a video file (MP4, WebM, MOV)');
      return;
    }
    setVideoUploading(true);
    setVideoUploadStatus('⏳ Uploading video…');
    try {
      const url = await uploadVideo(file, `products/video-prod-${modal.id}-${Date.now()}`);
      setForm(f => ({ ...f, video_url: url }));
      await api.patch('products', `id=eq.${modal.id}`, { video_url: url }).catch(() => {});
      setVideoUploadStatus('✅ Video uploaded!');
    } catch(e) {
      setVideoUploadStatus('❌ ' + e.message);
    } finally {
      setVideoUploading(false);
    }
  }

  async function toggleStatus(p) {
    await api.patch('products', `id=eq.${p.id}`, { status: p.status === 'active' ? 'inactive' : 'active' });
    load();
  }

  const gst = calcGST();
  const catMap = Object.fromEntries(categories.map(c => [c.id, c.name]));
  const filtered = products.filter(p => {
    if (search && !p.name.toLowerCase().includes(search.toLowerCase())) return false;
    if (filterCat && catMap[p.category_id] !== filterCat) return false;
    if (filterSize || filterStock) {
      const vars = variantStockMap[p.id] || [];
      const match = vars.some(v => {
        if (filterSize && v.variant_value !== filterSize) return false;
        if (filterStock === 'out' && v.available_stock !== 0) return false;
        if (filterStock === 'low' && !(v.available_stock > 0 && v.available_stock <= 5)) return false;
        if (filterStock === 'ok'  && !(v.available_stock > 10)) return false;
        return true;
      });
      if (!match) return false;
    }
    return true;
  });
  const hasFilter = search || filterCat || filterSize || filterStock;
  const allSizes = [...new Set((products.flatMap(p => (variantStockMap[p.id] || []).map(v => v.variant_value))).filter(Boolean))].sort((a, b) => parseGrams(a) - parseGrams(b));
  const totalVariants = filtered.reduce((s, p) => {
    const vars = variantStockMap[p.id] || [];
    if (!filterSize && !filterStock) return s + vars.length;
    return s + vars.filter(v => {
      if (filterSize && v.variant_value !== filterSize) return false;
      if (filterStock === 'out' && v.available_stock !== 0) return false;
      if (filterStock === 'low' && !(v.available_stock > 0 && v.available_stock <= 5)) return false;
      if (filterStock === 'ok'  && !(v.available_stock > 10)) return false;
      return true;
    }).length;
  }, 0);

  if (loading) return <Loader text="Loading products…" />;
  if (error)   return <ErrorMsg error={error} onRetry={load} />;

  return (
    <div className="space-y-4">
      {/* ── Image Upload Sub-Modal ── */}
      {imgModal && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4" style={{background:'rgba(0,0,0,0.7)'}}>
          <div className="rounded-2xl p-6 w-full max-w-lg" style={{background:'var(--bg2,#161b22)',border:'1px solid var(--bd,#1a5c2a)'}}>
            <div className="flex justify-between items-center mb-4">
              <div className="text-[13px] font-bold" style={{color:'var(--tx,#fff)'}}>📸 Product Images</div>
              <button onClick={() => setImgModal(false)} className="text-[var(--tx3)] hover:text-[var(--tx)] text-lg">×</button>
            </div>

            {/* Existing images */}
            {prodImages.length > 0 ? (
              <div className="flex flex-wrap gap-2 mb-4">
                {prodImages.map((img, i) => (
                  <div key={img.id} className="relative">
                    <img src={img.image_url} alt="" className="rounded-lg object-cover border-2"
                      style={{width: i===0?'100%':'72px', height: i===0?'160px':'72px', borderColor: i===0?'var(--accent,#1a5c2a)':'var(--bd,#1a5c2a)'}}
                      onError={e => { e.target.style.opacity = '0.3'; }} />
                    <div className="absolute top-1 left-1 text-[8px] font-bold px-1 rounded" style={{background:'rgba(0,0,0,0.7)',color:'#fff'}}>{i===0?'Main':`#${i+1}`}</div>
                    <button onClick={() => deleteImage(img.id)}
                      className="absolute top-1 right-1 w-4 h-4 rounded text-[var(--tx)] flex items-center justify-center text-[10px]"
                      style={{background:'rgba(220,50,50,0.85)'}}>×</button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-6 text-[12px] text-gray-500 mb-4">
                {modal === 'add' || !modal?.id ? 'Save product first to upload images' : 'No images yet'}
              </div>
            )}

            {/* Upload new */}
            {modal !== 'add' && modal?.id && (
              <div className="space-y-2">
                <label className="block text-[10px] font-bold uppercase tracking-wider text-[var(--tx3)]">Upload New Images</label>
                <input type="file" accept="image/*" multiple
                  onChange={e => handleImageUpload(Array.from(e.target.files))}
                  disabled={uploading}
                  className="w-full text-[12px] text-[var(--tx2)] file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-[11px] file:font-bold file:text-[var(--tx)] cursor-pointer"
                  style={{fileBackground:'var(--accent,#1a5c2a)'}} />
                {uploadStatus && <div className="text-[11px] mt-1" style={{color: uploadStatus.startsWith('✅') ? '#3fb950' : uploadStatus.startsWith('❌') ? '#f85149' : '#d29922'}}>{uploadStatus}</div>}
              </div>
            )}

            {/* ── Video Upload Section ── */}
            <div className="mt-4 pt-4" style={{borderTop:'1px solid var(--bd,#1a5c2a)'}}>
              <div className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{color:'var(--tx3)'}}>🎬 Product Video (optional)</div>
              {form.video_url ? (
                <div className="mb-3">
                  <video src={form.video_url} controls className="w-full rounded-lg"
                    style={{maxHeight:'160px',border:'1px solid var(--bd,#1a5c2a)',background:'#000'}} />
                  <div className="flex gap-2 mt-2">
                    <div className="flex-1 text-[10px] truncate font-mono py-1 px-2 rounded" style={{background:'var(--bg,#0d1117)',color:'var(--tx2)',border:'1px solid var(--bd)'}}>
                      {form.video_url.split('/').pop()}
                    </div>
                    <button onClick={() => { setForm(f => ({...f, video_url:''})); setVideoUploadStatus(''); if(modal?.id) api.patch('products',`id=eq.${modal.id}`,{video_url:null}).catch(()=>{}); }}
                      className="px-2 py-1 rounded text-[11px] font-bold flex-shrink-0"
                      style={{background:'rgba(248,81,73,0.12)',color:'#f85149',border:'1px solid rgba(248,81,73,0.3)'}}>
                      ✕ Remove
                    </button>
                  </div>
                </div>
              ) : (
                <div className="text-[11px] mb-2 py-2 text-center rounded-lg" style={{color:'var(--tx3)',background:'var(--bg,#0d1117)',border:'1px dashed var(--bd)'}}>
                  No video yet
                </div>
              )}
              {modal !== 'add' && modal?.id && (
                <div className="space-y-2">
                  <input type="file" accept="video/mp4,video/webm,video/ogg,video/quicktime,.mp4,.webm,.mov"
                    onChange={e => handleVideoUpload(e.target.files[0])}
                    disabled={videoUploading}
                    className="w-full text-[12px] text-[var(--tx2)] file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-[11px] file:font-bold file:text-[var(--tx)] cursor-pointer" />
                  <div className="text-[10px]" style={{color:'var(--tx3)'}}>MP4, WebM or MOV · Max 100MB · Shown on product page</div>
                  {videoUploadStatus && <div className="text-[11px]" style={{color: videoUploadStatus.startsWith('✅') ? '#3fb950' : videoUploadStatus.startsWith('❌') ? '#f85149' : '#d29922'}}>{videoUploadStatus}</div>}
                  <input value={form.video_url || ''} onChange={e => setForm(f => ({...f,video_url:e.target.value}))}
                    placeholder="or paste video URL…"
                    className="w-full rounded-lg px-3 py-1.5 text-[11px] outline-none font-mono"
                    style={{background:'var(--bg,#0d1117)',border:'1px solid var(--bd)',color:'var(--tx)'}} />
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Product Edit/Add Modal ── */}
      {modal && (
        <Modal title={modal === 'add' ? '+ Add Product' : `Edit — ${modal.name}`} onClose={() => { setModal(null); setModalTab('basic'); }} fullscreen>
          <div style={{display:'flex',flexDirection:'column',height:'100%'}}>

          {/* ── Tab navigation ── */}
          <div style={{display:'flex',gap:0,borderBottom:'2px solid var(--bd,#1a5c2a)',marginBottom:'18px',flexShrink:0}}>
            {[
              {id:'basic',    label:'📋 Basic Info'},
              {id:'pricing',  label:'💰 Pricing & Variants'},
              {id:'ai',       label:'🤖 AI Content', badge: aiSaved ? '✓' : null},
            ].map(tab => (
              <button key={tab.id} onClick={()=>setModalTab(tab.id)}
                className="px-4 py-2 text-[12px] font-bold transition flex items-center gap-1.5"
                style={{
                  borderBottom: modalTab===tab.id ? '2px solid var(--accent,#1a5c2a)' : '2px solid transparent',
                  marginBottom: '-2px',
                  color: modalTab===tab.id ? 'var(--accent,#1a5c2a)' : 'var(--tx2,#6e9a75)',
                  background: 'transparent',
                  border: 'none',
                  borderBottom: modalTab===tab.id ? '2px solid var(--accent,#1a5c2a)' : '2px solid transparent',
                }}>
                {tab.label}
                {tab.badge && <span className="text-[9px] px-1.5 py-0.5 rounded-full font-bold" style={{background:'rgba(63,185,80,0.2)',color:'#3fb950'}}>{tab.badge}</span>}
              </button>
            ))}
          </div>

          {/* Pricing pre-fill banner — shown above tab content when arriving from Pricing Engine */}
          {prefillPricing && modal === 'add' && (
            <div style={{ margin:'0 0 16px 0', padding:'12px 20px', background:'rgba(63,185,80,0.07)', border:'1px solid rgba(63,185,80,0.25)', borderRadius:10, display:'flex', flexWrap:'wrap', alignItems:'flex-start', gap:16, flexShrink:0 }}>
              <div style={{ fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.06em', color:'#6e9a75', width:'100%' }}>
                ✓ Pricing pre-filled from calculator — add name, category &amp; state to complete
              </div>
              {[
                { label:'Base price (excl GST)',    val:'₹'+prefillPricing.price },
                { label:'Selling price (incl GST)', val:'₹'+prefillPricing.mrp, accent:true },
                { label:'MRP (strikethrough)',       val:'₹'+prefillPricing.mrp_display },
                { label:'Cost price',               val:'₹'+prefillPricing.cost_price },
                { label:'GST rate',                 val:prefillPricing.gst_rate+'%' },
                { label:'Gross margin',             val:prefillPricing._margin_pct+'%' },
              ].map((item,i) => (
                <div key={i}>
                  <div style={{ fontSize:10, color:'#6e9a75' }}>{item.label}</div>
                  <div style={{ fontSize:14, fontWeight:700, color: item.accent ? '#3fb950' : 'var(--tx,#e6edf3)' }}>{item.val}</div>
                </div>
              ))}
            </div>
          )}

          {/* ── Tab content ── */}
          <div style={{flex:1,overflowY:'auto',minHeight:0}}>

            {/* BASIC INFO TAB */}
            {modalTab === 'basic' && (
              <div className="space-y-3">
              <div className="text-[10px] font-bold uppercase tracking-widest mb-3 pb-1" style={{color:'var(--accent,#1a5c2a)',borderBottom:'1px solid var(--bd,#1a5c2a)'}}>📋 Basic Info</div>

              <Field label="NAME *">
                <input value={form.name} onChange={e => {
                  const name = e.target.value;
                  setForm(f => ({
                    ...f,
                    name,
                    slug: f.slug || name.toLowerCase().replace(/\s+/g,'-').replace(/[^a-z0-9-]/g,''),
                  }));
                }} className={inp} placeholder="Product name" />
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="EMOJI">
                  <input value={form.emoji} onChange={e => setForm(f=>({...f,emoji:e.target.value}))} className={inp} placeholder="🍯" />
                </Field>
{/* SKU is per-variant, not product-level */}
              </div>
              <Field label="SLUG">
                <input value={form.slug} onChange={e => setForm(f=>({...f,slug:e.target.value}))} className={inp} placeholder="auto from name" />
              </Field>
              <div className="grid grid-cols-3 gap-2">
                <Field label="CATEGORY">
                  <select value={form.category_id||''} onChange={e=>setForm(f=>({...f,category_id:e.target.value}))} className={inp}>
                    <option value="">None</option>
                    {categories.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </Field>
                <Field label="STATE *">
                  <select value={form.state_id||''} onChange={e=>setForm(f=>({...f,state_id:e.target.value}))} className={inp}>
                    <option value="">Select…</option>
                    {states.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </Field>
                <Field label="VENDOR / SUPPLIER">
                  <select value={form.vendor_id||''} onChange={e=>setForm(f=>({...f,vendor_id:e.target.value}))} className={inp}>
                    <option value="">— No vendor assigned —</option>
                    {vendors.filter(v=>v.status==='active').map(v=>(
                      <option key={v.id} value={v.id}>{v.business_name} ({v.name})</option>
                    ))}
                  </select>
                  {vendors.length === 0 && (
                    <div className="text-[10px] mt-1" style={{color:'var(--tx3)'}}>
                      No vendors yet — <a href="/admin/vendors" className="underline" style={{color:'var(--accent)'}}>add vendors first</a>
                    </div>
                  )}
                </Field>
                <Field label="STATUS">
                  <select value={form.status} onChange={e=>setForm(f=>({...f,status:e.target.value}))} className={inp}>
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                    <option value="draft">Draft</option>
                  </select>
                </Field>
              </div>
              {variants.length === 0 ? (
                <div className="rounded-lg px-3 py-2.5" style={{background:'rgba(248,81,73,0.07)',border:'1px solid rgba(248,81,73,0.25)'}}>
                  <span className="text-[11px]" style={{color:'#f85149'}}>⚠️ Add at least one variant below to set stock quantity. Stock is tracked per variant.</span>
                </div>
              ) : (
                <div className="rounded-lg px-3 py-2 flex items-center gap-2" style={{background:'color-mix(in srgb, var(--blue-bg) 45%, transparent)',border:'1px solid var(--blue-bg)'}}>
                  <span className="text-[10px]" style={{color:'var(--blue)'}}>📦 Stock managed per variant →</span>
                </div>
              )}
              <Field label="SHORT DESCRIPTION">
                <textarea value={form.short_description} onChange={e=>setForm(f=>({...f,short_description:e.target.value}))} className={inp+' resize-none'} style={{height:'72px'}} placeholder="Shown in product cards…" />
              </Field>
              <Field label="LONG DESCRIPTION (product page)">
                <textarea value={form.long_description} onChange={e=>setForm(f=>({...f,long_description:e.target.value}))} className={inp+' resize-none'} style={{height:'96px'}} placeholder="Full description…" />
              </Field>
              <Field label="TAGS (comma separated)">
                <input value={form.tags} onChange={e=>setForm(f=>({...f,tags:e.target.value}))} className={inp} placeholder="himalayan, natural, raw…" />
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
                      style={{
                        background: form[b.key] ? `${b.color}22` : 'var(--bg,#0d1117)',
                        border: `1px solid ${form[b.key] ? b.color : 'var(--bd,#1a5c2a)'}`,
                        color: form[b.key] ? b.color : 'var(--tx2,#6e9a75)',
                      }}>
                      <input type="checkbox" checked={form[b.key]} onChange={e=>setForm(f=>({...f,[b.key]:e.target.checked}))} className="accent-green-600" />
                      {b.label}
                    </label>
                  ))}
                </div>
              </div>
              </div>
            )}

            {/* PRICING & VARIANTS TAB */}
            {modalTab === 'pricing' && (
              <div style={{display:'flex',gap:'20px',alignItems:'flex-start'}}>
              {/* LEFT COLUMN — Pricing & Media */}
              <div className="space-y-3" style={{flex:'1',minWidth:0}}>
              <div className="text-[10px] font-bold uppercase tracking-widest mb-3 pb-1" style={{color:'var(--accent,#1a5c2a)',borderBottom:'1px solid var(--bd,#1a5c2a)'}}>💰 Pricing & Media</div>

              <div className="grid grid-cols-2 gap-2">
                <Field label="GST RATE">
                  <select value={form.gst_rate} onChange={e=>{
                    const rate=parseFloat(e.target.value)||0;
                    const base=parseFloat(form.price)||0;
                    const newSelling=(base+base*rate/100).toFixed(2);
                    setForm(f=>({...f,gst_rate:e.target.value,selling:newSelling}));
                  }} className={inp}>
                    {GST_RATES.map(r=><option key={r.value} value={r.value}>{r.value}%</option>)}
                  </select>
                </Field>
                <Field label="COST PRICE ₹">
                  <input type="number" value={form.cost_price} onChange={e=>setForm(f=>({...f,cost_price:e.target.value}))} className={inp} placeholder="Your cost" />
                </Field>
              </div>

              <Field label="BASE PRICE ₹ (excl. GST — auto-synced from lowest variant)">
                <div style={{position:'relative'}}>
                  <input type="number" value={form.price} readOnly className={inp}
                    style={{paddingRight:'90px', color:'#3fb950', borderColor: variants.length > 0 ? 'rgba(31,111,60,0.6)' : undefined, background: variants.length > 0 ? 'rgba(31,111,60,0.05)' : undefined}}
                    placeholder="0.00" />
                  {variants.length > 0 && (
                    <span style={{position:'absolute',right:'8px',top:'50%',transform:'translateY(-50%)',fontSize:'9px',fontWeight:700,color:'#3fb950',background:'rgba(31,111,60,0.15)',padding:'2px 6px',borderRadius:'4px',pointerEvents:'none',whiteSpace:'nowrap'}}>
                      ⚡ AUTO
                    </span>
                  )}
                </div>
              </Field>
              <Field label="SELLING PRICE ₹ (incl. GST — lowest active variant)">
                <div style={{position:'relative'}}>
                  <input type="number" value={form.selling} readOnly className={inp}
                    style={{paddingRight:'90px', color:'#3fb950', borderColor: variants.length > 0 ? 'rgba(31,111,60,0.6)' : undefined, background: variants.length > 0 ? 'rgba(31,111,60,0.05)' : undefined}}
                    placeholder="0.00" />
                  {variants.length > 0 && (
                    <span style={{position:'absolute',right:'8px',top:'50%',transform:'translateY(-50%)',fontSize:'9px',fontWeight:700,color:'#3fb950',background:'rgba(31,111,60,0.15)',padding:'2px 6px',borderRadius:'4px',pointerEvents:'none',whiteSpace:'nowrap'}}>
                      ⚡ AUTO
                    </span>
                  )}
                </div>
                {variants.length > 0 && (
                  <div style={{marginTop:'4px',fontSize:'10px',color:'#3fb950',display:'flex',alignItems:'center',gap:'4px'}}>
                    ✓ Synced from {(() => { const active = variants.filter(v=>v.price&&parseFloat(v.price)>0&&v.is_active!==false); if(!active.length) return 'variants'; const minP = Math.min(...active.map(v=>parseFloat(v.price))); const minV = active.find(v=>parseFloat(v.price)===minP); return minV?.variant_value || 'variants'; })()}  variant
                  </div>
                )}
              </Field>
              <div className="rounded-lg px-3 py-2 text-[11px]" style={{background:'color-mix(in srgb, var(--blue-bg) 45%, transparent)',border:'1px solid var(--blue-bg)'}}>
                <span className="text-[var(--blue)] font-semibold">MRP</span>
                <span className="text-[var(--tx3)]"> = strikethrough price shown on site. Must be ≥ selling price. Leave blank to use selling price.</span>
              </div>
              <Field label="MRP ₹ (strikethrough — must be ≥ selling price)">
                <input
                  type="number"
                  value={form.mrp}
                  onChange={e => {
                    const val = e.target.value;
                    const mrp = parseFloat(val) || 0;
                    const selling = parseFloat(form.selling) || 0;
                    setForm(f => ({ ...f, mrp: val, _mrpError: mrp > 0 && mrp < selling }));
                  }}
                  className={inp}
                  placeholder="Leave blank = same as selling price"
                  style={{ borderColor: form._mrpError ? '#f85149' : undefined }}
                />
                {form._mrpError && (
                  <div className="mt-1 flex items-center gap-1.5 text-[11px] font-semibold" style={{color:'#f85149'}}>
                    ⚠️ MRP (₹{parseFloat(form.mrp).toFixed(0)}) cannot be less than Selling Price (₹{parseFloat(form.selling||0).toFixed(0)})
                  </div>
                )}
                {!form._mrpError && form.mrp && parseFloat(form.mrp) > parseFloat(form.selling||0) && (
                  <div className="mt-1 flex items-center gap-1.5 text-[11px] font-semibold" style={{color:'#3fb950'}}>
                    ✓ Discount: {Math.round((1 - parseFloat(form.selling||0)/parseFloat(form.mrp)) * 100)}% off shown to customer
                  </div>
                )}
              </Field>

              {/* Live GST breakdown */}
              <div className="rounded-xl p-3" style={{background:'var(--bg,#0d1117)',border:'2px solid var(--accent,#1a5c2a)'}}>
                <div className="text-[10px] font-bold text-yellow-400 mb-2 tracking-wider">⚡ LIVE GST BREAKDOWN</div>
                <div className="flex items-center justify-center gap-2 mb-2 text-center">
                  <div><div className="text-[9px] text-[var(--tx3)]">Base</div><div className="text-[18px] font-bold text-[var(--tx)]">₹{gst.base.toFixed(2)}</div></div>
                  <div className="text-gray-500">+</div>
                  <div><div className="text-[9px] text-[var(--tx3)]">GST @{form.gst_rate}%</div><div className="text-[18px] font-bold text-orange-400">₹{gst.gstAmt}</div></div>
                  <div className="text-gray-500">=</div>
                  <div><div className="text-[9px] text-[var(--tx3)]">Selling</div><div className="text-[18px] font-bold text-green-400">₹{gst.selling}</div></div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded p-2 text-center" style={{background:'rgba(0,0,0,0.3)'}}>
                    <div className="text-[9px] text-[var(--tx3)]">CGST</div><div className="text-[14px] font-bold text-[var(--tx)]">₹{gst.cgst}</div>
                  </div>
                  <div className="rounded p-2 text-center" style={{background:'rgba(0,0,0,0.3)'}}>
                    <div className="text-[9px] text-[var(--tx3)]">SGST</div><div className="text-[14px] font-bold text-[var(--tx)]">₹{gst.sgst}</div>
                  </div>
                </div>
              </div>

              {/* Image */}
              <Field label="IMAGE URL">
                <div className="flex gap-2">
                  <input value={form.image_url} onChange={e=>setForm(f=>({...f,image_url:e.target.value}))} className={inp} placeholder="https://…" />
                  <button type="button" onClick={openImgModal}
                    className="flex-shrink-0 px-3 py-2 rounded-lg text-[11px] font-bold text-[var(--tx)]"
                    style={{background:'var(--accent,#1a5c2a)'}}>📤</button>
                </div>
              </Field>
              {form.image_url && (
                <img src={form.image_url} alt="" className="w-full rounded-xl object-cover"
                  style={{height:'180px',border:'1px solid var(--bd,#1a5c2a)'}}
                  onError={e=>{e.target.style.display='none';}} />
              )}

              {/* Video URL */}
              <Field label="VIDEO URL (optional)">
                <div className="flex gap-2">
                  <input value={form.video_url || ''} onChange={e=>setForm(f=>({...f,video_url:e.target.value}))} className={inp} placeholder="https://… (auto-filled after upload)" />
                  <button type="button" onClick={openImgModal}
                    className="flex-shrink-0 px-3 py-2 rounded-lg text-[11px] font-bold text-[var(--tx)]"
                    title="Open media manager to upload video"
                    style={{background:'var(--accent,#1a5c2a)'}}>🎬</button>
                </div>
              </Field>
              {form.video_url && (
                <video src={form.video_url} controls className="w-full rounded-xl"
                  style={{maxHeight:'160px',border:'1px solid var(--bd,#1a5c2a)',background:'#000'}}
                  onError={e=>{e.target.style.display='none';}} />
              )}

              </div>{/* end left column */}

              {/* RIGHT COLUMN — Variants */}
              <div className="space-y-3" style={{flex:'1',minWidth:0}}>
              <div className="text-[10px] font-bold uppercase tracking-widest mb-3 pb-1" style={{color:'var(--accent,#1a5c2a)',borderBottom:'1px solid var(--bd,#1a5c2a)'}}>📦 Variants</div>

              <div className="flex gap-2 mb-2">
                <button type="button" onClick={() => {
                    setAutoPanel(p => {
                      const opening = !p;
                      if (opening && variants.length > 0) {
                        const active = variants.filter(v => v.price && parseFloat(v.price) > 0 && v.is_active !== false);
                        if (active.length > 0) {
                          const minP = Math.min(...active.map(v => parseFloat(v.price)));
                          const minV = active.find(v => parseFloat(v.price) === minP);
                          if (minV) { setAvBaseUnit(minV.variant_value); setAvBasePrice(String(minP)); }
                        }
                      }
                      return opening;
                    });
                  }}
                  className="text-[11px] px-3 py-1.5 rounded-lg font-bold flex items-center gap-1.5"
                  style={{background: autoPanel ? 'rgba(210,153,34,0.25)' : 'var(--yellow-bg)', border:'1px solid rgba(210,153,34,0.4)', color:'var(--yellow)'}}>
                  ⚡ Auto-generate {autoPanel ? '▲' : '▼'}
                </button>
                <button type="button" onClick={addVariant}
                  className="text-[11px] px-3 py-1.5 rounded-lg font-bold"
                  style={{background:'var(--bg,#0d1117)',border:'1px solid var(--bd,#1a5c2a)',color:'var(--accent,#1a5c2a)'}}>
                  + Add Variant
                </button>
              </div>

              {autoPanel && (
                <div className="rounded-xl p-3 space-y-3" style={{background:'rgba(210,153,34,0.06)',border:'1px solid rgba(210,153,34,0.25)'}}>
                  <div className="text-[11px] font-bold text-yellow-400">⚡ Auto-generate variants</div>
                  <div className="text-[10px] text-[var(--tx3)]">
                    Prices calculated proportionally · SKUs auto-generated · Select type first
                  </div>

                  {/* Weight / Liquid toggle */}
                  <div className="flex gap-2">
                    {[{v:'weight',l:'⚖️ Weight (g/kg)'},{v:'liquid',l:'💧 Liquid (ml/L)'}].map(opt=>(
                      <button key={opt.v} type="button"
                        onClick={()=>{ setAvUnitType(opt.v); setAvSelectedSizes([]); setAvBaseUnit(opt.v==='liquid'?'250ml':'250g'); }}
                        className="flex-1 py-1.5 rounded-lg text-[11px] font-bold transition"
                        style={{background: avUnitType===opt.v ? 'color-mix(in srgb, var(--yellow-bg) 60%, transparent)' : 'color-mix(in srgb, var(--bd) 10%, transparent)', border:`1px solid ${avUnitType===opt.v ? 'color-mix(in srgb, var(--yellow) 60%, transparent)' : 'color-mix(in srgb, var(--bd) 20%, transparent)'}`, color: avUnitType===opt.v ? '#d29922' : 'var(--tx3,#6e7681)'}}>
                        {opt.l}
                      </button>
                    ))}
                  </div>

                  {/* Base unit + price */}
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="Base Unit">
                      <select value={avBaseUnit} onChange={e=>setAvBaseUnit(e.target.value)} className={inp}>
                        {ALL_SIZES.map(u=><option key={u}>{u}</option>)}
                      </select>
                    </Field>
                    <Field label={`Price for ${avBaseUnit} ₹`}>
                      <input type="number" value={avBasePrice} onChange={e=>setAvBasePrice(e.target.value)} className={inp}
                        placeholder={form.selling || '0'}
                        style={{borderColor: avBasePrice ? 'rgba(210,153,34,0.5)' : undefined}} />
                      {variants.length > 0 && avBasePrice && (
                        <div className="mt-1 text-[10px]" style={{color:'var(--yellow)'}}>⚡ Auto-filled from lowest variant · editable</div>
                      )}
                    </Field>
                  </div>

                  {/* Size checkboxes */}
                  <div>
                    <div className="text-[10px] font-bold text-gray-500 uppercase mb-1.5">Select Sizes to Generate</div>
                    <div className="grid grid-cols-3 gap-1.5">
                      {ALL_SIZES.map(sz => {
                        const checked = avSelectedSizes.includes(sz);
                        const alreadyExists = variants.some(v => v.variant_value?.toLowerCase().trim() === sz.toLowerCase().trim());
                        const bp = parseFloat(avBasePrice) || parseFloat(form.selling) || 0;
                        const ratio = parseGrams(sz) / parseGrams(avBaseUnit);
                        const previewPrice = bp > 0 ? Math.round(bp * ratio) : null;
                        return (
                          <label key={sz} className="flex flex-col rounded-lg px-2 py-1.5 cursor-pointer select-none"
                            style={{background: checked ? 'rgba(210,153,34,0.18)' : 'color-mix(in srgb, var(--bd) 10%, transparent)', border:`1px solid ${checked ? 'rgba(210,153,34,0.5)' : 'rgba(255,255,255,0.08)'}`, opacity: alreadyExists ? 0.4 : 1}}>
                            <div className="flex items-center gap-1.5">
                              <input type="checkbox" checked={checked} disabled={alreadyExists}
                                onChange={() => setAvSelectedSizes(s => checked ? s.filter(x=>x!==sz) : [...s, sz])}
                                className="accent-yellow-500 w-3 h-3" />
                              <span className="text-[11px] font-bold" style={{color: checked ? '#d29922' : 'var(--tx2,#8b949e)'}}>{sz}</span>
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
                      <button type="button" onClick={() => setAvSelectedSizes(ALL_SIZES.filter(sz => !variants.some(v=>v.variant_value?.toLowerCase().trim()===sz.toLowerCase().trim())))}
                        className="text-[10px] text-yellow-500 underline">Select All</button>
                      <button type="button" onClick={() => setAvSelectedSizes([])}
                        className="text-[10px] text-gray-500 underline">Clear</button>
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <button type="button" onClick={autoGenerate} disabled={!avSelectedSizes.length}
                      className="flex-1 py-2 rounded-lg text-[12px] font-bold text-[var(--tx)] disabled:opacity-40"
                      style={{background:'var(--yellow)'}}>
                      ⚡ Generate {avSelectedSizes.length} variant{avSelectedSizes.length !== 1 ? 's' : ''} →
                    </button>
                    <button type="button" onClick={() => setAutoPanel(false)}
                      className="px-4 py-2 rounded-lg text-[11px] text-[var(--tx3)] border border-[var(--bd)]">Cancel</button>
                  </div>
                </div>
              )}

              {variants.length === 0 && !autoPanel && (
                <div className="rounded-xl p-4 text-center" style={{background:'var(--bg,#0d1117)',border:'1px dashed var(--bd,#1a5c2a)'}}>
                  <div className="text-[12px] text-gray-500 mb-1">No variants</div>
                  <div className="text-[10px] text-gray-600">Single product. Add variants for multiple sizes (250g, 500g, 1kg etc.)</div>
                </div>
              )}

              <div className="space-y-2">
                {variants.map((v, i) => (
                  <div key={i} className="rounded-xl p-3 space-y-2" style={{background:'var(--bg,#0d1117)',border:'1px solid var(--bd,#1a5c2a)'}}>
                    <div className="flex items-center justify-between">
                      <div className="text-[10px] font-bold text-[var(--tx3)] uppercase">Variant #{i+1}</div>
                      <button onClick={() => removeVariant(i)}
                        className="w-6 h-6 rounded flex items-center justify-center text-[var(--tx)] text-[11px]"
                        style={{background:'#e74c3c'}}>✕</button>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <Field label="Type">
                        <select value={v.variant_type||'weight'} onChange={e=>updateVariant(i,'variant_type',e.target.value)}
                          className={inp} style={{padding:'6px 8px'}}>
                          {['weight','volume','pack_size','grade'].map(t=><option key={t}>{t}</option>)}
                        </select>
                      </Field>
                      <Field label="Value">
                        <input value={v.variant_value||''} onChange={e=>updateVariant(i,'variant_value',e.target.value)}
                          placeholder="e.g. 250g" className={inp} style={{padding:'6px 8px'}} />
                      </Field>
                    </div>
                    {/* Sell price + Status row */}
                    <div className="grid grid-cols-2 gap-2">
                      <Field label="Sell ₹">
                        <input type="number" value={v.price||''} onChange={e=>updateVariant(i,'price',e.target.value)}
                          className={inp} style={{padding:'6px 8px'}} />
                      </Field>
                      <Field label="Status">
                        <select value={v.is_active!==false?'true':'false'} onChange={e=>updateVariant(i,'is_active',e.target.value==='true')}
                          className={inp} style={{padding:'6px 8px'}}>
                          <option value="true">✓ Active</option>
                          <option value="false">✗ Off</option>
                        </select>
                      </Field>
                    </div>

                    {/* Initial Stock — mandatory for inventory tracking */}
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-wider mb-1"
                        style={{color: (!v.initial_stock || parseInt(v.initial_stock) <= 0) ? '#f85149' : 'var(--tx2,#8b949e)'}}>
                        Initial Stock <span style={{color:'#f85149'}}>*</span>
                        <span className="ml-1 text-[9px] font-normal" style={{color:'#555'}}>required for inventory</span>
                      </label>
                      <input type="number" value={v.initial_stock||''} onChange={e=>updateVariant(i,'initial_stock',e.target.value)}
                        className={inp} style={{padding:'5px 8px',
                          borderColor: (!v.initial_stock || parseInt(v.initial_stock) <= 0) ? 'rgba(248,81,73,0.5)' : undefined}}
                        placeholder="Total purchased *" />
                    </div>

                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-wider mb-1 text-gray-500">
                        SKU <span className="text-[9px] font-normal text-gray-600 ml-1">auto-generated by DB</span>
                      </label>
                      <div className={inp} style={{padding:'6px 8px',fontFamily:'monospace',fontSize:11,
                        color:'var(--blue)',cursor:'not-allowed',opacity:0.8,userSelect:'all'}}>
                        {v.sku || generateSku(form.name, v.variant_value, catMap[form.category_id] || '') || '—'}
                      </div>
                    </div>
                    {v._base && <div className="text-[10px] text-gray-500">Base (excl. GST): ₹{v._base}</div>}
                  </div>
                ))}
              </div>
              </div>
              </div>
            )}

            {/* AI CONTENT TAB */}
            {modalTab === 'ai' && (
              <div className="space-y-3 max-w-xl">
              <div className="flex items-center justify-between mb-3">
                <div className="text-[10px] font-bold uppercase tracking-widest" style={{color:'var(--purple)'}}>🤖 AI Content</div>
                {aiSaved && !aiPreview && (
                  <span className="text-[9px] px-2 py-0.5 rounded-full font-semibold" style={{background:'rgba(63,185,80,0.12)',border:'1px solid rgba(63,185,80,0.3)',color:'#3fb950'}}>
                    ✓ Content saved
                  </span>
                )}
                {!aiSaved && !aiPreview && modal !== 'add' && (
                  <span className="text-[9px] px-2 py-0.5 rounded-full font-semibold" style={{background:'rgba(248,81,73,0.1)',border:'1px solid rgba(248,81,73,0.25)',color:'#f85149'}}>
                    No AI content yet
                  </span>
                )}
              </div>

              {/* Error */}
              {aiError && (
                <div className="text-[11px] mb-2 px-3 py-2 rounded-lg" style={{background:'rgba(248,81,73,0.08)',border:'1px solid rgba(248,81,73,0.2)',color:'#f85149'}}>
                  ⚠ {aiError}
                </div>
              )}

              {/* Generate button */}
              {!aiPreview && (
                <button
                  onClick={handleGenerateAI}
                  disabled={aiLoading || modal === 'add'}
                  className="w-full py-2 rounded-lg text-[12px] font-bold transition mb-2 flex items-center justify-center gap-2"
                  style={{
                    background: aiLoading ? 'var(--purple-bg)' : 'rgba(137,87,229,0.18)',
                    border: '1px solid rgba(137,87,229,0.45)',
                    color: aiLoading ? '#8957e580' : '#c0a0ff',
                    cursor: modal === 'add' ? 'not-allowed' : 'pointer',
                    opacity: modal === 'add' ? 0.5 : 1,
                  }}>
                  {aiLoading
                    ? <><span style={{display:'inline-block',width:12,height:12,borderRadius:'50%',border:'2px solid #8957e5',borderTopColor:'transparent',animation:'spin 0.7s linear infinite'}} /> Generating…</>
                    : aiSaved ? '🔄 Regenerate with Claude Haiku' : '✨ Generate with Claude Haiku'
                  }
                </button>
              )}

              {/* Preview box */}
              {aiPreview && (
                <div className="rounded-lg p-3 mb-2 text-[11px] space-y-2" style={{background:'color-mix(in srgb, var(--purple-bg) 40%, transparent)',border:'1px solid var(--purple-bg)'}}>
                  <div style={{color:'var(--tx2,#8b949e)',fontWeight:700,fontSize:9,textTransform:'uppercase',letterSpacing:'0.05em',marginBottom:4}}>Preview — not yet saved</div>

                  {/* Description */}
                  <div>
                    <div style={{color:'var(--purple)',fontWeight:700,fontSize:10,marginBottom:2}}>📄 Description</div>
                    <div style={{color:'var(--tx,#e6edf3)',lineHeight:1.5}}>{aiPreview.description}</div>
                  </div>

                  {/* Benefits */}
                  {aiPreview.benefits?.length > 0 && (
                    <div>
                      <div style={{color:'var(--purple)',fontWeight:700,fontSize:10,marginBottom:2}}>💚 Health Benefits ({aiPreview.benefits.length})</div>
                      <ul style={{margin:0,padding:'0 0 0 14px',color:'var(--tx2,#8b949e)',lineHeight:1.6}}>
                        {aiPreview.benefits.map((b,i) => (
                          <li key={i}><span style={{color:'var(--tx,#e6edf3)',fontWeight:600}}>{b.icon} {b.title}</span> — {b.desc}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* How to Use */}
                  {aiPreview.how_to_use?.length > 0 && (
                    <div>
                      <div style={{color:'var(--purple)',fontWeight:700,fontSize:10,marginBottom:2}}>🍽️ How to Use</div>
                      <ul style={{margin:0,padding:'0 0 0 14px',color:'var(--tx2,#8b949e)',lineHeight:1.6}}>
                        {aiPreview.how_to_use.map((s,i) => <li key={i}>{s}</li>)}
                      </ul>
                    </div>
                  )}

                  {/* Storage Tips */}
                  {aiPreview.storage_tips?.length > 0 && (
                    <div>
                      <div style={{color:'var(--purple)',fontWeight:700,fontSize:10,marginBottom:2}}>📦 Storage Tips</div>
                      <ul style={{margin:0,padding:'0 0 0 14px',color:'var(--tx2,#8b949e)',lineHeight:1.6}}>
                        {aiPreview.storage_tips.map((s,i) => <li key={i}>{s}</li>)}
                      </ul>
                    </div>
                  )}

                  {/* Who Should Buy */}
                  {aiPreview.who_should_buy && (
                    <div>
                      <div style={{color:'var(--purple)',fontWeight:700,fontSize:10,marginBottom:2}}>👤 Who Should Buy</div>
                      <div style={{color:'var(--tx2,#8b949e)',lineHeight:1.5}}>{aiPreview.who_should_buy}</div>
                    </div>
                  )}

                  {/* Save / Discard / Regenerate buttons */}
                  <div className="flex gap-2 pt-1">
                    <button onClick={handleSaveAI}
                      className="flex-1 py-1.5 rounded-lg text-[11px] font-bold transition"
                      style={{background:'rgba(63,185,80,0.15)',border:'1px solid rgba(63,185,80,0.35)',color:'#3fb950'}}>
                      ✓ Save & Go Live
                    </button>
                    <button onClick={handleGenerateAI} disabled={aiLoading}
                      className="py-1.5 px-3 rounded-lg text-[11px] font-bold transition"
                      style={{background:'var(--purple-bg)',border:'1px solid rgba(137,87,229,0.3)',color:'var(--purple)'}}>
                      🔄 Retry
                    </button>
                    <button onClick={handleDiscardAI}
                      className="py-1.5 px-3 rounded-lg text-[11px] font-bold transition"
                      style={{background:'rgba(248,81,73,0.08)',border:'1px solid rgba(248,81,73,0.2)',color:'#f85149'}}>
                      ✕
                    </button>
                  </div>
                </div>
              )}

              {/* Saved content summary */}
              {aiSaved && !aiPreview && (
                <div className="rounded-lg p-2.5 text-[10px]" style={{background:'rgba(63,185,80,0.05)',border:'1px solid rgba(63,185,80,0.15)'}}>
                  <div style={{color:'#3fb950',fontWeight:700,marginBottom:4}}>✓ Live on customer site</div>
                  <div style={{color:'var(--tx2,#8b949e)',lineHeight:1.5,marginBottom:4}} className="line-clamp-2">{aiSaved.description}</div>
                  <div className="flex flex-wrap gap-x-3 gap-y-1" style={{color:'var(--tx3,#6e7681)',fontSize:9}}>
                    <span>💚 {aiSaved.benefits?.length || 0} benefits</span>
                    <span>🍽️ {aiSaved.how_to_use?.length || 0} usage steps</span>
                    <span>📦 {aiSaved.storage_tips?.length || 0} storage tips</span>
                  </div>
                  {aiSaved.generated_at && (
                    <div style={{color:'var(--tx3,#6e7681)',fontSize:9,marginTop:4}}>
                      Last generated: {new Date(aiSaved.generated_at).toLocaleString('en-IN', {day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'})} via {aiSaved.provider || 'Claude'}
                    </div>
                  )}
                </div>
              )}

              {modal === 'add' && (
                <div className="text-[10px] text-center mt-1" style={{color:'var(--tx3,#6e7681)'}}>
                  Save product first, then generate AI content
                </div>
              )}
              </div>
            )}

          </div>

          {/* Save bar — sticky at bottom */}
          <div className="flex gap-3 mt-4 pt-4 flex-shrink-0" style={{borderTop:'1px solid var(--bd,#1a5c2a)'}}>
            <button onClick={save} disabled={saving}
              className="flex-1 py-2.5 rounded-lg text-[13px] font-bold text-[var(--tx)] transition"
              style={{background: saving ? '#333' : 'var(--accent,#1a5c2a)'}}>
              {saving ? 'Saving…' : modal === 'add' ? '+ Add Product' : '💾 Save Product'}
            </button>
            <button onClick={() => setModal(null)}
              className="px-6 py-2.5 rounded-lg text-[13px] text-[var(--tx3)] border border-[var(--bd)] hover:border-gray-500 transition">
              Cancel
            </button>
          </div>
          </div>
        </Modal>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search products…"
          className="rounded-lg px-3 py-1.5 text-[12px] focus:outline-none flex-[2] min-w-0"
          style={{background:'var(--bg2,#161b22)',border:'1px solid var(--bd,#1a5c2a)',color:'var(--tx,#fff)',height:30}} />
        <select value={filterCat} onChange={e => setFilterCat(e.target.value)}
          className="rounded-lg px-2 py-1.5 text-[12px] focus:outline-none flex-[1.2] min-w-0"
          style={{background:'var(--bg2,#161b22)',border:'1px solid var(--bd,#1a5c2a)',color:'var(--tx,#fff)',height:30}}>
          <option value="">All Categories</option>
          {categories.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
        </select>
        <select value={filterSize} onChange={e => setFilterSize(e.target.value)}
          className="rounded-lg px-2 py-1.5 text-[12px] focus:outline-none flex-[1.2] min-w-0"
          style={{background:'var(--bg2,#161b22)',border:'1px solid var(--bd,#1a5c2a)',color:'var(--tx,#fff)',height:30}}>
          <option value="">All Sizes</option>
          {allSizes.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={filterStock} onChange={e => setFilterStock(e.target.value)}
          className="rounded-lg px-2 py-1.5 text-[12px] focus:outline-none flex-[1.2] min-w-0"
          style={{background:'var(--bg2,#161b22)',border:'1px solid var(--bd,#1a5c2a)',color:'var(--tx,#fff)',height:30}}>
          <option value="">All Status</option>
          <option value="out">Out of stock</option>
          <option value="low">Low (≤5)</option>
          <option value="ok">Good (&gt;10)</option>
        </select>
        <span className="text-[11px] whitespace-nowrap px-1" style={{color:'var(--tx2,#6e9a75)'}}>{totalVariants} variant{totalVariants !== 1 ? 's' : ''}</span>
        {hasFilter && (
          <button onClick={() => { setSearch(''); setFilterCat(''); setFilterSize(''); setFilterStock(''); }}
            className="text-[11px] px-3 py-1 rounded-lg whitespace-nowrap"
            style={{color:'#f85149',border:'1px solid rgba(248,81,73,0.3)',background:'transparent',height:30}}>
            ✕ Clear
          </button>
        )}
        <button onClick={openAdd}
          className="px-4 py-2 rounded-lg text-[12px] font-bold text-[var(--tx)] whitespace-nowrap"
          style={{background:'var(--accent,#1a5c2a)',height:30}}>
          + Add Product
        </button>
      </div>

      <Card title={`Products (${filtered.length})`}>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead><tr>
              {['Product','Category','SKU','Size','Price','Initial Stock','Available Stock','Status',''].map(h=>(
                <th key={h} className="text-left text-[10px] font-bold uppercase tracking-wider pb-2 pr-4" style={{color:'var(--tx2,#6e9a75)'}}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {filtered.map(p => {
                const pVars = variantStockMap[p.id] || [];
                const visibleVars = pVars.filter(v => {
                  if (filterSize && v.variant_value !== filterSize) return false;
                  if (filterStock === 'out' && v.available_stock !== 0) return false;
                  if (filterStock === 'low' && !(v.available_stock > 0 && v.available_stock <= 5)) return false;
                  if (filterStock === 'ok'  && !(v.available_stock > 10)) return false;
                  return true;
                });
                const displayVars = (filterSize || filterStock) ? visibleVars : pVars;
                const rowCount = displayVars.length || 1;
                const isHighlighted = !!(filterSize || filterStock);

                return displayVars.length > 0 ? displayVars.map((v, i) => {
                  const avail = v.available_stock ?? 0;
                  const color = avail === 0 ? '#f85149' : avail <= 5 ? 'var(--yellow)' : '#3fb950';
                  const isFirst = i === 0;
                  return (
                    <tr key={`${p.id}-${i}`} className="border-t hover:opacity-90 transition" style={{borderColor: isFirst ? 'var(--bd,#1a5c2a)' : 'rgba(26,92,42,0.15)', background: isHighlighted ? 'rgba(210,153,34,0.04)' : 'transparent'}}>
                      {isFirst && (
                        <>
                          <td className="py-2.5 pr-4" rowSpan={rowCount}>
                            <div className="flex items-center gap-2">
                              {p.image_url && <img src={p.image_url} alt="" className="w-8 h-8 rounded object-cover flex-shrink-0" style={{border:'1px solid var(--bd,#1a5c2a)'}} onError={e=>e.target.style.display='none'} />}
                              <div>
                                <div className="text-[13px] font-semibold" style={{color:'var(--tx,#fff)'}}>{p.emoji} {p.name}</div>
                                {p._variantCount > 0 && (
                                  <div className="text-[10px] mt-0.5" style={{color:'var(--blue)',background:'var(--blue-bg)',borderRadius:4,display:'inline-block',padding:'1px 6px'}}>
                                    {p._variantCount} variant{p._variantCount !== 1 ? 's' : ''}
                                  </div>
                                )}
                                {p.badges?.length > 0 && (
                                  <div className="flex gap-1 mt-0.5">
                                    {p.badges.includes('bestseller') && <span className="text-[9px] px-1.5 rounded-full" style={{background:'var(--yellow-bg)',color:'var(--yellow)'}}>🏆</span>}
                                    {p.badges.includes('organic')    && <span className="text-[9px] px-1.5 rounded-full" style={{background:'rgba(63,185,80,0.2)',color:'#3fb950'}}>🌿</span>}
                                    {p.badges.includes('new')        && <span className="text-[9px] px-1.5 rounded-full" style={{background:'var(--blue-bg)',color:'var(--blue)'}}>✨</span>}
                                  </div>
                                )}
                              </div>
                            </div>
                          </td>
                          <td className="py-2.5 pr-4" rowSpan={rowCount}><Badge type="blue">{catMap[p.category_id] || '—'}</Badge></td>
                        </>
                      )}
                      <td className="py-1.5 pr-4 text-[10px]" style={{color:'var(--tx2,#6e9a75)',fontFamily:'monospace',whiteSpace:'nowrap'}}>{v.sku || '—'}</td>
                      <td className="py-1.5 pr-4 text-[11px]" style={{color:'var(--tx,#fff)'}}>{v.variant_value || '—'}</td>
                      <td className="py-1.5 pr-4">
                        <div className="text-[12px] font-bold" style={{color:'var(--tx,#fff)'}}>₹{parseFloat(v.price||0).toFixed(0)}</div>
                      </td>
                      <td className="py-1.5 pr-4 text-[11px]" style={{color:'var(--tx,#fff)'}}>{v.initial_stock ?? '—'}</td>
                      <td className="py-1.5 pr-4 text-[11px] font-bold" style={{color}}>{avail}</td>
                      {isFirst && (
                        <>
                          <td className="py-2.5 pr-4" rowSpan={rowCount}>
                            <button onClick={() => toggleStatus(p)}>
                              <Badge type={p.status === 'active' ? 'green' : 'default'}>{p.status || 'active'}</Badge>
                            </button>
                          </td>
                          <td className="py-2.5" rowSpan={rowCount}>
                            <div className="flex flex-col gap-1 items-start">
                              <button onClick={() => openEdit(p)} className="text-[11px] px-3 py-1 rounded transition"
                                style={{color:'var(--accent,#1a5c2a)',border:'1px solid var(--bd,#1a5c2a)'}}>
                                Edit
                              </button>
                              {p.ai_description
                                ? <span className="text-[9px] px-1.5 py-0.5 rounded-full" style={{background:'var(--purple-bg)',color:'var(--purple)'}}>🤖 AI</span>
                                : <span className="text-[9px] px-1.5 py-0.5 rounded-full" style={{background:'color-mix(in srgb, var(--tx3) 10%, transparent)',color:'var(--tx3,#6e7681)'}}>No AI</span>
                              }
                            </div>
                          </td>
                        </>
                      )}
                    </tr>
                  );
                }) : (
                  <tr key={p.id} className="border-t hover:opacity-80 transition" style={{borderColor:'var(--bd,#1a5c2a)'}}>
                    <td className="py-2.5 pr-4">
                      <div className="flex items-center gap-2">
                        {p.image_url && <img src={p.image_url} alt="" className="w-8 h-8 rounded object-cover flex-shrink-0" style={{border:'1px solid var(--bd,#1a5c2a)'}} onError={e=>e.target.style.display='none'} />}
                        <div>
                          <div className="text-[13px] font-semibold" style={{color:'var(--tx,#fff)'}}>{p.emoji} {p.name}</div>
                          {p.badges?.length > 0 && (
                            <div className="flex gap-1 mt-0.5">
                              {p.badges.includes('bestseller') && <span className="text-[9px] px-1.5 rounded-full" style={{background:'var(--yellow-bg)',color:'var(--yellow)'}}>🏆</span>}
                              {p.badges.includes('organic')    && <span className="text-[9px] px-1.5 rounded-full" style={{background:'rgba(63,185,80,0.2)',color:'#3fb950'}}>🌿</span>}
                              {p.badges.includes('new')        && <span className="text-[9px] px-1.5 rounded-full" style={{background:'var(--blue-bg)',color:'var(--blue)'}}>✨</span>}
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="py-2.5 pr-4"><Badge type="blue">{catMap[p.category_id] || '—'}</Badge></td>
                    <td className="py-2.5 pr-4 text-[11px]" style={{color:'var(--tx2,#6e9a75)'}}>—</td>
                    <td className="py-2.5 pr-4 text-[11px]" style={{color:'var(--tx2,#6e9a75)'}}>—</td>
                    <td className="py-2.5 pr-4 text-[11px]" style={{color:'var(--tx2,#6e9a75)'}}>—</td>
                    <td className="py-2.5 pr-4 text-[11px]" style={{color:'var(--tx2,#6e9a75)'}}>—</td>
                    <td className="py-2.5 pr-4 text-[11px]" style={{color:'var(--tx2,#6e9a75)'}}>—</td>
                    <td className="py-2.5 pr-4">
                      <button onClick={() => toggleStatus(p)}>
                        <Badge type={p.status === 'active' ? 'green' : 'default'}>{p.status || 'active'}</Badge>
                      </button>
                    </td>
                    <td className="py-2.5">
                      <div className="flex flex-col gap-1 items-start">
                        <button onClick={() => openEdit(p)} className="text-[11px] px-3 py-1 rounded transition"
                          style={{color:'var(--accent,#1a5c2a)',border:'1px solid var(--bd,#1a5c2a)'}}>
                          Edit
                        </button>
                        {p.ai_description
                          ? <span className="text-[9px] px-1.5 py-0.5 rounded-full" style={{background:'var(--purple-bg)',color:'var(--purple)'}}>🤖 AI</span>
                          : <span className="text-[9px] px-1.5 py-0.5 rounded-full" style={{background:'color-mix(in srgb, var(--tx3) 10%, transparent)',color:'var(--tx3,#6e7681)'}}>No AI</span>
                        }
                      </div>
                    </td>
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
const inp = "w-full rounded-lg px-3 py-2 text-[12px] focus:outline-none focus:ring-1 focus:ring-[var(--accent)] bg-[var(--bg)] border border-[var(--accent)] text-[var(--tx)] placeholder-[var(--tx3)]";
function Field({ label, children }) {
  return (
    <div>
      <label className="block text-[10px] font-bold uppercase tracking-wider mb-1 text-[var(--tx3)]">{label}</label>
      {children}
    </div>
  );
}

// ── Categories Tab ────────────────────────────────────────────
function CategoriesTab() {
  const [cats, setCats]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal]   = useState(null);
  const [form, setForm]     = useState({ name: '', slug: '', description: '' });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setCats(await api.get('categories', 'select=id,name,slug,description&order=name.asc') || []); }
    catch(e) {}
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function save() {
    if (!form.name) return alert('Name required');
    setSaving(true);
    try {
      const body = { name: form.name, slug: form.slug || form.name.toLowerCase().replace(/\s+/g,'-'), description: form.description };
      if (modal === 'add') await api.post('categories', body);
      else await api.patch('categories', `id=eq.${modal.id}`, body);
      setModal(null); load();
    } catch(e) { alert('Error: ' + e.message); }
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
            <Field label="NAME *"><input value={form.name} onChange={e=>{
              const n=e.target.value;
              setForm(f=>({...f, name:n, slug: f.slug||n.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'') }));
            }} className={inp} placeholder="Category name" /></Field>
            <Field label="SLUG"><input value={form.slug} onChange={e=>setForm(f=>({...f,slug:e.target.value}))} className={inp} placeholder="auto-generated from name" /></Field>
            <Field label="DESCRIPTION"><textarea value={form.description} onChange={e=>setForm(f=>({...f,description:e.target.value}))} className={inp + ' h-16 resize-none'} placeholder="Optional description" /></Field>
          </div>
          <div className="flex gap-3 mt-5 pt-4" style={{borderTop:'1px solid var(--bd,#1a5c2a)'}}>
            <button onClick={save} disabled={saving} className="flex-1 py-2.5 rounded-lg text-[13px] font-bold text-white" style={{background:'var(--accent,#1a5c2a)'}}>
              {saving ? 'Saving…' : modal === 'add' ? '+ Add' : '✓ Save'}
            </button>
            <button onClick={() => setModal(null)} className="px-5 py-2.5 rounded-lg text-[13px] text-[var(--tx3)] border border-[var(--bd)]">Cancel</button>
          </div>
        </Modal>
      )}
      <div className="flex justify-end">
        <button onClick={() => { setForm({name:'',slug:'',description:''}); setModal('add'); }}
          className="px-4 py-2 rounded-lg text-[12px] font-bold text-white" style={{background:'var(--accent,#1a5c2a)'}}>
          + Add Category
        </button>
      </div>
      <Card title={`Categories (${cats.length})`}>
        <table className="w-full">
          <thead><tr>
            {['Name','Slug','Description',''].map(h=>(
              <th key={h} className="text-left text-[10px] font-bold uppercase tracking-wider pb-2 pr-4" style={{color:'var(--tx2,#6e9a75)'}}>{h}</th>
            ))}
          </tr></thead>
          <tbody>
            {cats.map(c => (
              <tr key={c.id} className="border-t" style={{borderColor:'var(--bd,#1a5c2a)'}}>
                <td className="py-2.5 pr-4 text-[13px] font-semibold" style={{color:'var(--tx,#fff)'}}>{c.name}</td>
                <td className="py-2.5 pr-4 text-[11px] font-mono" style={{color:'var(--tx2,#6e9a75)'}}>{c.slug || '—'}</td>
                <td className="py-2.5 pr-4 text-[11px]" style={{color:'var(--tx2,#6e9a75)'}}>{c.description || '—'}</td>
                <td className="py-2.5 flex gap-2">
                  <button onClick={() => { setForm({name:c.name,slug:c.slug||'',description:c.description||''}); setModal(c); }}
                    className="text-[11px] px-3 py-1 rounded transition" style={{color:'var(--accent,#1a5c2a)',border:'1px solid var(--bd,#1a5c2a)'}}>Edit</button>
                  <button onClick={() => del(c)} className="text-[11px] px-3 py-1 rounded border border-red-900 text-red-400 hover:bg-red-950/20 transition">Del</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

// ── GST Auto-suggest rules (category name → recommended GST %)
const GST_SUGGEST = [
  { keywords: ['honey', 'shahad'],                         rate: 5,  reason: 'Packaged honey — 5%' },
  { keywords: ['juice', 'buransh', 'rhododendron'],        rate: 12, reason: 'Packaged fruit juice — 12%' },
  { keywords: ['rice', 'chawal', 'rajma', 'dal', 'pulse'], rate: 5,  reason: 'Staple food grains — 5%' },
  { keywords: ['tea', 'chai'],                             rate: 5,  reason: 'Tea — 5%' },
  { keywords: ['spice', 'masala', 'turmeric', 'cardamom', 'haldi', 'jeera'], rate: 5, reason: 'Spices — 5%' },
  { keywords: ['oil', 'mustard', 'tel'],                   rate: 5,  reason: 'Edible oil — 5%' },
  { keywords: ['shilajit', 'resin', 'supplement'],         rate: 18, reason: 'Supplement — 18%' },
  { keywords: ['shoot', 'bamboo', 'pickle', 'achar'],      rate: 12, reason: 'Processed veg — 12%' },
];

function getSuggest(catName, productName) {
  const text = ((catName || '') + ' ' + (productName || '')).toLowerCase();
  for (const rule of GST_SUGGEST) {
    if (rule.keywords.some(k => text.includes(k))) return rule;
  }
  return null;
}

// ── GST Manager Tab ───────────────────────────────────────────
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

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [p, c] = await Promise.all([
        api.get('products', 'select=id,name,emoji,price,gst_rate,status,category_id&is_deleted=eq.false&order=name.asc'),
        api.get('categories', 'select=id,name&order=name.asc'),
      ]);
      setProducts(p || []);
      setCategories(c || []);
    } catch(e) {}
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const catMap = Object.fromEntries((categories || []).map(c => [c.id, c.name]));

  async function updateGST(p, newRate) {
    setSaving(s => ({...s, [p.id]: true}));
    const rate = parseFloat(newRate);
    const oldRate = parseFloat(p.gst_rate) || 5;
    const basePrice = parseFloat(p.price) / (1 + oldRate / 100);
    const newPrice = (basePrice * (1 + rate / 100)).toFixed(2);
    try {
      await api.patch('products', `id=eq.${p.id}`, { gst_rate: rate, price: parseFloat(newPrice) });
      setProducts(ps => ps.map(x => x.id === p.id ? { ...x, gst_rate: rate, price: newPrice } : x));
    } catch(e) { alert('Error: ' + e.message); }
    finally { setSaving(s => ({...s, [p.id]: false})); }
  }

  async function applyBulk() {
    if (!bulkRate) return alert('Select a GST rate to apply');
    const targets = filtered.filter(p => selected.size === 0 || selected.has(p.id));
    if (!targets.length) return alert('No products selected');
    if (!confirm(`Apply ${bulkRate}% GST to ${targets.length} product${targets.length > 1 ? 's' : ''}?\n\nPrices will be recalculated to keep base price same.`)) return;
    setBulkSaving(true);
    let success = 0;
    for (const p of targets) {
      const rate = parseFloat(bulkRate);
      const oldRate = parseFloat(p.gst_rate) || 5;
      const basePrice = parseFloat(p.price) / (1 + oldRate / 100);
      const newPrice = parseFloat((basePrice * (1 + rate / 100)).toFixed(2));
      try { await api.patch('products', `id=eq.${p.id}`, { gst_rate: rate, price: newPrice }); success++; } catch(e) {}
    }
    setBulkSaving(false);
    setSelected(new Set());
    setBulkRate('');
    alert(`Done! Updated ${success} of ${targets.length} products.`);
    load();
  }

  // Auto-apply suggested GST rates for all products that have a mismatch
  async function applyAutoSuggest() {
    const toFix = products.filter(p => {
      const s = getSuggest(catMap[p.category_id], p.name);
      return s && s.rate !== (parseFloat(p.gst_rate) || 5);
    });
    if (!toFix.length) return alert('All products already have correct GST rates! No changes needed.');
    const preview = toFix.map(p => {
      const s = getSuggest(catMap[p.category_id], p.name);
      return `• ${p.name}: ${p.gst_rate}% → ${s.rate}% (${s.reason})`;
    }).join('\n');
    if (!confirm(`Auto-fix GST for ${toFix.length} products?\n\n${preview}\n\nPrices will be recalculated.`)) return;
    setAutoApplying(true);
    let success = 0;
    for (const p of toFix) {
      const s = getSuggest(catMap[p.category_id], p.name);
      const rate = s.rate;
      const oldRate = parseFloat(p.gst_rate) || 5;
      const basePrice = parseFloat(p.price) / (1 + oldRate / 100);
      const newPrice = parseFloat((basePrice * (1 + rate / 100)).toFixed(2));
      try { await api.patch('products', `id=eq.${p.id}`, { gst_rate: rate, price: newPrice }); success++; } catch(e) {}
    }
    setAutoApplying(false);
    alert(`Done! Auto-fixed ${success} products.`);
    load();
  }

  function toggleSelect(id) {
    setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function selectAll() {
    setSelected(s => s.size === filtered.length ? new Set() : new Set(filtered.map(p => p.id)));
  }

  const filtered = products.filter(p => {
    const matchSearch = !search || p.name.toLowerCase().includes(search.toLowerCase());
    const matchCat    = !filterCat || String(p.category_id) === filterCat;
    return matchSearch && matchCat;
  });
  const summary    = GST_RATES.map(r => ({ rate: r.value, count: products.filter(p => (p.gst_rate||5) === r.value).length })).filter(r => r.count > 0);
  const allSelected = filtered.length > 0 && selected.size === filtered.length;

  // Count how many products have a suggested rate different from current
  const autoFixCount = products.filter(p => {
    const s = getSuggest(catMap[p.category_id], p.name);
    return s && s.rate !== (parseFloat(p.gst_rate) || 5);
  }).length;

  if (loading) return <Loader text="Loading GST data…" />;

  return (
    <div className="space-y-4">
      {/* Summary tiles */}
      <div className="grid grid-cols-5 gap-3">
        {summary.map(s => (
          <div key={s.rate} className="rounded-xl p-3 text-center" style={{background:'var(--bg2,#161b22)',border:'1px solid var(--bd,#1a5c2a)'}}>
            <div className="text-[22px] font-bold" style={{color:'var(--accent,#1a5c2a)'}}>{s.rate}%</div>
            <div className="text-[11px]" style={{color:'var(--tx2,#6e9a75)'}}>{s.count} product{s.count!==1?'s':''}</div>
          </div>
        ))}
      </div>

      {/* ── AUTO SUGGEST panel ───────────────────────── */}
      <div className="rounded-xl p-4" style={{background:'color-mix(in srgb, var(--blue-bg) 33%, transparent)',border:'2px solid var(--blue)'}}>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="text-[11px] font-bold text-[var(--blue)] mb-1 tracking-wider">🤖 SMART GST AUTO-SUGGEST</div>
            <div className="text-[11px] text-[var(--tx3)] max-w-lg">
              Analyzes each product's category and name against Indian GST food slabs
              (honey→5%, juice→12%, shilajit→18%, etc.) and suggests the correct rate.
            </div>
            {autoFixCount > 0 ? (
              <div className="mt-1.5 text-[11px] text-yellow-400 font-semibold">
                ⚠️ {autoFixCount} product{autoFixCount > 1 ? 's have' : ' has'} a potentially wrong GST rate
              </div>
            ) : (
              <div className="mt-1.5 text-[11px] text-green-400 font-semibold">✓ All products look correct</div>
            )}
          </div>
          <button onClick={applyAutoSuggest} disabled={autoApplying}
            className="px-4 py-2 rounded-lg text-[12px] font-bold text-[var(--tx)] flex-shrink-0 transition"
            style={{background: autoApplying ? '#333' : 'var(--blue)', color: '#000'}}>
            {autoApplying ? 'Applying…' : `🤖 Auto-Fix ${autoFixCount > 0 ? `(${autoFixCount})` : 'All'}`}
          </button>
        </div>
      </div>

      {/* ── BULK UPDATE panel ────────────────────────── */}
      <div className="rounded-xl p-4" style={{background:'rgba(210,153,34,0.05)',border:'2px solid #d29922'}}>
        <div className="text-[11px] font-bold text-yellow-400 mb-3 tracking-wider">⚡ BULK GST UPDATE — Manual</div>
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <div className="text-[10px] text-[var(--tx3)] mb-1 uppercase tracking-wider">Filter by Category</div>
            <select value={filterCat} onChange={e => { setFilterCat(e.target.value); setSelected(new Set()); }}
              className="rounded-lg px-3 py-1.5 text-[12px] focus:outline-none w-44"
              style={{background:'var(--bg,#0d1117)',border:'1px solid var(--bd,#1a5c2a)',color:'var(--tx,#fff)'}}>
              <option value="">All Categories</option>
              {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <div className="text-[10px] text-[var(--tx3)] mb-1 uppercase tracking-wider">Apply GST Rate</div>
            <select value={bulkRate} onChange={e => setBulkRate(e.target.value)}
              className="rounded-lg px-3 py-1.5 text-[12px] focus:outline-none w-52"
              style={{background:'var(--bg,#0d1117)',border:'1px solid #d29922',color:'var(--tx,#fff)'}}>
              <option value="">Select Rate…</option>
              {GST_RATES.map(r => <option key={r.value} value={r.value}>{r.value}% — {r.label.split('(')[0].trim()}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={selectAll}
              className="px-3 py-1.5 rounded-lg text-[11px] border transition"
              style={{borderColor:'var(--bd,#1a5c2a)',color:'var(--tx2,#6e9a75)'}}>
              {allSelected ? 'Deselect All' : `Select All (${filtered.length})`}
            </button>
            {selected.size > 0 && (
              <span className="text-[11px] text-yellow-400 font-bold">{selected.size} selected</span>
            )}
            <button onClick={applyBulk} disabled={bulkSaving || !bulkRate}
              className="px-4 py-1.5 rounded-lg text-[12px] font-bold text-[var(--tx)] transition"
              style={{background: bulkRate ? 'var(--yellow)' : 'var(--input-bg)', opacity: !bulkRate ? 0.5 : 1}}>
              {bulkSaving ? 'Updating…' : `Apply to ${selected.size > 0 ? selected.size : filtered.length} products`}
            </button>
          </div>
        </div>
        <div className="mt-2 text-[10px] text-gray-500">
          💡 Filter by category (e.g. Honey) → select rate → click Apply. Or tick individual checkboxes.
        </div>
      </div>

      {/* Search */}
      <div className="flex items-center gap-3">
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search products…"
          className="rounded-lg px-3 py-1.5 text-[12px] w-56 focus:outline-none"
          style={{background:'var(--bg2,#161b22)',border:'1px solid var(--bd,#1a5c2a)',color:'var(--tx,#fff)'}} />
        <span className="text-[11px]" style={{color:'var(--tx2,#6e9a75)'}}>{filtered.length} products shown</span>
      </div>

      {/* Table */}
      <Card title="GST Rate Manager — change GST per product">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead><tr>
              <th className="pb-2 pr-2 w-8">
                <input type="checkbox" checked={allSelected} onChange={selectAll} className="accent-green-500 cursor-pointer" />
              </th>
              {['Product','Category','Price','GST Rate','Suggest','Base (excl.)','GST Amt','Selling'].map(h=>(
                <th key={h} className="text-left text-[10px] font-bold uppercase tracking-wider pb-2 pr-3" style={{color:'var(--tx2,#6e9a75)'}}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {filtered.map(p => {
                const rate    = parseFloat(p.gst_rate) || 5;
                const price   = parseFloat(p.price) || 0;
                const base    = price / (1 + rate / 100);
                const gstAmt  = price - base;
                const suggest = getSuggest(catMap[p.category_id], p.name);
                const isMismatch = suggest && suggest.rate !== rate;
                const isSelected = selected.has(p.id);
                return (
                  <tr key={p.id} className="border-t" style={{borderColor:'var(--bd,#1a5c2a)', background: isSelected ? 'rgba(210,153,34,0.05)' : ''}}>
                    <td className="py-2.5 pr-2">
                      <input type="checkbox" checked={isSelected} onChange={() => toggleSelect(p.id)} className="accent-green-500 cursor-pointer" />
                    </td>
                    <td className="py-2.5 pr-3 text-[12px] font-semibold" style={{color:'var(--tx,#fff)'}}>{p.emoji} {p.name}</td>
                    <td className="py-2.5 pr-3 text-[11px]" style={{color:'var(--tx2,#6e9a75)'}}>{catMap[p.category_id] || '—'}</td>
                    <td className="py-2.5 pr-3 text-[12px] font-bold" style={{color:'var(--tx,#fff)'}}>₹{price.toFixed(0)}</td>
                    <td className="py-2.5 pr-3">
                      <select value={rate} onChange={e => updateGST(p, e.target.value)}
                        disabled={saving[p.id]}
                        className="rounded px-2 py-1 text-[11px] focus:outline-none"
                        style={{background:'var(--bg,#0d1117)',border:`1px solid ${isMismatch ? '#f85149' : 'var(--bd,#1a5c2a)'}`,color:'var(--tx,#fff)'}}>
                        {GST_RATES.map(r => <option key={r.value} value={r.value}>{r.value}%</option>)}
                      </select>
                    </td>
                    <td className="py-2.5 pr-3">
                      {suggest ? (
                        <button
                          onClick={() => updateGST(p, suggest.rate)}
                          disabled={saving[p.id] || !isMismatch}
                          title={suggest.reason}
                          className="text-[10px] px-2 py-1 rounded transition font-semibold"
                          style={{
                            background: isMismatch ? 'var(--blue-bg)' : 'rgba(63,185,80,0.1)',
                            color: isMismatch ? 'var(--blue)' : '#3fb950',
                            border: `1px solid ${isMismatch ? '#58a6ff44' : '#3fb95044'}`,
                            cursor: isMismatch ? 'pointer' : 'default',
                          }}>
                          {isMismatch ? `→ ${suggest.rate}%` : `✓ ${suggest.rate}%`}
                        </button>
                      ) : (
                        <span className="text-[10px] text-gray-600">—</span>
                      )}
                    </td>
                    <td className="py-2.5 pr-3 text-[12px]" style={{color:'var(--tx2,#6e9a75)'}}>₹{base.toFixed(2)}</td>
                    <td className="py-2.5 pr-3 text-[12px] text-orange-400">₹{gstAmt.toFixed(2)}</td>
                    <td className="py-2.5 text-[12px] font-bold text-green-400">₹{price.toFixed(2)}</td>
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

  // Sync tab when sidebar link changes URL (searchParams update)
  useEffect(() => {
    const t = searchParams.get('tab') || 'products';
    setTab(t);
  }, [searchParams]);

  // Read pricing prefill once on mount — cleared from sessionStorage immediately
  const [prefillPricing] = useState(() => {
    if (typeof window === 'undefined') return null;
    if (searchParams.get('fromPricing') !== '1') return null;
    try {
      return readAndClearPricingPrefill() ?? null;
    } catch { return null; }
  });

  const TABS = [
    { id: 'products',  icon: '📦', label: 'Products'    },
    { id: 'categories',icon: '🏷️', label: 'Categories'  },
    { id: 'gst',       icon: '📋', label: 'GST Manager' },
  ];

  return (
    <div className="space-y-4">
      {/* Tab Bar */}
      <div className="flex gap-1 p-1 rounded-xl w-fit" style={{background:'var(--bg2,#161b22)',border:'1px solid var(--bd,#1a5c2a)'}}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className="px-4 py-2 rounded-lg text-[12px] font-medium transition"
            style={tab === t.id
              ? { background: 'var(--accent,#1a5c2a)', color: '#fff', fontWeight: 700 }
              : { color: 'var(--tx2,#6e9a75)' }}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {tab === 'products'   && <ProductsTab prefillPricing={prefillPricing} />}
      {tab === 'categories' && <CategoriesTab />}
      {tab === 'gst'        && <GSTManagerTab />}
    </div>
  );
}

// Suspense boundary required by Next.js for useSearchParams
export default function CataloguePageWrapper(props) {
  return (
    <Suspense fallback={<div className="flex items-center justify-center py-24" style={{color:'var(--tx2,#6e7681)'}}>Loading…</div>}>
      <CataloguePage {...props} />
    </Suspense>
  );
}
