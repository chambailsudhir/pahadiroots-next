'use client'
// ─────────────────────────────────────────────────────────────────────────────
// PdpVariantContext — one source of truth for "which pack size is selected" on the PDP.
//
// PDP audit P1-2: price / MRP / SAVE % / stock / low-stock were computed ONCE on the server from the
// default variant, while AddToCartSection kept the customer's selection in its own client state. Picking
// 1 kg left the big headline at the small-pack price (and the mobile bar showed a different price).
// The cart was always right (it receives the selected variant); only the display drifted.
//
// This provider renders NO DOM (context only), so layout/CSS are untouched. AddToCartSection reports its
// selection here; PdpPriceBlock, PdpStockRow and the gallery badge read it. Initial selection is the same
// default rule the server uses, so SSR HTML and first client render match (no flash, no hydration warning).
// ─────────────────────────────────────────────────────────────────────────────
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { savingsPercent } from '@/lib/utils'

export interface PdpVariantLite {
  id: string | number
  price: number
  mrp: number
  available_stock: number
  initial_stock?: number | null
  size?: string
}
export interface PdpFallback { price: number; mrp: number; stock: number; initialStock?: number | null }

export interface PdpSelected {
  price: number
  mrp: number
  stock: number
  initialStock: number | null
  size: string
  savings: number
}
interface Ctx { selected: PdpSelected; selectVariant: (id: string | number) => void }

const PdpVariantCtx = createContext<Ctx | null>(null)

export function PdpVariantProvider({
  variants, initialVariantId, fallback, children,
}: { variants: PdpVariantLite[]; initialVariantId: string | number | null; fallback: PdpFallback; children: ReactNode }) {
  const [selectedId, setSelectedId] = useState<string | number | null>(initialVariantId)
  const selectVariant = useCallback((id: string | number) => setSelectedId(id), [])

  const selected = useMemo<PdpSelected>(() => {
    const v = selectedId != null ? variants.find(x => String(x.id) === String(selectedId)) : undefined
    const price = Number(v ? v.price : fallback.price) || 0
    const mrpRaw = Number(v ? v.mrp : fallback.mrp) || price
    const mrp = mrpRaw > price ? mrpRaw : price
    const initial = v ? v.initial_stock : fallback.initialStock
    return {
      price,
      mrp,
      stock: Number(v ? v.available_stock : fallback.stock) || 0,
      initialStock: initial != null && Number(initial) > 0 ? Number(initial) : null,
      size: v?.size ?? '',
      savings: savingsPercent(mrp, price),
    }
  }, [selectedId, variants, fallback.price, fallback.mrp, fallback.stock, fallback.initialStock])

  const value = useMemo<Ctx>(() => ({ selected, selectVariant }), [selected, selectVariant])
  return <PdpVariantCtx.Provider value={value}>{children}</PdpVariantCtx.Provider>
}

/** null when rendered outside a provider (e.g. unit tests / QuickView) — callers must fall back to their props. */
export function usePdpSelection(): Ctx | null {
  return useContext(PdpVariantCtx)
}
