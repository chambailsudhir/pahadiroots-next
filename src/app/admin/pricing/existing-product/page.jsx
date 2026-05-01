'use client';
import { useState, useEffect, useRef, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';

// ── Constants ───────────────────────────────────────────────────
const GST_RATES = [0, 5, 12, 18, 28];

const STAGE_META = [
  { num: 1, label: 'Product cost',              sub: 'Purchase price landed at warehouse',      color: '#378ADD', tint: 'rgba(55,138,221,0.07)',  badge: '#E6F1FB', badgeText: '#185FA5' },
  { num: 2, label: 'Packaging & storage',       sub: 'Packing, warehouse & inventory holding', color: '#C8820A', tint: 'rgba(200,130,10,0.07)',   badge: '#FAEEDA', badgeText: '#854F0B' },
  { num: 3, label: 'Logistics & payments',      sub: 'Delivery, COD mix & payment gateway',    color: '#1D9E75', tint: 'rgba(29,158,117,0.07)',   badge: '#E1F5EE', badgeText: '#0F6E56' },
  { num: 4, label: 'Returns',                   sub: 'Loss from returned orders per unit',      color: '#E24B4A', tint: 'rgba(226,75,74,0.07)',    badge: '#FCEBEB', badgeText: '#A32D2D' },
  { num: 5, label: 'Platform, marketing & ops', sub: 'Commission, ads & operating cost',       color: '#7F77DD', tint: 'rgba(127,119,221,0.07)',  badge: '#EEEDFE', badgeText: '#534AB7' },
  { num: 6, label: 'Profit & final price',      sub: 'Target margin, output GST & MRP',        color: '#639922', tint: 'rgba(99,153,34,0.07)',    badge: '#EAF3DE', badgeText: '#3B6D11' },
];

// ── Helpers ─────────────────────────────────────────────────────
function r(n)    { return Math.round(n * 100) / 100; }
function ri(n)   { return Math.round(n); }
function fmtN(n) { return ri(n).toLocaleString('en-IN'); }
function fmtR(n) { return '₹' + fmtN(n); }

// ── Calc Engine ─────────────────────────────────────────────────
function runCalc(f) {
  const purchase    = Number(f.purchase)   || 0;
  const gst_in      = Number(f.gst_in)     || 0;
  const inbound     = Number(f.inbound)    || 0;
  const handling    = Number(f.handling)   || 0;
  const damage_pct  = Number(f.damage_pct) || 0;
  const gst_amt     = purchase * (gst_in / 100);
  const dmg_amt     = (purchase + gst_amt) * (damage_pct / 100);
  const landed      = purchase + gst_amt + inbound + handling + dmg_amt;

  const packaging  = Number(f.packaging)  || 0;
  const labor      = Number(f.labor)      || 0;
  const warehouse  = Number(f.warehouse)  || 0;
  const inventory  = Number(f.inventory)  || 0;
  const s2_add     = packaging + labor + warehouse + inventory;
  const after_pkg  = landed + s2_add;

  const shipping    = Number(f.shipping)   || 0;
  const cod_charge  = Number(f.cod_charge) || 0;
  const cod_pct     = Number(f.cod_pct)    || 0;
  const pg          = Number(f.pg)         || 0;
  const gst_log     = Number(f.gst_log)    || 0;
  const blended_cod = cod_charge * (cod_pct / 100);
  const log_raw     = shipping + blended_cod + pg;
  const s3_add      = log_raw * (1 + gst_log / 100);
  const after_log   = after_pkg + s3_add;

  const return_rate = Number(f.return_rate) || 0;
  const return_cost = Number(f.return_cost) || 0;
  const ret_impact  = return_cost * (return_rate / 100);
  const after_ret   = after_log + ret_impact;

  const platform_pct = Number(f.platform_pct) || 0;
  const marketing    = Number(f.marketing)    || 0;
  const ops          = Number(f.ops)          || 0;
  const extra        = Number(f.extra)        || 0;
  const platform_amt = after_log * (platform_pct / 100);
  const s5_add       = platform_amt + marketing + ops + extra;
  const total        = after_ret + s5_add;

  const profit        = Number(f.profit)   || 0;
  const gst_out       = Number(f.gst_out)  || 0;
  const mrp_mult      = Number(f.mrp_mult) || 1;
  const base_excl_gst = total + profit;
  const sp            = base_excl_gst * (1 + gst_out / 100);
  const mrp           = sp * mrp_mult;
  const margin_pct    = sp > 0 ? (sp - total) / sp * 100 : 0;
  const profit_val    = sp - total;
  const disc          = sp > 0 && mrp > sp ? Math.round((1 - sp / mrp) * 100) : 0;
  const base_price    = sp / (1 + gst_out / 100);
  const gst_total     = sp - base_price;

  return {
    landed, after_pkg, after_log, after_ret, total, sp, mrp, base_price,
    s2_add, s3_add, ret_impact, s5_add,
    gst_amt, dmg_amt, blended_cod, platform_amt,
    margin_pct, profit_val, disc,
    gst_total, cgst: gst_total / 2, sgst: gst_total / 2, base_excl_gst,
  };
}

const DEFAULT_F = {
  purchase: 100, gst_in: 5,
  inbound: 12, handling: 3, damage_pct: 2,
  packaging: 20, labor: 8, warehouse: 10, inventory: 5,
  shipping: 65, cod_charge: 20, cod_pct: 60, pg: 5, gst_log: 18,
  return_rate: 10, return_cost: 120,
  platform_pct: 0, marketing: 0, ops: 0, extra: 0,
  profit: 125, mrp_mult: 1.6, gst_out: 5,
};

// ── Results Panel ───────────────────────────────────────────────
function ResultsPanel({ f, calc, selProd, onPush, pushing, pushed, pushErr, onCopy }) {
  const marginColor = calc.margin_pct > 25 ? '#27500A' : calc.margin_pct > 15 ? '#C8820A' : '#A32D2D';
  const marginBg    = calc.margin_pct > 25 ? '#EAF3DE' : calc.margin_pct > 15 ? '#FAEEDA' : '#FCEBEB';

  const wfSteps = [
    { label: 'Purchase price',             total: Number(f.purchase)||0, col: '#378ADD' },
    { label: '+ GST/inbound/handling/dmg', total: calc.landed,           col: '#378ADD' },
    { label: '+ Packaging & storage',      total: calc.after_pkg,        col: '#C8820A' },
    { label: '+ Logistics (inc. GST)',     total: calc.after_log,        col: '#1D9E75' },
    { label: '+ Return impact',            total: calc.after_ret,        col: '#E24B4A' },
    { label: '+ Platform/mktg/ops',        total: calc.total,            col: '#7F77DD' },
    { label: '+ Profit target',            total: calc.base_excl_gst,    col: '#639922' },
    { label: '+ Output GST',               total: calc.sp,               col: '#888780' },
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

      {/* Key metrics */}
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

      {/* GST */}
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
                  <div className="h-full rounded-full transition-all" style={{ width: `${w}%`, background: s.col }} />
                </div>
                <div className="w-14 text-right font-bold flex-none" style={{ color: 'var(--tx,#e6edf3)' }}>{fmtR(s.total)}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Push */}
      <div className="p-4">
        <div className="text-[10px] font-bold tracking-widest uppercase mb-3" style={{ color: 'var(--tx2,#8b949e)' }}>
          {selProd ? `Push to: ${selProd.emoji || '📦'} ${selProd.name}` : 'Select a product to push'}
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
            className="w-full py-2.5 rounded-lg text-[12px] font-bold transition"
            style={{ background: pushed ? '#EAF3DE' : 'var(--accent,#3fb950)', color: pushed ? '#27500A' : '#fff', opacity: pushing ? 0.6 : 1 }}>
            {pushing ? 'Saving…' : pushed ? '✓ Saved to database' : '↑ Push pricing to catalogue'}
          </button>
        ) : (
          <div className="w-full py-2.5 rounded-lg text-[12px] font-semibold text-center border"
            style={{ borderColor: 'var(--bd,#30363d)', color: 'var(--tx2,#8b949e)' }}>
            Search &amp; select a product above first
          </div>
        )}
        {selProd && (
          <button onClick={onCopy}
            className="mt-2 w-full py-2 rounded-lg text-[11px] font-medium border transition"
            style={{ borderColor: 'var(--bd,#30363d)', color: 'var(--tx2,#8b949e)', background: 'transparent' }}>
            &#x1F4CB; Copy values instead
          </button>
        )}
      </div>
    </div>
  );
}

