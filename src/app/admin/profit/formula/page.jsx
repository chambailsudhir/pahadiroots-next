'use client';
// ─────────────────────────────────────────────────────────────────────────────
// Profit Formula Explainer — interactive tab for Profit & Margins page
// Shows step-by-step P&L with real Pahadi Roots product examples
// Drop this as a tab inside profit/page.jsx  OR  link as /admin/profit/formula
// ─────────────────────────────────────────────────────────────────────────────

import { useState } from 'react';

// ── real product examples ─────────────────────────────────────────────────────
const EXAMPLES = [
  {
    id: 'honey',
    emoji: '🍯',
    name: 'Himalayan Wild Honey',
    desc: '500g jar · GST 5% · D2C website order',
    inputs: {
      costPrice:   200,   // what you paid to source/make
      gstRate:     5,     // % GST on this product category
      sellingPrice:499,   // price_at_time (incl. GST) — what customer paid
      shippingCharge: 0,  // included in order (free shipping)
      refundable:  false, // was this order returned?
    },
  },
  {
    id: 'shilajit',
    emoji: '🌑',
    name: 'Pure Shilajit Resin',
    desc: '20g · GST 12% · COD order with return',
    inputs: {
      costPrice:   350,
      gstRate:     12,
      sellingPrice:899,
      shippingCharge: 0,
      refundable:  true,  // customer returned it → ₹899 refunded
    },
  },
  {
    id: 'tea',
    emoji: '🍵',
    name: 'Kangra Green Tea',
    desc: '100g · GST 5% · Prepaid order',
    inputs: {
      costPrice:   120,
      gstRate:     5,
      sellingPrice:349,
      shippingCharge: 0,
      refundable:  false,
    },
  },
];

// ── formula steps calculator ──────────────────────────────────────────────────
function calcSteps(inp) {
  const { costPrice, gstRate, sellingPrice, shippingCharge, refundable } = inp;

  const grossRevenue    = sellingPrice;                             // Step 1
  const refundDeduction = refundable ? sellingPrice : 0;           // Step 2
  const netCollected    = grossRevenue - refundDeduction;          // Step 3
  const gstAmount       = netCollected - (netCollected / (1 + gstRate / 100)); // Step 4
  const netRevExGST     = netCollected - gstAmount;                // Step 5
  const cogs            = costPrice;                               // Step 6
  const grossProfit     = netRevExGST - cogs;                      // Step 7
  const grossMargin     = netRevExGST > 0
    ? Math.round((grossProfit / netRevExGST) * 100) : 0;           // Step 8

  return {
    grossRevenue, refundDeduction, netCollected,
    gstAmount: Math.round(gstAmount),
    netRevExGST: Math.round(netRevExGST),
    cogs, grossProfit: Math.round(grossProfit), grossMargin,
    isRefunded: refundable,
  };
}

// ── helpers ───────────────────────────────────────────────────────────────────
const fmt_inr = (n) => '\u20B9' + Math.round(n).toLocaleString('en-IN');

function StepRow({ num, label, value, sub, type = 'normal', indent = false, animate = false }) {
  const colors = {
    normal:   { val: 'var(--tx,#e6edf3)',  bg: 'transparent' },
    positive: { val: '#3fb950',             bg: 'rgba(63,185,80,0.06)' },
    negative: { val: '#f85149',             bg: 'rgba(248,81,73,0.06)' },
    total:    { val: '#3fb950',             bg: 'rgba(63,185,80,0.1)'  },
    pct:      { val: '#d29922',             bg: 'rgba(210,153,34,0.08)'},
    zero:     { val: 'var(--tx3,#6e7681)', bg: 'transparent' },
  };
  const c = colors[type] || colors.normal;

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: type === 'total' || type === 'pct' ? '10px 12px' : '7px 12px',
      marginLeft: indent ? 16 : 0,
      background: c.bg,
      borderRadius: 8,
      borderTop: (type === 'total' || type === 'pct') ? '1px solid var(--bd,#30363d)' : 'none',
      marginTop: (type === 'total' || type === 'pct') ? 6 : 0,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{
          width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
          background: type === 'total' || type === 'pct'
            ? 'rgba(63,185,80,0.15)' : 'var(--input-bg,#21262d)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 10, fontWeight: 600,
          color: type === 'total' || type === 'pct' ? '#3fb950' : 'var(--tx3,#6e7681)',
        }}>
          {num}
        </div>
        <div>
          <div style={{ fontSize: 13, color: type === 'total' || type === 'pct' ? 'var(--tx)' : 'var(--tx2,#8b949e)', fontWeight: type === 'total' || type === 'pct' ? 600 : 400 }}>
            {label}
          </div>
          {sub && <div style={{ fontSize: 11, color: 'var(--tx3,#6e7681)', marginTop: 1 }}>{sub}</div>}
        </div>
      </div>
      <div style={{ fontSize: type === 'total' || type === 'pct' ? 16 : 14, fontWeight: type === 'total' || type === 'pct' ? 700 : 500, color: c.val, fontFamily: 'var(--font-mono, monospace)' }}>
        {value}
      </div>
    </div>
  );
}

