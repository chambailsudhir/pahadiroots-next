// BUG FIX (3.9): Previously RelatedProducts always called getStoreData()
// independently, performing a full second catalog fetch on every PDP render.
// It also filtered by category_id only, ignoring the state_id matching already
// done one level up in fetchProductData (state OR category).
//
// Fix: accept a `products` prop of the already-normalised array built by
// fetchProductData (with _firstImage and _variants attached). The component
// renders immediately with no extra fetch.
//
// The old Props (categoryId + excludeId) are kept as an optional fallback so
// any other call site that doesn't pass `products` still works.
import RelatedCard from './RelatedCard'

interface NormalisedProduct {
  id: number | string
  [key: string]: unknown
}

interface Props {
  // Pre-fetched, normalised array — preferred path
  products?: NormalisedProduct[]
  // Legacy fallback (triggers its own fetch — avoid on PDP)
  categoryId?: number | string
  excludeId?: number | string
}

export default async function RelatedProducts({ products, categoryId, excludeId }: Props) {
  let items: any[] = []

  if (products) {
    // Happy path: pre-fetched by the parent page, no extra DB round-trip
    items = products
  } else if (categoryId != null && excludeId != null) {
    // Fallback: fetch independently (kept for backwards compatibility)
    try {
      const { getStoreData } = await import('@/lib/storeData')
      const storeData = await getStoreData()
      const raw = storeData.products
        .filter((p: any) =>
          p.id !== excludeId &&
          String(p.category_id) === String(categoryId)
        )
        .slice(0, 4)

      items = raw.map((p: any) => {
        const imgs = storeData.product_images
          .filter((i: any) => String(i.product_id) === String(p.id))
          .sort((a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
        const vars = storeData.product_variants
          .filter((v: any) => String(v.product_id) === String(p.id) && v.is_active)
          .sort((a: any, b: any) => a.price - b.price)
        const badgeArr: string[] = Array.isArray(p.badges) ? p.badges : []
        return {
          ...p,
          badges_bestseller: badgeArr.includes('bestseller'),
          badges_new:        badgeArr.includes('new'),
          badges_organic:    badgeArr.includes('organic'),
          _firstImage:       imgs[0]?.image_url || p.image_url || '',
          _variants:         vars,
        }
      })
    } catch { return null }
  }

  if (!items.length) return null

  return (
    <section>
      <h2 className="pdp-related-title">You May Also Like</h2>
      <p className="pdp-related-sub">Handpicked from the same Himalayan region</p>
      <div className="pdp-related-grid">
        {items.map((p: any) => <RelatedCard key={p.id} product={p} />)}
      </div>
      <style>{`
        .pdp-related-title{font-family:var(--font-playfair),'Playfair Display',serif;font-size:22px;font-weight:900;color:#1a3a1e;margin-bottom:4px}
        .pdp-related-sub{font-size:13px;color:#7a7a7a;margin-bottom:20px}
        .pdp-related-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:16px}
        @media(max-width:880px){.pdp-related-grid{grid-template-columns:repeat(2,1fr)}}
        @media(max-width:480px){.pdp-related-grid{grid-template-columns:1fr 1fr}}
      `}</style>
    </section>
  )
}
