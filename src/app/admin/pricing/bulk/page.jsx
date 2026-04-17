'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ri, fmtR } from '@/lib/pricingCalc';

// ─────────────────────────────────────────────────────────────────
// WHAT THIS PAGE IS FOR:
//
// When you buy in bulk, you need ONE number before you can price:
//   "What did this single unit cost me, delivered to my warehouse?"
//
// That's it. This is called your LANDED COST / PURCHASE PRICE.
//
// Everything that happens AFTER (packaging each order, shipping to
// customer, COD, returns, profit) is handled in the Pricing Calculator.
// Those costs repeat every time you sell a unit — they are NOT bulk costs.
//
// HOW GIANTS DO IT (Walmart, Amazon, FMCG brands):
//   Bulk calc = COGS (Cost of Goods Sold) per unit
//   Pricing   = COGS + all variable selling costs + margin = Selling Price
// ─────────────────────────────────────────────────────────────────

function InputRow({ label, hint, value, onChange, unit, prefix }) {
  return (
    <div className="grid items-start gap-4 px-5 py-3.5 border-b"
      style={{ gridTemplateColumns: '1fr 140px', borderColor: 'var(--bd,#30363d)' }}>
      <div>
        <div className="text-[12px] font-semibold" style={{ color: 'var(--tx,#e6edf3)' }}>{label}</div>
        {hint && <div className="text-[11px] mt-0.5 leading-relaxed" style={{ color: 'var(--tx2,#8b949e)' }}>{hint}</div>}
      </div>
      <div className="flex flex-col items-end gap-1">
        <div className="flex items-center gap-1.5 w-full justify-end">
          {prefix && <span className="text-[12px] font-semibold" style={{ color: 'var(--tx2,#8b949e)' }}>{prefix}</span>}
          <input
            type="number" value={value} min={0}
            onChange={e => onChange(e.target.value)}
            className="w-[100px] px-2 py-1.5 rounded-lg text-[13px] font-bold border text-right"
            style={{ background: 'var(--bg,#0d1117)', borderColor: 'var(--bd,#30363d)', color: 'var(--tx,#e6edf3)' }}
          />
          {unit && <span className="text-[11px]" style={{ color: 'var(--tx2,#8b949e)' }}>{unit}</span>}
        </div>
      </div>
    </div>
  );
}