function FormulaBox({ formula, color = '#58a6ff' }) {
  return (
    <div style={{
      fontFamily: 'var(--font-mono, monospace)', fontSize: 12,
      background: 'var(--input-bg,#21262d)', padding: '8px 14px',
      borderRadius: 8, marginTop: 6, marginBottom: 4,
      borderLeft: `3px solid ${color}`,
      color: 'var(--tx2,#8b949e)',
    }}>
      {formula}
    </div>
  );
}

// ── main component ────────────────────────────────────────────────────────────
export default function ProfitFormulaExplainer() {
  const [selectedEx, setSelectedEx] = useState('honey');
  const [showGSTDetail, setShowGSTDetail] = useState(false);

  const ex = EXAMPLES.find(e => e.id === selectedEx);
  const s  = calcSteps(ex.inputs);

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '0 0 48px' }}>

      {/* ── Header ── */}
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, color: 'var(--tx)', margin: 0 }}>
          📐 How Profit is Calculated — Step by Step
        </h2>
        <p style={{ fontSize: 13, color: 'var(--tx3)', marginTop: 6, lineHeight: 1.6 }}>
          Pick a real product below. Every rupee traced from customer payment → your pocket.
          No jargon. No shortcuts.
        </p>
      </div>

      {/* ── Product Selector ── */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 24 }}>
        {EXAMPLES.map(e => (
          <button key={e.id} onClick={() => setSelectedEx(e.id)}
            style={{
              flex: 1, padding: '12px 14px', borderRadius: 12, cursor: 'pointer',
              border: selectedEx === e.id
                ? '2px solid var(--accent,#3fb950)'
                : '1px solid var(--bd,#30363d)',
              background: selectedEx === e.id
                ? 'color-mix(in srgb, var(--accent,#3fb950) 10%, var(--bg,#0d1117))'
                : 'var(--bg2,#161b22)',
              textAlign: 'left', transition: 'all 0.15s',
            }}>
            <div style={{ fontSize: 20, marginBottom: 4 }}>{e.emoji}</div>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--tx)' }}>{e.name}</div>
            <div style={{ fontSize: 11, color: 'var(--tx3)', marginTop: 2 }}>{e.desc}</div>
          </button>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>

        {/* ── Left: Step-by-step P&L ── */}
        <div style={{ background: 'var(--bg2,#161b22)', borderRadius: 16, padding: 20, border: '1px solid var(--bd,#30363d)' }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--tx2)', marginBottom: 14, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
            {ex.emoji} {ex.name} — P&L trace
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>

            <StepRow
              num="1" label="Customer paid (incl. GST)"
              value={fmt_inr(s.grossRevenue)} type="normal"
              sub={`price_at_time in order_items = ₹${ex.inputs.sellingPrice}`}
            />

            {s.isRefunded ? (
              <StepRow
                num="2" label="Refund issued — order returned"
                value={`−${fmt_inr(s.refundDeduction)}`} type="negative" indent
                sub="returns.status = 'refunded' → full amount back to customer"
              />
            ) : (
              <StepRow
                num="2" label="Refunds (none this order)"
                value="₹0" type="zero" indent
                sub="no return filed"
              />
            )}

            <StepRow
              num="3" label="Net Revenue (collected)"
              value={fmt_inr(s.netCollected)}
              type={s.netCollected > 0 ? 'total' : 'negative'}
              sub={`Step 1 ${s.isRefunded ? `− Step 2 = ₹${s.grossRevenue} − ₹${s.refundDeduction}` : '(no refund)'}`}
            />

            <div style={{ height: 8 }} />

            <div style={{ fontSize: 11, color: 'var(--tx3)', padding: '0 12px', marginBottom: 2 }}>
              Now strip GST — this was collected for the govt, not yours:
            </div>
            <StepRow
              num="4" label={`GST @ ${ex.inputs.gstRate}% (govt liability)`}
              value={`−${fmt_inr(s.gstAmount)}`} type="negative" indent
              sub={`Formula: ₹${s.netCollected} − (₹${s.netCollected} ÷ ${1 + ex.inputs.gstRate/100})`}
            />
            <StepRow
              num="5" label="Net Revenue ex-GST ← YOUR real top line"
              value={fmt_inr(s.netRevExGST)} type="total"
              sub="This is what you actually earned. Everything below is from this."
            />

            <div style={{ height: 8 }} />

            <div style={{ fontSize: 11, color: 'var(--tx3)', padding: '0 12px', marginBottom: 2 }}>
              Now subtract what this product cost you:
            </div>
            <StepRow
              num="6" label="COGS — what you paid for this product"
              value={`−${fmt_inr(s.cogs)}`} type="negative" indent
              sub={`products.cost_price = ₹${ex.inputs.costPrice} × 1 unit`}
            />
            <StepRow
              num="7" label="Gross Profit"
              value={s.grossProfit >= 0 ? fmt_inr(s.grossProfit) : `−${fmt_inr(Math.abs(s.grossProfit))}`}
              type={s.grossProfit >= 0 ? 'total' : 'negative'}
              sub={`Step 5 − Step 6 = ₹${s.netRevExGST} − ₹${s.cogs}`}
            />
            <StepRow
              num="8" label="Gross Margin %"
              value={s.grossMargin + '%'} type="pct"
              sub={`Gross Profit ÷ Net Rev ex-GST × 100 = ₹${s.grossProfit} ÷ ₹${s.netRevExGST} × 100`}
            />

          </div>

          {/* Verdict */}
          <div style={{
            marginTop: 16, padding: '12px 16px', borderRadius: 12,
            background: s.isRefunded
              ? 'rgba(248,81,73,0.08)'
              : s.grossProfit > 0 ? 'rgba(63,185,80,0.08)' : 'rgba(248,81,73,0.08)',
            border: `1px solid ${s.isRefunded ? 'rgba(248,81,73,0.3)' : s.grossProfit > 0 ? 'rgba(63,185,80,0.3)' : 'rgba(248,81,73,0.3)'}`,
          }}>
            <div style={{ fontSize: 11, color: 'var(--tx3)', marginBottom: 4 }}>
              {s.isRefunded ? 'After this return, your pocket got:' : 'From this 1 order, your pocket got:'}
            </div>
            <div style={{ fontSize: 24, fontWeight: 700, color: s.grossProfit >= 0 && !s.isRefunded ? '#3fb950' : '#f85149' }}>
              {s.isRefunded ? '₹0 (refunded)' : fmt_inr(s.grossProfit)}
            </div>
            {!s.isRefunded && s.grossProfit > 0 && (
              <div style={{ fontSize: 11, color: 'var(--tx3)', marginTop: 4 }}>
                Out of every ₹100 collected, ₹{s.grossMargin} stayed with you after GST & COGS
              </div>
            )}
            {s.isRefunded && (
              <div style={{ fontSize: 11, color: '#f85149', marginTop: 4 }}>
                ₹{s.grossRevenue} collected → ₹{s.grossRevenue} refunded → net = ₹0. Reverse logistics cost is extra loss.
              </div>
            )}
          </div>
        </div>

        {/* ── Right: Formula explanations ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

          {/* What IS GST */}
          <div style={{ background: 'var(--bg2,#161b22)', borderRadius: 16, padding: 18, border: '1px solid var(--bd,#30363d)' }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#58a6ff', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
              🏛 GST — what it is & why we strip it
            </div>
            <div style={{ fontSize: 13, color: 'var(--tx2)', lineHeight: 1.7 }}>
              When a customer pays <strong style={{ color: 'var(--tx)' }}>₹{ex.inputs.sellingPrice}</strong>, that price already includes GST.
              You collected it on behalf of the government. It was <strong style={{ color: '#f85149' }}>never your money</strong>.
            </div>
            <FormulaBox
              formula={`GST amount = Price × gst_rate ÷ (100 + gst_rate)\n= ₹${ex.inputs.sellingPrice} × ${ex.inputs.gstRate} ÷ ${100 + ex.inputs.gstRate}\n= ₹${s.gstAmount}`}
              color="#58a6ff"
            />
            <div style={{ fontSize: 12, color: 'var(--tx3)', marginTop: 8, padding: '8px 10px', background: 'rgba(88,166,255,0.06)', borderRadius: 8 }}>
              💡 This is why "GST Collected" on the dashboard is shown separately as a <em>liability</em>, not profit.
              You remit CGST (₹{Math.round(s.gstAmount/2)}) + SGST (₹{Math.round(s.gstAmount/2)}) to the government.
            </div>
          </div>

          {/* What IS COGS */}
          <div style={{ background: 'var(--bg2,#161b22)', borderRadius: 16, padding: 18, border: '1px solid var(--bd,#30363d)' }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#d29922', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
              📦 COGS — cost of goods sold
            </div>
            <div style={{ fontSize: 13, color: 'var(--tx2)', lineHeight: 1.7 }}>
              COGS = <strong style={{ color: 'var(--tx)' }}>products.cost_price × units sold</strong>.
              This is what YOU paid to source or produce this product.
              <br /><br />
              For {ex.name}: you paid <strong style={{ color: 'var(--tx)' }}>₹{ex.inputs.costPrice}</strong> to get 1 unit.
            </div>
            <FormulaBox
              formula={`COGS = cost_price × qty\n= ₹${ex.inputs.costPrice} × 1\n= ₹${s.cogs}`}
              color="#d29922"
            />
            <div style={{ fontSize: 12, color: 'var(--tx3)', marginTop: 8, padding: '8px 10px', background: 'rgba(210,153,34,0.06)', borderRadius: 8 }}>
              ⚠️ If cost_price = ₹0 in DB, COGS = ₹0 → Gross Profit is overstated (fake 100% margin).
              Fill it in: Catalogue → Product → Cost Price.
            </div>
          </div>

          {/* Margin vs Markup */}
          <div style={{ background: 'var(--bg2,#161b22)', borderRadius: 16, padding: 18, border: '1px solid var(--bd,#30363d)' }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#3fb950', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
              📐 Margin % vs Markup % (people confuse these)
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div style={{ padding: '10px 12px', background: 'rgba(63,185,80,0.06)', borderRadius: 10, border: '1px solid rgba(63,185,80,0.2)' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#3fb950', marginBottom: 6 }}>MARGIN % (we use this)</div>
                <div style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--tx2)', lineHeight: 1.7 }}>
                  = Profit ÷ Revenue × 100<br />
                  = ₹{s.grossProfit} ÷ ₹{s.netRevExGST} × 100<br />
                  = <strong style={{ color: '#3fb950' }}>{s.grossMargin}%</strong>
                </div>
                <div style={{ fontSize: 11, color: 'var(--tx3)', marginTop: 6 }}>Industry standard. Amazon, Myntra use this.</div>
              </div>
              <div style={{ padding: '10px 12px', background: 'rgba(210,153,34,0.06)', borderRadius: 10, border: '1px solid rgba(210,153,34,0.2)' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#d29922', marginBottom: 6 }}>MARKUP % (avoid)</div>
                <div style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--tx2)', lineHeight: 1.7 }}>
                  = Profit ÷ COGS × 100<br />
                  = ₹{s.grossProfit} ÷ ₹{s.cogs} × 100<br />
                  = <strong style={{ color: '#d29922' }}>{s.cogs > 0 ? Math.round((s.grossProfit/s.cogs)*100) : '∞'}%</strong>
                </div>
                <div style={{ fontSize: 11, color: 'var(--tx3)', marginTop: 6 }}>Higher number, misleading for P&L decisions.</div>
              </div>
            </div>
          </div>

          {/* What net profit will include when expanded */}
          <div style={{ background: 'var(--bg2,#161b22)', borderRadius: 16, padding: 18, border: '1px solid var(--bd,#30363d)' }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--tx2)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
              🛣 Road to True Net Profit
            </div>
            <div style={{ fontSize: 13, lineHeight: 1.8 }}>
              {[
                { label: 'Gross Profit (now)',          val: fmt_inr(s.grossProfit),  color: '#3fb950' },
                { label: '− Shipping cost (per order)', val: '~₹80–120',       color: '#f85149' },
                { label: '− Packaging material',        val: '~₹15–30',        color: '#f85149' },
                { label: '− Return loss (12% rate)',     val: `~₹${Math.round(ex.inputs.sellingPrice * 0.12)}`, color: '#f85149' },
                { label: '− Marketing / CAC',           val: '~₹30–80',        color: '#f85149' },
                { label: '= True Net Profit',           val: 'track in Pricing Engine', color: '#d29922' },
              ].map((row, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: i < 5 ? '1px solid color-mix(in srgb, var(--bd) 40%, transparent)' : 'none', fontWeight: i === 5 ? 600 : 400 }}>
                  <span style={{ color: 'var(--tx2)', fontSize: 12 }}>{row.label}</span>
                  <span style={{ color: row.color, fontFamily: 'monospace', fontSize: 12 }}>{row.val}</span>
                </div>
              ))}
            </div>
            <div style={{ fontSize: 11, color: 'var(--tx3)', marginTop: 10, padding: '8px 10px', background: 'var(--input-bg,#21262d)', borderRadius: 8 }}>
              💡 Use Pricing Engine → New Product to get true per-unit net profit including all these costs.
            </div>
          </div>

        </div>
      </div>

      {/* ── Big picture sequence ── */}
      <div style={{ marginTop: 20, background: 'var(--bg2,#161b22)', borderRadius: 16, padding: 20, border: '1px solid var(--bd,#30363d)' }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--tx2)', marginBottom: 16, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
          🔄 Full P&L Sequence — how every rupee flows
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 0, overflowX: 'auto', paddingBottom: 8 }}>
          {[
            { label: 'Customer Pays', val: `₹${ex.inputs.sellingPrice}`, color: '#3fb950', icon: '💸' },
            { label: '→ Refund?', val: s.isRefunded ? `−₹${ex.inputs.sellingPrice}` : 'No', color: s.isRefunded ? '#f85149' : 'var(--tx3)', icon: '↩️' },
            { label: '→ Strip GST', val: `−₹${s.gstAmount}`, color: '#58a6ff', icon: '🏛' },
            { label: '→ Net Rev', val: `₹${s.netRevExGST}`, color: '#3fb950', icon: '📊' },
            { label: '→ Strip COGS', val: `−₹${s.cogs}`, color: '#d29922', icon: '📦' },
            { label: '→ Gross Profit', val: `₹${s.grossProfit}`, color: s.grossProfit >= 0 ? '#3fb950' : '#f85149', icon: '🤑' },
          ].map((step, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
              <div style={{ textAlign: 'center', minWidth: 100 }}>
                <div style={{ fontSize: 18, marginBottom: 4 }}>{step.icon}</div>
                <div style={{ fontSize: 11, color: 'var(--tx3)', marginBottom: 3 }}>{step.label}</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: step.color, fontFamily: 'monospace' }}>{step.val}</div>
              </div>
              {i < 5 && (
                <div style={{ fontSize: 18, color: 'var(--tx3)', margin: '0 2px', paddingBottom: 20 }}>›</div>
              )}
            </div>
          ))}
        </div>
      </div>

    </div>
  );
}
