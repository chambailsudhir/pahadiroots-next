'use client';
import { GST_RATES, STAGE_META, ri, fmtN, fmtR, r } from '@/lib/pricingCalc';
import { api } from '@/lib/api';

// ═══════════════════════════════════════════════════════════════
// RESULTS PANEL — sticky right column
// ═══════════════════════════════════════════════════════════════
export function ResultsPanel({ f, calc, selProd, onPush, pushing, pushed, pushErr, onCopy }) {
  const marginColor = calc.margin_pct > 25 ? '#27500A' : calc.margin_pct > 15 ? '#C8820A' : '#A32D2D';
  const marginBg    = calc.margin_pct > 25 ? '#EAF3DE' : calc.margin_pct > 15 ? '#FAEEDA' : '#FCEBEB';

  const wfSteps = [
    { label: 'Purchase price',             total: Number(f.purchase) || 0, col: '#378ADD' },
    { label: '+ GST/inbound/handling/dmg', total: calc.landed,             col: '#378ADD' },
    { label: '+ Packaging & storage',      total: calc.after_pkg,          col: '#C8820A' },
    { label: '+ Logistics (inc. GST)',      total: calc.after_log,          col: '#1D9E75' },
    { label: '+ Return impact',            total: calc.after_ret,          col: '#E24B4A' },
    { label: '+ Platform/mktg/ops',        total: calc.total,              col: '#7F77DD' },
    { label: '+ Profit target',            total: calc.base_excl_gst,      col: '#639922' },
    { label: '+ Output GST',               total: calc.sp,                 col: '#888780' },
  ];

  return (
    <div className="rounded-xl border overflow-hidden sticky top-4"
      style={{ background: 'var(--bg2,#161b22)', borderColor: 'var(--bd,#30363d)' }}>

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
            {calc.margin_pct > 25 ? '✓ Healthy margin' : calc.margin_pct > 15 ? '⚠ Tight — consider raising price' : '✗ Below minimum — review costs'}
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
          { label: 'Profit / order',  val: calc.profit_val, col: '#27500A' },
        ].map((s, i) => (
          <div key={i} className="px-3 py-2.5"
            style={{
              borderRight: i % 2 === 0 ? '1px solid var(--bd,#30363d)' : 'none',
              borderBottom: i < 4 ? '1px solid var(--bd,#30363d)' : 'none',
            }}>
            <div className="text-[10px]" style={{ color: 'var(--tx2,#8b949e)' }}>{s.label}</div>
            <div className="text-[13px] font-bold mt-0.5" style={{ color: s.col || 'var(--tx,#e6edf3)' }}>{fmtR(s.val)}</div>
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
          <span className="font-bold" style={{ color: '#d29922' }}>= {fmtR(calc.gst_total)}</span>
          <span style={{ color: 'var(--tx2,#8b949e)' }}>=</span>
          <span className="font-bold" style={{ color: 'var(--accent,#3fb950)' }}>{fmtR(calc.sp)}</span>
        </div>
        <div className="flex gap-4 mt-1 text-[11px]" style={{ color: 'var(--tx2,#8b949e)' }}>
          <span>CGST: <b style={{ color: 'var(--tx,#e6edf3)' }}>{fmtR(calc.cgst)}</b></span>
          <span>SGST: <b style={{ color: 'var(--tx,#e6edf3)' }}>{fmtR(calc.sgst)}</b></span>
        </div>
      </div>

      {/* Waterfall */}
      <div className="px-4 py-3 border-b" style={{ borderColor: 'var(--bd,#30363d)' }}>
        <div className="text-[10px] font-bold tracking-widest uppercase mb-3" style={{ color: 'var(--tx2,#8b949e)' }}>Cost waterfall</div>
        <div className="space-y-1.5">
          {wfSteps.map((s, i) => {
            const w = calc.sp > 0 ? Math.max(3, ri(s.total / calc.sp * 100)) : 0;
            return (
              <div key={i} className="flex items-center gap-2 text-[11px]">
                <div className="w-2 h-2 rounded-full flex-none" style={{ background: s.col }} />
                <div className="flex-1 truncate" style={{ color: 'var(--tx2,#8b949e)' }}>{s.label}</div>
                <div className="w-20 h-1.5 rounded-full overflow-hidden flex-none" style={{ background: 'var(--bd,#30363d)' }}>
                  <div className="h-full rounded-full" style={{ width: `${w}%`, background: s.col }} />
                </div>
                <div className="w-14 text-right font-bold flex-none" style={{ color: 'var(--tx,#e6edf3)' }}>{fmtR(s.total)}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Push panel */}
      <div className="p-4">
        <div className="text-[10px] font-bold tracking-widest uppercase mb-3" style={{ color: 'var(--tx2,#8b949e)' }}>
          {selProd ? `Push to: ${selProd.emoji || '📦'} ${selProd.name}` : 'Push to catalogue'}
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
          <button onClick={onCopy}
            className="w-full py-2 rounded-lg text-[12px] font-bold border transition"
            style={{ borderColor: 'var(--bd,#30363d)', color: 'var(--tx2,#8b949e)', background: 'var(--bg,#0d1117)' }}>
            Copy values
          </button>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// STAGE ACCORDION — 6 stages, colour-coded
// ═══════════════════════════════════════════════════════════════
export function StageAccordion({ f, setField, calc, open, tog }) {
  const stageConfig = [
    {
      fields: [
        { key: 'purchase',   label: 'Purchase price',   hint: 'Supplier se ek unit ka cost', unit: '₹/unit' },
        { key: 'gst_in',     label: 'Input GST %',      hint: 'GST slab on supplier bill. Amount = purchase × %', unit: '%',
          formula: () => `= ₹${ri(f.purchase * f.gst_in / 100)} (${f.gst_in}%)`, isSelect: true, opts: GST_RATES },
        { key: 'inbound',    label: 'Inbound shipping', hint: 'Supplier → warehouse transport per unit', unit: '₹/unit' },
        { key: 'handling',   label: 'Handling',         hint: 'Loading, sorting, misc labour', unit: '₹/unit' },
        { key: 'damage_pct', label: 'Transit damage %', hint: 'Avg breakage 1–3%. Applied on (purchase + input GST)', unit: '%',
          formula: () => `= ₹${ri((f.purchase + f.purchase * f.gst_in / 100) * f.damage_pct / 100)}` },
      ],
      summaryLabel: 'Landed cost',
      summaryFormula: 'purchase + input GST + inbound + handling + transit damage',
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
        { key: 'shipping',  label: 'Forward shipping',   hint: 'Courier charge per order (Shiprocket / Delhivery)', unit: '₹/order' },
        { key: '_cod',      label: 'COD charge & mix',   isCodCombined: true },
        { key: 'pg',        label: 'Payment gateway',    hint: 'Razorpay / PayU fee on prepaid orders (₹5–10)', unit: '₹/order' },
        { key: 'gst_log',   label: 'GST on logistics',   hint: '18% GST on all courier services — auto-calculated', unit: '%',
          formula: () => `GST = ₹${ri((f.shipping + f.cod_charge * f.cod_pct / 100 + f.pg) * f.gst_log / 100)}  on ₹${ri(f.shipping + f.cod_charge * f.cod_pct / 100 + f.pg)} base` },
      ],
      summaryLabel: 'After logistics',
      summaryFormula: '(shipping + blended COD + PG) × (1 + GST 18%)',
      summaryVal: () => calc.after_log,
    },
    {
      fields: [
        { key: 'return_rate', label: 'Return rate %',   hint: 'D2C avg 5–15%. % of orders that come back.', unit: '%' },
        { key: 'return_cost', label: 'Cost per return', hint: 'Reverse shipping + repackaging + damage (₹80–150)', unit: '₹/return',
          formula: () => `impact per order = ₹${ri(calc.ret_impact)}` },
      ],
      summaryLabel: 'After returns',
      summaryFormula: 'after logistics + (return cost × return rate %)',
      summaryVal: () => calc.after_ret,
    },
    {
      fields: [
        { key: 'platform_pct', label: 'Platform fee %',  hint: 'Marketplace commission 5–25%. Applied on after-logistics cost.', unit: '%',
          formula: () => `= ₹${ri(calc.platform_amt)}  (on ₹${ri(calc.after_log)} base)` },
        { key: 'marketing',    label: 'Marketing / CAC', hint: 'Ads spend ÷ orders = customer acquisition cost per order', unit: '₹/order' },
        { key: 'ops',          label: 'Ops & support',   hint: 'Team, tools, tech cost ÷ monthly orders', unit: '₹/order' },
        { key: 'extra',        label: 'Hidden / extra',  hint: 'Discounts, COD failures, chargebacks buffer 10–15%', unit: '₹/order' },
      ],
      summaryLabel: 'Total real cost',
      summaryFormula: 'after returns + platform + marketing + ops + extra',
      summaryVal: () => calc.total,
    },
    {
      fields: [
        { key: 'profit',   label: 'Target profit / order', hint: 'Per order profit target. ₹80–150 healthy for D2C.', unit: '₹/order' },
        { key: 'gst_out',  label: 'Output GST %',          hint: 'GST charged to customer (depends on product category)', unit: '%',
          isSelect: true, opts: GST_RATES,
          formula: () => `Base ₹${ri(calc.base_excl_gst)} × ${f.gst_out}% = ₹${ri(calc.gst_total)} → Selling ₹${ri(calc.sp)}` },
        { key: 'mrp_mult', label: 'MRP multiplier',        hint: '1.6× = 37% off shown. 2× = 50% off.', unit: '× SP', step: 0.05,
          formula: () => `₹${ri(calc.sp)} × ${Number(f.mrp_mult).toFixed(2)} = MRP ₹${ri(calc.mrp)}  (${ri((1 - 1 / (Number(f.mrp_mult) || 1)) * 100)}% off shown)` },
      ],
      summaryLabel: 'Selling price (incl GST)',
      summaryFormula: '(total cost + profit) × (1 + output GST%)',
      summaryVal: () => calc.sp,
    },
  ];

  const stageAdd = [
    { val: () => calc.landed,     isTotal: true,  sub2: 'landed cost' },
    { val: () => calc.s2_add,     isTotal: false, sub2: () => `→ ₹${fmtN(calc.after_pkg)} total` },
    { val: () => calc.s3_add,     isTotal: false, sub2: () => `→ ₹${fmtN(calc.after_log)} total` },
    { val: () => calc.ret_impact, isTotal: false, sub2: () => `→ ₹${fmtN(calc.after_ret)} total` },
    { val: () => calc.s5_add,     isTotal: false, sub2: () => `→ ₹${fmtN(calc.total)} total` },
    { val: () => calc.sp,         isTotal: true,  sub2: 'selling price' },
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
                  if (field.isCodCombined) {
                    const blended = ri(f.cod_charge * f.cod_pct / 100);
                    return (
                      <div key="_cod" className="px-4 py-3 border-b"
                        style={{ borderColor: `${color}25`, background: 'var(--bg2,#161b22)' }}>
                        <div className="flex items-center gap-2 mb-1.5">
                          <div className="text-[12px] font-semibold" style={{ color: 'var(--tx,#e6edf3)' }}>COD charge & mix</div>
                          <div className="text-[10px] px-1.5 py-0.5 rounded font-mono"
                            style={{ background: 'var(--bg,#0d1117)', color: '#d29922' }}>
                            blended = ₹{blended}/order
                          </div>
                        </div>
                        <div className="text-[11px] mb-3" style={{ color: 'var(--tx2,#8b949e)' }}>
                          COD charge × COD % of orders = blended cost per order. India D2C avg 60–70% COD.
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          {[
                            { k: 'cod_charge', lbl: 'COD charge', s: 'Fee on COD orders (₹15–30)', u: '₹/order' },
                            { k: 'cod_pct',    lbl: 'COD order mix', s: '% of total orders via COD', u: '%' },
                          ].map(({ k, lbl, s, u }) => (
                            <div key={k} className="rounded-lg p-2.5"
                              style={{ background: 'var(--bg,#0d1117)', border: '1px solid var(--bd,#30363d)' }}>
                              <div className="text-[10px] font-semibold mb-0.5" style={{ color: 'var(--tx2,#8b949e)' }}>
                                {lbl} <span style={{ fontWeight: 400 }}>{u}</span>
                              </div>
                              <div className="text-[10px] mb-2" style={{ color: 'var(--tx2,#8b949e)' }}>{s}</div>
                              <input type="number" value={f[k]} step={1}
                                onChange={e => setField(k, e.target.value)}
                                className="w-full px-2 py-1.5 rounded text-[13px] font-bold border text-right"
                                style={{ background: 'var(--bg2,#161b22)', borderColor: 'var(--bd,#30363d)', color: 'var(--tx,#e6edf3)' }} />
                            </div>
                          ))}
                        </div>
                        <div className="flex items-center gap-2 mt-2 text-[11px]" style={{ color: 'var(--tx2,#8b949e)' }}>
                          <span>₹{f.cod_charge}</span><span>×</span><span>{f.cod_pct}%</span><span>→</span>
                          <span className="font-bold px-1.5 py-0.5 rounded"
                            style={{ background: 'color-mix(in srgb,#d29922 15%,var(--bg,#0d1117))', color: '#d29922' }}>
                            ₹{blended} blended/order
                          </span>
                        </div>
                      </div>
                    );
                  }

                  const isPct = field.unit === '%';
                  const formula = typeof field.formula === 'function' ? field.formula() : null;
                  return (
                    <div key={field.key} className="grid items-start gap-4 px-4 py-3 border-b"
                      style={{ gridTemplateColumns: '1fr 130px', borderColor: `${color}25`, background: 'var(--bg2,#161b22)' }}>
                      <div>
                        <div className="text-[12px] font-semibold" style={{ color: 'var(--tx,#e6edf3)' }}>{field.label}</div>
                        <div className="text-[11px] mt-0.5 leading-relaxed" style={{ color: 'var(--tx2,#8b949e)' }}>{field.hint}</div>
                        {formula && !isPct && (
                          <div className="mt-1.5 inline-block text-[10px] px-1.5 py-0.5 rounded font-mono"
                            style={{ background: 'var(--bg,#0d1117)', color: '#d29922' }}>
                            {formula}
                          </div>
                        )}
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        {isPct ? (
                          <>
                            <div className="flex items-center gap-1.5">
                              {field.isSelect ? (
                                <select value={f[field.key]} onChange={e => setField(field.key, e.target.value)}
                                  className="w-[80px] px-2 py-1.5 rounded-lg text-[12px] border text-right"
                                  style={{ background: 'var(--bg,#0d1117)', borderColor: 'var(--bd,#30363d)', color: 'var(--tx,#e6edf3)' }}>
                                  {field.opts.map(o => <option key={o} value={o}>{o}%</option>)}
                                </select>
                              ) : (
                                <input type="number" value={f[field.key]} step={field.step || 1}
                                  onChange={e => setField(field.key, e.target.value)}
                                  className="w-[80px] px-2 py-1.5 rounded-lg text-[12px] border text-right"
                                  style={{ background: 'var(--bg,#0d1117)', borderColor: 'var(--bd,#30363d)', color: 'var(--tx,#e6edf3)' }} />
                              )}
                              <span className="text-[11px] font-semibold" style={{ color: 'var(--tx2,#8b949e)' }}>%</span>
                            </div>
                            {formula && (
                              <div className="text-right text-[10px] px-1.5 py-0.5 rounded font-mono"
                                style={{ background: 'var(--bg,#0d1117)', color: '#d29922' }}>{formula}</div>
                            )}
                          </>
                        ) : (
                          <>
                            {field.isSelect ? (
                              <select value={f[field.key]} onChange={e => setField(field.key, e.target.value)}
                                className="w-full px-2 py-1.5 rounded-lg text-[12px] border text-right"
                                style={{ background: 'var(--bg,#0d1117)', borderColor: 'var(--bd,#30363d)', color: 'var(--tx,#e6edf3)' }}>
                                {field.opts.map(o => <option key={o} value={o}>{o}%</option>)}
                              </select>
                            ) : (
                              <input type="number" value={f[field.key]} step={field.step || 1}
                                onChange={e => setField(field.key, e.target.value)}
                                className="w-full px-2 py-1.5 rounded-lg text-[12px] border text-right"
                                style={{ background: 'var(--bg,#0d1117)', borderColor: 'var(--bd,#30363d)', color: 'var(--tx,#e6edf3)' }} />
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