// ── Stage Accordion ─────────────────────────────────────────────
function StageAccordion({ f, setField, calc, open, tog }) {
  const stageConfig = [
    {
      fields: [
        { key: 'purchase',   label: 'Purchase price',   hint: 'Auto-filled from DB. Edit if cost has changed.', unit: '₹/unit' },
        { key: 'gst_in',     label: 'Input GST %',      hint: 'GST slab on supplier bill. Amount = purchase × %', unit: '%',
          formula: () => `= ₹${ri(f.purchase * f.gst_in / 100)} (${f.gst_in}%)`, isSelect: true, opts: GST_RATES },
        { key: 'inbound',    label: 'Inbound shipping', hint: 'Supplier → warehouse transport per unit', unit: '₹/unit' },
        { key: 'handling',   label: 'Handling',         hint: 'Loading, sorting, misc labour', unit: '₹/unit' },
        { key: 'damage_pct', label: 'Transit damage %', hint: 'Avg breakage 1–3%. Applied on (purchase + input GST)', unit: '%',
          formula: () => `= ₹${ri((f.purchase + f.purchase * f.gst_in / 100) * f.damage_pct / 100)}` },
      ],
      summaryLabel: 'Landed cost', summaryFormula: 'purchase + input GST + inbound + handling + transit damage', summaryVal: () => calc.landed,
    },
    {
      fields: [
        { key: 'packaging', label: 'Packaging material', hint: 'Box, bubble wrap, tape, label, dunnage per unit', unit: '₹/unit' },
        { key: 'labor',     label: 'Packing labour',     hint: 'Monthly staff cost ÷ units packed per month', unit: '₹/unit' },
        { key: 'warehouse', label: 'Warehouse rent',     hint: 'Monthly rent ÷ units stored. Nominal if home-based.', unit: '₹/unit' },
        { key: 'inventory', label: 'Inventory holding',  hint: 'Opportunity cost of capital locked in stock', unit: '₹/unit' },
      ],
      summaryLabel: 'After packaging', summaryFormula: 'landed + packaging + labour + warehouse + inventory', summaryVal: () => calc.after_pkg,
    },
    {
      fields: [
        { key: 'shipping',  label: 'Forward shipping',  hint: 'Courier charge per order (Shiprocket / Delhivery)', unit: '₹/order' },
        { key: '_cod',      label: 'COD charge & mix',  isCodCombined: true },
        { key: 'pg',        label: 'Payment gateway',   hint: 'Razorpay / PayU fee on prepaid orders (₹5–10)', unit: '₹/order' },
        { key: 'gst_log',   label: 'GST on logistics',  hint: '18% GST on all courier services', unit: '%',
          formula: () => `GST = ₹${ri((f.shipping + f.cod_charge * f.cod_pct / 100 + f.pg) * f.gst_log / 100)}` },
      ],
      summaryLabel: 'After logistics', summaryFormula: '(shipping + blended COD + PG) × (1 + GST 18%)', summaryVal: () => calc.after_log,
    },
    {
      fields: [
        { key: 'return_rate', label: 'Return rate %',   hint: 'D2C avg 5–15%. % of orders that come back.', unit: '%' },
        { key: 'return_cost', label: 'Cost per return', hint: 'Reverse shipping + repackaging + damage (₹80–150)', unit: '₹/return',
          formula: () => `impact per order = ₹${ri(calc.ret_impact)}` },
      ],
      summaryLabel: 'After returns', summaryFormula: 'after logistics + (return cost × return rate %)', summaryVal: () => calc.after_ret,
    },
    {
      fields: [
        { key: 'platform_pct', label: 'Platform fee %',  hint: 'Marketplace commission 5–25%.', unit: '%',
          formula: () => `= ₹${ri(calc.platform_amt)}` },
        { key: 'marketing',    label: 'Marketing / CAC', hint: 'Ads spend ÷ orders = customer acquisition cost per order', unit: '₹/order' },
        { key: 'ops',          label: 'Ops & support',   hint: 'Team, tools, tech cost ÷ monthly orders', unit: '₹/order' },
        { key: 'extra',        label: 'Hidden / extra',  hint: 'Discounts, COD failures, chargebacks buffer 10–15%', unit: '₹/order' },
      ],
      summaryLabel: 'Total real cost', summaryFormula: 'after returns + platform + marketing + ops + extra', summaryVal: () => calc.total,
    },
    {
      fields: [
        { key: 'profit',   label: 'Target profit / order', hint: 'Per order profit target. ₹80–150 healthy for D2C.', unit: '₹/order' },
        { key: 'gst_out',  label: 'Output GST %',          hint: 'GST charged to customer. Auto-filled from product.',unit: '%',
          isSelect: true, opts: GST_RATES,
          formula: () => `Base ₹${ri(calc.base_excl_gst)} × ${f.gst_out}% = ₹${ri(calc.gst_total)} → Selling ₹${ri(calc.sp)}` },
        { key: 'mrp_mult', label: 'MRP multiplier', hint: '1.6× = 37% off shown. 2× = 50% off. Controls strikethrough price.', unit: '× SP', step: 0.05,
          formula: () => `₹${ri(calc.sp)} × ${Number(f.mrp_mult).toFixed(2)} = MRP ₹${ri(calc.mrp)}` },
      ],
      summaryLabel: 'Selling price (incl GST)', summaryFormula: '(total cost + profit) × (1 + output GST%)', summaryVal: () => calc.sp,
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
            style={{ border: `1px solid ${isOpen ? color : 'var(--bd,#30363d)'}`, background: isOpen ? tint : 'var(--bg2,#161b22)' }}>
            <button onClick={() => tog(num)} className="w-full flex items-center gap-3 px-4 py-3 text-left"
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
              <span style={{ color, fontSize: 10, transform: isOpen ? 'rotate(180deg)' : 'none', display: 'inline-block', transition: 'transform .2s', marginLeft: 4, opacity: 0.8 }}>&#9660;</span>
            </button>

            {isOpen && (
              <div style={{ borderTop: `1px solid ${color}30` }}>
                {cfg.fields.map(field => {
                  if (field.isCodCombined) {
                    const blended = ri(f.cod_charge * f.cod_pct / 100);
                    return (
                      <div key="_cod" className="px-4 py-3 border-b" style={{ borderColor: `${color}25`, background: 'var(--bg2,#161b22)' }}>
                        <div className="flex items-center gap-2 mb-1">
                          <div className="text-[12px] font-semibold" style={{ color: 'var(--tx,#e6edf3)' }}>COD charge &amp; mix</div>
                          <div className="text-[10px] px-1.5 py-0.5 rounded font-mono" style={{ background: 'var(--bg,#0d1117)', color: 'var(--yellow)' }}>
                            blended = &#x20B9;{blended}/order
                          </div>
                        </div>
                        <div className="text-[11px] mb-3" style={{ color: 'var(--tx2,#8b949e)' }}>
                          COD charge &times; COD % = blended cost per order. India D2C avg 60&ndash;70% COD.
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          {[
                            { k: 'cod_charge', label: 'COD charge', sub: 'Fee on COD orders (₹15–30)', unit: '₹/order' },
                            { k: 'cod_pct',    label: 'COD order mix', sub: '% of total orders via COD', unit: '%' },
                          ].map(({ k, label: lbl, sub: s, unit }) => (
                            <div key={k} className="rounded-lg p-2.5" style={{ background: 'var(--bg,#0d1117)', border: '1px solid var(--bd,#30363d)' }}>
                              <div className="text-[10px] font-semibold mb-0.5" style={{ color: 'var(--tx2,#8b949e)' }}>
                                {lbl} <span style={{ fontWeight: 400 }}>{unit}</span>
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
                          <span>&#x20B9;{f.cod_charge}</span><span>&times;</span><span>{f.cod_pct}%</span><span>&rarr;</span>
                          <span className="font-bold px-1.5 py-0.5 rounded"
                            style={{ background: 'color-mix(in srgb,#d29922 15%,var(--bg,#0d1117))', color: 'var(--yellow)' }}>
                            &#x20B9;{blended} blended/order
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
                            style={{ background: 'var(--bg,#0d1117)', color: 'var(--yellow)' }}>{formula}</div>
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
                                style={{ background: 'var(--bg,#0d1117)', color: 'var(--yellow)' }}>{formula}</div>
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

// ═══════════════════════════════════════════════════════════════
// MAIN PAGE — Existing Product Pricing
// ═══════════════════════════════════════════════════════════════
function ExistingProductPricingInner() {
  const searchParams = useSearchParams();
  const preselectedId = searchParams.get('product');
  const [products, setProducts]       = useState([]);
  const [categories, setCategories]   = useState([]);
  const [loading, setLoading]         = useState(true);

  const [selProd, setSelProd]         = useState(null);
  const [selCat, setSelCat]           = useState('all');
  const [query, setQuery]             = useState('');
  const [showDrop, setShowDrop]       = useState(false);
  const [selVariants, setSelVariants] = useState([]);
  const [loadingVars, setLoadingVars] = useState(false);
  const searchRef                     = useRef(null);

  const [f, setF]       = useState({ ...DEFAULT_F });
  const [open, setOpen] = useState({ 1: true, 2: false, 3: false, 4: false, 5: false, 6: false });

  const [pushing, setPushing] = useState(false);
  const [pushed, setPushed]   = useState(false);
  const [pushErr, setPushErr] = useState('');

  // Load products + categories
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [prods, cats] = await Promise.all([
        api.get('products', 'select=id,name,slug,emoji,cost_price,gst_rate,price,mrp,status,category_id,unit_label&is_deleted=eq.false&order=name.asc'),
        api.get('categories', 'select=id,name&order=name.asc'),
      ]);
      setProducts(prods || []);
      setCategories(cats || []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Auto-select product from URL param (e.g. ?product=<id>)
  useEffect(() => {
    if (!preselectedId || !products.length || selProd) return;
    const found = products.find(p => p.id === preselectedId || String(p.id) === preselectedId);
    if (found) selectProduct(found);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preselectedId, products]);

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
        price: r(calc.base_price), mrp: ri(calc.sp),
        cost_price: r(f.purchase), gst_rate: f.gst_out,
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
          <div className="flex items-center gap-2 mb-1">
            <a href="/admin/pricing"
              className="text-[11px] px-2 py-1 rounded-lg border transition"
              style={{ borderColor: 'var(--bd,#30363d)', color: 'var(--tx2,#8b949e)', background: 'var(--bg2,#161b22)', textDecoration: 'none' }}>
              &larr; Pricing Engine
            </a>
          </div>
          <h1 className="text-[20px] font-bold flex items-center gap-2">
            <span>&#x1F50D;</span> Existing Product Pricing
          </h1>
          <p className="text-[12px] mt-0.5" style={{ color: 'var(--tx2,#8b949e)' }}>
            Search a product &middot; Cost &amp; GST auto-filled from DB &middot; Adjust &amp; push directly to catalogue
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={copyValues}
            className="px-3 py-1.5 text-[12px] font-medium rounded-lg border transition"
            style={{ borderColor: 'var(--bd,#30363d)', color: 'var(--tx2,#8b949e)', background: 'var(--bg2,#161b22)' }}>
            &#x1F4CB; Copy values
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
              &#x2713; Saved
            </div>
          )}
        </div>
      </div>

      {/* Info banner */}
      <div className="flex items-start gap-3 px-4 py-3 rounded-xl text-[12px]"
        style={{ background: 'color-mix(in srgb,#1D9E75 8%, var(--bg2,#161b22))', border: '1px solid #1D9E75' }}>
        <span className="text-[18px] flex-none">&#x1F50D;</span>
        <div style={{ color: 'var(--tx2,#8b949e)' }}>
          <b style={{ color: 'var(--tx,#e6edf3)' }}>Search a product first</b> — cost price &amp; GST will be auto-filled from the database.
          Adjust any stage, then hit <b style={{ color: 'var(--tx,#e6edf3)' }}>&uarr; Push to catalogue</b> to update the product and all its variants.
          To price a brand new product, use <a href="/admin/pricing/new-product"
            style={{ color: 'var(--accent,#3fb950)', textDecoration: 'underline' }}>New Product</a> instead.
        </div>
      </div>

      {/* Product search — full width, prominent */}
      <div className="rounded-xl border overflow-hidden" style={{ background: 'var(--bg2,#161b22)', borderColor: selProd ? 'var(--accent,#3fb950)' : 'var(--bd,#30363d)', borderWidth: selProd ? 2 : 1 }}>
        <div className="px-4 py-3 border-b flex items-center gap-2" style={{ borderColor: 'var(--bd,#30363d)', background: 'var(--bg,#0d1117)' }}>
          <span className="text-[16px]">&#x1F50D;</span>
          <div className="text-[13px] font-bold" style={{ color: 'var(--tx,#e6edf3)' }}>
            {selProd ? `Selected: ${selProd.emoji || ''} ${selProd.name}` : 'Step 1 — Search & select a product'}
          </div>
          {selProd && (
            <button onClick={clearProduct} className="ml-auto text-[11px] px-2 py-0.5 rounded border"
              style={{ borderColor: 'var(--bd,#30363d)', color: 'var(--tx2,#8b949e)' }}>
              &times; Clear
            </button>
          )}
        </div>

        <div className="p-4 space-y-3">
          {/* Category pills */}
          <div className="flex gap-1.5 flex-wrap">
            {[{ id: 'all', name: 'All' }, ...categories].map(c => (
              <button key={c.id} onClick={() => setSelCat(c.id)}
                className="px-3 py-1.5 rounded-lg text-[11px] font-semibold transition"
                style={{
                  background: selCat === c.id ? 'var(--accent,#3fb950)' : 'var(--bg,#0d1117)',
                  color: selCat === c.id ? '#fff' : 'var(--tx2,#8b949e)',
                  border: selCat === c.id ? '1px solid transparent' : '1px solid var(--bd,#30363d)',
                }}>
                {c.name}
                {c.id !== 'all' && (
                  <span className="ml-1 opacity-60">{products.filter(p => p.category_id === c.id).length}</span>
                )}
              </button>
            ))}
          </div>

          {/* Search input */}
          <div className="relative" ref={searchRef}>
            <div className="flex items-center gap-3 px-4 py-3 rounded-xl border"
              style={{ background: 'var(--bg,#0d1117)', borderColor: 'var(--bd,#30363d)' }}>
              <span className="text-[16px] flex-none">&#x1F50D;</span>
              <input
                value={query}
                onChange={e => { setQuery(e.target.value); setShowDrop(true); if (!e.target.value) clearProduct(); }}
                onFocus={() => setShowDrop(true)}
                placeholder="Type product name to search…"
                className="flex-1 text-[14px] bg-transparent outline-none"
                style={{ color: 'var(--tx,#e6edf3)' }}
              />
              {selProd && (
                <div className="flex items-center gap-2 px-2 py-1 rounded-full flex-none"
                  style={{ background: 'color-mix(in srgb, var(--accent,#3fb950) 15%, var(--bg2,#161b22))', border: '1px solid var(--accent,#3fb950)' }}>
                  <span className="text-[12px] font-semibold" style={{ color: 'var(--accent,#3fb950)' }}>
                    {selProd.emoji} {selProd.name}
                  </span>
                  <button onClick={clearProduct} style={{ color: 'var(--tx2,#8b949e)' }}>&#x2715;</button>
                </div>
              )}
            </div>
            {showDrop && !selProd && (
              <div className="absolute z-50 w-full mt-1 rounded-xl border overflow-hidden shadow-xl"
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
                          {catName(p.category_id)} &middot; GST {p.gst_rate}%
                        </div>
                      </div>
                      <div className="text-right flex-none">
                        <div className="text-[12px] font-bold" style={{ color: 'var(--accent,#3fb950)' }}>
                          {p.cost_price ? fmtR(p.cost_price) : <span style={{ color: 'var(--tx2,#8b949e)' }}>&mdash;</span>}
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

          {/* Selected product details + variants */}
          {selProd && (
            <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--accent,#3fb950)', background: 'var(--bg,#0d1117)' }}>
              <div className="px-4 py-2.5 flex items-center gap-2 border-b" style={{ borderColor: 'var(--bd,#30363d)' }}>
                <span className="text-[20px]">{selProd.emoji || '📦'}</span>
                <div>
                  <div className="text-[13px] font-bold" style={{ color: 'var(--tx,#e6edf3)' }}>{selProd.name}</div>
                  <div className="text-[11px]" style={{ color: 'var(--tx2,#8b949e)' }}>
                    {catName(selProd.category_id)} &middot; GST {selProd.gst_rate}% &middot; Current MRP: {selProd.mrp ? fmtR(selProd.mrp) : 'not set'}
                  </div>
                </div>
                <span className="ml-auto text-[10px] font-bold px-2 py-0.5 rounded-full"
                  style={{ background: 'color-mix(in srgb,var(--accent,#3fb950) 15%, var(--bg2,#161b22))', color: 'var(--accent,#3fb950)' }}>
                  &#x2713; Auto-filled Stage 1
                </span>
              </div>
              <div className="p-3">
                {loadingVars ? (
                  <div className="text-[11px]" style={{ color: 'var(--tx2,#8b949e)' }}>Loading variants…</div>
                ) : selVariants.length === 0 ? (
                  <div className="text-[11px]" style={{ color: 'var(--tx2,#8b949e)' }}>No active variants. Pricing will update the base product only.</div>
                ) : (
                  <div>
                    <div className="text-[10px] font-bold mb-2 tracking-widest uppercase" style={{ color: 'var(--tx2,#8b949e)' }}>
                      {selVariants.length} variant{selVariants.length > 1 ? 's' : ''} — prices will be scaled proportionally on push
                    </div>
                    <div className="flex gap-2 flex-wrap">
                      {selVariants.map(v => (
                        <div key={v.id} className="px-3 py-2 rounded-lg"
                          style={{ background: 'var(--bg2,#161b22)', border: '1px solid var(--bd,#30363d)' }}>
                          <div className="text-[11px] font-semibold" style={{ color: 'var(--tx,#e6edf3)' }}>{v.label}</div>
                          <div className="text-[12px] font-bold mt-0.5" style={{ color: 'var(--accent,#3fb950)' }}>{fmtR(v.price)}</div>
                          {v.original_price && (
                            <div className="text-[10px] line-through" style={{ color: 'var(--tx2,#8b949e)' }}>{fmtR(v.original_price)}</div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Step 2 label */}
      {selProd && (
        <div className="flex items-center gap-3">
          <div className="h-px flex-1" style={{ background: 'var(--bd,#30363d)' }} />
          <div className="text-[11px] font-bold px-3 py-1 rounded-full"
            style={{ background: 'var(--bg2,#161b22)', color: 'var(--tx2,#8b949e)', border: '1px solid var(--bd,#30363d)' }}>
            Step 2 &mdash; Review &amp; adjust pricing stages
          </div>
          <div className="h-px flex-1" style={{ background: 'var(--bd,#30363d)' }} />
        </div>
      )}

      {/* 2-col: stages + results (only show after product selected) */}
      {selProd ? (
        <div className="grid gap-4" style={{ gridTemplateColumns: '1fr 400px', alignItems: 'start' }}>
          <StageAccordion f={f} setField={setField} calc={calc} open={open} tog={tog} />
          <ResultsPanel f={f} calc={calc}
            selProd={selProd}
            onPush={pushToAdmin} pushing={pushing} pushed={pushed} pushErr={pushErr} onCopy={copyValues} />
        </div>
      ) : (
        <div className="rounded-xl border py-16 text-center"
          style={{ borderColor: 'var(--bd,#30363d)', background: 'var(--bg2,#161b22)', borderStyle: 'dashed' }}>
          <div className="text-[32px] mb-3">&#x1F50D;</div>
          <div className="text-[14px] font-semibold" style={{ color: 'var(--tx,#e6edf3)' }}>Search a product to get started</div>
          <div className="text-[12px] mt-1" style={{ color: 'var(--tx2,#8b949e)' }}>
            Cost price &amp; GST will auto-fill from the database
          </div>
        </div>
      )}
    </div>
  );
}

export default function ExistingProductPricingPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center" style={{ color: 'var(--tx2,#8b949e)' }}>Loading…</div>}>
      <ExistingProductPricingInner />
    </Suspense>
  );
}
