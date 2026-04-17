'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { runCalc, DEFAULT_F, ri, fmtR, r } from '@/lib/pricingCalc';
import { StageAccordion, ResultsPanel } from '@/components/PricingShared';
import { api } from '@/lib/api';

export default function ExistingProductPage() {
  const [f, setF]             = useState({ ...DEFAULT_F });
  const [open, setOpen]       = useState({ 1: true, 2: false, 3: false, 4: false, 5: false, 6: false });

  const [products, setProducts]       = useState([]);
  const [categories, setCategories]   = useState([]);
  const [loading, setLoading]         = useState(true);
  const [selProd, setSelProd]         = useState(null);
  const [selCat, setSelCat]           = useState('all');
  const [query, setQuery]             = useState('');
  const [showDrop, setShowDrop]       = useState(false);
  const [selVariants, setSelVariants] = useState([]);
  const [loadingVars, setLoadingVars] = useState(false);
  const [pushing, setPushing]         = useState(false);
  const [pushed, setPushed]           = useState(false);
  const [pushErr, setPushErr]         = useState('');
  const searchRef                     = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [prods, cats] = await Promise.all([
        api.get('products', 'select=id,name,emoji,cost_price,gst_rate,price,mrp,status,category_id,unit_label&is_deleted=eq.false&order=name.asc'),
        api.get('categories', 'select=id,name&order=name.asc'),
      ]);
      setProducts(prods || []);
      setCategories(cats || []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    function h(e) { if (!searchRef.current?.contains(e.target)) setShowDrop(false); }
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const catName = (id) => categories.find(c => c.id === id)?.name || '';

  const filtered = (() => {
    let list = selCat === 'all' ? products : products.filter(p => p.category_id === selCat);
    if (query.length >= 1) list = list.filter(p => p.name.toLowerCase().includes(query.toLowerCase()));
    return list.slice(0, 10);
  })();

  async function selectProduct(p) {
    setSelProd(p);
    setQuery(p.name);
    setShowDrop(false);
    setF(prev => ({
      ...prev,
      purchase: parseFloat(p.cost_price) || parseFloat(p.price) || 100,
      gst_in:   parseFloat(p.gst_rate) || 5,
      gst_out:  parseFloat(p.gst_rate) || 5,
    }));
    setPushed(false); setPushErr('');
    setLoadingVars(true);
    try {
      const v = await api.get('product_variants', `product_id=eq.${p.id}&is_active=eq.true&select=id,label,price,original_price`);
      setSelVariants(v || []);
    } catch { setSelVariants([]); }
    finally { setLoadingVars(false); }
  }

  function clearProduct() {
    setSelProd(null); setQuery(''); setShowDrop(false);
    setSelVariants([]); setPushed(false); setPushErr('');
    setF({ ...DEFAULT_F });
  }

  function setField(key, val) {
    const parsed = key === 'mrp_mult' ? (parseFloat(val) || 1) : (parseFloat(val) || 0);
    setF(prev => ({ ...prev, [key]: parsed }));
    setPushed(false);
  }

  function tog(key) { setOpen(p => ({ ...p, [key]: !p[key] })); }

  const calc = runCalc(f);

  async function pushToAdmin() {
    if (!selProd) return;
    setPushing(true); setPushErr('');
    try {
      await api.patch('products', `id=eq.${selProd.id}`, {
        price:      r(calc.base_price),
        mrp:        ri(calc.sp),
        cost_price: r(f.purchase),
        gst_rate:   f.gst_out,
      });
      const vars = await api.get('product_variants', `product_id=eq.${selProd.id}&is_active=eq.true`).catch(() => []);
      if (vars?.length) {
        const oldSP = parseFloat(selProd.mrp) || calc.sp;
        const ratio = oldSP > 0 ? calc.sp / oldSP : 1;
        await Promise.all(vars.map(v => {
          const newPrice = ri(parseFloat(v.price) * ratio);
          const newBase  = r(newPrice / (1 + f.gst_out / 100));
          return api.patch('product_variants', `id=eq.${v.id}`, { price: newPrice, original_price: newBase });
        }));
      }
      setPushed(true);
      setProducts(prev => prev.map(p => p.id === selProd.id
        ? { ...p, price: r(calc.base_price), mrp: ri(calc.sp), cost_price: r(f.purchase), gst_rate: f.gst_out }
        : p));
    } catch (e) { setPushErr(e.message); }
    finally { setPushing(false); }
  }

  function copyValues() {
    navigator.clipboard.writeText([
      `BASE PRICE (excl GST): ${fmtR(calc.base_price)}`,
      `SELLING PRICE (incl GST): ${fmtR(calc.sp)}`,
      `MRP STRIKETHROUGH: ${fmtR(calc.mrp)}`,
      `COST PRICE: ${fmtR(f.purchase)}`,
      `GST RATE: ${f.gst_out}%`,
      `GROSS MARGIN: ${ri(calc.margin_pct)}%`,
      `PROFIT / ORDER: ${fmtR(calc.profit_val)}`,
    ].join('\n')).catch(() => {});
  }

  return (
    <div className="space-y-4" style={{ color: 'var(--tx,#e6edf3)' }}>

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="mb-1">
            <Link href="/admin/pricing" className="text-[12px]" style={{ color: 'var(--tx2,#8b949e)' }}>
              ← Pricing Engine
            </Link>
          </div>
          <h1 className="text-[20px] font-bold flex items-center gap-2">
            <span className="text-[24px]">🔍</span> Existing Product
          </h1>
          <p className="text-[12px] mt-0.5" style={{ color: 'var(--tx2,#8b949e)' }}>
            Search your catalogue, tweak costs, and push updated pricing directly to the database.
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={copyValues}
            className="px-3 py-1.5 text-[12px] font-medium rounded-lg border transition"
            style={{ borderColor: 'var(--bd,#30363d)', color: 'var(--tx2,#8b949e)', background: 'var(--bg2,#161b22)' }}>
            Copy values
          </button>
          {selProd && !pushed && (
            <button onClick={pushToAdmin} disabled={pushing}
              className="px-3 py-1.5 text-[12px] font-bold rounded-lg transition"
              style={{ background: 'var(--accent,#3fb950)', color: '#fff', opacity: pushing ? 0.6 : 1 }}>
              {pushing ? 'Saving…' : '↑ Push to catalogue'}
            </button>
          )}
          {pushed && (
            <div className="px-3 py-1.5 text-[12px] font-bold rounded-lg" style={{ background: '#EAF3DE', color: '#27500A' }}>
              ✓ Saved
            </div>
          )}
        </div>
      </div>

      {/* Category filter pills */}
      <div className="flex gap-1.5 flex-wrap">
        {[{ id: 'all', name: 'All' }, ...categories].map(c => (
          <button key={c.id} onClick={() => setSelCat(c.id)}
            className="px-3 py-1.5 rounded-lg text-[11px] font-semibold transition"
            style={{
              background: selCat === c.id ? 'var(--accent,#3fb950)' : 'var(--bg2,#161b22)',
              color: selCat === c.id ? '#fff' : 'var(--tx2,#8b949e)',
              border: selCat === c.id ? '1px solid transparent' : '1px solid var(--bd,#30363d)',
            }}>
            {c.name}
            {c.id !== 'all' && (
              <span className="ml-1 opacity-50 text-[10px]">
                {products.filter(p => p.category_id === c.id).length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Search bar */}
      <div className="relative" ref={searchRef}>
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl border"
          style={{ background: 'var(--bg2,#161b22)', borderColor: selProd ? 'var(--accent,#3fb950)' : 'var(--bd,#30363d)' }}>
          <span className="text-[16px] flex-none">🔍</span>
          <input
            value={query}
            onChange={e => { setQuery(e.target.value); setShowDrop(true); if (!e.target.value) clearProduct(); }}
            onFocus={() => setShowDrop(true)}
            placeholder="Search product by name…"
            className="flex-1 text-[14px] bg-transparent outline-none"
            style={{ color: 'var(--tx,#e6edf3)' }}
          />
          {selProd && (
            <div className="flex items-center gap-2 px-2 py-1 rounded-full flex-none"
              style={{ background: 'color-mix(in srgb, var(--accent,#3fb950) 15%, var(--bg2,#161b22))', border: '1px solid var(--accent,#3fb950)' }}>
              <span className="text-[12px] font-semibold" style={{ color: 'var(--accent,#3fb950)' }}>
                {selProd.emoji} {selProd.name}
              </span>
              <button onClick={clearProduct} className="text-[12px]" style={{ color: 'var(--tx2,#8b949e)' }}>✕</button>
            </div>
          )}
        </div>
        {showDrop && (
          <div className="absolute z-50 w-full mt-1 rounded-xl border overflow-hidden"
            style={{ background: 'var(--bg2,#161b22)', borderColor: 'var(--bd,#30363d)' }}>
            {loading
              ? <div className="px-4 py-3 text-[12px]" style={{ color: 'var(--tx2,#8b949e)' }}>Loading…</div>
              : filtered.length === 0
              ? <div className="px-4 py-3 text-[12px]" style={{ color: 'var(--tx2,#8b949e)' }}>No products found</div>
              : filtered.map(p => (
                <button key={p.id} onClick={() => selectProduct(p)}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-left border-b transition"
                  style={{ borderColor: 'var(--bd,#30363d)' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--bg,#0d1117)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                  <span className="text-[20px] flex-none">{p.emoji || '📦'}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-semibold truncate" style={{ color: 'var(--tx,#e6edf3)' }}>{p.name}</div>
                    <div className="text-[11px]" style={{ color: 'var(--tx2,#8b949e)' }}>
                      {catName(p.category_id)} · GST {p.gst_rate}%
                    </div>
                  </div>
                  <div className="text-right flex-none">
                    <div className="text-[12px] font-bold" style={{ color: 'var(--accent,#3fb950)' }}>
                      {p.cost_price ? fmtR(p.cost_price) : '—'}
                    </div>
                    <div className="text-[10px]" style={{ color: 'var(--tx2,#8b949e)' }}>
                      {p.mrp ? 'MRP ' + fmtR(p.mrp) : 'no MRP set'}
                    </div>
                  </div>
                </button>
              ))
            }
          </div>
        )}
      </div>

      {/* Variants strip */}
      {selProd && (
        <div className="rounded-xl border overflow-hidden"
          style={{ background: 'var(--bg2,#161b22)', borderColor: 'var(--accent,#3fb950)', borderWidth: 1 }}>
          <div className="px-4 py-2.5 border-b flex items-center justify-between"
            style={{ borderColor: 'var(--bd,#30363d)', background: 'var(--bg,#0d1117)' }}>
            <div className="flex items-center gap-2">
              <span className="text-[14px]">📦</span>
              <span className="text-[12px] font-bold" style={{ color: 'var(--tx,#e6edf3)' }}>
                {selProd.emoji} {selProd.name} — variants
              </span>
            </div>
            <span className="text-[10px]" style={{ color: 'var(--tx2,#8b949e)' }}>
              Prices scale proportionally when pushed
            </span>
          </div>
          <div className="p-3">
            {loadingVars ? (
              <div className="text-[11px]" style={{ color: 'var(--tx2,#8b949e)' }}>Loading variants…</div>
            ) : selVariants.length === 0 ? (
              <div className="text-[11px]" style={{ color: 'var(--tx2,#8b949e)' }}>No active variants found.</div>
            ) : (
              <div className="flex gap-2 flex-wrap">
                {selVariants.map(v => (
                  <div key={v.id} className="px-3 py-2 rounded-lg"
                    style={{ background: 'var(--bg,#0d1117)', border: '1px solid var(--bd,#30363d)' }}>
                    <div className="text-[11px] font-semibold" style={{ color: 'var(--tx,#e6edf3)' }}>{v.label}</div>
                    <div className="text-[12px] font-bold mt-0.5" style={{ color: 'var(--accent,#3fb950)' }}>{fmtR(v.price)}</div>
                    {v.original_price && (
                      <div className="text-[10px] line-through" style={{ color: 'var(--tx2,#8b949e)' }}>{fmtR(v.original_price)}</div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 2-col layout */}
      <div className="grid gap-4" style={{ gridTemplateColumns: '1fr 400px', alignItems: 'start' }}>
        <StageAccordion f={f} setField={setField} calc={calc} open={open} tog={tog} />
        <ResultsPanel f={f} calc={calc} selProd={selProd}
          onPush={pushToAdmin} pushing={pushing} pushed={pushed} pushErr={pushErr}
          onCopy={copyValues} />
      </div>
    </div>
  );
}
