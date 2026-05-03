'use client';
// ─────────────────────────────────────────────────────────────────────────────
// Marketplace Pricing Engine
// /admin/pricing/marketplace
// Calculates correct selling price for Amazon, Flipkart, Meesho, Myntra
// with their actual fee structures (referral fee, closing fee, FBA, etc.)
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';

// ── Platform definitions with real fee structures ─────────────────────────────
const PLATFORMS = {
  amazon: {
    name: 'Amazon India',
    icon: '🟠',
    color: '#FF9900',
    feeStructure: 'Referral % + Closing Fee + FBA (optional)',
    categories: [
      { label: 'Grocery & Gourmet',     referral: 9,  closing: 5,   fba: 35 },
      { label: 'Health & Personal Care', referral: 9,  closing: 5,   fba: 35 },
      { label: 'Beauty',                referral: 13, closing: 5,   fba: 35 },
      { label: 'Ayurveda / Wellness',   referral: 9,  closing: 5,   fba: 35 },
      { label: 'Kitchen & Dining',      referral: 13, closing: 5,   fba: 40 },
      { label: 'Sports & Outdoors',     referral: 15, closing: 5,   fba: 40 },
    ],
    notes: 'Amazon charges GST @ 18% on their fees. FBA = Fulfilled by Amazon (warehousing).',
    tds: 1, // TDS 1% deducted
    gstOnFees: 18,
  },
  flipkart: {
    name: 'Flipkart',
    icon: '🔵',
    color: '#2874F0',
    feeStructure: 'Commission % + Shipping Fee + Fixed Fee',
    categories: [
      { label: 'Grocery',               referral: 5,  closing: 10,  fba: 30 },
      { label: 'Health & Nutrition',    referral: 10, closing: 10,  fba: 30 },
      { label: 'Beauty & Personal Care',referral: 12, closing: 10,  fba: 35 },
      { label: 'Ayurveda',              referral: 8,  closing: 10,  fba: 30 },
      { label: 'Home & Kitchen',        referral: 12, closing: 10,  fba: 40 },
    ],
    notes: 'Flipkart charges collection fee + shipping fee. FBA here = Smart Fulfillment.',
    tds: 1,
    gstOnFees: 18,
  },
  meesho: {
    name: 'Meesho',
    icon: '🟣',
    color: '#9B2C8F',
    feeStructure: '0% Commission + Logistics Fee only',
    categories: [
      { label: 'Grocery & Food',        referral: 0,  closing: 0,   fba: 45 },
      { label: 'Health & Wellness',     referral: 0,  closing: 0,   fba: 45 },
      { label: 'Beauty & Skincare',     referral: 0,  closing: 0,   fba: 45 },
      { label: 'Home & Kitchen',        referral: 0,  closing: 0,   fba: 50 },
    ],
    notes: 'Meesho has 0% commission — you only pay logistics fees. High return rates (~25–35%).',
    tds: 1,
    gstOnFees: 18,
  },
  myntra: {
    name: 'Myntra',
    icon: '🩷',
    color: '#FF3F6C',
    feeStructure: 'Commission % + Platform Fee (Fashion/Lifestyle focus)',
    categories: [
      { label: 'Wellness & Supplements',referral: 15, closing: 10,  fba: 50 },
      { label: 'Beauty & Skincare',     referral: 18, closing: 10,  fba: 50 },
      { label: 'Ayurveda / Herbal',     referral: 15, closing: 10,  fba: 50 },
      { label: 'Home Wellness',         referral: 12, closing: 10,  fba: 50 },
    ],
    notes: 'Myntra primarily fashion. Wellness/organic listings allowed. High return rates.',
    tds: 1,
    gstOnFees: 18,
  },
  jiomart: {
    name: 'JioMart / Reliance',
    icon: '🔴',
    color: '#E63329',
    feeStructure: 'Commission % (lower for grocery)',
    categories: [
      { label: 'Grocery & Staples',     referral: 5,  closing: 5,   fba: 25 },
      { label: 'Health & Nutrition',    referral: 8,  closing: 5,   fba: 25 },
      { label: 'Ayurveda / Natural',    referral: 8,  closing: 5,   fba: 30 },
      { label: 'Kitchen & Food',        referral: 6,  closing: 5,   fba: 30 },
    ],
    notes: 'Strong in tier-2/3 cities. Lower commissions but smaller customer base for premium.',
    tds: 1,
    gstOnFees: 18,
  },
};

