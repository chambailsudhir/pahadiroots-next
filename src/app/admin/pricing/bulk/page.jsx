'use client';
import { useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { fmtR, fmtN, ri, r } from '@/lib/pricingCalc';

// ── Collapsible section wrapper ───────────────────────────────
function Section({ num, title, sub, color = '#3fb950', children, open, onToggle, rightSummary }) {
  return (
    <div className="rounded-xl overflow-hidden border transition-all"
      style={{ borderColor: open ? color : 'var(--bd,#30363d)', background: open ? `${color}08` : 'var(--bg2,#161b22)' }}>
      <button onClick={onToggle}
        className="w-full flex items-center gap-3 px-5 py-4 text-left"
        style={{ borderLeft: `3px solid ${color}` }}>
        <span className="w-7 h-7 rounded-full text-[12px] font-bold flex items-center justify-center flex-none"
          style={{ background: open ? color : 'var(--bg,#0d1117)', color: open ? '#fff' : color, border: `1.5px solid ${color}` }}>
          {num}
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-[14px] font-bold" style={{ color: open ? 'var(--tx,#e6edf3)' : 'var(--tx2,#8b949e)' }}>{title}</div>
          <div className="text-[11px] mt-0.5" style={{ color: 'var(--tx2,#8b949e)' }}>{sub}</div>
        </div>
        {rightSummary && !open && (
          <div className="text-[13px] font-bold flex-none mr-2" style={{ color }}>{rightSummary}</div>
        )}
        <span style={{ color, fontSize: 11, transform: open ? 'rotate(180deg)' : 'none', display: 'inline-block', transition: 'transform .2s', opacity: 0.7 }}>▼</span>
      </button>
      {open && (
        <div className="px-5 pb-5" style={{ borderTop: `1px solid ${color}25` }}>
          {children}
        </div>
      )}
    </div>
  );
}

// ── Labelled number input ─────────────────────────────────────
function NumInput({ label, desc, value, onChange, prefix = '₹', step = 1, min = 0, suffix }) {
  return (
    <div className="py-4 border-b last:border-0" style={{ borderColor: 'var(--bd,#30363d)' }}>
      <div className="text-[13px] font-semibold mb-0.5" style={{ color: 'var(--tx,#e6edf3)' }}>{label}</div>
      {desc && <div className="text-[11px] mb-2.5 leading-relaxed" style={{ color: 'var(--tx2,#8b949e)' }}>{desc}</div>}
      <div className="flex items-center gap-2">
        {prefix && (
          <span className="text-[13px] font-semibold w-5 text-center flex-none" style={{ color: 'var(--tx2,#8b949e)' }}>{prefix}</span>
        )}
        <input
          type="number" value={value} step={step} min={min}
          onChange={e => onChange(e.target.value)}
          className="flex-1 px-3 py-2 rounded-lg border text-[15px] font-bold text-right"
          style={{ background: 'var(--bg,#0d1117)', borderColor: 'var(--bd,#30363d)', color: 'var(--tx,#e6edf3)' }}
        />
        {suffix && <span className="text-[12px] flex-none" style={{ color: 'var(--tx2,#8b949e)' }}>{suffix}</span>}
      </div>
    </div>
  );
}

export default function BulkCalcPage() {
  const router = useRouter();

  // Section open/close state
  const [open, setOpen] = useState({ 1: true, 2: true, 3: false });
  function tog(n) { setOpen(p => ({ ...p, [n]: !p[n] })); }

  // Section 1 — What did you buy?
  const [units, setUnits]         = useState(100);
  const [unitLabel, setUnitLabel] = useState('bottles');
  const [invoice, setInvoice]     = useState(3000);

  // Section 2 — Procurement extras
  const [freight, setFreight]     = useState(0);
  const [duties, setDuties]       = useState(0);
  const [wastage, setWastage]     = useState(0);
  const [wastePct, setWastePct]   = useState(0);   // % mode for wastage
  const [wasteMode, setWasteMode] = useState('flat'); // 'flat' | 'pct'

  // Section 3 — Cost allocation (optional)
  const [allocCost, setAllocCost] = useState(0);   // e.g. fixed overheads to spread

  // ── Derived calculations ──────────────────────────────────
  const totalUnits = Math.max(1, Number(units) || 1);
  const totalInvoice = Number(invoice) || 0;
  const totalFreight = Number(freight) || 0;
  const totalDuties  = Number(duties)  || 0;
  const totalAlloc   = Number(allocCost) || 0;

  const wasteAmt = wasteMode === 'pct'
    ? totalInvoice * (Number(wastePct) / 100)
    : (Number(wastage) || 0);

  const totalSpend    = totalInvoice + totalFreight + totalDuties + wasteAmt + totalAlloc;
  const perUnitCost   = r(totalSpend / totalUnits);

  // Breakdown rows
  const breakdown = [
    { label: `Product cost (₹${fmtN(totalInvoice)} ÷ ${fmtN(totalUnits)})`, val: r(totalInvoice / totalUnits), show: true },
    { label: 'Inbound freight / unit', val: r(totalFreight / totalUnits), show: totalFreight > 0 },
    { label: 'Duties & taxes / unit',  val: r(totalDuties  / totalUnits), show: totalDuties  > 0 },
    { label: 'Wastage / unit',         val: r(wasteAmt      / totalUnits), show: wasteAmt     > 0 },
    { label: 'Allocated overheads / unit', val: r(totalAlloc / totalUnits), show: totalAlloc  > 0 },
  ].filter(x => x.show);

  function goToPricingCalc() {
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('bulk_purchase', String(perUnitCost));
    }
    router.push('/admin/pricing/new?from=bulk');
  }

  const n = v => parseFloat(v) || 0;

  return (
    <div className="space-y-4 pb-16" style={{ color: 'var(--tx,#e6edf3)' }}>

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="mb-1">
            <Link href="/admin/pricing" className="text-[12px]" style={{ color: 'var(--tx2,#8b949e)' }}>
              ← Pricing Engine
            </Link>
          </div>
          <h1 className="text-[20px] font-bold flex items-center gap-2">
            <span className="text-[24px]">🧮</span> Bulk Calculator
          </h1>
          <p className="text-[12px] mt-0.5" style={{ color: 'var(--tx2,#8b949e)' }}>
            What did 1 unit cost you, sitting in your warehouse?
          </p>
        </div>
      </div>

      {/* Context banner */}
      <div className="grid gap-3" style={{ gridTemplateColumns: '1fr 1fr' }}>
        {[
          { emoji: '🧮', title: 'Bulk calc (this page)', color: '#378ADD', bg: 'rgba(55,138,221,0.07)', bd: 'rgba(55,138,221,0.3)',
            q: '"What did 1 unit cost me, sitting in my warehouse?"',
            items: ['Product / material cost', 'Inbound freight (supplier → your WH)', 'Import duties or taxes', 'Wastage / processing loss'] },
          { emoji: '💰', title: 'Pricing Calculator (next step)', color: '#C8820A', bg: 'rgba(200,130,10,0.07)', bd: 'rgba(200,130,10,0.3)',
            q: '"What should I charge to make a profit?"',
            items: ['Packaging each order', 'Shipping + COD to customer', 'Returns, marketing, platform fee', 'Your profit target + GST'] },
        ].map(c => (
          <div key={c.title} className="rounded-xl p-4" style={{ background: c.bg, border: `1px solid ${c.bd}` }}>
            <div className="text-[12px] font-bold mb-1" style={{ color: c.color }}>{c.emoji} {c.title}</div>
            <div className="text-[11px] mb-2 italic" style={{ color: 'var(--tx2,#8b949e)' }}>{c.q}</div>
            {c.items.map(i => (
              <div key={i} className="text-[11px] flex gap-1.5" style={{ color: 'var(--tx2,#8b949e)' }}>
                <span style={{ color: c.color }}>✓</span> {i}
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="text-[11px] px-1" style={{ color: 'var(--tx2,#8b949e)' }}>
        These costs repeat <b style={{ color: 'var(--tx,#e6edf3)' }}>every time you ship an order</b> — they are NOT part of bulk purchase cost. That's why they live in the Pricing Calculator, not here.
      </div>

      {/* Two-col layout */}
      <div className="grid gap-4" style={{ gridTemplateColumns: '1fr 340px', alignItems: 'start' }}>

        {/* LEFT — sections */}
        <div className="space-y-3">

          {/* Section 1 */}
          <Section num={1} title="What did you buy?"
            sub="Total units and total amount paid to supplier"
            color="#378ADD" open={open[1]} onToggle={() => tog(1)}
            rightSummary={!open[1] ? `${fmtN(totalUnits)} ${unitLabel} · ₹${fmtN(totalInvoice)}` : null}>

            <div className="pt-4">
              {/* Units row */}
              <div className="pb-4 border-b" style={{ borderColor: 'var(--bd,#30363d)' }}>
                <div className="text-[13px] font-semibold mb-0.5" style={{ color: 'var(--tx,#e6edf3)' }}>How many units did you buy?</div>
                <div className="text-[11px] mb-2.5" style={{ color: 'var(--tx2,#8b949e)' }}>Enter the quantity and what you call them (bottles, packets, pieces, kg…)</div>
                <div className="flex gap-2">
                  <input type="number" value={units} min={1} step={1}
                    onChange={e => setUnits(e.target.value)}
                    className="w-28 px-3 py-2 rounded-lg border text-[15px] font-bold text-right"
                    style={{ background: 'var(--bg,#0d1117)', borderColor: 'var(--bd,#30363d)', color: 'var(--tx,#e6edf3)' }} />
                  <input type="text" value={unitLabel} placeholder="bottles"
                    onChange={e => setUnitLabel(e.target.value)}
                    className="flex-1 px-3 py-2 rounded-lg border text-[14px]"
                    style={{ background: 'var(--bg,#0d1117)', borderColor: 'var(--bd,#30363d)', color: 'var(--tx,#e6edf3)' }} />
                </div>
              </div>

              {/* Invoice */}
              <NumInput label="Total invoice amount paid (₹)"
                desc="Full amount paid to supplier for this batch — exactly as it appears on the invoice."
                value={invoice} onChange={setInvoice} />

              {/* Cost per unit live preview inside section */}
              <div className="mt-1 flex items-center justify-between px-3 py-2.5 rounded-lg"
                style={{ background: 'rgba(55,138,221,0.08)', border: '1px solid rgba(55,138,221,0.25)' }}>
                <span className="text-[11px]" style={{ color: 'var(--tx2,#8b949e)' }}>Invoice ÷ units</span>
                <span className="text-[14px] font-bold" style={{ color: '#378ADD' }}>
                  ₹{fmtN(totalInvoice)} ÷ {fmtN(totalUnits)} = <span style={{ color: 'var(--tx,#e6edf3)' }}>₹{r(totalInvoice / totalUnits)}/unit</span>
                </span>
              </div>
            </div>
          </Section>

          {/* Section 2 */}
          <Section num={2} title="Procurement extras (optional)"
            sub="Costs to get stock from supplier to your warehouse"
            color="#C8820A" open={open[2]} onToggle={() => tog(2)}
            rightSummary={!open[2] && (totalFreight + totalDuties + wasteAmt) > 0
              ? `+₹${fmtN(totalFreight + totalDuties + wasteAmt)} total`
              : !open[2] ? 'optional — skip if not applicable' : null}>

            <div className="pt-2">
              <NumInput label="Inbound freight / transport (₹)"
                desc="What you paid to transport the bulk stock from supplier to your warehouse. Enter 0 if supplier delivered free."
                value={freight} onChange={setFreight} />

              <NumInput label="Import duties, taxes, other (₹)"
                desc="Customs duty, IGST on imports, inspection fees etc. for the whole batch. Enter 0 if local supplier."
                value={duties} onChange={setDuties} />

              {/* Wastage — flat or % toggle */}
              <div className="py-4 border-b last:border-0" style={{ borderColor: 'var(--bd,#30363d)' }}>
                <div className="flex items-center justify-between mb-0.5">
                  <div className="text-[13px] font-semibold" style={{ color: 'var(--tx,#e6edf3)' }}>Wastage / processing loss</div>
                  <div className="flex gap-1">
                    {[['flat','₹ flat'],['pct','% of invoice']].map(([v,l]) => (
                      <button key={v} onClick={() => setWasteMode(v)}
                        className="px-2 py-1 rounded text-[10px] font-bold transition"
                        style={{
                          background: wasteMode === v ? '#C8820A' : 'var(--bg,#0d1117)',
                          color: wasteMode === v ? '#fff' : 'var(--tx2,#8b949e)',
                          border: `1px solid ${wasteMode === v ? '#C8820A' : 'var(--bd,#30363d)'}`,
                        }}>{l}</button>
                    ))}
                  </div>
                </div>
                <div className="text-[11px] mb-2.5" style={{ color: 'var(--tx2,#8b949e)' }}>
                  Units broken during transport or processing. Enter as flat ₹ or % of invoice.
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-semibold w-5 text-center flex-none" style={{ color: 'var(--tx2,#8b949e)' }}>
                    {wasteMode === 'pct' ? '%' : '₹'}
                  </span>
                  <input type="number"
                    value={wasteMode === 'pct' ? wastePct : wastage}
                    min={0} step={wasteMode === 'pct' ? 0.1 : 1}
                    onChange={e => wasteMode === 'pct' ? setWastePct(e.target.value) : setWastage(e.target.value)}
                    className="flex-1 px-3 py-2 rounded-lg border text-[15px] font-bold text-right"
                    style={{ background: 'var(--bg,#0d1117)', borderColor: 'var(--bd,#30363d)', color: 'var(--tx,#e6edf3)' }} />
                  {wasteMode === 'pct' && wasteAmt > 0 && (
                    <span className="text-[11px] flex-none" style={{ color: '#C8820A' }}>= ₹{fmtN(wasteAmt)}</span>
                  )}
                </div>
              </div>
            </div>
          </Section>

          {/* Section 3 */}
          <Section num={3} title="Overhead allocation (optional)"
            sub="Fixed costs to spread across this batch (rent, labour, machinery…)"
            color="#7F77DD" open={open[3]} onToggle={() => tog(3)}
            rightSummary={!open[3] && totalAlloc > 0 ? `+₹${fmtN(totalAlloc)} allocated` : !open[3] ? 'optional' : null}>

            <div className="pt-2">
              <NumInput label="Total overhead cost to allocate (₹)"
                desc="E.g. monthly factory rent ÷ batches processed, labour for processing this batch. This gets spread across all units."
                value={allocCost} onChange={setAllocCost} />
              {totalAlloc > 0 && (
                <div className="mt-1 flex items-center justify-between px-3 py-2 rounded-lg"
                  style={{ background: 'rgba(127,119,221,0.08)', border: '1px solid rgba(127,119,221,0.2)' }}>
                  <span className="text-[11px]" style={{ color: 'var(--tx2,#8b949e)' }}>Per unit overhead</span>
                  <span className="text-[13px] font-bold" style={{ color: '#7F77DD' }}>
                    +₹{r(totalAlloc / totalUnits)}/unit
                  </span>
                </div>
              )}
            </div>
          </Section>
        </div>

        {/* RIGHT — sticky result panel */}
        <div className="sticky top-4 space-y-3">
          <div className="rounded-xl border overflow-hidden"
            style={{ background: 'var(--bg2,#161b22)', borderColor: 'var(--accent,#3fb950)' }}>

            {/* Hero */}
            <div className="p-5 border-b" style={{ borderColor: 'var(--bd,#30363d)', background: 'var(--bg,#0d1117)' }}>
              <div className="text-[10px] font-bold tracking-widest uppercase mb-1" style={{ color: 'var(--tx2,#8b949e)' }}>
                Purchase price per unit
              </div>
              <div className="text-[48px] font-bold leading-none" style={{ color: 'var(--tx,#e6edf3)' }}>
                {fmtR(perUnitCost)}
              </div>
              <div className="text-[11px] mt-1" style={{ color: 'var(--tx2,#8b949e)' }}>
                per {unitLabel} · landed at your warehouse
              </div>
              <div className="mt-2 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold inline-block"
                style={{ background: 'rgba(63,185,80,0.12)', color: 'var(--accent,#3fb950)', border: '1px solid rgba(63,185,80,0.25)' }}>
                This goes into Stage 1 of the Pricing Calculator
              </div>
            </div>

            {/* Breakdown */}
            <div className="p-4">
              <div className="text-[10px] font-bold tracking-widest uppercase mb-3" style={{ color: 'var(--tx2,#8b949e)' }}>
                How it breaks down
              </div>
              <div className="space-y-1.5">
                {breakdown.map((row, i) => (
                  <div key={i} className="flex items-center justify-between text-[12px]">
                    <div className="flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full flex-none" style={{ background: 'var(--accent,#3fb950)' }} />
                      <span style={{ color: 'var(--tx2,#8b949e)' }}>{row.label}</span>
                    </div>
                    <span className="font-bold" style={{ color: 'var(--tx,#e6edf3)' }}>₹{row.val}</span>
                  </div>
                ))}
                <div className="flex items-center justify-between text-[13px] pt-2 mt-1"
                  style={{ borderTop: '1px solid var(--bd,#30363d)' }}>
                  <span className="font-bold" style={{ color: 'var(--tx2,#8b949e)' }}>= Per unit purchase price</span>
                  <span className="font-bold" style={{ color: 'var(--accent,#3fb950)' }}>₹{perUnitCost}</span>
                </div>
              </div>

              {/* Stats */}
              <div className="grid grid-cols-2 gap-2 mt-4">
                {[
                  { label: 'Units bought', val: `${fmtN(totalUnits)} ${unitLabel}` },
                  { label: 'Total spend',  val: fmtR(totalSpend) },
                ].map((s, i) => (
                  <div key={i} className="rounded-lg px-3 py-2.5" style={{ background: 'var(--bg,#0d1117)' }}>
                    <div className="text-[10px]" style={{ color: 'var(--tx2,#8b949e)' }}>{s.label}</div>
                    <div className="text-[13px] font-bold mt-0.5" style={{ color: 'var(--tx,#e6edf3)' }}>{s.val}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* CTA */}
            <div className="p-4 pt-0">
              <button onClick={goToPricingCalc}
                className="w-full py-3 rounded-xl text-[13px] font-bold transition"
                style={{ background: 'var(--accent,#3fb950)', color: '#fff' }}>
                Use {fmtR(perUnitCost)} as Purchase Price → Pricing Calculator
              </button>
              <div className="text-[10px] text-center mt-1.5" style={{ color: 'var(--tx2,#8b949e)' }}>
                Opens New Product page · Stage 1 will be pre-filled with this cost
              </div>

              {/* What comes next */}
              <div className="mt-4">
                <div className="text-[10px] font-bold tracking-widest uppercase mb-2" style={{ color: 'var(--tx2,#8b949e)' }}>
                  What you'll fill in next:
                </div>
                {[
                  { n: 2, t: 'Packaging per unit (box, tape, label)' },
                  { n: 3, t: 'Shipping + COD per order' },
                  { n: 4, t: 'Return rate & return cost' },
                  { n: 5, t: 'Platform fee + marketing' },
                  { n: 6, t: 'Profit target + output GST' },
                ].map(s => (
                  <div key={s.n} className="flex items-center gap-2 text-[11px] py-1"
                    style={{ borderBottom: '1px solid var(--bd,#30363d)', color: 'var(--tx2,#8b949e)' }}>
                    <span className="w-4 h-4 rounded-full text-[9px] font-bold flex items-center justify-center flex-none"
                      style={{ background: 'var(--bg,#0d1117)', border: '1px solid var(--bd,#30363d)', color: 'var(--tx2,#8b949e)' }}>
                      {s.n}
                    </span>
                    {s.t}
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