export default function BulkCalcPage() {
  const router = useRouter();

  // Core inputs
  const [totalUnits, setTotalUnits]     = useState(100);
  const [unitLabel, setUnitLabel]       = useState('bottles');
  const [totalCost, setTotalCost]       = useState(3000);
  const [inboundShip, setInboundShip]   = useState(0);   // freight from supplier to WH
  const [duties, setDuties]             = useState(0);   // import duty / taxes if any
  const [wastePct, setWastePct]         = useState(0);   // % lost in transit/processing

  // Pack size variants (optional — if you pack multiple units per SKU)
  const [variants, setVariants] = useState([
    { label: '1 unit',  qty: 1 },
  ]);
  const [showVariants, setShowVariants] = useState(false);

  // ── Calculations ───────────────────────────────────────────────
  const N = v => parseFloat(v) || 0;

  const usableUnits      = N(totalUnits) * (1 - N(wastePct) / 100);
  const safeUnits        = usableUnits > 0 ? usableUnits : 1;
  const totalSpend       = N(totalCost) + N(inboundShip) + N(duties);
  const purchasePerUnit  = totalSpend / safeUnits;

  // Cost breakdown for display
  const productCostPU  = N(totalCost) / safeUnits;
  const inboundPU      = N(inboundShip) / safeUnits;
  const dutiesPU       = N(duties) / safeUnits;

  function fmt2(n) { return n.toFixed(2); }

  function pushToCalculator(cpUnit, label) {
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('bulk_purchase', String(cpUnit));
    }
    router.push('/admin/pricing/new?from=bulk');
  }

  return (
    <div style={{ color: 'var(--tx,#e6edf3)' }}>

      {/* Header */}
      <div className="mb-5">
        <Link href="/admin/pricing" className="text-[12px]" style={{ color: 'var(--tx2,#8b949e)' }}>
          ← Pricing Engine
        </Link>
        <h1 className="text-[20px] font-bold mt-1 flex items-center gap-2">
          <span className="text-[24px]">📦</span> Bulk Purchase Calculator
        </h1>
        <p className="text-[12px] mt-0.5" style={{ color: 'var(--tx2,#8b949e)' }}>
          Find your <b style={{ color: 'var(--tx,#e6edf3)' }}>per-unit purchase price</b> when buying in bulk.
          Then take that number into the Pricing Calculator to add packaging, logistics, profit and get your MRP.
        </p>
      </div>

      {/* Concept explainer — how giants do it */}
      <div className="rounded-xl p-4 mb-5"
        style={{ background: 'var(--bg2,#161b22)', border: '1px solid var(--bd,#30363d)' }}>
        <div className="text-[12px] font-bold mb-2" style={{ color: 'var(--tx,#e6edf3)' }}>
          💡 How big D2C brands, FMCG companies & Amazon sellers think about this:
        </div>
        <div className="grid grid-cols-2 gap-3 text-[11px]">
          <div className="rounded-lg p-3" style={{ background: 'rgba(55,138,221,0.08)', border: '1px solid rgba(55,138,221,0.2)' }}>
            <div className="font-bold mb-1.5" style={{ color: '#378ADD' }}>📦 Bulk calc (this page)</div>
            <div style={{ color: 'var(--tx2,#8b949e)' }}>
              Answers: <b style={{ color: 'var(--tx,#e6edf3)' }}>"What did 1 unit cost me, sitting in my warehouse?"</b>
            </div>
            <ul className="mt-1.5 space-y-0.5" style={{ color: 'var(--tx2,#8b949e)' }}>
              <li>✓ Product/material cost</li>
              <li>✓ Inbound freight (supplier → your WH)</li>
              <li>✓ Import duties or taxes</li>
              <li>✓ Wastage / processing loss</li>
            </ul>
          </div>
          <div className="rounded-lg p-3" style={{ background: 'rgba(99,153,34,0.08)', border: '1px solid rgba(99,153,34,0.2)' }}>
            <div className="font-bold mb-1.5" style={{ color: '#639922' }}>🏷️ Pricing Calculator (next step)</div>
            <div style={{ color: 'var(--tx2,#8b949e)' }}>
              Answers: <b style={{ color: 'var(--tx,#e6edf3)' }}>"What should I charge to make a profit?"</b>
            </div>
            <ul className="mt-1.5 space-y-0.5" style={{ color: 'var(--tx2,#8b949e)' }}>
              <li>✓ Packaging each order</li>
              <li>✓ Shipping + COD to customer</li>
              <li>✓ Returns, marketing, platform fee</li>
              <li>✓ Your profit target + GST</li>
            </ul>
          </div>
        </div>
        <div className="mt-2 text-[11px] px-1" style={{ color: 'var(--tx2,#8b949e)' }}>
          These costs repeat <b style={{ color: 'var(--tx,#e6edf3)' }}>every time you ship an order</b> — they are NOT part of bulk purchase cost.
          That's why they live in the Pricing Calculator, not here.
        </div>
      </div>

      {/* Main 2-col layout */}
      <div className="grid gap-5" style={{ gridTemplateColumns: '1fr 360px', alignItems: 'start' }}>

        {/* LEFT — inputs */}
        <div className="space-y-4">

          {/* STEP 1: What did you buy */}
          <div className="rounded-xl border overflow-hidden"
            style={{ background: 'var(--bg2,#161b22)', borderColor: 'var(--bd,#30363d)', borderLeft: '3px solid #378ADD' }}>

            {/* Collapsible header */}
            <div className="flex items-center gap-3 px-5 py-3.5 border-b"
              style={{ borderColor: 'var(--bd,#30363d)', background: 'var(--bg,#0d1117)' }}>
              <span className="w-6 h-6 rounded-full text-[11px] font-bold flex items-center justify-center flex-none"
                style={{ background: '#E6F1FB', color: '#185FA5' }}>1</span>
              <div className="flex-1">
                <div className="text-[13px] font-bold" style={{ color: '#378ADD' }}>What did you buy?</div>
                <div className="text-[11px]" style={{ color: 'var(--tx2,#8b949e)' }}>Total units and total amount paid to supplier</div>
              </div>
            </div>

            {/* Units row: number + label inline */}
            <div className="px-5 py-3.5 border-b" style={{ borderColor: 'var(--bd,#30363d)' }}>
              <div className="text-[12px] font-semibold mb-2" style={{ color: 'var(--tx,#e6edf3)' }}>
                How many units did you buy?
              </div>
              <div className="text-[11px] mb-2" style={{ color: 'var(--tx2,#8b949e)' }}>
                Enter the quantity and what you call them (bottles, packets, pieces, kg…)
              </div>
              <div className="flex items-center gap-2">
                <input type="number" value={totalUnits} min={1}
                  onChange={e => setTotalUnits(e.target.value)}
                  className="w-28 px-2 py-1.5 rounded-lg text-[14px] font-bold border text-right"
                  style={{ background: 'var(--bg,#0d1117)', borderColor: 'var(--bd,#30363d)', color: 'var(--tx,#e6edf3)' }} />
                <input value={unitLabel} onChange={e => setUnitLabel(e.target.value)}
                  placeholder="bottles / pieces / kg…"
                  className="flex-1 px-3 py-1.5 rounded-lg text-[13px] border"
                  style={{ background: 'var(--bg,#0d1117)', borderColor: 'var(--bd,#30363d)', color: 'var(--tx,#e6edf3)' }} />
              </div>
            </div>

            <InputRow
              label="Total invoice amount paid (₹)"
              hint="Full amount paid to supplier for this batch — exactly as it appears on the invoice."
              prefix="₹" value={totalCost} onChange={setTotalCost}
            />
          </div>

          {/* STEP 2: Extra procurement costs */}
          <div className="rounded-xl border overflow-hidden"
            style={{ background: 'var(--bg2,#161b22)', borderColor: 'var(--bd,#30363d)', borderLeft: '3px solid #C8820A' }}>
            <div className="flex items-center gap-3 px-5 py-3.5 border-b"
              style={{ borderColor: 'var(--bd,#30363d)', background: 'var(--bg,#0d1117)' }}>
              <span className="w-6 h-6 rounded-full text-[11px] font-bold flex items-center justify-center flex-none"
                style={{ background: '#FAEEDA', color: '#854F0B' }}>2</span>
              <div className="flex-1">
                <div className="text-[13px] font-bold" style={{ color: '#C8820A' }}>Procurement extras (optional)</div>
                <div className="text-[11px]" style={{ color: 'var(--tx2,#8b949e)' }}>Costs to get stock from supplier to your warehouse</div>
              </div>
            </div>

            <InputRow
              label="Inbound freight / transport (₹)"
              hint="What you paid to transport the bulk stock from supplier to your warehouse. Enter 0 if supplier delivered free."
              prefix="₹" value={inboundShip} onChange={setInboundShip}
            />
            <InputRow
              label="Import duties, taxes, other (₹)"
              hint="Customs duty, IGST on imports, inspection fees etc. for the whole batch. Enter 0 if local supplier."
              prefix="₹" value={duties} onChange={setDuties}
            />
          </div>

          {/* STEP 3: Wastage */}
          <div className="rounded-xl border overflow-hidden"
            style={{ background: 'var(--bg2,#161b22)', borderColor: 'var(--bd,#30363d)', borderLeft: '3px solid #E24B4A' }}>
            <div className="flex items-center gap-3 px-5 py-3.5 border-b"
              style={{ borderColor: 'var(--bd,#30363d)', background: 'var(--bg,#0d1117)' }}>
              <span className="w-6 h-6 rounded-full text-[11px] font-bold flex items-center justify-center flex-none"
                style={{ background: '#FCEBEB', color: '#A32D2D' }}>3</span>
              <div className="flex-1">
                <div className="text-[13px] font-bold" style={{ color: '#E24B4A' }}>Wastage / processing loss (optional)</div>
                <div className="text-[11px]" style={{ color: 'var(--tx2,#8b949e)' }}>Units lost in transit, damaged, or used in quality checks</div>
              </div>
            </div>

            <div className="px-5 py-3.5 border-b" style={{ borderColor: 'var(--bd,#30363d)' }}>
              <div className="text-[12px] font-semibold mb-1" style={{ color: 'var(--tx,#e6edf3)' }}>
                Wastage %
              </div>
              <div className="text-[11px] mb-2" style={{ color: 'var(--tx2,#8b949e)' }}>
                % of units that are unusable (broken, damaged, used for QC, processing loss). Enter 0 if everything is sellable.
              </div>
              <div className="flex items-center gap-2">
                <input type="number" value={wastePct} min={0} max={100}
                  onChange={e => setWastePct(e.target.value)}
                  className="w-24 px-2 py-1.5 rounded-lg text-[14px] font-bold border text-right"
                  style={{ background: 'var(--bg,#0d1117)', borderColor: 'var(--bd,#30363d)', color: 'var(--tx,#e6edf3)' }} />
                <span className="text-[13px] font-bold" style={{ color: 'var(--tx2,#8b949e)' }}>%</span>
                {N(wastePct) > 0 && (
                  <span className="text-[11px] px-2 py-0.5 rounded ml-1" style={{ background: '#FCEBEB', color: '#A32D2D' }}>
                    {(N(totalUnits) * N(wastePct) / 100).toFixed(0)} {unitLabel} lost
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* STEP 4: Pack sizes (optional) */}
          <div className="rounded-xl border overflow-hidden"
            style={{ background: 'var(--bg2,#161b22)', borderColor: 'var(--bd,#30363d)' }}>
            <button onClick={() => setShowVariants(v => !v)}
              className="w-full flex items-center gap-3 px-5 py-3.5"
              style={{ background: 'var(--bg,#0d1117)' }}>
              <span className="w-6 h-6 rounded-full text-[11px] font-bold flex items-center justify-center flex-none"
                style={{ background: 'var(--bd,#30363d)', color: 'var(--tx2,#8b949e)' }}>4</span>
              <div className="flex-1 text-left">
                <div className="text-[13px] font-semibold" style={{ color: 'var(--tx,#e6edf3)' }}>
                  Pack sizes <span className="text-[11px] font-normal ml-1" style={{ color: 'var(--tx2,#8b949e)' }}>(optional)</span>
                </div>
                <div className="text-[11px]" style={{ color: 'var(--tx2,#8b949e)' }}>
                  Selling 1 bottle, 3-pack and 6-pack from the same bulk purchase?
                </div>
              </div>
              <span style={{ color: 'var(--tx2,#8b949e)', fontSize: 10, transform: showVariants ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }}>▼</span>
            </button>

            {showVariants && (
              <div className="border-t" style={{ borderColor: 'var(--bd,#30363d)' }}>
                <div className="px-5 py-3 border-b" style={{ borderColor: 'var(--bd,#30363d)' }}>
                  <div className="text-[11px]" style={{ color: 'var(--tx2,#8b949e)' }}>
                    Enter how many units per pack for each SKU. The per-unit cost will scale up.
                    Each size can be pushed separately to the Pricing Calculator.
                  </div>
                </div>
                {/* Table header */}
                <div className="grid text-[10px] font-bold uppercase tracking-widest px-5 py-2"
                  style={{ gridTemplateColumns: '1fr 80px 110px 32px', color: 'var(--tx2,#8b949e)', borderBottom: '1px solid var(--bd,#30363d)' }}>
                  <div>Label (e.g. "3-pack")</div>
                  <div className="text-right">Units/pack</div>
                  <div className="text-right">Cost/pack</div>
                  <div />
                </div>
                {variants.map((v, i) => {
                  const packCost = v.qty * purchasePerUnit;
                  return (
                    <div key={i} className="grid items-center px-5 py-2 gap-3"
                      style={{ gridTemplateColumns: '1fr 80px 110px 32px', borderBottom: '1px solid var(--bd,#30363d)' }}>
                      <input value={v.label}
                        placeholder={`${v.qty} ${unitLabel}`}
                        onChange={e => setVariants(prev => prev.map((x, j) => j === i ? { ...x, label: e.target.value } : x))}
                        className="px-2 py-1 rounded text-[12px] border"
                        style={{ background: 'var(--bg,#0d1117)', borderColor: 'var(--bd,#30363d)', color: 'var(--tx,#e6edf3)' }} />
                      <input type="number" value={v.qty} min={1}
                        onChange={e => setVariants(prev => prev.map((x, j) => j === i ? { ...x, qty: parseFloat(e.target.value) || 1 } : x))}
                        className="px-2 py-1 rounded text-[12px] border text-right"
                        style={{ background: 'var(--bg,#0d1117)', borderColor: 'var(--bd,#30363d)', color: 'var(--tx,#e6edf3)' }} />
                      <div className="text-right">
                        <div className="text-[12px] font-bold" style={{ color: 'var(--accent,#3fb950)' }}>
                          ₹{packCost.toFixed(2)}
                        </div>
                        <button onClick={() => pushToCalculator(packCost, v.label || `${v.qty} ${unitLabel}`)}
                          className="text-[10px] mt-0.5 px-1.5 py-0.5 rounded border transition"
                          style={{ borderColor: 'var(--accent,#3fb950)', color: 'var(--accent,#3fb950)' }}>
                          Use this →
                        </button>
                      </div>
                      <button onClick={() => setVariants(prev => prev.filter((_, j) => j !== i))}
                        style={{ color: 'var(--tx2,#8b949e)', fontSize: 14, textAlign: 'center' }}>✕</button>
                    </div>
                  );
                })}
                <div className="px-5 py-2">
                  <button onClick={() => setVariants(v => [...v, { label: '', qty: 1 }])}
                    className="text-[11px] px-3 py-1 rounded border"
                    style={{ borderColor: 'var(--bd,#30363d)', color: 'var(--tx2,#8b949e)' }}>
                    + Add pack size
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* RIGHT — live result */}
        <div className="sticky top-4 space-y-3">

          {/* The one number that matters */}
          <div className="rounded-xl border overflow-hidden"
            style={{ borderColor: 'var(--accent,#3fb950)' }}>
            <div className="px-5 py-4 border-b" style={{ borderColor: 'var(--bd,#30363d)', background: 'var(--bg,#0d1117)' }}>
              <div className="text-[10px] font-bold tracking-widest uppercase mb-1" style={{ color: 'var(--tx2,#8b949e)' }}>
                Purchase price per unit
              </div>
              <div className="text-[44px] font-bold leading-none" style={{ color: 'var(--accent,#3fb950)' }}>
                {fmtR(purchasePerUnit)}
              </div>
              <div className="text-[12px] mt-1.5" style={{ color: 'var(--tx2,#8b949e)' }}>
                per {unitLabel || 'unit'} · landed at your warehouse
              </div>
              <div className="text-[11px] mt-1 px-2 py-1 rounded inline-block"
                style={{ background: 'rgba(99,153,34,0.1)', color: '#639922' }}>
                This goes into Stage 1 of the Pricing Calculator
              </div>
            </div>

            {/* Breakdown */}
            <div className="px-5 py-3 space-y-2 border-b" style={{ borderColor: 'var(--bd,#30363d)', background: 'var(--bg2,#161b22)' }}>
              <div className="text-[10px] font-bold tracking-widest uppercase mb-2" style={{ color: 'var(--tx2,#8b949e)' }}>
                How it breaks down
              </div>
              {[
                { label: `Product cost (₹${N(totalCost).toLocaleString('en-IN')} ÷ ${usableUnits.toFixed(1)})`, val: productCostPU, col: '#378ADD' },
                ...(N(inboundShip) > 0 ? [{ label: `Inbound freight ÷ ${usableUnits.toFixed(1)}`, val: inboundPU, col: '#C8820A' }] : []),
                ...(N(duties) > 0 ? [{ label: `Duties/taxes ÷ ${usableUnits.toFixed(1)}`, val: dutiesPU, col: '#7F77DD' }] : []),
                ...(N(wastePct) > 0 ? [{ label: `Wastage spread (${N(wastePct)}% of ${N(totalUnits)})`, val: purchasePerUnit - (N(totalSpend) / N(totalUnits)), col: '#E24B4A' }] : []),
              ].map((row, i) => (
                <div key={i} className="flex items-center gap-2 text-[11px]">
                  <div className="w-2 h-2 rounded-full flex-none" style={{ background: row.col }} />
                  <div className="flex-1 truncate" style={{ color: 'var(--tx2,#8b949e)' }}>{row.label}</div>
                  <div className="font-bold flex-none" style={{ color: 'var(--tx,#e6edf3)' }}>₹{row.val.toFixed(2)}</div>
                </div>
              ))}
              <div className="flex items-center justify-between pt-2 text-[12px] font-bold"
                style={{ borderTop: '1px solid var(--bd,#30363d)' }}>
                <span style={{ color: 'var(--tx,#e6edf3)' }}>= Per unit purchase price</span>
                <span style={{ color: 'var(--accent,#3fb950)' }}>{fmtR(purchasePerUnit)}</span>
              </div>
            </div>

            {/* Batch facts */}
            <div className="px-5 py-3 space-y-1.5 border-b" style={{ borderColor: 'var(--bd,#30363d)', background: 'var(--bg2,#161b22)' }}>
              {[
                { label: 'Units bought', val: `${N(totalUnits)} ${unitLabel}` },
                ...(N(wastePct) > 0 ? [{ label: `Usable (${N(wastePct)}% wasted)`, val: `${usableUnits.toFixed(1)} ${unitLabel}` }] : []),
                { label: 'Total spend', val: `₹${N(totalSpend).toLocaleString('en-IN')}` },
              ].map((row, i) => (
                <div key={i} className="flex justify-between text-[11px]">
                  <span style={{ color: 'var(--tx2,#8b949e)' }}>{row.label}</span>
                  <span className="font-bold" style={{ color: 'var(--tx,#e6edf3)' }}>{row.val}</span>
                </div>
              ))}
            </div>

            {/* Main CTA */}
            <div className="px-5 py-4" style={{ background: 'var(--bg2,#161b22)' }}>
              <button onClick={() => pushToCalculator(purchasePerUnit)}
                className="w-full py-3 rounded-xl text-[13px] font-bold flex items-center justify-center gap-2 transition"
                style={{ background: 'var(--accent,#3fb950)', color: '#fff' }}>
                Use {fmtR(purchasePerUnit)} as Purchase Price
                <span className="opacity-80">→ Pricing Calculator</span>
              </button>
              <div className="text-[10px] text-center mt-2" style={{ color: 'var(--tx2,#8b949e)' }}>
                Opens New Product page · Stage 1 will be pre-filled with this cost
              </div>

              {/* What happens next */}
              <div className="mt-3 rounded-lg p-3" style={{ background: 'var(--bg,#0d1117)', border: '1px solid var(--bd,#30363d)' }}>
                <div className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: 'var(--tx2,#8b949e)' }}>
                  What you'll fill in next:
                </div>
                {[
                  { n: 2, col: '#C8820A', label: 'Packaging per unit (box, tape, label)' },
                  { n: 3, col: '#1D9E75', label: 'Shipping + COD per order' },
                  { n: 4, col: '#E24B4A', label: 'Return rate & return cost' },
                  { n: 5, col: '#7F77DD', label: 'Marketing, platform fee' },
                  { n: 6, col: '#639922', label: 'Profit target + output GST → MRP' },
                ].map(s => (
                  <div key={s.n} className="flex items-center gap-2 text-[11px] py-0.5">
                    <span className="w-4 h-4 rounded-full text-[9px] font-bold flex items-center justify-center flex-none"
                      style={{ background: `${s.col}20`, color: s.col }}>{s.n}</span>
                    <span style={{ color: 'var(--tx2,#8b949e)' }}>{s.label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