const r  = (n) => Math.round(n * 100) / 100;
const ri = (n) => Math.round(n);
const ₹  = (n) => '₹' + ri(n).toLocaleString('en-IN');

// ── Core marketplace calc ─────────────────────────────────────────────────────
function calcMarketplace(inp) {
  const {
    costPrice, gstRateIn, gstRateOut,
    referralPct, closingFee, logisticsFee, gstOnFees,
    returnRate, returnCostPerUnit,
    targetMarginPct, tds,
    packaging, inboundShipping,
  } = inp;

  // Step 1: Landed cost
  const gstIn   = costPrice * (gstRateIn / 100);
  const landed  = costPrice + gstIn + packaging + inboundShipping;

  // Step 2: Return cost per unit (amortized)
  const returnImpact = (returnRate / 100) * returnCostPerUnit;

  // Step 3: Total cost before fees
  const costBeforeFees = landed + returnImpact;

  // Step 4: Solve for Selling Price (SP incl. GST)
  // SP_excl = SP / (1 + gstOut/100)
  // referral  = SP_excl × referralPct / 100
  // gstOnRef  = referral × gstOnFees / 100
  // totalFees = (closingFee + logisticsFee) × (1 + gstOnFees/100) + referral + gstOnRef + tdsAmt
  //
  // Margin mode: (SP_excl - totalCost) / SP_excl = margin
  // Algebraic:
  //   let m = margin/100, p = referralPct/100, g = gstOut/100, gf = gstOnFees/100
  //   fixedFees = (closingFee + logisticsFee) × (1+gf)
  //   SP_excl × (1 - p - p×gf - m - tds/100) = costBeforeFees + fixedFees
  //   SP_excl = (costBeforeFees + fixedFees) / (1 - p×(1+gf) - m - tds/100)

  const m   = targetMarginPct / 100;
  const p   = referralPct / 100;
  const gf  = gstOnFees / 100;
  const g   = gstRateOut / 100;
  const tdsR = tds / 100;

  const fixedFees   = (closingFee + logisticsFee) * (1 + gf);
  const denominator = 1 - p * (1 + gf) - m - tdsR;

  let spExcl, sp, referral, gstOnRef, totalFees, totalCost, grossProfit, actualMargin;

  if (denominator <= 0.01) {
    // Platform fees + margin target exceeds 100% — impossible
    return { impossible: true };
  }

  spExcl      = (costBeforeFees + fixedFees) / denominator;
  sp          = spExcl * (1 + g);
  referral    = spExcl * p;
  gstOnRef    = referral * gf;
  const tdsAmt = spExcl * tdsR;
  totalFees   = fixedFees + referral + gstOnRef + tdsAmt;
  totalCost   = costBeforeFees + totalFees;
  grossProfit = spExcl - totalCost;
  actualMargin = spExcl > 0 ? (grossProfit / spExcl) * 100 : 0;

  // GST breakdown
  const gstCollected = sp - spExcl;
  const cgst = gstCollected / 2;
  const sgst = gstCollected / 2;

  // MRP suggestion (2x sp for perceived value)
  const mrpSuggested = ri(sp * 1.8 / 10) * 10; // round to nearest 10

  return {
    impossible: false,
    // Inputs echo
    costPrice, landed, returnImpact, costBeforeFees,
    // Fees
    referral: r(referral), gstOnRef: r(gstOnRef), fixedFees: r(fixedFees),
    tdsAmt: r(tdsAmt), totalFees: r(totalFees),
    // Price
    spExcl: r(spExcl), sp: r(sp), mrpSuggested,
    // P&L
    totalCost: r(totalCost), grossProfit: r(grossProfit),
    actualMargin: r(actualMargin),
    // GST
    gstCollected: r(gstCollected), cgst: r(cgst), sgst: r(sgst),
  };
}

