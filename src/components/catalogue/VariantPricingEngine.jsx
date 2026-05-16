'use client';
// src/components/catalogue/VariantPricingEngine.jsx
// Audit fix: "Must split catalogue into components"
// Handles variant list display, add/remove, auto-generate panel
// All pricing strategy logic isolated here — catalogue page is just orchestrator

import { useState, useMemo } from 'react';
import { calcVariantPrices, generateSku, toPaise, toRupees, removeGst, parseGrams } from '@/lib/pricingCalc';

const inp = "w-full rounded-lg px-2 py-1.5 text-[11px] focus:outline-none bg-[var(--bg)] border border-[var(--accent)] text-[var(--tx)] placeholder-[var(--tx3)]";

const WEIGHT_SIZES = ['50g','100g','250g','500g','1kg','2kg','5kg'];
const LIQUID_SIZES = ['50ml','100ml','200ml','250ml','500ml','1L','2L','5L'];


export default function VariantPricingEngine({
  variants,
  setVariants,
  form,
  catMap,
  onSyncPricing, // callback: (updatedVariants) => void — syncs lowest price back to parent form
}) {
  const [autoPanel,        setAutoPanel]        = useState(false);
  const [avBasePrice,      setAvBasePrice]      = useState('');
  const [avBaseUnit,       setAvBaseUnit]       = useState('250g');
  const [avUnitType,       setAvUnitType]       = useState('weight');
  const [variantStrategy,  setVariantStrategy]  = useState('psychological');
  const [avSelectedSizes,  setAvSelectedSizes]  = useState(['100g','250g','500g','1kg']);

  const ALL_SIZES = avUnitType === 'liquid' ? LIQUID_SIZES : WEIGHT_SIZES;

  // Memoize variant price previews for size selector
  const variantPreviews = useMemo(() => {
    const bp   = parseFloat(avBasePrice) || parseFloat(form.selling_price) || 0;
    const gstR = parseFloat(form.gst_rate) || 5;
    if (bp <= 0) return {};
    const result = {};
    for (const sz of ALL_SIZES) {
      const calc = calcVariantPrices(bp, avBaseUnit, [sz], gstR, variantStrategy);
      result[sz] = calc[0]?.price || null;
    }
    return result;
  }, [avBasePrice, form.selling_price, form.gst_rate, avBaseUnit, variantStrategy, ALL_SIZES]);

  function syncPricingFromVariants(updatedVariants) {
    const gst    = parseFloat(form.gst_rate) || 5;
    const active = updatedVariants.filter(v => v.price && parseFloat(v.price) > 0 && v.is_active !== false);
    if (active.length === 0) return;
    const lowestSell = Math.min(...active.map(v => parseFloat(v.price)));
    const lowestBase = toRupees(removeGst(toPaise(lowestSell), gst));
    if (onSyncPricing) onSyncPricing({ selling_price: String(lowestSell), price: String(lowestBase) });
  }

  function addVariant() {
    setVariants(vs => [...vs, {
      variant_type: 'weight', variant_value: '', price: '',
      available_stock: 0, initial_stock: 0, returned_good: 0,
      is_active: true, _gst: parseFloat(form.gst_rate) || 5, sku: '',
    }]);
  }

  function removeVariant(i) {
    setVariants(vs => {
      const next = vs.filter((_, idx) => idx !== i);
      syncPricingFromVariants(next);
      return next;
    });
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
        if (key === 'price' && parseFloat(val) > 0) {
          const gst = parseFloat(form.gst_rate) || 5;
          updated._base = String(toRupees(removeGst(toPaise(val), gst)));
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

  function autoGenerate() {
    const basePrice = parseFloat(avBasePrice) || parseFloat(form.selling_price) || 0;
    if (!basePrice) return alert('Set a selling price or base price first');
    if (!avSelectedSizes.length) return alert('Select at least one size');
    const existingNow   = new Set(variants.map(v => v.variant_value?.toLowerCase().trim()).filter(Boolean));
    const alreadyExists = avSelectedSizes.filter(s => existingNow.has(s.toLowerCase().trim()));
    const fresh         = avSelectedSizes.filter(s => !existingNow.has(s.toLowerCase().trim()));
    if (alreadyExists.length > 0 && fresh.length === 0) return alert('❌ All selected sizes already exist.');
    if (alreadyExists.length > 0 && fresh.length > 0) {
      if (!confirm(`"${alreadyExists.join(', ')}" already exist — skipping.\nGenerate: ${fresh.join(', ')}?`)) return;
    }
    setAutoPanel(false);
    setVariants(vs => {
      const existing = new Set(vs.map(v => v.variant_value?.toLowerCase().trim()).filter(Boolean));
      const newSizes  = avSelectedSizes.filter(s => !existing.has(s.toLowerCase().trim()));
      const gst       = parseFloat(form.gst_rate) || 5;
      const calculated = calcVariantPrices(basePrice, avBaseUnit, newSizes, gst, variantStrategy);
      const newVars = calculated.map(c => ({
        variant_type: avUnitType === 'liquid' ? 'volume' : 'weight',
        variant_value: c.variant_value,
        price: c.price,
        available_stock: 0, initial_stock: 0, returned_good: 0, is_active: true,
        _base: c.original_price, _autoGenerated: true,
        sku: generateSku(form.name, c.variant_value, catMap[form.category_id] || ''),
      }));
      const next = [...vs, ...newVars];
      syncPricingFromVariants(next);
      return next;
    });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* Header + controls */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" onClick={() => setAutoPanel(p => !p)}
          style={{ fontSize: 11, padding: '5px 12px', borderRadius: 8, fontWeight: 600, cursor: 'pointer', background: autoPanel ? 'rgba(210,153,34,0.25)' : 'rgba(210,153,34,0.1)', border: '1px solid rgba(210,153,34,0.4)', color: '#d29922' }}>
          ⚡ Auto-generate {autoPanel ? '▲' : '▼'}
        </button>
        <button type="button" onClick={addVariant}
          style={{ fontSize: 11, padding: '5px 12px', borderRadius: 8, cursor: 'pointer', background: 'var(--bg)', border: '1px solid var(--bd)', color: 'var(--accent)' }}>
          + Add manually
        </button>
      </div>

      {/* Auto-generate panel */}
      {autoPanel && (
        <div style={{ borderRadius: 10, padding: '14px 16px', background: 'rgba(210,153,34,0.06)', border: '1px solid rgba(210,153,34,0.25)', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#d29922' }}>⚡ Auto-generate variants</div>

          {/* Strategy selector */}
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--tx3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Pricing strategy</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
              {[
                { v: 'linear',           l: '📏 Linear',       desc: 'Strict proportional — same margin % at all sizes' },
                { v: 'margin-protected', l: '🛡️ Margin-safe',  desc: 'Large packs cheaper per-gram, margin protected' },
                { v: 'psychological',    l: '🧠 Psychological', desc: 'Snaps to ₹99/₹199/₹499 price anchors' },
              ].map(opt => (
                <button key={opt.v} type="button" title={opt.desc} onClick={() => setVariantStrategy(opt.v)}
                  style={{ fontSize: 10, padding: '6px 4px', borderRadius: 6, cursor: 'pointer', fontWeight: variantStrategy === opt.v ? 700 : 400, background: variantStrategy === opt.v ? 'rgba(210,153,34,0.25)' : 'transparent', border: `1px solid ${variantStrategy === opt.v ? 'rgba(210,153,34,0.5)' : 'rgba(255,255,255,0.08)'}`, color: variantStrategy === opt.v ? '#d29922' : 'var(--tx3)' }}>
                  {opt.l}
                </button>
              ))}
            </div>
            <div style={{ fontSize: 10, marginTop: 4, color: 'var(--tx3)' }}>
              {variantStrategy === 'linear'           && 'Same margin % across all sizes.'}
              {variantStrategy === 'margin-protected' && 'Larger packs get ~8% per-gram discount. Margin protected.'}
              {variantStrategy === 'psychological'    && 'Margin-protected + rounds to ₹49/₹99/₹199/₹499 anchors. Best for FMCG.'}
            </div>
          </div>

          {/* Unit type toggle */}
          <div style={{ display: 'flex', gap: 6 }}>
            {[{ v: 'weight', l: '⚖️ Weight (g/kg)' }, { v: 'liquid', l: '💧 Liquid (ml/L)' }].map(opt => (
              <button key={opt.v} type="button"
                onClick={() => { setAvUnitType(opt.v); setAvSelectedSizes([]); setAvBaseUnit(opt.v === 'liquid' ? '250ml' : '250g'); }}
                style={{ flex: 1, fontSize: 11, padding: '5px 0', borderRadius: 8, cursor: 'pointer', fontWeight: avUnitType === opt.v ? 700 : 400, background: avUnitType === opt.v ? 'rgba(210,153,34,0.18)' : 'transparent', border: `1px solid ${avUnitType === opt.v ? 'rgba(210,153,34,0.5)' : 'rgba(255,255,255,0.08)'}`, color: avUnitType === opt.v ? '#d29922' : 'var(--tx3)' }}>
                {opt.l}
              </button>
            ))}
          </div>

          {/* Base unit + price */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div>
              <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--tx3)', textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Base unit</label>
              <select value={avBaseUnit} onChange={e => setAvBaseUnit(e.target.value)} className={inp}>
                {ALL_SIZES.map(u => <option key={u}>{u}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--tx3)', textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Price for {avBaseUnit} ₹</label>
              <input type="number" value={avBasePrice} onChange={e => setAvBasePrice(e.target.value)} className={inp} placeholder={form.selling_price || '0'} />
            </div>
          </div>

          {/* Size selector */}
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--tx3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Select sizes to generate</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4 }}>
              {ALL_SIZES.map(sz => {
                const checked       = avSelectedSizes.includes(sz);
                const alreadyExists = variants.some(v => v.variant_value?.toLowerCase().trim() === sz.toLowerCase().trim());
                const preview       = variantPreviews[sz];
                return (
                  <label key={sz} style={{ display: 'flex', flexDirection: 'column', borderRadius: 8, padding: '6px 8px', cursor: alreadyExists ? 'not-allowed' : 'pointer', opacity: alreadyExists ? 0.4 : 1, background: checked ? 'rgba(210,153,34,0.18)' : 'transparent', border: `1px solid ${checked ? 'rgba(210,153,34,0.5)' : 'rgba(255,255,255,0.08)'}` }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      <input type="checkbox" checked={checked} disabled={alreadyExists}
                        onChange={() => setAvSelectedSizes(s => checked ? s.filter(x => x !== sz) : [...s, sz])}
                        style={{ width: 12, height: 12, accentColor: '#d29922' }} />
                      <span style={{ fontSize: 11, fontWeight: 600, color: checked ? '#d29922' : 'var(--tx2)' }}>{sz}</span>
                      {alreadyExists && <span style={{ fontSize: 9, color: 'var(--tx3)', marginLeft: 'auto' }}>✓</span>}
                    </div>
                    {preview && !alreadyExists && (
                      <span style={{ fontSize: 10, fontWeight: 700, color: '#d29922', marginLeft: 17 }}>₹{preview}</span>
                    )}
                  </label>
                );
              })}
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
              <button type="button" onClick={() => setAvSelectedSizes(ALL_SIZES.filter(sz => !variants.some(v => v.variant_value?.toLowerCase() === sz.toLowerCase())))} style={{ fontSize: 10, color: '#d29922', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>Select all</button>
              <button type="button" onClick={() => setAvSelectedSizes([])} style={{ fontSize: 10, color: 'var(--tx3)', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>Clear</button>
            </div>
          </div>

          {/* Generate button */}
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={autoGenerate} disabled={!avSelectedSizes.length}
              style={{ flex: 1, padding: '8px 0', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: avSelectedSizes.length ? 'pointer' : 'not-allowed', background: avSelectedSizes.length ? '#d29922' : '#333', color: '#000', border: 'none', opacity: avSelectedSizes.length ? 1 : 0.5 }}>
              ⚡ Generate {avSelectedSizes.length} variant{avSelectedSizes.length !== 1 ? 's' : ''} →
            </button>
            <button type="button" onClick={() => setAutoPanel(false)}
              style={{ padding: '8px 16px', borderRadius: 8, fontSize: 11, cursor: 'pointer', background: 'transparent', border: '1px solid var(--bd)', color: 'var(--tx3)' }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Variants list */}
      {variants.length === 0 && !autoPanel && (
        <div style={{ padding: '24px 0', textAlign: 'center', borderRadius: 10, border: '1px dashed var(--bd)' }}>
          <div style={{ fontSize: 12, color: 'var(--tx3)', marginBottom: 4 }}>No variants yet</div>
          <div style={{ fontSize: 10, color: 'var(--tx3)' }}>Add size variants (250g, 500g, 1kg etc.)</div>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {variants.map((v, i) => (
          <div key={i} style={{ borderRadius: 10, padding: '12px 14px', background: 'var(--bg)', border: '1px solid var(--bd)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--tx3)', textTransform: 'uppercase' }}>Variant #{i + 1}</span>
              <button onClick={() => removeVariant(i)} style={{ width: 22, height: 22, borderRadius: 5, background: '#e74c3c', color: '#fff', border: 'none', fontSize: 11, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
              <div>
                <label style={{ fontSize: 10, fontWeight: 600, color: 'var(--tx3)', textTransform: 'uppercase', display: 'block', marginBottom: 3 }}>Type</label>
                <select value={v.variant_type || 'weight'} onChange={e => updateVariant(i, 'variant_type', e.target.value)} className={inp} style={{ padding: '5px 8px' }}>
                  {['weight','volume','pack_size','grade'].map(t => <option key={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 10, fontWeight: 600, color: 'var(--tx3)', textTransform: 'uppercase', display: 'block', marginBottom: 3 }}>Size / value</label>
                <input value={v.variant_value || ''} onChange={e => updateVariant(i, 'variant_value', e.target.value)} placeholder="e.g. 250g" className={inp} style={{ padding: '5px 8px' }} />
              </div>
              <div>
                <label style={{ fontSize: 10, fontWeight: 600, color: 'var(--tx3)', textTransform: 'uppercase', display: 'block', marginBottom: 3 }}>Sell ₹ (incl. GST)</label>
                <input type="number" value={v.price || ''} onChange={e => updateVariant(i, 'price', e.target.value)} className={inp} style={{ padding: '5px 8px' }} />
                {v._base && <div style={{ fontSize: 10, color: 'var(--tx3)', marginTop: 2 }}>Base excl. GST: ₹{v._base}</div>}
              </div>
              <div>
                <label style={{ fontSize: 10, fontWeight: 600, color: 'var(--tx3)', textTransform: 'uppercase', display: 'block', marginBottom: 3 }}>Status</label>
                <select value={v.is_active !== false ? 'true' : 'false'} onChange={e => updateVariant(i, 'is_active', e.target.value === 'true')} className={inp} style={{ padding: '5px 8px' }}>
                  <option value="true">✓ Active</option>
                  <option value="false">✗ Off</option>
                </select>
              </div>
            </div>
            <div>
              <label style={{ fontSize: 10, fontWeight: 700, color: (!v.initial_stock || parseInt(v.initial_stock) <= 0) ? '#f85149' : 'var(--tx3)', textTransform: 'uppercase', display: 'block', marginBottom: 3 }}>
                Initial stock <span style={{ color: '#f85149' }}>*</span>
              </label>
              <input type="number" value={v.initial_stock || ''} onChange={e => updateVariant(i, 'initial_stock', e.target.value)} className={inp} style={{ padding: '5px 8px', borderColor: (!v.initial_stock || parseInt(v.initial_stock) <= 0) ? 'rgba(248,81,73,0.5)' : undefined }} placeholder="Total purchased *" />
            </div>
            {v.sku && (
              <div style={{ marginTop: 6, fontSize: 10, fontFamily: 'var(--font-mono)', color: '#58a6ff', opacity: 0.8 }}>SKU: {v.sku}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
