'use client';
import { GST_RATES, STAGE_META, BUSINESS_TYPES, ri, fmtN, fmtR, r, validateField } from '@/lib/pricingCalc';

// ═══════════════════════════════════════════════════════════════
// BUSINESS TYPE SELECTOR — shown at top of each pricing page
// ═══════════════════════════════════════════════════════════════
export function BusinessTypeSelector({ current, onSelect }) {
  return (
    <div className="rounded-xl border p-4"
      style={{ background: 'var(--bg2,#161b22)', borderColor: 'var(--bd,#30363d)' }}>
      <div className="text-[11px] font-bold tracking-widest uppercase mb-3" style={{ color: 'var(--tx2,#8b949e)' }}>
        Business type — sets realistic defaults & margin benchmarks
      </div>
      <div className="grid grid-cols-1 gap-2" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))' }}>
        {BUSINESS_TYPES.map(bt => (
          <button key={bt.id} onClick={() => onSelect(bt)}
            className="text-left px-3 py-2.5 rounded-lg border transition"
            style={{
              background: current === bt.id ? 'rgba(63,185,80,0.08)' : 'var(--bg,#0d1117)',
              borderColor: current === bt.id ? 'var(--accent,#3fb950)' : 'var(--bd,#30363d)',
            }}>
            <div className="text-[12px] font-bold" style={{ color: current === bt.id ? 'var(--accent,#3fb950)' : 'var(--tx,#e6edf3)' }}>
              {bt.label}
            </div>
            <div className="text-[10px] mt-0.5 leading-relaxed" style={{ color: 'var(--tx2,#8b949e)' }}>{bt.desc}</div>
            <div className="flex gap-3 mt-1.5 text-[10px]" style={{ color: 'var(--tx2,#8b949e)' }}>
              <span>✓ Healthy &gt;{bt.marginHealthy}%</span>
              <span>⚠ Tight {bt.marginTight}–{bt.marginHealthy}%</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// RESULTS PANEL — sticky right column
// ═══════════════════════════════════════════════════════════════
export function ResultsPanel({ f, calc, selProd, onPush, pushing, pushed, pushErr, marginHealthy = 25, marginTight = 15, onSaveAsProduct }) {
  const marginColor =
    calc.margin_pct >= marginHealthy ? '#27500A' :
    calc.margin_pct >= marginTight   ? '#C8820A' : '#A32D2D';
  const marginBg =
    calc.margin_pct >= marginHealthy ? '#EAF3DE' :
    calc.margin_pct >= marginTight   ? '#FAEEDA' : '#FCEBEB';
  const marginLabel =
    calc.margin_pct >= marginHealthy ? '✓ Healthy margin' :
    calc.margin_pct >= marginTight   ? '⚠ Tight — consider raising price' :
    '✗ Below minimum — review costs';

  // FIX (Waterfall): show deltas consistently, not mixed cumulative/delta
  const wfSteps = [
    { label: 'Purchase price',             val: Number(f.purchase) || 0,  col: '#378ADD' },
    { label: '+ GST + inbound + handling + dmg', val: calc.s1_add,        col: '#378ADD' },
    { label: '+ Packaging & storage',      val: calc.s2_add,              col: '#C8820A' },
    { label: '+ Logistics (incl. GST)',     val: calc.s3_add,              col: '#1D9E75' },
    { label: '+ Return impact',            val: calc.ret_impact,           col: '#E24B4A' },
    { label: '+ Platform + mktg + ops',   val: calc.s5_add,               col: '#7F77DD' },
    { label: '+ Profit target',            val: calc.base_excl_gst - calc.total, col: '#639922' },
    { label: '+ Output GST',               val: calc.gst_total,            col: '#888780' },
  ];
  const totalWf = wfSteps.reduce((s, x) => s + x.val, 0);

  return (
    <div className="rounded-xl border overflow-hidden sticky top-4"
      style={{ background: 'var(--bg2,#161b22)', borderColor: 'var(--bd,#30363d)' }}>

      {/* Breakeven warning — FIX (Bug #6) */}
      {calc.below_breakeven && (
        <div className="px-4 py-2.5 text-[11px] font-bold flex items-center gap-2"
          style={{ background: '#FCEBEB', color: '#A32D2D', borderBottom: '1px solid #F09595' }}>
          <span>⚠</span>
          <span>Pricing is below breakeven — raise profit target or reduce costs.</span>
        </div>
      )}

      {/* MRP Hero */}
      <div className="p-4 border-b" style={{ borderColor: 'var(--bd,#30363d)', background: 'var(--bg,#0d1117)' }}>
        <div className="text-[10px] font-bold tracking-widest uppercase mb-1" style={{ color: 'var(--tx2,#8b949e)' }}>Suggested MRP</div>
        <div className="text-[38px] font-bold leading-none" style={{ color: 'var(--tx,#e6edf3)' }}>{fmtR(calc.mrp)}</div>
        <div className="flex items-center gap-2 mt-2 flex-wrap">
          <span className="text-[13px] line-through" style={{ color: 'var(--tx2,#8b949e)' }}>{fmtR(calc.sp)} selling</span>
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: '#EAF3DE', color: '#27500A' }}>
            {calc.disc}% off shown
          </span>
        </div>

        {/* MRP multiplier context */}
        <div className="text-[10px] mt-1" style={{ color: 'var(--tx2,#8b949e)' }}>
          {calc.mrp_mult.toFixed(2)}× SP — {calc.disc < 40 ? '⚠ low impact (<40% off)' : calc.disc >= 55 ? '✓ strong deal signal' : '✓ good deal signal'}
        </div>

        <div className="mt-3">
          <div className="flex justify-between text-[11px] mb-1">
            <span style={{ color: 'var(--tx2,#8b949e)' }}>Gross margin</span>
            <span className="font-bold" style={{ color: marginColor }}>{ri(calc.margin_pct)}%</span>
          </div>
          <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--bd,#30363d)' }}>
            <div className="h-full rounded-full transition-all duration-300"
              style={{ width: `${Math.min(100, Math.max(0, ri(calc.margin_pct)))}%`, background: marginColor }} />
          </div>
          <div className="text-[10px] mt-1 font-semibold px-2 py-0.5 rounded inline-block" style={{ background: marginBg, color: marginColor }}>
            {marginLabel}
          </div>
        </div>
      </div>

      {/* 6 key metrics */}
      <div className="grid grid-cols-2 border-b" style={{ borderColor: 'var(--bd,#30363d)' }}>
        {[
          { label: 'Landed cost',     val: calc.landed,     col: null },
          { label: 'After logistics', val: calc.after_log,  col: null },
          { label: 'Total real cost', val: calc.total,      col: '#C8820A' },
          { label: 'Selling price',   val: calc.sp,         col: 'var(--accent,#3fb950)' },
          { label: 'Return impact',   val: calc.ret_impact, col: '#E24B4A' },
          { label: 'Profit / order',  val: calc.profit_val, col: calc.below_breakeven ? '#A32D2D' : '#27500A' },
        ].map((s, i) => (
          <div key={i} className="px-3 py-2.5"
            style={{
              borderRight: i % 2 === 0 ? '1px solid var(--bd,#30363d)' : 'none',
              borderBottom: i < 4 ? '1px solid var(--bd,#30363d)' : 'none',
            }}>
            <div className="text-[10px]" style={{ color: 'var(--tx2,#8b949e)' }}>{s.label}</div>
            <div className="text-[13px] font-bold mt-0.5" style={{ color: s.col || 'var(--tx,#e6edf3)' }}>
              {fmtR(s.val)}
              {s.label === 'Profit / order' && calc.below_breakeven && (
                <span className="ml-1 text-[9px]">⚠ LOSS</span>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* GST breakdown */}
      <div className="px-4 py-3 border-b" style={{ borderColor: 'var(--bd,#30363d)', background: 'var(--bg,#0d1117)' }}>
        <div className="text-[10px] font-bold tracking-widest uppercase mb-1.5" style={{ color: 'var(--tx2,#8b949e)' }}>Live GST breakdown</div>
        <div className="flex items-baseline gap-1.5 text-[12px] flex-wrap">
          <span style={{ color: 'var(--tx2,#8b949e)' }}>Base</span>
          <span className="font-bold" style={{ color: 'var(--tx,#e6edf3)' }}>{fmtR(calc.base_price)}</span>
          <span style={{ color: 'var(--tx2,#8b949e)' }}>+ GST {f.gst_out}%</span>
          <span className="font-bold" style={{ color: 'var(--yellow)' }}>= {fmtR(calc.gst_total)}</span>
          <span style={{ color: 'var(--tx2,#8b949e)' }}>=</span>
          <span className="font-bold" style={{ color: 'var(--accent,#3fb950)' }}>{fmtR(calc.sp)}</span>
        </div>
        <div className="flex gap-4 mt-1 text-[11px]" style={{ color: 'var(--tx2,#8b949e)' }}>
          <span>CGST: <b style={{ color: 'var(--tx,#e6edf3)' }}>{fmtR(calc.cgst)}</b></span>
          <span>SGST: <b style={{ color: 'var(--tx,#e6edf3)' }}>{fmtR(calc.sgst)}</b></span>
        </div>
        {f.gst_registered && (
          <div className="mt-1.5 text-[10px] px-2 py-1 rounded" style={{ background: '#E1F5EE', color: '#0F6E56' }}>
            ✓ GST-registered: logistics ITC recovered (₹{fmtN(calc.gst_on_courier)} saved/order)
          </div>
        )}
      </div>

      {/* Waterfall — FIX (UX #3): all bars are DELTAS, not mixed cumulative/delta */}
      <div className="px-4 py-3 border-b" style={{ borderColor: 'var(--bd,#30363d)' }}>
        <div className="text-[10px] font-bold tracking-widest uppercase mb-1" style={{ color: 'var(--tx2,#8b949e)' }}>
          Cost waterfall <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(each bar = that stage's addition)</span>
        </div>
        <div className="space-y-1.5 mt-2">
          {wfSteps.map((s, i) => {
            const w = totalWf > 0 ? Math.max(2, ri(s.val / totalWf * 100)) : 0;
            return (
              <div key={i} className="flex items-center gap-2 text-[11px]">
                <div className="w-2 h-2 rounded-full flex-none" style={{ background: s.col }} />
                <div className="flex-1 truncate" style={{ color: 'var(--tx2,#8b949e)' }}>{s.label}</div>
                <div className="w-20 h-1.5 rounded-full overflow-hidden flex-none" style={{ background: 'var(--bd,#30363d)' }}>
                  <div className="h-full rounded-full" style={{ width: `${w}%`, background: s.col }} />
                </div>
                <div className="w-14 text-right font-bold flex-none" style={{ color: 'var(--tx,#e6edf3)' }}>{fmtR(s.val)}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Market price comparison — FIX (Logic #4): explicit label about ACTUAL selling price */}
      {calc.market_price_gap !== null && (
        <div className="px-4 py-3 border-b" style={{ borderColor: 'var(--bd,#30363d)', background: 'var(--bg,#0d1117)' }}>
          <div className="text-[10px] font-bold tracking-widest uppercase mb-1" style={{ color: 'var(--tx2,#8b949e)' }}>vs Competitor actual selling price</div>
          <div className="text-[12px] font-bold" style={{ color: calc.market_price_gap >= 0 ? '#27500A' : '#A32D2D' }}>
            {calc.market_price_gap >= 0
              ? `✓ You are ₹${fmtN(calc.market_price_gap)} cheaper (your SP: ₹${fmtN(calc.sp)} vs their SP: ₹${fmtN(f.market_price)})`
              : `⚠ You are ₹${fmtN(Math.abs(calc.market_price_gap))} more expensive (your SP: ₹${fmtN(calc.sp)} vs their SP: ₹${fmtN(f.market_price)})`}
          </div>
          <div className="text-[10px] mt-1" style={{ color: 'var(--tx2,#8b949e)' }}>
            Enter competitor's <em>actual selling price</em>, not their MRP — otherwise comparison is misleading.
          </div>
        </div>
      )}

      {/* Push panel — FIX (UX #2): single action location, removed duplicate */}
      <div className="p-4">
        <div className="text-[10px] font-bold tracking-widest uppercase mb-3" style={{ color: 'var(--tx2,#8b949e)' }}>
          {selProd ? `Push to: ${selProd.emoji || '📦'} ${selProd.name}` : 'Copy values'}
        </div>
        <div className="grid grid-cols-2 gap-2 mb-3">
          {[
            { label: 'price (base excl GST)', val: fmtR(calc.base_price) },
            { label: 'mrp (selling incl GST)', val: fmtR(calc.sp), accent: true },
            { label: 'MRP strikethrough', val: fmtR(calc.mrp) },
            { label: 'cost_price', val: fmtR(f.purchase) },
          ].map((item, i) => (
            <div key={i} className="rounded-lg p-2.5" style={{ background: 'var(--bg,#0d1117)' }}>
              <div className="text-[10px] font-mono" style={{ color: 'var(--tx2,#8b949e)' }}>{item.label}</div>
              <div className="text-[13px] font-bold mt-0.5"
                style={{ color: item.accent ? 'var(--accent,#3fb950)' : 'var(--tx,#e6edf3)' }}>
                {item.val}
              </div>
            </div>
          ))}
        </div>
        {pushErr && (
          <div className="mb-2 px-3 py-1.5 rounded text-[11px]" style={{ background: '#FCEBEB', color: '#A32D2D' }}>{pushErr}</div>
        )}
        {selProd ? (
          <button onClick={onPush} disabled={pushing || pushed}
            className="w-full py-2 rounded-lg text-[12px] font-bold transition"
            style={{ background: pushed ? '#EAF3DE' : 'var(--accent,#3fb950)', color: pushed ? '#27500A' : '#fff', opacity: pushing ? 0.6 : 1 }}>
            {pushing ? 'Saving…' : pushed ? '✓ Saved to database' : '↑ Push pricing to catalogue'}
          </button>
        ) : (
          <div className="space-y-2">
            <CopyValuesButton calc={calc} f={f} />
            {onSaveAsProduct && (
              <button onClick={onSaveAsProduct}
                className="w-full py-2 rounded-lg text-[12px] font-bold transition flex items-center justify-center gap-1.5"
                style={{ background: 'rgba(63,185,80,0.1)', color: 'var(--accent,#3fb950)', border: '1px solid rgba(63,185,80,0.3)' }}>
                📦 Save as Product →
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function CopyValuesButton({ calc, f }) {
  function copy() {
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
    <button onClick={copy}
      className="w-full py-2 rounded-lg text-[12px] font-bold border transition"
      style={{ borderColor: 'var(--bd,#30363d)', color: 'var(--tx2,#8b949e)', background: 'var(--bg,#0d1117)' }}>
      Copy values
    </button>
  );
}

// ═══════════════════════════════════════════════════════════════
// STAGE ACCORDION — 6 stages, colour-coded
// ═══════════════════════════════════════════════════════════════
export function StageAccordion({ f, setField, fieldErrors, calc, open, tog }) {
  const stageConfig = [
    {
      fields: [
        { key: 'purchase',   label: 'Purchase price',   hint: 'Supplier se ek unit ka cost', unit: '₹/unit' },
        { key: 'gst_in',     label: 'Input GST %',      hint: 'GST slab on supplier bill. Amount = purchase × %', unit: '%',
          formula: () => `= ₹${ri(f.purchase * f.gst_in / 100)} (${f.gst_in}%)`, isSelect: true, opts: GST_RATES },
        { key: 'inbound',    label: 'Inbound shipping', hint: 'Supplier → warehouse transport per unit', unit: '₹/unit' },
        { key: 'handling',   label: 'Handling',         hint: 'Loading, sorting, misc labour', unit: '₹/unit' },
        { key: 'damage_pct', label: 'Transit damage %', hint: f.gst_registered
            ? 'GST-registered: damage on purchase price only (input GST is ITC-reclaimable). Applied on purchase.'
            : 'Avg breakage 1–3%. Unregistered: applied on (purchase + input GST). Toggle GST registration below to change.',
          unit: '%',
          formula: () => `= ₹${ri(calc.dmg_amt)} (on ${f.gst_registered ? 'purchase only' : 'purchase + GST'})` },
        {
          key: '_gst_registered', label: 'GST registered?', isGstToggle: true,
          hint: 'Registered sellers: input GST is ITC (recovered), logistics GST is ITC. Lowers effective cost.',
        },
      ],
      summaryLabel: 'Landed cost',
      summaryFormula: `purchase ₹${ri(f.purchase)} + GST ₹${calc.gst_amt.toFixed(2)} + inbound ₹${ri(f.inbound)} + handling ₹${ri(f.handling)} + damage ₹${calc.dmg_amt.toFixed(2)} = ₹${calc.landed.toFixed(2)} ≈ ₹${ri(calc.landed)}`,
      summaryVal: () => calc.landed,
    },
    {
      fields: [
        { key: 'packaging', label: 'Packaging material', hint: 'Box, bubble wrap, tape, label, dunnage per unit', unit: '₹/unit' },
        { key: 'labor',     label: 'Packing labour',     hint: 'Monthly staff cost ÷ units packed per month', unit: '₹/unit' },
        { key: 'warehouse', label: 'Warehouse rent',     hint: 'Monthly rent ÷ units stored per month', unit: '₹/unit' },
        { key: 'inventory', label: 'Inventory holding',  hint: 'Opportunity cost of capital locked in stock', unit: '₹/unit' },
      ],
      summaryLabel: 'After packaging',
      summaryFormula: 'landed + packaging + labour + warehouse + inventory',
      summaryVal: () => calc.after_pkg,
    },
    {
      fields: [
        { key: 'shipping',  label: 'Forward shipping',
          hint: 'Pahadi default ₹110 (hill-state origin surcharge). Shiprocket/Delhivery zone B/C: ₹90–150.',
          unit: '₹/order' },
        { key: '_cod',      label: 'COD charge & mix',   isCodCombined: true },
        { key: 'pg',        label: 'Payment gateway',    hint: 'Razorpay / PayU — quoted rates include 18% GST. Do not apply logistics GST again on PG.', unit: '₹/order' },
        { key: 'gst_log',   label: 'GST on courier',     hint: '18% GST on courier services (forward shipping + COD charge). PG is excluded — PG already quotes GST-inclusive rates.', unit: '%',
          formula: () => {
            const gstExact = calc.gst_on_courier;
            const gstDisplay = gstExact % 1 === 0 ? gstExact : gstExact.toFixed(2);
            const baseDisplay = ri(Number(f.shipping) + calc.blended_cod);
            return `Courier GST = ₹${gstDisplay} on ₹${baseDisplay} courier base${f.gst_registered ? ' (ITC: ₹0 net cost)' : ''}`;
          } },
      ],
      summaryLabel: 'After logistics',
      summaryFormula: `shipping ₹${ri(f.shipping)} + COD ₹${(f.cod_charge * f.cod_pct / 100).toFixed(2)} + PG ₹${ri(f.pg)} + GST ₹${(calc.gst_on_courier).toFixed(2)} = ₹${(Number(f.shipping) + f.cod_charge*f.cod_pct/100 + Number(f.pg) + calc.gst_on_courier).toFixed(2)} ≈ ₹${ri(calc.after_log) - ri(calc.after_pkg)} added`,
      summaryVal: () => calc.after_log,
    },
    {
      fields: [
        { key: 'return_rate', label: 'Return rate %',
          hint: 'Pahadi default 12%. D2C avg 5–15%. Hill-state products: higher due to remote last-mile failures.', unit: '%' },
        { key: 'return_cost', label: 'Cost per return',
          hint: 'Pahadi default ₹180: reverse logistics from anywhere in India → hill-state warehouse (₹150–250) + repackaging.',
          unit: '₹/return',
          formula: () => `impact per order = ₹${ri(calc.ret_impact)}` },
      ],
      summaryLabel: 'After returns',
      summaryFormula: `return cost ₹${ri(f.return_cost)} × ${f.return_rate}% = ₹${calc.ret_impact.toFixed(2)} ≈ +₹${ri(calc.after_ret) - ri(calc.after_log)} added`,
      summaryVal: () => calc.after_ret,
    },
    {
      fields: [
        { key: 'platform_pct', label: 'Platform fee %',
          hint: 'Marketplace commission 5–25%. Charged on selling price (exact algebraic formula — no approximation). 0% for own website.',
          unit: '%',
          formula: () => `= ₹${ri(calc.platform_amt)} (on ₹${ri(calc.sp)} SP — exact closed-form)` },
        { key: 'marketing',    label: 'Marketing / CAC', hint: 'Ads spend ÷ orders = customer acquisition cost per order', unit: '₹/order' },
        { key: 'ops',          label: 'Ops & support',   hint: 'Team, tools, tech cost ÷ monthly orders', unit: '₹/order' },
        { key: 'extra',        label: 'Hidden / extra',  hint: 'Discounts, COD failures, chargebacks — 10–15% buffer recommended', unit: '₹/order' },
      ],
      summaryLabel: 'Total real cost',
      summaryFormula: 'after returns + platform + marketing + ops + extra',
      summaryVal: () => calc.total,
    },
    {
      fields: [
        { key: '_profit_mode', label: 'Profit mode', isCustom: true },
        { key: 'gst_out',  label: 'Output GST %',          hint: 'GST charged to customer (depends on product category)', unit: '%',
          isSelect: true, opts: GST_RATES,
          formula: () => `Base ₹${ri(calc.base_excl_gst)} × ${f.gst_out}% = ₹${ri(calc.gst_total)} → Selling ₹${ri(calc.sp)}` },
        { key: 'mrp_mult', label: 'MRP multiplier',
          hint: '1.6× = 37% off (low impact). 2.0× = 50% off (standard). 2.5× = 60% off (strong signal). Range: 1.0–8.0.',
          unit: '× SP', step: 0.05,
          formula: () => {
            const m = calc.mrp_mult;
            const disc = ri((1 - 1/m)*100);
            const signal = disc < 40 ? '⚠ low impact' : disc >= 55 ? '✓ strong signal' : '✓ good signal';
            return `₹${ri(calc.sp)} × ${m.toFixed(2)} = MRP ₹${ri(calc.mrp)}  (${disc}% off — ${signal})`;
          }},
        { key: 'market_price', label: 'Competitor actual selling price',
          hint: 'Enter competitor\'s ACTUAL SELLING PRICE (not their MRP). Compares apples-to-apples with your SP. 0 = skip.',
          unit: '₹ (optional)',
          formula: () => calc.market_price_gap !== null
            ? calc.market_price_gap >= 0
              ? `✓ You're ₹${ri(calc.market_price_gap)} cheaper (SP vs SP)`
              : `⚠ You're ₹${ri(Math.abs(calc.market_price_gap))} more expensive (SP vs SP)`
            : null },
      ],
      summaryLabel: 'Selling price (incl GST)',
      summaryFormula: '(total cost + profit) ÷ (1 − platform%) × (1 + output GST%)',
      summaryVal: () => calc.sp,
    },
  ];

  // Derive each stage's displayed delta as ri(this_cumulative) - ri(prev_cumulative).
  // This guarantees: displayed_prev + displayed_delta === displayed_total, always.
  // Using ri(s3_add) independently can differ by ±1 due to accumulated fractional rounding.
  const stageAdd = [
    { val: () => ri(calc.landed),                                      isTotal: true,  sub2: 'landed cost' },
    { val: () => ri(calc.after_pkg) - ri(calc.landed),                 isTotal: false, sub2: () => `→ ₹${fmtN(calc.after_pkg)} total` },
    { val: () => ri(calc.after_log) - ri(calc.after_pkg),              isTotal: false, sub2: () => `→ ₹${fmtN(calc.after_log)} total` },
    { val: () => ri(calc.after_ret) - ri(calc.after_log),              isTotal: false, sub2: () => `→ ₹${fmtN(calc.after_ret)} total` },
    { val: () => ri(calc.total)     - ri(calc.after_ret),              isTotal: false, sub2: () => `→ ₹${fmtN(calc.total)} total` },
    { val: () => ri(calc.sp),                                          isTotal: true,  sub2: 'selling price' },
  ];

  return (
    <div className="space-y-2">
      {STAGE_META.map(({ num, label, sub, color, tint, badge, badgeText }, idx) => {
        const isOpen = open[num];
        const cfg    = stageConfig[idx];
        const sh     = stageAdd[idx];

        return (
          <div key={num} className="rounded-xl overflow-hidden transition-all"
            style={{
              border: `1px solid ${isOpen ? color : 'var(--bd,#30363d)'}`,
              background: isOpen ? tint : 'var(--bg2,#161b22)',
            }}>

            <button onClick={() => tog(num)}
              className="w-full flex items-center gap-3 px-4 py-3 text-left"
              style={{ borderLeft: `3px solid ${color}` }}>
              <span className="w-6 h-6 rounded-full text-[11px] font-bold flex items-center justify-center flex-none"
                style={{ background: badge, color: badgeText }}>{num}</span>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-semibold" style={{ color: 'var(--tx,#e6edf3)' }}>{label}</div>
                <div className="text-[11px]" style={{ color: 'var(--tx2,#8b949e)' }}>{sub}</div>
              </div>
              <div className="text-right flex-none">
                <div className="text-[14px] font-bold" style={{ color: sh.isTotal ? color : 'var(--tx,#e6edf3)' }}>
                  {sh.isTotal ? fmtR(sh.val()) : `+${fmtR(sh.val())}`}
                </div>
                <div className="text-[10px]" style={{ color: 'var(--tx2,#8b949e)' }}>
                  {typeof sh.sub2 === 'function' ? sh.sub2() : sh.sub2}
                </div>
              </div>
              <span style={{ color, fontSize: 10, transform: isOpen ? 'rotate(180deg)' : 'none', display: 'inline-block', transition: 'transform .2s', marginLeft: 4, opacity: 0.8 }}>▼</span>
            </button>

            {isOpen && (
              <div style={{ borderTop: `1px solid ${color}30` }}>
                {cfg.fields.map(field => {
                  // Custom: profit mode toggle
                  if (field.isCustom && field.key === '_profit_mode') {
                    return (
                      <div key="_profit_mode" className="px-4 py-3 border-b"
                        style={{ borderColor: `${color}25`, background: 'var(--bg2,#161b22)' }}>
                        <div className="text-[12px] font-semibold mb-1" style={{ color: 'var(--tx,#e6edf3)' }}>Profit mode</div>
                        <div className="text-[11px] mb-3" style={{ color: 'var(--tx2,#8b949e)' }}>
                          Flat ₹ = fixed profit per order. Target % = set a gross margin goal — SP is solved with exact formula.
                        </div>
                        <div className="flex gap-2 mb-3">
                          {[['flat','Flat ₹ profit'],['margin','Target % margin']].map(([v,lbl]) => (
                            <button key={v} onClick={() => setField('profit_mode', v)}
                              className="px-3 py-1.5 rounded-lg text-[11px] font-semibold transition"
                              style={{
                                background: f.profit_mode === v ? color : 'var(--bg,#0d1117)',
                                color: f.profit_mode === v ? '#fff' : 'var(--tx2,#8b949e)',
                                border: `1px solid ${f.profit_mode === v ? color : 'var(--bd,#30363d)'}`,
                              }}>
                              {lbl}
                            </button>
                          ))}
                        </div>
                        {f.profit_mode === 'flat' ? (
                          <FieldRow fieldKey="profit" label="Target profit / order"
                            hint="Per order profit target. ₹80–150 healthy for Pahadi D2C."
                            unit="₹/order" value={f.profit} step={5}
                            formula={`profit / order = ₹${ri(calc.profit_val)}`}
                            error={fieldErrors?.profit}
                            onChange={v => setField('profit', v)} color={color} />
                        ) : (
                          <FieldRow fieldKey="target_margin" label="Target gross margin %"
                            hint="% of selling price as profit. 25–35% is healthy Pahadi D2C. SP is solved exactly."
                            unit="%" value={f.target_margin} step={1} min={1} max={90}
                            formula={`actual margin = ${ri(calc.margin_pct)}%  →  ₹${ri(calc.profit_val)}/order`}
                            error={fieldErrors?.target_margin}
                            onChange={v => setField('target_margin', v)} color={color} isPct />
                        )}
                      </div>
                    );
                  }

                  // Custom: COD combined row
                  if (field.isCodCombined) {
                    const blended_exact = f.cod_charge * f.cod_pct / 100;
                    const blended = blended_exact % 1 === 0 ? blended_exact : blended_exact.toFixed(2);
                    return (
                      <div key="_cod" className="px-4 py-3 border-b"
                        style={{ borderColor: `${color}25`, background: 'var(--bg2,#161b22)' }}>
                        <div className="flex items-center gap-2 mb-1.5">
                          <div className="text-[12px] font-semibold" style={{ color: 'var(--tx,#e6edf3)' }}>COD charge & mix</div>
                          <div className="text-[10px] px-1.5 py-0.5 rounded font-mono"
                            style={{ background: 'var(--bg,#0d1117)', color: 'var(--yellow)' }}>
                            blended = ₹{blended}/order
                          </div>
                        </div>
                        <div className="text-[11px] mb-3" style={{ color: 'var(--tx2,#8b949e)' }}>
                          COD charge × COD % of orders = blended cost per order. Pahadi default: 65% COD mix, ₹40/order charge.
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          {[
                            { k: 'cod_charge', lbl: 'COD charge', s: 'Shiprocket ₹30–55, Delhivery ₹35–50. Pahadi default ₹40.', u: '₹/order' },
                            { k: 'cod_pct',    lbl: 'COD order mix', s: '% of total orders via COD. Pahadi D2C avg 65–70%.', u: '%' },
                          ].map(({ k, lbl, s, u }) => (
                            <div key={k} className="rounded-lg p-2.5"
                              style={{ background: 'var(--bg,#0d1117)', border: `1px solid ${fieldErrors?.[k] ? '#E24B4A' : 'var(--bd,#30363d)'}` }}>
                              <div className="text-[10px] font-semibold mb-0.5" style={{ color: 'var(--tx2,#8b949e)' }}>
                                {lbl} <span style={{ fontWeight: 400 }}>{u}</span>
                              </div>
                              <div className="text-[10px] mb-2" style={{ color: 'var(--tx2,#8b949e)' }}>{s}</div>
                              <input type="number" value={f[k]} step={1}
                                onChange={e => setField(k, e.target.value)}
                                className="w-full px-2 py-1.5 rounded text-[13px] font-bold border text-right"
                                style={{ background: 'var(--bg2,#161b22)', borderColor: fieldErrors?.[k] ? '#E24B4A' : 'var(--bd,#30363d)', color: 'var(--tx,#e6edf3)' }} />
                              {fieldErrors?.[k] && (
                                <div className="text-[10px] mt-1" style={{ color: '#E24B4A' }}>{fieldErrors[k]}</div>
                              )}
                            </div>
                          ))}
                        </div>
                        <div className="flex items-center gap-2 mt-2 text-[11px]" style={{ color: 'var(--tx2,#8b949e)' }}>
                          <span>₹{f.cod_charge}</span><span>×</span><span>{f.cod_pct}%</span><span>→</span>
                          <span className="font-bold px-1.5 py-0.5 rounded"
                            style={{ background: 'color-mix(in srgb,#d29922 15%,var(--bg,#0d1117))', color: 'var(--yellow)' }}>
                            ₹{blended} blended/order
                          </span>
                        </div>
                      </div>
                    );
                  }

                  // Custom: GST registration toggle
                  if (field.isGstToggle) {
                    return (
                      <div key="_gst_registered" className="px-4 py-3 border-b flex items-start gap-4"
                        style={{ borderColor: `${color}25`, background: 'var(--bg2,#161b22)' }}>
                        <div className="flex-1">
                          <div className="text-[12px] font-semibold" style={{ color: 'var(--tx,#e6edf3)' }}>GST registered?</div>
                          <div className="text-[11px] mt-0.5 leading-relaxed" style={{ color: 'var(--tx2,#8b949e)' }}>
                            Registered sellers claim ITC: logistics GST (₹{ri(calc.gst_on_courier)}/order) + input GST on damage are recovered. Reduces effective cost.
                          </div>
                        </div>
                        <button onClick={() => setField('gst_registered', !f.gst_registered)}
                          className="flex-none px-3 py-1.5 rounded-lg text-[11px] font-bold transition"
                          style={{
                            background: f.gst_registered ? '#E1F5EE' : 'var(--bg,#0d1117)',
                            color: f.gst_registered ? '#0F6E56' : 'var(--tx2,#8b949e)',
                            border: `1px solid ${f.gst_registered ? '#1D9E75' : 'var(--bd,#30363d)'}`,
                          }}>
                          {f.gst_registered ? '✓ Yes — ITC active' : 'No — not registered'}
                        </button>
                      </div>
                    );
                  }

                  // Standard field
                  const isPct    = field.unit === '%';
                  const formula  = typeof field.formula === 'function' ? field.formula() : null;
                  const errMsg   = fieldErrors?.[field.key];
                  return (
                    <div key={field.key} className="grid items-start gap-4 px-4 py-3 border-b"
                      style={{ gridTemplateColumns: '1fr 130px', borderColor: `${color}25`, background: 'var(--bg2,#161b22)' }}>
                      <div>
                        <div className="text-[12px] font-semibold" style={{ color: 'var(--tx,#e6edf3)' }}>{field.label}</div>
                        <div className="text-[11px] mt-0.5 leading-relaxed" style={{ color: 'var(--tx2,#8b949e)' }}>{field.hint}</div>
                        {formula && !isPct && (
                          <div className="mt-1.5 inline-block text-[10px] px-1.5 py-0.5 rounded font-mono"
                            style={{ background: 'var(--bg,#0d1117)', color: 'var(--yellow)' }}>
                            {formula}
                          </div>
                        )}
                        {errMsg && (
                          <div className="mt-1 text-[10px] font-semibold" style={{ color: '#E24B4A' }}>{errMsg}</div>
                        )}
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        {isPct ? (
                          <>
                            <div className="flex items-center gap-1.5">
                              {field.isSelect ? (
                                <select value={f[field.key]} onChange={e => setField(field.key, e.target.value)}
                                  className="w-[80px] px-2 py-1.5 rounded-lg text-[12px] border text-right"
                                  style={{ background: 'var(--bg,#0d1117)', borderColor: errMsg ? '#E24B4A' : 'var(--bd,#30363d)', color: 'var(--tx,#e6edf3)' }}>
                                  {field.opts.map(o => <option key={o} value={o}>{o}%</option>)}
                                </select>
                              ) : (
                                <input type="number" value={f[field.key]} step={field.step || 1}
                                  onChange={e => setField(field.key, e.target.value)}
                                  className="w-[80px] px-2 py-1.5 rounded-lg text-[12px] border text-right"
                                  style={{ background: 'var(--bg,#0d1117)', borderColor: errMsg ? '#E24B4A' : 'var(--bd,#30363d)', color: 'var(--tx,#e6edf3)' }} />
                              )}
                              <span className="text-[11px] font-semibold" style={{ color: 'var(--tx2,#8b949e)' }}>%</span>
                            </div>
                            {formula && (
                              <div className="text-right text-[10px] px-1.5 py-0.5 rounded font-mono"
                                style={{ background: 'var(--bg,#0d1117)', color: 'var(--yellow)' }}>{formula}</div>
                            )}
                          </>
                        ) : (
                          <>
                            {field.isSelect ? (
                              <select value={f[field.key]} onChange={e => setField(field.key, e.target.value)}
                                className="w-full px-2 py-1.5 rounded-lg text-[12px] border text-right"
                                style={{ background: 'var(--bg,#0d1117)', borderColor: errMsg ? '#E24B4A' : 'var(--bd,#30363d)', color: 'var(--tx,#e6edf3)' }}>
                                {field.opts.map(o => <option key={o} value={o}>{o}%</option>)}
                              </select>
                            ) : (
                              <input type="number" value={f[field.key]} step={field.step || 1}
                                onChange={e => setField(field.key, e.target.value)}
                                className="w-full px-2 py-1.5 rounded-lg text-[12px] border text-right"
                                style={{ background: 'var(--bg,#0d1117)', borderColor: errMsg ? '#E24B4A' : 'var(--bd,#30363d)', color: 'var(--tx,#e6edf3)' }} />
                            )}
                            <div className="text-[10px] text-right" style={{ color: 'var(--tx2,#8b949e)' }}>{field.unit}</div>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}

                {/* Stage summary bar */}
                <div className="flex items-center justify-between px-4 py-3"
                  style={{ background: `${color}14`, borderTop: `1px solid ${color}30` }}>
                  <div>
                    <div className="text-[12px] font-bold" style={{ color: 'var(--tx,#e6edf3)' }}>{cfg.summaryLabel}</div>
                    <div className="text-[10px] font-mono mt-0.5" style={{ color: 'var(--tx2,#8b949e)' }}>{cfg.summaryFormula}</div>
                  </div>
                  <div className="text-[16px] font-bold" style={{ color }}>{fmtR(cfg.summaryVal())}</div>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Reusable field row for custom sections ────────────────────
function FieldRow({ fieldKey, label, hint, unit, value, step, min, max, formula, error, onChange, color, isPct }) {
  return (
    <div className="grid items-start gap-4" style={{ gridTemplateColumns: '1fr 130px' }}>
      <div>
        <div className="text-[12px] font-semibold" style={{ color: 'var(--tx,#e6edf3)' }}>{label}</div>
        <div className="text-[11px] mt-0.5" style={{ color: 'var(--tx2,#8b949e)' }}>{hint}</div>
        {formula && (
          <div className="mt-1.5 inline-block text-[10px] px-1.5 py-0.5 rounded font-mono"
            style={{ background: 'var(--bg,#0d1117)', color: 'var(--yellow)' }}>
            {formula}
          </div>
        )}
        {error && <div className="mt-1 text-[10px] font-semibold" style={{ color: '#E24B4A' }}>{error}</div>}
      </div>
      <div className="flex flex-col items-end gap-1">
        <div className="flex items-center gap-1.5">
          <input type="number" value={value} step={step || 1} min={min} max={max}
            onChange={e => onChange(e.target.value)}
            className={`${isPct ? 'w-[80px]' : 'w-full'} px-2 py-1.5 rounded-lg text-[12px] border text-right`}
            style={{ background: 'var(--bg,#0d1117)', borderColor: error ? '#E24B4A' : 'var(--bd,#30363d)', color: 'var(--tx,#e6edf3)' }} />
          {isPct && <span className="text-[11px] font-semibold" style={{ color: 'var(--tx2,#8b949e)' }}>%</span>}
        </div>
        {!isPct && <div className="text-[10px] text-right" style={{ color: 'var(--tx2,#8b949e)' }}>{unit}</div>}
      </div>
    </div>
  );
}