// ── component ─────────────────────────────────────────────────────────────────
export default function MarketplacePricingPage() {
  const router = useRouter();

  const [platform,  setPlatform]  = useState('amazon');
  const [catIdx,    setCatIdx]    = useState(0);
  const [saving,    setSaving]    = useState(false);
  const [saved,     setSaved]     = useState(false);

  const plat = PLATFORMS[platform];
  const cat  = plat.categories[catIdx] || plat.categories[0];

  const [f, setF] = useState({
    costPrice:       200,
    gstRateIn:       5,    // GST you pay when buying stock (input tax)
    gstRateOut:      5,    // GST charged to customer (output tax)
    referralPct:     cat.referral,
    closingFee:      cat.closing,
    logisticsFee:    cat.fba,
    returnRate:      15,   // % of orders returned
    returnCostPerUnit: 80, // reverse logistics cost per return
    targetMarginPct: 25,
    packaging:       20,
    inboundShipping: 10,
    productName:     '',
  });

  // Sync fees when category changes
  function selectCat(idx) {
    const c = plat.categories[idx];
    setCatIdx(idx);
    setF(p => ({ ...p, referralPct: c.referral, closingFee: c.closing, logisticsFee: c.fba }));
  }

  function setField(k, v) {
    const n = parseFloat(v);
    setF(p => ({ ...p, [k]: isNaN(n) ? p[k] : n }));
  }

  const calc = useMemo(() => calcMarketplace({ ...f, gstOnFees: plat.gstOnFees, tds: plat.tds }), [f, plat]);

  const inputStyle = {
    width: '100%', padding: '8px 10px', borderRadius: 8, fontSize: 13,
    background: 'var(--input-bg,#21262d)', border: '1px solid var(--bd,#30363d)',
    color: 'var(--tx,#e6edf3)', outline: 'none',
  };
  const labelStyle = { fontSize: 11, color: 'var(--tx3)', marginBottom: 4, display: 'block' };

  function Row({ label, val, color = 'var(--tx)', sub, bold, minus }) {
    return (
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '6px 0', borderBottom: '1px solid color-mix(in srgb, var(--bd) 40%, transparent)' }}>
        <div>
          <span style={{ fontSize: 13, color: bold ? 'var(--tx)' : 'var(--tx2)', fontWeight: bold ? 600 : 400 }}>{label}</span>
          {sub && <div style={{ fontSize: 11, color: 'var(--tx3)' }}>{sub}</div>}
        </div>
        <span style={{ fontSize: bold ? 15 : 13, fontWeight: bold ? 700 : 500, color, fontFamily: 'monospace' }}>
          {minus ? '−' : ''}{val}
        </span>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1100, color: 'var(--tx,#e6edf3)' }}>

      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
          <button onClick={() => router.push('/admin/pricing')}
            style={{ fontSize: 12, color: 'var(--tx3)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
            ← Pricing Engine
          </button>
        </div>
        <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>🛍 Marketplace Pricing</h1>
        <p style={{ fontSize: 13, color: 'var(--tx3)', marginTop: 4 }}>
          Calculate correct selling price for each platform — accounting for referral fees, logistics, GST on fees, TDS, and return rates.
        </p>
      </div>

      {/* Platform Selector */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {Object.entries(PLATFORMS).map(([key, p]) => (
          <button key={key} onClick={() => { setPlatform(key); setCatIdx(0); setF(prev => ({ ...prev, referralPct: p.categories[0].referral, closingFee: p.categories[0].closing, logisticsFee: p.categories[0].fba })); }}
            style={{
              padding: '8px 16px', borderRadius: 99, fontSize: 13, cursor: 'pointer',
              border: platform === key ? `2px solid ${p.color}` : '1px solid var(--bd,#30363d)',
              background: platform === key ? `${p.color}18` : 'var(--bg2,#161b22)',
              color: platform === key ? p.color : 'var(--tx2)',
              fontWeight: platform === key ? 600 : 400,
              transition: 'all 0.15s',
            }}>
            {p.icon} {p.name}
          </button>
        ))}
      </div>

      {/* Platform info banner */}
      <div style={{ padding: '10px 16px', borderRadius: 10, marginBottom: 20, background: `${plat.color}10`, border: `1px solid ${plat.color}30`, fontSize: 12, color: 'var(--tx2)', display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ color: plat.color, fontWeight: 600 }}>{plat.icon} {plat.name}</span>
        <span>Fee structure: <strong style={{ color: 'var(--tx)' }}>{plat.feeStructure}</strong></span>
        <span>TDS: <strong style={{ color: 'var(--tx)' }}>{plat.tds}%</strong></span>
        <span>GST on platform fees: <strong style={{ color: 'var(--tx)' }}>{plat.gstOnFees}%</strong></span>
        <span style={{ color: 'var(--tx3)', fontStyle: 'italic' }}>{plat.notes}</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>

        {/* ── LEFT: Inputs ── */}
        <div style={{ background: 'var(--bg2,#161b22)', borderRadius: 16, padding: 20, border: '1px solid var(--bd,#30363d)' }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--tx2)', marginBottom: 16, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
            Product & Cost Inputs
          </div>

          {/* Product name */}
          <div style={{ marginBottom: 14 }}>
            <label style={labelStyle}>Product Name (optional)</label>
            <input style={inputStyle} placeholder="e.g. Himalayan Wild Honey 500g"
              value={f.productName}
              onChange={e => setF(p => ({ ...p, productName: e.target.value }))} />
          </div>

          {/* Category */}
          <div style={{ marginBottom: 14 }}>
            <label style={labelStyle}>Platform Category</label>
            <select value={catIdx} onChange={e => selectCat(parseInt(e.target.value))} style={inputStyle}>
              {plat.categories.map((c, i) => (
                <option key={i} value={i}>{c.label}</option>
              ))}
            </select>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
            {[
              { key: 'costPrice',       label: 'Your Cost Price (₹)',    hint: 'What you paid per unit' },
              { key: 'packaging',       label: 'Packaging Cost (₹)',      hint: 'Box, bubble wrap, label' },
              { key: 'inboundShipping', label: 'Inbound Shipping (₹)',    hint: 'To Amazon/Flipkart warehouse' },
              { key: 'gstRateIn',       label: 'GST on Purchase (%)',     hint: 'Input tax credit' },
              { key: 'gstRateOut',      label: 'GST on Sale (%)',         hint: 'Output GST charged to customer' },
              { key: 'targetMarginPct', label: 'Target Gross Margin (%)', hint: 'After all platform fees' },
            ].map(({ key, label, hint }) => (
              <div key={key}>
                <label style={labelStyle}>{label}</label>
                <input type="number" style={inputStyle} value={f[key]}
                  onChange={e => setField(key, e.target.value)} />
                <div style={{ fontSize: 10, color: 'var(--tx3)', marginTop: 2 }}>{hint}</div>
              </div>
            ))}
          </div>

          <div style={{ borderTop: '1px solid var(--bd)', paddingTop: 14, marginBottom: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--tx2)', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
              Platform Fees (auto-filled from category)
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
              {[
                { key: 'referralPct',  label: 'Referral Fee (%)',  hint: '% of selling price' },
                { key: 'closingFee',   label: 'Closing Fee (₹)',   hint: 'Fixed per order' },
                { key: 'logisticsFee', label: 'Logistics Fee (₹)', hint: 'Shipping/FBA per order' },
              ].map(({ key, label, hint }) => (
                <div key={key}>
                  <label style={labelStyle}>{label}</label>
                  <input type="number" style={{ ...inputStyle, border: `1px solid ${plat.color}50` }}
                    value={f[key]} onChange={e => setField(key, e.target.value)} />
                  <div style={{ fontSize: 10, color: 'var(--tx3)', marginTop: 2 }}>{hint}</div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ borderTop: '1px solid var(--bd)', paddingTop: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--tx2)', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
              Returns (amortized per unit)
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {[
                { key: 'returnRate',        label: 'Return Rate (%)',          hint: 'Meesho ~25%, Amazon ~12%' },
                { key: 'returnCostPerUnit', label: 'Cost per Return (₹)',      hint: 'Reverse logistics cost' },
              ].map(({ key, label, hint }) => (
                <div key={key}>
                  <label style={labelStyle}>{label}</label>
                  <input type="number" style={inputStyle} value={f[key]}
                    onChange={e => setField(key, e.target.value)} />
                  <div style={{ fontSize: 10, color: 'var(--tx3)', marginTop: 2 }}>{hint}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── RIGHT: Results ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

          {calc.impossible ? (
            <div style={{ background: 'rgba(248,81,73,0.1)', border: '1px solid rgba(248,81,73,0.3)', borderRadius: 16, padding: 24, textAlign: 'center' }}>
              <div style={{ fontSize: 24 }}>⚠️</div>
              <div style={{ fontSize: 15, fontWeight: 600, color: '#f85149', marginTop: 8 }}>Impossible Combination</div>
              <div style={{ fontSize: 13, color: 'var(--tx2)', marginTop: 6 }}>
                Platform fees + target margin exceed 100% of selling price. Lower your target margin or choose a lower-fee category.
              </div>
            </div>
          ) : (
            <>
              {/* Price Output */}
              <div style={{ background: `${plat.color}0d`, border: `1px solid ${plat.color}30`, borderRadius: 16, padding: 20 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: plat.color, marginBottom: 14, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
                  {plat.icon} Recommended Prices for {plat.name}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 14 }}>
                  {[
                    { label: 'Selling Price (incl. GST)', val: ₹(calc.sp), color: plat.color, sub: 'List at this price on platform' },
                    { label: 'Base Price (excl. GST)',    val: ₹(calc.spExcl), color: 'var(--tx)', sub: 'For your records / invoice' },
                    { label: 'MRP Suggestion',            val: ₹(calc.mrpSuggested), color: 'var(--tx3)', sub: 'Strikethrough price (1.8× sell)' },
                  ].map(({ label, val, color, sub }) => (
                    <div key={label} style={{ textAlign: 'center', padding: '12px 10px', background: 'var(--bg2,#161b22)', borderRadius: 12 }}>
                      <div style={{ fontSize: 11, color: 'var(--tx3)', marginBottom: 4 }}>{label}</div>
                      <div style={{ fontSize: 20, fontWeight: 700, color, fontFamily: 'monospace' }}>{val}</div>
                      <div style={{ fontSize: 10, color: 'var(--tx3)', marginTop: 3 }}>{sub}</div>
                    </div>
                  ))}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div style={{ padding: '10px 12px', background: 'rgba(63,185,80,0.08)', borderRadius: 10, border: '1px solid rgba(63,185,80,0.2)', textAlign: 'center' }}>
                    <div style={{ fontSize: 11, color: 'var(--tx3)', marginBottom: 2 }}>Gross Profit / order</div>
                    <div style={{ fontSize: 22, fontWeight: 700, color: calc.grossProfit >= 0 ? '#3fb950' : '#f85149', fontFamily: 'monospace' }}>
                      {₹(calc.grossProfit)}
                    </div>
                  </div>
                  <div style={{ padding: '10px 12px', background: 'rgba(210,153,34,0.08)', borderRadius: 10, border: '1px solid rgba(210,153,34,0.2)', textAlign: 'center' }}>
                    <div style={{ fontSize: 11, color: 'var(--tx3)', marginBottom: 2 }}>Gross Margin %</div>
                    <div style={{ fontSize: 22, fontWeight: 700, color: calc.actualMargin >= 20 ? '#3fb950' : calc.actualMargin >= 10 ? '#d29922' : '#f85149', fontFamily: 'monospace' }}>
                      {ri(calc.actualMargin)}%
                    </div>
                  </div>
                </div>
              </div>

              {/* Detailed P&L */}
              <div style={{ background: 'var(--bg2,#161b22)', borderRadius: 16, padding: 20, border: '1px solid var(--bd,#30363d)' }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--tx2)', marginBottom: 14, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
                  Per-Order P&L Breakdown
                </div>
                <Row label="Selling Price (incl. GST)" val={₹(calc.sp)} bold />
                <Row label="  − GST collected (govt)" val={₹(calc.gstCollected)} color="#58a6ff" minus sub={`CGST ₹${ri(calc.cgst)} + SGST ₹${ri(calc.sgst)}`} />
                <Row label="Net Revenue (ex-GST)" val={₹(calc.spExcl)} color="var(--tx)" bold />
                <div style={{ height: 6 }} />
                <Row label="  − Cost Price (landed)" val={₹(calc.costBeforeFees)} color="#f85149" minus
                  sub={`COGS ₹${calc.costPrice} + packaging ₹${f.packaging} + inbound ₹${f.inboundShipping} + returns ₹${ri(calc.returnImpact)}`} />
                <Row label={`  − Referral fee (${f.referralPct}%)`} val={₹(calc.referral)} color="#f85149" minus sub={`+ GST on fee ₹${ri(calc.gstOnRef)}`} />
                <Row label="  − Closing + Logistics fees" val={₹(calc.fixedFees)} color="#f85149" minus sub={`₹${f.closingFee} + ₹${f.logisticsFee} incl. 18% GST`} />
                <Row label={`  − TDS (${plat.tds}%)`} val={₹(calc.tdsAmt)} color="#f85149" minus sub="Tax Deducted at Source by platform" />
                <Row label="Total Deductions" val={₹(calc.totalCost)} color="#f85149" minus bold />
                <div style={{ height: 6 }} />
                <Row label="Gross Profit" val={₹(calc.grossProfit)} color={calc.grossProfit >= 0 ? '#3fb950' : '#f85149'} bold />
                <Row label="Gross Margin %" val={ri(calc.actualMargin) + '%'} color="#d29922" bold />
              </div>

              {/* vs D2C comparison */}
              <div style={{ background: 'var(--bg2,#161b22)', borderRadius: 16, padding: 20, border: '1px solid var(--bd,#30363d)' }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--tx2)', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
                  💡 Marketplace vs D2C — what changes
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div style={{ padding: 12, background: 'rgba(63,185,80,0.06)', borderRadius: 10, border: '1px solid rgba(63,185,80,0.15)' }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#3fb950', marginBottom: 8 }}>D2C Website</div>
                    <div style={{ fontSize: 12, color: 'var(--tx2)', lineHeight: 1.8 }}>
                      ✅ 0% platform commission<br />
                      ✅ Your customer data<br />
                      ✅ Brand control<br />
                      ❌ You pay marketing/CAC<br />
                      ❌ You manage logistics<br />
                      Margin: ~40–60%
                    </div>
                  </div>
                  <div style={{ padding: 12, background: `${plat.color}08`, borderRadius: 10, border: `1px solid ${plat.color}20` }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: plat.color, marginBottom: 8 }}>{plat.name}</div>
                    <div style={{ fontSize: 12, color: 'var(--tx2)', lineHeight: 1.8 }}>
                      ✅ Ready traffic / discovery<br />
                      ✅ Trust + Prime badge<br />
                      ❌ {f.referralPct}% referral fee<br />
                      ❌ High return rates (~{f.returnRate}%)<br />
                      ❌ No customer data<br />
                      Margin: ~{ri(calc.actualMargin)}%
                    </div>
                  </div>
                </div>
              </div>

              {/* Save to product */}
              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  onClick={() => {
                    const text = [
                      `MARKETPLACE: ${plat.name}`,
                      `Product: ${f.productName || 'Unnamed'}`,
                      `Category: ${cat.label}`,
                      `Selling Price (list): ${₹(calc.sp)}`,
                      `Base Price (ex-GST): ${₹(calc.spExcl)}`,
                      `MRP (strikethrough): ${₹(calc.mrpSuggested)}`,
                      `Gross Profit/order: ${₹(calc.grossProfit)}`,
                      `Gross Margin: ${ri(calc.actualMargin)}%`,
                      `Platform fees total: ${₹(calc.totalFees)}`,
                    ].join('\n');
                    navigator.clipboard.writeText(text).catch(() => {});
                    setSaved(true);
                    setTimeout(() => setSaved(false), 2000);
                  }}
                  style={{
                    flex: 1, padding: '11px 0', borderRadius: 10, fontSize: 13, fontWeight: 600,
                    background: 'var(--input-bg,#21262d)', border: '1px solid var(--bd)', color: 'var(--tx2)', cursor: 'pointer',
                  }}>
                  {saved ? '✅ Copied!' : '📋 Copy Summary'}
                </button>
                <button
                  onClick={() => router.push('/admin/pricing/new')}
                  style={{
                    flex: 1, padding: '11px 0', borderRadius: 10, fontSize: 13, fontWeight: 600,
                    background: `${plat.color}`, border: 'none', color: '#fff', cursor: 'pointer',
                  }}>
                  Open D2C Calculator →
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
