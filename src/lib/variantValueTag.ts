// AUD: "Best Value" / "Steal Deal" tags were positional (variant index), so they could claim a
// better deal than the per-unit price actually delivers (e.g. Manali honey 500g vs 1kg are within
// 0.1% per gram). Tag only when the per-unit saving is real.

/** Parses sizes like "250g", "1 kg", "500ml", "1L" into base units (g or ml). Returns null if unknown. */
export function sizeToBaseUnits(size: string | null | undefined): number | null {
  const m = String(size ?? '').trim().toLowerCase().match(/^(\d+(?:\.\d+)?)\s*(kg|g|gm|gms|l|ltr|ml)\b/)
  if (!m) return null
  const n = parseFloat(m[1])
  switch (m[2]) {
    case 'kg': case 'l': case 'ltr': return n * 1000
    default: return n
  }
}

/** Minimum per-unit saving vs the smallest pack before we call anything a deal. */
export const MIN_UNIT_SAVING = 0.03

/**
 * Returns the id of the single variant that deserves a "Best Value" tag, or null.
 * Requires 2+ in-stock variants with parseable sizes and a >=3% lower unit price than the smallest pack.
 */
export function bestValueVariantId<T extends { id: string | number; size?: string | null; price: number; available_stock?: number }>(
  variants: T[],
): T['id'] | null {
  const rows = variants
    .filter(v => (v.available_stock ?? 1) > 0)
    .map(v => ({ id: v.id, units: sizeToBaseUnits(v.size), price: v.price }))
    .filter((r): r is { id: T['id']; units: number; price: number } => r.units != null && r.units > 0 && r.price > 0)
  if (rows.length < 2) return null
  const unit = (r: { units: number; price: number }) => r.price / r.units
  const smallest = rows.reduce((a, b) => (b.units < a.units ? b : a))
  const best = rows.reduce((a, b) => (unit(b) < unit(a) ? b : a))
  if (best.id === smallest.id) return null
  return unit(best) <= unit(smallest) * (1 - MIN_UNIT_SAVING) ? best.id : null
}
