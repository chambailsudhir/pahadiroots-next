'use client';
import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { runCalc, DEFAULT_F, BUSINESS_TYPES, validateField, ri, fmtR, r } from '@/lib/pricingCalc';
import { StageAccordion, ResultsPanel, BusinessTypeSelector } from '@/components/PricingShared';
import { savePricingPrefill } from '@/lib/pricingPrefill';

export default function NewProductPage() {
  const router       = useRouter();
  const searchParams = useSearchParams();
  const fromBulk     = searchParams.get('from') === 'bulk';
  const [bulkBanner, setBulkBanner] = useState(false);
  const bulkApplied  = useRef(false);

  const [f, setF]            = useState({ ...DEFAULT_F });
  const [fieldErrors, setFE] = useState({});
  const [open, setOpen]      = useState({ 1: true, 2: false, 3: false, 4: false, 5: false, 6: false });

  // Read bulk purchase cost from sessionStorage (written by bulk/page.jsx)
  useEffect(() => {
    if (!fromBulk || bulkApplied.current || typeof window === 'undefined') return;
    const stored = sessionStorage.getItem('bulk_purchase');
    if (!stored) return;
    const val = parseFloat(stored);
    if (val > 0) {
      bulkApplied.current = true;
      setF(prev => ({ ...prev, purchase: val }));
      setBulkBanner(true);
      setTimeout(() => sessionStorage.removeItem('bulk_purchase'), 0);
    }
  }, [fromBulk]);

  const bizType = BUSINESS_TYPES.find(b => b.id === f.business_type) || BUSINESS_TYPES[0];

  function applyBusinessType(bt) {
    setF(prev => ({ ...prev, ...bt.defaults, business_type: bt.id }));
    setFE({});
  }

  function setField(key, val) {
    if (key === 'profit_mode')    { setF(prev => ({ ...prev, profit_mode: val })); return; }
    if (key === 'gst_registered') { setF(prev => ({ ...prev, gst_registered: val })); return; }
    const err = validateField(key, val);
    setFE(prev => ({ ...prev, [key]: err || undefined }));
    const parsed = key === 'mrp_mult'
      ? Math.max(1.0, Math.min(8.0, parseFloat(val) || 2.0))
      : (parseFloat(val) ?? 0);
    setF(prev => ({ ...prev, [key]: isNaN(parsed) ? prev[key] : parsed }));
  }

  function tog(key) { setOpen(p => ({ ...p, [key]: !p[key] })); }

  const calc = runCalc(f);

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

  function resetDefaults() { setF({ ...DEFAULT_F }); setFE({}); }

  // ── Save as Product ─────────────────────────────────────────
  // Writes pricing payload to sessionStorage then navigates to
  // the Products page which reads it and opens its own Add
  // Product modal (with Pricing & Variants + AI tabs enabled).
  function goToAddProduct() {
    savePricingPrefill(calc, f);
    router.push('/admin/catalogue?addNew=1&fromPricing=1');
  }

  return (
    <div className="space-y-4" style={{ color: 'var(--tx,#e6edf3)' }}>

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Link href="/admin/pricing" className="text-[12px]" style={{ color: 'var(--tx2,#8b949e)' }}>
              ← Pricing Engine
            </Link>
          </div>
          <h1 className="text-[20px] font-bold flex items-center gap-2">
            <span className="text-[24px]">✨</span> New Product
          </h1>
          <p className="text-[12px] mt-0.5" style={{ color: 'var(--tx2,#8b949e)' }}>
            Price a product not yet in your catalogue. Fill in your costs stage by stage.
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={resetDefaults}
            className="px-3 py-1.5 text-[12px] font-medium rounded-lg border transition"
            style={{ borderColor: 'var(--bd,#30363d)', color: 'var(--tx2,#8b949e)', background: 'var(--bg2,#161b22)' }}>
            Reset defaults
          </button>
          <button onClick={copyValues}
            className="px-3 py-1.5 text-[12px] font-medium rounded-lg border transition"
            style={{ borderColor: 'var(--bd,#30363d)', color: 'var(--tx2,#8b949e)', background: 'var(--bg2,#161b22)' }}>
            Copy values
          </button>
          <button
            onClick={goToAddProduct}
            disabled={calc.below_breakeven}
            className="px-3 py-1.5 text-[12px] font-bold rounded-lg transition flex items-center gap-1.5"
            style={{
              background: calc.below_breakeven ? 'var(--bg2,#161b22)' : 'var(--accent,#3fb950)',
              color:      calc.below_breakeven ? 'var(--tx2,#8b949e)' : '#fff',
              border:     calc.below_breakeven ? '1px solid var(--bd,#30363d)' : 'none',
              opacity:    calc.below_breakeven ? 0.6 : 1,
              cursor:     calc.below_breakeven ? 'not-allowed' : 'pointer',
            }}
            title={calc.below_breakeven ? 'Fix pricing before saving — currently below breakeven' : 'Open Add Product modal with pricing pre-filled'}>
            📦 Save as Product →
          </button>
        </div>
      </div>

      {/* Business type selector */}
      <BusinessTypeSelector current={f.business_type} onSelect={applyBusinessType} />

      {/* Tip banner */}
      <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl text-[12px]"
        style={{ background: 'var(--bg2,#161b22)', border: '1px solid var(--bd,#30363d)' }}>
        <span>💡</span>
        <span style={{ color: 'var(--tx2,#8b949e)' }}>
          Bought stock in bulk first?{' '}
          <Link href="/admin/pricing/bulk" className="font-semibold" style={{ color: 'var(--accent,#3fb950)' }}>
            Use the Bulk Calculator
          </Link>{' '}
          to get your per-unit cost, then come back here.
        </span>
      </div>

      {/* Bulk-pushed notice */}
      {bulkBanner && (
        <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl text-[12px]"
          style={{ background: 'color-mix(in srgb, #3fb950 8%, var(--bg2,#161b22))', border: '1px solid var(--accent,#3fb950)' }}>
          <span style={{ color: 'var(--accent,#3fb950)' }}>✓</span>
          <span style={{ color: 'var(--tx,#e6edf3)' }}>
            Per-unit cost <b>{fmtR(f.purchase)}</b> pre-filled from Bulk Calculator into Stage 1 Purchase Price.
          </span>
          <button onClick={() => setBulkBanner(false)} className="ml-auto text-[11px]"
            style={{ color: 'var(--tx2,#8b949e)' }}>dismiss</button>
        </div>
      )}

      {/* 2-col layout */}
      <div className="grid gap-4" style={{ gridTemplateColumns: '1fr 400px', alignItems: 'start' }}>
        <StageAccordion f={f} setField={setField} fieldErrors={fieldErrors} calc={calc} open={open} tog={tog} />
        <ResultsPanel f={f} calc={calc}
          selProd={null} onPush={null} pushing={false} pushed={false} pushErr=""
          marginHealthy={bizType.marginHealthy}
          marginTight={bizType.marginTight}
          onSaveAsProduct={calc.below_breakeven ? null : goToAddProduct} />
      </div>
    </div>
  );
}
