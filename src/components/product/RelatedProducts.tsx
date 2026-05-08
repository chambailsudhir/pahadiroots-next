import { getStoreData } from '@/lib/storeData'
import RelatedCard from './RelatedCard'

interface Props { categoryId: number | string; excludeId: number | string }

export default async function RelatedProducts({ categoryId, excludeId }: Props) {
  let products: any[] = []
  try {
    const storeData = await getStoreData()
    products = storeData.products
      .filter((p: any) =>
        p.id !== excludeId &&
        String(p.category_id) === String(categoryId)
      )
      .slice(0, 4)

    // Attach images
    products = products.map((p: any) => {
      const imgs = storeData.product_images
        .filter((i: any) => String(i.product_id) === String(p.id))
        .sort((a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
      return { ...p, _firstImage: imgs[0]?.image_url || imgs[0]?.url || p.image_url || '' }
    })

    // Attach variants
    products = products.map((p: any) => {
      const vars = storeData.product_variants
        .filter((v: any) => String(v.product_id) === String(p.id) && v.is_active)
        .sort((a: any, b: any) => a.price - b.price)
      return { ...p, _variants: vars }
    })
  } catch { return null }

  if (!products.length) return null

  return (
    <section>
      <h2 className="pdp-related-title">You May Also Like</h2>
      <p className="pdp-related-sub">Handpicked from the same Himalayan region</p>
      <div className="pdp-related-grid">
        {products.map((p: any) => <RelatedCard key={p.id} product={p} />)}
      </div>
      <style>{`
        .pdp-related-title{font-family:'Playfair Display',serif;font-size:22px;font-weight:900;color:#1a3a1e;margin-bottom:4px}
        .pdp-related-sub{font-size:13px;color:#7a7a7a;margin-bottom:20px}
        .pdp-related-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:16px}
        @media(max-width:880px){.pdp-related-grid{grid-template-columns:repeat(2,1fr)}}
        @media(max-width:480px){.pdp-related-grid{grid-template-columns:1fr 1fr}}
      `}</style>
    </section>
  )
}
