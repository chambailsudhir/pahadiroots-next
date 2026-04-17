'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { runCalc, DEFAULT_F, ri, fmtR, r } from '@/lib/pricingCalc';
import { StageAccordion, ResultsPanel } from '@/components/PricingShared';

export default function NewProductPage() {
  const searchParams = useSearchParams();
  const fromBulk     = searchParams.get('from') === 'bulk';
  const [bulkBanner, setBulkBanner] = useState(false);

  const [f, setF]       = useState({ ...DEFAULT_F });

  // Pick up purchase price pushed from Bulk Calculator
  useEffect(() => {
    if (fromBulk && typeof window !== 'undefined') {
      const stored = sessionStorage.getItem('bulk_purchase');
      if (stored) {
        const val = parseFloat(stored);
        if (val > 0) {
          setF(prev => ({ ...prev, purchase: val }));
          setBulkBanner(true);
          sessionStorage.removeItem('bulk_purchase');
        }
      }
    }
  }, [fromBulk]);
  const [open, setOpen] = useState({ 1: true, 2: false, 3: false, 4: false, 5: false, 6: false });

  function setField(key, val) {
    const parsed = key === 'mrp_mult' ? (parseFloat(val) || 1) : (parseFloat(val) || 0);
    setF(prev => ({ ...prev, [key]: parsed }));
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

  function resetDefaults() { setF({ ...DEFAULT_F }); }

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
        <div className="flex gap-2">
          <button onClick={resetDefaults}
            className="px-3 py-1.5 text-[12px] font-medium rounded-lg border transition"
            style={{ borderColor: 'var(--bd,#30363d)', color: 'var(--tx2,#8b949e)', background: 'var(--bg2,#161b22)' }}>
            Reset defaults
          </button>
          <button onClick={copyValues}
            className="px-3 py-1.5 text-[12px] font-bold rounded-lg transition"
            style={{ background: 'var(--accent,#3fb950)', color: '#fff' }}>
            Copy values
          </button>
        </div>
      </div>

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
          <button onClick={() => setBulkBanner(false)} className="ml-auto text-[11px]" style={{ color: 'var(--tx2,#8b949e)' }}>dismiss</button>
        </div>
      )}

      {/* 2-col layout */}
      <div className="grid gap-4" style={{ gridTemplateColumns: '1fr 400px', alignItems: 'start' }}>
        <StageAccordion f={f} setField={setField} calc={calc} open={open} tog={tog} />
        <ResultsPanel f={f} calc={calc}
          selProd={null} onPush={null} pushing={false} pushed={false} pushErr=""
          onCopy={copyValues} />
      </div>
    </div>
  );
}
