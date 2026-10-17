'use client'
// Price block + stock row that follow the selected pack size (PDP audit P1-2). Markup and class names are
// identical to the server-rendered blocks they replace, so no CSS or layout changes.
import { usePdpSelection } from './PdpVariantContext'

/** The admin treats ≤10 units as "critically low" (pahadi-admin dashboard); the PDP uses the same line. */
export const LOW_STOCK_THRESHOLD = 10

export function PdpPriceBlock({ hasVariants }: { hasVariants: boolean }) {
  const ctx = usePdpSelection()
  if (!ctx) return null
  const { price, mrp, savings, size, stock, initialStock } = ctx.selected

  // PDP audit P2-1 (and the admin's own brand rule: "never fake urgency"):
  //  • only at the admin's own low-stock line (≤10), not "< 50";
  //  • no "selling fast" (a sales-velocity claim nothing measures);
  //  • the fill bar shows a REAL sold-percentage and only when initial stock is known — the old invented
  //    fallback formula is gone.
  const showLow = stock > 0 && stock <= LOW_STOCK_THRESHOLD
  const soldPct = initialStock ? Math.max(0, Math.min(Math.round((1 - stock / initialStock) * 100), 95)) : null

  return (
    <div className="pdp-price-block">
      <div className="pdp-price-row">
        <span className="pdp-price">₹{price}</span>
        {mrp > price && (
          <>
            <span className="pdp-mrp">₹{mrp}</span>
            <span className="pdp-save-badge">SAVE {savings}%</span>
          </>
        )}
      </div>
      <p className="pdp-tax-note">
        MRP inclusive of all taxes{hasVariants && size ? ` · ${size}` : ''}
      </p>
      {showLow && (
        <div className="pdp-urgency" role="status">
          <div className="pdp-urgency-label">Only {stock} left</div>
          {soldPct !== null && (
            <div className="pdp-urgency-track" aria-hidden="true">
              <div className="pdp-urgency-fill" style={{ width: `${soldPct}%` }} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function PdpStockRow() {
  const ctx = usePdpSelection()
  if (!ctx) return null
  const stock = ctx.selected.stock
  return (
    <div className="pdp-stock-row">
      <div className={`pdp-stock-dot${stock <= 0 ? ' oos' : stock <= 5 ? ' low' : ''}`} />
      <span role="status">
        {stock <= 0 ? 'Out of Stock'
          : stock <= 5 ? `Only ${stock} left!`
          : stock <= 20 ? `${stock} in stock`
          : 'In Stock'}
      </span>
    </div>
  )
}
