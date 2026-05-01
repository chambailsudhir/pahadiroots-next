'use client';
import { useState, useCallback } from 'react';

// ── Helpers ────────────────────────────────────────────────────
function ri(n)   { return Math.round(Number(n) || 0); }
function r2(n)   { return Math.round((Number(n) || 0) * 100) / 100; }
function fmtR(n) { return '₹' + ri(n).toLocaleString('en-IN'); }
function fmtR2(n){ return '₹' + r2(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function pct(n)  { return ri(n) + '%'; }
function nv(v)   { return Number(v) || 0; }

// ── Field component ────────────────────────────────────────────
function Field({ label, hint, value, onChange, unit = '', prefix = '', type = 'number', step, min = 0, computed, computedLabel, accent }) {
  return (
    <div className="grid items-start gap-3 py-3 border-b" style={{ gridTemplateColumns: '1fr 140px', borderColor: 'var(--bd,#30363d)' }}>
      <div>
        <div className="text-[12px] font-semibold" style={{ color: 'var(--tx,#e6edf3)' }}>{label}</div>
        {hint && <div className="text-[11px] mt-1 leading-relaxed" style={{ color: 'var(--tx2,#8b949e)' }}>{hint}</div>}
        {computed !== undefined && (
          <div className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-mono px-2 py-0.5 rounded"
            style={{ background: 'var(--bg,#0d1117)', color: accent ? 'var(--accent,#3fb950)' : 'var(--tx2,#8b949e)' }}>
            {computedLabel && <span style={{ color: 'var(--tx2,#8b949e)' }}>{computedLabel}</span>}
            <span className="font-bold">{computed}</span>
          </div>
        )}
      </div>
      <div>
        <div className="flex items-center gap-1">
          {prefix && <span className="text-[12px] font-bold" style={{ color: 'var(--tx2,#8b949e)' }}>{prefix}</span>}
          <input
            type={type} value={value} step={step || 1} min={min}
            onChange={e => onChange(e.target.value)}
            className="w-full px-3 py-2 rounded-lg text-[13px] font-bold border text-right"
            style={{ background: 'var(--bg,#0d1117)', borderColor: 'var(--bd,#30363d)', color: 'var(--tx,#e6edf3)', outline: 'none' }}
          />
        </div>
        {unit && <div className="text-[10px] text-right mt-1" style={{ color: 'var(--tx2,#8b949e)' }}>{unit}</div>}
      </div>
    </div>
  );
}

// ── Section wrapper ────────────────────────────────────────────
function Section({ num, title, sub, color, badge, badgeText, result, resultLabel, children }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="rounded-xl border overflow-hidden mb-3" style={{ background: 'var(--bg2,#161b22)', borderColor: 'var(--bd,#30363d)' }}>
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center gap-3 px-4 py-3 text-left">
        <span className="w-7 h-7 rounded-full text-[11px] font-bold flex items-center justify-center flex-none"
          style={{ background: badge, color: badgeText }}>{num}</span>
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-semibold" style={{ color: 'var(--tx,#e6edf3)' }}>{title}</div>
          <div className="text-[11px]" style={{ color: 'var(--tx2,#8b949e)' }}>{sub}</div>
        </div>
        {result !== undefined && (
          <div className="text-right flex-none">
            <div className="text-[14px] font-bold" style={{ color }}>{fmtR2(result)}</div>
            {resultLabel && <div className="text-[10px]" style={{ color: 'var(--tx2,#8b949e)' }}>{resultLabel}</div>}
          </div>
        )}
        <span style={{ color: 'var(--tx2,#8b949e)', fontSize: 10, transform: open ? 'rotate(180deg)' : 'none', display: 'inline-block', transition: 'transform .2s', marginLeft: 4 }}>▼</span>
      </button>
      {open && <div className="border-t px-4" style={{ borderColor: 'var(--bd,#30363d)' }}>{children}</div>}
    </div>
  );
}

// ── Summary row ────────────────────────────────────────────────
function SumRow({ label, formula, val, accent, big }) {
  return (
    <div className="flex items-center justify-between py-2.5 border-b last:border-b-0"
      style={{ borderColor: 'var(--bd,#30363d)' }}>
      <div>
        <div className={`font-semibold ${big ? 'text-[13px]' : 'text-[12px]'}`} style={{ color: 'var(--tx,#e6edf3)' }}>{label}</div>
        {formula && <div className="text-[10px] font-mono mt-0.5" style={{ color: 'var(--tx2,#8b949e)' }}>{formula}</div>}
      </div>
      <div className={`font-bold text-right ${big ? 'text-[16px]' : 'text-[13px]'}`}
        style={{ color: accent || (big ? 'var(--accent,#3fb950)' : 'var(--tx,#e6edf3)') }}>
        {fmtR2(val)}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ══════════════════════════════════════════════════════════════
export default function BulkCalcPage() {

  // ── Section 1: Bulk purchase ──
  const [totalUnits,        setTotalUnits]        = useState(1000);
  const [productCostBulk,   setProductCostBulk]   = useState(50000);
  const [packagingCostBulk, setPackagingCostBulk] = useState(10000);
  const [wastePct,          setWastePct]           = useState(0);

  // ── Section 2: Warehouse & storage ──
  const [monthlyRent,       setMonthlyRent]        = useState(50000);
  const [ordersPerMonth,    setOrdersPerMonth]     = useState(5000);
  const [holdingPerUnit,    setHoldingPerUnit]     = useState(3);
  const [avgDaysStock,      setAvgDaysStock]       = useState(30);

  // ── Section 3: Processing & labour ──
  const [processingPerUnit, setProcessingPerUnit]  = useState(5);
  const [qualityCheckPct,   setQualityCheckPct]    = useState(2);
  const [labourPerUnit,     setLabourPerUnit]      = useState(8);

  // ── Section 4: Logistics ──
  const [shippingPerOrder,  setShippingPerOrder]   = useState(65);
  const [codCharge,         setCodCharge]          = useState(20);
  const [codPct,            setCodPct]             = useState(50);
  const [pgFee,             setPgFee]              = useState(8);
  const [logisticsGst,      setLogisticsGst]       = useState(18);

  // ── Section 5: Returns ──
  const [returnRate,        setReturnRate]         = useState(10);
  const [reverseShipping,   setReverseShipping]    = useState(65);
  const [repackagingCost,   setRepackagingCost]    = useState(15);

  // ── Section 6: Overheads & marketing ──
  const [adSpendMonthly,    setAdSpendMonthly]     = useState(50000);
  const [opsTeamMonthly,    setOpsTeamMonthly]     = useState(30000);
  const [platformPct,       setPlatformPct]        = useState(10);
  const [hiddenCostPct,     setHiddenCostPct]      = useState(5);

  // ── Section 7: Target margin ──
  const [targetMarginPct,   setTargetMarginPct]    = useState(25);
  const [outputGst,         setOutputGst]          = useState(5);
  const [mrpMultiplier,     setMrpMultiplier]      = useState(1.6);

  // ══════════════════════════════════════════════════════════════
  // CALCULATION ENGINE — top-down, step by step
  // ══════════════════════════════════════════════════════════════
  const c = (() => {
    // 1. Bulk purchase
    const units       = nv(totalUnits) || 1;
    const usableUnits = units * (1 - nv(wastePct) / 100);
    const perUnit_product  = nv(productCostBulk)   / (usableUnits || 1);
    const perUnit_packaging = nv(packagingCostBulk) / (usableUnits || 1);

    // 2. Warehouse & storage allocation
    const orders     = nv(ordersPerMonth) || 1;
    const perUnit_warehouse = nv(monthlyRent) / orders;   // warehouse rent allocated per order shipped
    const perUnit_holding   = nv(holdingPerUnit);

    // 3. Processing & labour (per unit)
    const perUnit_processing = nv(processingPerUnit);
    const qualityRejections  = perUnit_product * (nv(qualityCheckPct) / 100); // cost of rejected units spread
    const perUnit_labour     = nv(labourPerUnit);

    // 4. Logistics (blended per order)
    const blended_cod  = nv(codCharge) * (nv(codPct) / 100);
    const log_base     = nv(shippingPerOrder) + blended_cod + nv(pgFee);
    const perOrder_log = log_base * (1 + nv(logisticsGst) / 100);

    // 5. Returns (cost per order, spread)
    const returnCostPerOrder = (nv(reverseShipping) + nv(repackagingCost)) * (nv(returnRate) / 100);

    // 6. Overheads & marketing
    const perOrder_ads      = nv(adSpendMonthly) / orders;
    const perOrder_ops      = nv(opsTeamMonthly) / orders;
    const platform_amt      = 0; // calculated after SP — placeholder
    const hidden_mult       = 1 + nv(hiddenCostPct) / 100;

    // ── Total landed cost per order (BEFORE platform fee and margin)
    const rawCost =
      perUnit_product +
      perUnit_packaging +
      perUnit_warehouse +
      perUnit_holding +
      perUnit_processing +
      qualityRejections +
      perUnit_labour +
      perOrder_log +
      returnCostPerOrder +
      perOrder_ads +
      perOrder_ops;

    // Apply hidden cost buffer
    const costBeforePlatform = rawCost * hidden_mult;

    // Platform fee is on selling price — need to solve iteratively
    // SP = (cost + SP * platform%) / (1 - margin%) ... circular
    // Standard approach: cost = SP * (1 - margin% - platform%)
    // SP = cost / (1 - margin% - platform%)
    const platFrac   = nv(platformPct) / 100;
    const marginFrac = nv(targetMarginPct) / 100;
    const denominator = 1 - platFrac - marginFrac;
    const sp_excl_gst = denominator > 0 ? costBeforePlatform / denominator : costBeforePlatform * 2;
    const platform_fee_amt = sp_excl_gst * platFrac;
    const totalCost  = costBeforePlatform + platform_fee_amt;
    const profit_val = sp_excl_gst - totalCost;
    const sp         = sp_excl_gst * (1 + nv(outputGst) / 100);
    const mrp        = sp * (nv(mrpMultiplier) || 1);
    const margin_actual = sp_excl_gst > 0 ? (profit_val / sp_excl_gst * 100) : 0;
    const disc       = sp > 0 && mrp > sp ? ri((1 - sp / mrp) * 100) : 0;
    const base_price = sp / (1 + nv(outputGst) / 100);
    const gst_amt_out = sp - base_price;

    return {
      usableUnits, perUnit_product, perUnit_packaging,
      perUnit_warehouse, perUnit_holding,
      perUnit_processing, qualityRejections, perUnit_labour,
      blended_cod, perOrder_log, returnCostPerOrder,
      perOrder_ads, perOrder_ops,
      rawCost, costBeforePlatform, platform_fee_amt,
      totalCost, profit_val, sp_excl_gst, sp, mrp,
      margin_actual, disc, base_price, gst_amt_out,
    };
  })();

  // ── Push to pricing calculator via sessionStorage ──
  const pushToPricing = useCallback(() => {
    const data = {
      purchase: r2(c.perUnit_product),
      // packaging already per-unit
      packaging: r2(c.perUnit_packaging),
      labor:     r2(nv(labourPerUnit)),
      warehouse: r2(c.perUnit_warehouse),
      inventory: r2(nv(holdingPerUnit)),
      shipping:  r2(nv(shippingPerOrder)),
      cod_charge: r2(nv(codCharge)),
      cod_pct:   r2(nv(codPct)),
      pg:        r2(nv(pgFee)),
      gst_log:   r2(nv(logisticsGst)),
      return_rate: r2(nv(returnRate)),
      return_cost: r2(nv(reverseShipping) + nv(repackagingCost)),
      platform_pct: r2(nv(platformPct)),
      marketing:  r2(c.perOrder_ads),
      ops:        r2(c.perOrder_ops),
      gst_in:     5,
      gst_out:    r2(nv(outputGst)),
      mrp_mult:   r2(nv(mrpMultiplier)),
    };
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('bulk_to_pricing', JSON.stringify(data));
    }
    window.location.href = '/admin/pricing?from=bulk';
  }, [c, labourPerUnit, holdingPerUnit, shippingPerOrder, codCharge, codPct, pgFee, logisticsGst, returnRate, reverseShipping, repackagingCost, platformPct, adSpendMonthly, opsTeamMonthly, outputGst, mrpMultiplier, ordersPerMonth]);

  // ── Waterfall breakdown ──
  const wfRows = [
    { label: 'Product cost / unit',        val: c.perUnit_product,     col: '#378ADD', formula: `₹${ri(nv(productCostBulk))} ÷ ${ri(c.usableUnits)} usable units` },
    { label: 'Packaging cost / unit',       val: c.perUnit_packaging,   col: '#378ADD', formula: `₹${ri(nv(packagingCostBulk))} ÷ ${ri(c.usableUnits)} units` },
    { label: 'Warehouse rent / order',      val: c.perUnit_warehouse,   col: '#C8820A', formula: `₹${ri(nv(monthlyRent))} ÷ ${ri(nv(ordersPerMonth))} orders/month` },
    { label: 'Holding cost / unit',         val: c.perUnit_holding,     col: '#C8820A', formula: 'Set per unit' },
    { label: 'Processing & QC / unit',      val: c.perUnit_processing + c.qualityRejections, col: '#C8820A', formula: `Processing ₹${ri(nv(processingPerUnit))} + QC rejections ₹${r2(c.qualityRejections)}` },
    { label: 'Packing labour / unit',       val: c.perUnit_labour,      col: '#C8820A', formula: 'Set per unit' },
    { label: 'Logistics / order (blended)', val: c.perOrder_log,        col: '#1D9E75', formula: `(Ship ₹${ri(nv(shippingPerOrder))} + COD ₹${r2(c.blended_cod)} + PG ₹${ri(nv(pgFee))}) × ${1 + nv(logisticsGst)/100}x GST` },
    { label: 'Return cost / order',         val: c.returnCostPerOrder,  col: '#E24B4A', formula: `(₹${ri(nv(reverseShipping))} rev-ship + ₹${ri(nv(repackagingCost))} repack) × ${nv(returnRate)}%` },
    { label: 'Marketing (CAC) / order',     val: c.perOrder_ads,        col: '#7F77DD', formula: `₹${ri(nv(adSpendMonthly))}/month ÷ ${ri(nv(ordersPerMonth))} orders` },
    { label: 'Ops & team / order',          val: c.perOrder_ops,        col: '#7F77DD', formula: `₹${ri(nv(opsTeamMonthly))}/month ÷ ${ri(nv(ordersPerMonth))} orders` },
    { label: `Hidden cost buffer (${nv(hiddenCostPct)}%)`, val: c.costBeforePlatform - c.rawCost, col: '#7F77DD', formula: `Raw cost ₹${ri(c.rawCost)} × ${nv(hiddenCostPct)}%` },
    { label: `Platform fee (${nv(platformPct)}%)`,         val: c.platform_fee_amt,  col: '#7F77DD', formula: `On selling price ₹${ri(c.sp_excl_gst)}` },
  ];
  const maxVal = c.sp_excl_gst || 1;

  return (
    <div style={{ color: 'var(--tx,#e6edf3)' }}>

      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-4 flex-wrap mb-5">
        <div>
          <h1 className="text-[20px] font-bold" style={{ color: 'var(--tx,#e6edf3)' }}>Bulk cost calculator</h1>
          <p className="text-[12px] mt-1" style={{ color: 'var(--tx2,#8b949e)' }}>
            How large D2C brands calculate cost: start from bulk purchase → allocate every cost to a single unit → get true selling price
          </p>
        </div>
        <button onClick={pushToPricing}
          className="px-5 py-2 rounded-lg text-[13px] font-bold transition"
          style={{ background: 'var(--accent,#3fb950)', color: '#fff' }}>
          Push all costs → Pricing engine
        </button>
      </div>

      {/* ── Explainer banner ── */}
      <div className="rounded-xl p-4 mb-5 flex items-start gap-3"
        style={{ background: 'var(--bg2,#161b22)', border: '1px solid var(--bd,#30363d)' }}>
        <div className="text-[20px] flex-none">📦</div>
        <div>
          <div className="text-[13px] font-semibold mb-1" style={{ color: 'var(--tx,#e6edf3)' }}>
            How Amazon sellers & D2C brands actually calculate cost
          </div>
          <div className="text-[12px] leading-relaxed" style={{ color: 'var(--tx2,#8b949e)' }}>
            You buy <b style={{ color: 'var(--accent,#3fb950)' }}>1,000 units</b> for ₹50,000 (= ₹50/unit).
            Then you allocate <b style={{ color: '#C8820A' }}>warehouse rent</b> (₹50,000/month ÷ 5,000 orders = ₹10/order),
            <b style={{ color: '#1D9E75' }}> logistics</b>, <b style={{ color: '#E24B4A' }}>returns</b>,
            <b style={{ color: '#7F77DD' }}> marketing CAC</b> — all divided by monthly orders.
            The sum is your <b style={{ color: 'var(--accent,#3fb950)' }}>true cost per order</b>.
            Only then do you add margin to get your <b style={{ color: 'var(--accent,#3fb950)' }}>selling price</b>.
          </div>
          <div className="flex items-center gap-2 mt-3 text-[11px] font-semibold flex-wrap">
            {['Buy bulk', 'Per-unit cost', 'Warehouse ÷ orders', 'Logistics + returns', 'Marketing ÷ orders', 'Add margin', 'Get MRP'].map((s, i, arr) => (
              <span key={i} className="flex items-center gap-1">
                <span className="px-2 py-0.5 rounded" style={{ background: 'var(--bg,#0d1117)', color: 'var(--accent,#3fb950)' }}>{s}</span>
                {i < arr.length - 1 && <span style={{ color: 'var(--tx2,#8b949e)' }}>→</span>}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* ── Two-column layout ── */}
      <div className="grid gap-5" style={{ gridTemplateColumns: '1fr 360px', alignItems: 'start' }}>

        {/* LEFT — input sections */}
        <div>

          {/* Section 1: Bulk purchase */}
          <Section num={1} title="Bulk purchase" sub="What you bought and what it cost"
            color="#378ADD" badge="#E6F1FB" badgeText="#185FA5"
            result={c.perUnit_product + c.perUnit_packaging} resultLabel="product + pkg / unit">
            <Field label="Total units bought" hint="Ek baar me kitne units kharidi? (bottles, packets, kg, pieces)"
              value={totalUnits} onChange={setTotalUnits} unit="units" />
            <Field label="Product cost (bulk total ₹)" hint="Supplier ko total kitna diya — invoice amount"
              value={productCostBulk} onChange={setProductCostBulk} unit="₹ total invoice"
              computed={`₹${r2(c.perUnit_product).toFixed(2)} / unit`} computedLabel="= " />
            <Field label="Packaging cost (bulk total ₹)" hint="Boxes, bottles, pouches, labels — total bulk order cost"
              value={packagingCostBulk} onChange={setPackagingCostBulk} unit="₹ total"
              computed={`₹${r2(c.perUnit_packaging).toFixed(2)} / unit`} computedLabel="= " />
            <Field label="Wastage / rejection %" hint="Damaged, broken or unusable units from this bulk batch. Enter 0 if none."
              value={wastePct} onChange={setWastePct} unit="%" min={0}
              computed={wastePct > 0 ? `${ri(c.usableUnits)} usable units after ${wastePct}% waste` : 'No wastage'} />
          </Section>

          {/* Section 2: Warehouse & storage */}
          <Section num={2} title="Warehouse & storage allocation" sub="Monthly fixed costs divided by monthly orders shipped"
            color="#C8820A" badge="#FAEEDA" badgeText="#854F0B"
            result={c.perUnit_warehouse + c.perUnit_holding} resultLabel="storage cost / order">
            <Field label="Monthly warehouse rent (₹)" hint="Total monthly rent including electricity, security, maintenance"
              value={monthlyRent} onChange={setMonthlyRent} unit="₹ / month"
              computed={`₹${r2(c.perUnit_warehouse).toFixed(2)} / order`}
              computedLabel={`₹${ri(nv(monthlyRent))} ÷ ${ri(nv(ordersPerMonth))} orders = `} />
            <Field label="Orders shipped (monthly)" hint="Total orders you dispatch in a month — your denominator for all fixed cost allocation"
              value={ordersPerMonth} onChange={setOrdersPerMonth} unit="orders / month" />
            <Field label="Holding cost per unit (₹)" hint="Capital locked in stock × interest rate / 365 × avg days held. Or use ₹3–8 as estimate."
              value={holdingPerUnit} onChange={setHoldingPerUnit} unit="₹ / unit" />
            <Field label="Avg days stock held" hint="How many days does stock sit in warehouse before selling? Used to calculate capital cost."
              value={avgDaysStock} onChange={setAvgDaysStock} unit="days"
              computed={`Capital tied up: ₹${ri(nv(productCostBulk))} for ${avgDaysStock} days`} />
          </Section>

          {/* Section 3: Processing & labour */}
          <Section num={3} title="Processing & labour" sub="Cost to process, check quality and pack each unit"
            color="#C8820A" badge="#FAEEDA" badgeText="#854F0B"
            result={c.perUnit_processing + c.qualityRejections + c.perUnit_labour} resultLabel="processing / unit">
            <Field label="Processing cost per unit (₹)" hint="Cleaning, sorting, cutting, grinding — any transformation cost before packing"
              value={processingPerUnit} onChange={setProcessingPerUnit} unit="₹ / unit" />
            <Field label="Quality check rejection %" hint="What % of processed units get rejected at QC? Their cost spreads to remaining good units."
              value={qualityCheckPct} onChange={setQualityCheckPct} unit="%"
              computed={`₹${r2(c.qualityRejections).toFixed(2)} / unit extra cost from rejections`} />
            <Field label="Packing labour per unit (₹)" hint="Monthly packing staff salary ÷ units packed. Or per-unit piece-rate."
              value={labourPerUnit} onChange={setLabourPerUnit} unit="₹ / unit" />
          </Section>

          {/* Section 4: Logistics */}
          <Section num={4} title="Logistics & payments" sub="Delivery, COD handling and payment gateway — blended per order"
            color="#1D9E75" badge="#E1F5EE" badgeText="#0F6E56"
            result={c.perOrder_log} resultLabel="logistics cost / order">
            <Field label="Forward shipping per order (₹)" hint="Shiprocket / Delhivery / Ecom Express rate for your average order weight + zone"
              value={shippingPerOrder} onChange={setShippingPerOrder} unit="₹ / order" />
            <Field label="COD charge per COD order (₹)" hint="Extra fee courier charges to collect cash. Applied only on COD orders."
              value={codCharge} onChange={setCodCharge} unit="₹ / COD order" />
            <Field label="COD order mix %" hint="Kitne % orders COD hain? India D2C average 55–70%."
              value={codPct} onChange={setCodPct} unit="%"
              computed={`Blended COD cost = ₹${r2(c.blended_cod).toFixed(2)} / order`}
              computedLabel={`₹${ri(nv(codCharge))} × ${nv(codPct)}% = `} />
            <Field label="Payment gateway fee (₹)" hint="Razorpay / PayU flat fee or percentage on prepaid orders"
              value={pgFee} onChange={setPgFee} unit="₹ / prepaid order" />
            <Field label="GST on logistics %" hint="18% GST mandatory on all courier invoices. Cannot be avoided."
              value={logisticsGst} onChange={setLogisticsGst} unit="%"
              computed={`Total logistics = ₹${r2(c.perOrder_log).toFixed(2)} / order (incl. ${logisticsGst}% GST)`} />
          </Section>

          {/* Section 5: Returns */}
          <Section num={5} title="Returns & reversal" sub="Cost of returns spread across all orders as a per-order charge"
            color="#E24B4A" badge="#FCEBEB" badgeText="#A32D2D"
            result={c.returnCostPerOrder} resultLabel="return cost / order">
            <Field label="Return rate %" hint="Kitne % orders wapas aate hain? D2C average 8–15%. COD pe zyada hota hai."
              value={returnRate} onChange={setReturnRate} unit="%" />
            <Field label="Reverse shipping cost (₹)" hint="Cost to pick up returned order from customer. Usually same as forward or slightly less."
              value={reverseShipping} onChange={setReverseShipping} unit="₹ / return" />
            <Field label="Repackaging & restocking (₹)" hint="Cost to inspect, repack and restock a returned unit. Includes staff time."
              value={repackagingCost} onChange={setRepackagingCost} unit="₹ / return"
              computed={`Return cost / order = ₹${r2(c.returnCostPerOrder).toFixed(2)}`}
              computedLabel={`(₹${ri(nv(reverseShipping))}+₹${ri(nv(repackagingCost))})×${nv(returnRate)}% = `} />
          </Section>

          {/* Section 6: Overheads & marketing */}
          <Section num={6} title="Overheads, marketing & platform" sub="Monthly fixed costs allocated per order + platform commission"
            color="#7F77DD" badge="#EEEDFE" badgeText="#534AB7"
            result={c.perOrder_ads + c.perOrder_ops + c.platform_fee_amt} resultLabel="overheads / order">
            <Field label="Ad spend / marketing (₹/month)" hint="Facebook, Google, influencer — total monthly spend. Divided by monthly orders = CAC per order."
              value={adSpendMonthly} onChange={setAdSpendMonthly} unit="₹ / month"
              computed={`₹${r2(c.perOrder_ads).toFixed(2)} / order CAC`}
              computedLabel={`₹${ri(nv(adSpendMonthly))} ÷ ${ri(nv(ordersPerMonth))} = `} />
            <Field label="Ops & team cost (₹/month)" hint="Customer support, tech tools, software, team salaries — monthly total"
              value={opsTeamMonthly} onChange={setOpsTeamMonthly} unit="₹ / month"
              computed={`₹${r2(c.perOrder_ops).toFixed(2)} / order`}
              computedLabel={`₹${ri(nv(opsTeamMonthly))} ÷ ${ri(nv(ordersPerMonth))} = `} />
            <Field label="Platform / marketplace fee %" hint="Amazon / Flipkart / Meesho commission on selling price. Category-wise: 5–25%."
              value={platformPct} onChange={setPlatformPct} unit="% of selling price"
              computed={`₹${r2(c.platform_fee_amt).toFixed(2)} / order`}
              computedLabel="Applied on SP → " />
            <Field label="Hidden cost buffer %" hint="Discounts, COD failures, chargebacks, freebies — add 5–10% buffer on total cost"
              value={hiddenCostPct} onChange={setHiddenCostPct} unit="%"
              computed={`₹${r2(c.costBeforePlatform - c.rawCost).toFixed(2)} / order buffer`} />
          </Section>

          {/* Section 7: Target margin & pricing */}
          <Section num={7} title="Margin & final pricing" sub="Target profit margin, GST and MRP — calculated on top of full cost"
            color="#639922" badge="#EAF3DE" badgeText="#3B6D11"
            result={c.sp} resultLabel="selling price (incl GST)">
            <Field label="Target gross margin %" hint="Industry benchmarks: FMCG 30–40%, D2C food 25–35%, beauty/personal care 40–60%."
              value={targetMarginPct} onChange={setTargetMarginPct} unit="% of selling price"
              computed={`Profit / order = ₹${r2(c.profit_val).toFixed(2)}`}
              computedLabel="→ " accent />
            <Field label="Output GST %" hint="GST you charge customer. Food (5%), processed food (12%), beauty (18%). Check your HSN code."
              value={outputGst} onChange={setOutputGst} unit="%"
              computed={`GST = ₹${r2(c.gst_amt_out).toFixed(2)}  →  Selling ₹${r2(c.sp).toFixed(2)}`}
              computedLabel={`₹${ri(c.base_price)} × ${outputGst}% = `} />
            <Field label="MRP multiplier" hint="MRP = selling price × this. Higher = bigger discount shown to customer. 1.6x = 37% off shown."
              value={mrpMultiplier} onChange={setMrpMultiplier} unit="× selling price" step={0.05}
              computed={`MRP ₹${ri(c.mrp)}  →  ${c.disc}% off shown to customer`}
              computedLabel={`₹${ri(c.sp)} × ${nv(mrpMultiplier).toFixed(2)} = `} accent />
          </Section>
        </div>

        {/* RIGHT — live results panel */}
        <div className="sticky top-4 space-y-3">

          {/* MRP hero card */}
          <div className="rounded-xl border overflow-hidden" style={{ background: 'var(--bg2,#161b22)', borderColor: 'var(--bd,#30363d)' }}>
            <div className="p-4 border-b" style={{ borderColor: 'var(--bd,#30363d)' }}>
              <div className="text-[10px] font-bold tracking-widest uppercase mb-1" style={{ color: 'var(--tx2,#8b949e)' }}>Suggested MRP</div>
              <div className="text-[36px] font-bold leading-none" style={{ color: 'var(--tx,#e6edf3)' }}>{fmtR(c.mrp)}</div>
              <div className="flex items-center gap-2 mt-2">
                <span className="text-[14px] line-through" style={{ color: 'var(--tx2,#8b949e)' }}>{fmtR(c.sp)}</span>
                <span className="text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ background: '#EAF3DE', color: '#27500A' }}>
                  {c.disc}% off shown
                </span>
              </div>
              {/* Margin bar */}
              <div className="mt-3">
                <div className="flex justify-between text-[11px] mb-1">
                  <span style={{ color: 'var(--tx2,#8b949e)' }}>Gross margin</span>
                  <span className="font-bold" style={{ color: c.margin_actual > 25 ? '#27500A' : c.margin_actual > 15 ? '#854F0B' : '#A32D2D' }}>
                    {ri(c.margin_actual)}%
                  </span>
                </div>
                <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--bg,#0d1117)' }}>
                  <div className="h-full rounded-full transition-all"
                    style={{ width: `${Math.min(100, Math.max(0, ri(c.margin_actual)))}%`,
                      background: c.margin_actual > 25 ? '#639922' : c.margin_actual > 15 ? '#C8820A' : '#E24B4A' }} />
                </div>
                <div className="text-[10px] mt-1" style={{ color: 'var(--tx2,#8b949e)' }}>
                  {c.margin_actual > 30 ? '✓ Excellent — strong D2C margin'
                    : c.margin_actual > 20 ? '✓ Healthy — within industry range'
                    : c.margin_actual > 10 ? '⚠ Tight — review your costs'
                    : '✗ Loss-making — increase price or cut costs'}
                </div>
              </div>
            </div>

            {/* Key metrics */}
            <div className="grid grid-cols-2">
              {[
                { label: 'True cost / order', val: c.totalCost, col: '#C8820A' },
                { label: 'Selling price',     val: c.sp,        col: 'var(--accent,#3fb950)' },
                { label: 'Profit / order',    val: c.profit_val, col: '#27500A' },
                { label: 'MRP',              val: c.mrp,        col: 'var(--tx,#e6edf3)' },
              ].map((s, i) => (
                <div key={i} className="px-3 py-2.5 border-r border-b"
                  style={{ borderColor: 'var(--bd,#30363d)', borderRight: i % 2 === 1 ? 'none' : undefined, borderBottom: i >= 2 ? 'none' : undefined }}>
                  <div className="text-[10px]" style={{ color: 'var(--tx2,#8b949e)' }}>{s.label}</div>
                  <div className="text-[14px] font-bold" style={{ color: s.col }}>{fmtR2(s.val)}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Cost breakdown waterfall */}
          <div className="rounded-xl border overflow-hidden" style={{ background: 'var(--bg2,#161b22)', borderColor: 'var(--bd,#30363d)' }}>
            <div className="px-4 py-3 border-b" style={{ borderColor: 'var(--bd,#30363d)' }}>
              <div className="text-[11px] font-bold tracking-widest uppercase" style={{ color: 'var(--tx2,#8b949e)' }}>Cost waterfall</div>
              <div className="text-[10px] mt-0.5" style={{ color: 'var(--tx2,#8b949e)' }}>Every cost allocated to one order</div>
            </div>
            <div className="px-4 py-3 space-y-2.5">
              {wfRows.map((row, i) => {
                const w = maxVal > 0 ? Math.max(3, ri(row.val / maxVal * 100)) : 0;
                return (
                  <div key={i}>
                    <div className="flex items-center gap-2 text-[11px] mb-0.5">
                      <div className="w-2 h-2 rounded-full flex-none" style={{ background: row.col }} />
                      <div className="flex-1" style={{ color: 'var(--tx2,#8b949e)' }}>{row.label}</div>
                      <div className="font-bold flex-none" style={{ color: 'var(--tx,#e6edf3)' }}>{fmtR2(row.val)}</div>
                    </div>
                    <div className="ml-4 text-[9px] font-mono mb-1" style={{ color: 'var(--tx2,#8b949e)', opacity: 0.7 }}>{row.formula}</div>
                    <div className="ml-4 h-1 rounded-full overflow-hidden" style={{ background: 'var(--bg,#0d1117)' }}>
                      <div className="h-full rounded-full transition-all" style={{ width: `${w}%`, background: row.col }} />
                    </div>
                  </div>
                );
              })}
              <div className="pt-2 border-t" style={{ borderColor: 'var(--bd,#30363d)' }}>
                <div className="flex items-center justify-between text-[12px] font-bold">
                  <span style={{ color: 'var(--tx,#e6edf3)' }}>Total cost / order</span>
                  <span style={{ color: '#C8820A' }}>{fmtR2(c.totalCost)}</span>
                </div>
                <div className="flex items-center justify-between text-[12px] font-bold mt-1.5">
                  <span style={{ color: 'var(--tx,#e6edf3)' }}>+ Profit ({ri(c.margin_actual)}%)</span>
                  <span style={{ color: '#639922' }}>{fmtR2(c.profit_val)}</span>
                </div>
                <div className="flex items-center justify-between text-[13px] font-bold mt-2 pt-2 border-t"
                  style={{ borderColor: 'var(--bd,#30363d)' }}>
                  <span style={{ color: 'var(--accent,#3fb950)' }}>Selling price (incl GST)</span>
                  <span style={{ color: 'var(--accent,#3fb950)' }}>{fmtR2(c.sp)}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Per-unit cost breakdown (the Excel view) */}
          <div className="rounded-xl border overflow-hidden" style={{ background: 'var(--bg2,#161b22)', borderColor: 'var(--bd,#30363d)' }}>
            <div className="px-4 py-3 border-b" style={{ borderColor: 'var(--bd,#30363d)' }}>
              <div className="text-[11px] font-bold tracking-widest uppercase" style={{ color: 'var(--tx2,#8b949e)' }}>Per-order allocation summary</div>
            </div>
            <div className="px-4 py-2">
              <SumRow label="Product cost / unit" formula={`₹${ri(nv(productCostBulk))} ÷ ${ri(c.usableUnits)} units`} val={c.perUnit_product} />
              <SumRow label="Packaging cost / unit" formula={`₹${ri(nv(packagingCostBulk))} ÷ ${ri(c.usableUnits)} units`} val={c.perUnit_packaging} />
              <SumRow label="Warehouse / order" formula={`₹${ri(nv(monthlyRent))} ÷ ${ri(nv(ordersPerMonth))} orders`} val={c.perUnit_warehouse} />
              <SumRow label="Holding cost" val={c.perUnit_holding} />
              <SumRow label="Processing + QC + labour" val={c.perUnit_processing + c.qualityRejections + c.perUnit_labour} />
              <SumRow label="Logistics (blended)" val={c.perOrder_log} />
              <SumRow label="Returns" val={c.returnCostPerOrder} />
              <SumRow label="Marketing + ops" val={c.perOrder_ads + c.perOrder_ops} />
              <SumRow label="Hidden cost buffer" val={c.costBeforePlatform - c.rawCost} />
              <SumRow label="Platform fee" val={c.platform_fee_amt} />
              <SumRow label="Total real cost / order" formula="Sum of all above" val={c.totalCost} big accent="#C8820A" />
              <SumRow label={`Profit (${ri(c.margin_actual)}% margin)`} val={c.profit_val} accent="#639922" />
              <SumRow label="Selling price (excl GST)" val={c.base_price} />
              <SumRow label={`GST ${outputGst}%`} val={c.gst_amt_out} />
              <SumRow label="Selling price (incl GST)" val={c.sp} big />
              <SumRow label={`MRP (${nv(mrpMultiplier).toFixed(2)}x)`} val={c.mrp} big accent="var(--accent,#3fb950)" />
            </div>
          </div>

          {/* Push button */}
          <button onClick={pushToPricing}
            className="w-full py-3 rounded-xl text-[13px] font-bold transition"
            style={{ background: 'var(--accent,#3fb950)', color: '#fff' }}>
            Push all costs → Pricing engine ↗
          </button>
          <div className="text-[10px] text-center leading-relaxed" style={{ color: 'var(--tx2,#8b949e)' }}>
            All per-unit costs auto-fill in Pricing Calculator Stage 1–5. You can then fine-tune individually.
          </div>
        </div>
      </div>
    </div>
  );
}
