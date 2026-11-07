// components/collections/ComingLaterCollection.tsx — shown on a collection that has no products yet (Nov 2026 redesign).
//
// Empty categories are no longer linked from any menu, tile or filter chip (see withProducts() in lib/storeData.ts),
// but their URLs stay live so old links, shares and search results don't 404. Instead of "0 Products" and an empty
// sort bar, the page says plainly that the range isn't available, offers a WhatsApp question pre-filled with the
// category name, and shows what can be bought today. Server component: no client JS beyond the product cards.
import Link from 'next/link'
import ProductCard from '@/components/product/ProductCard'
import type { Product } from '@/types'

interface Props {
  categoryName: string
  /** Digits only, with country code (e.g. 919899984895). Omit to hide the WhatsApp link. */
  whatsappNumber?: string
  /** Products available now, already in card shape. */
  products: Product[]
}

export default function ComingLaterCollection({ categoryName, whatsappNumber, products }: Props) {
  const waText = encodeURIComponent(`Namaste! I'd like to know when ${categoryName} will be available.`)
  return (
    <div className="coming-later" data-testid="coming-later">
      <div className="coming-later-note">
        <h2>{categoryName} isn&apos;t available yet</h2>
        <p>
          We add a food to the shop only once we can source it properly from the mountains. Until then, here is
          everything you can order today.
        </p>
        <div className="coming-later-actions">
          <Link href="/products" className="coming-later-btn primary">Shop all products</Link>
          {whatsappNumber && (
            <a
              href={`https://wa.me/${whatsappNumber}?text=${waText}`}
              target="_blank"
              rel="noopener noreferrer"
              className="coming-later-btn"
            >
              Ask about {categoryName} on WhatsApp
            </a>
          )}
        </div>
      </div>
      {products.length > 0 && (
        <section aria-labelledby="coming-later-available">
          <h2 id="coming-later-available" className="coming-later-sub">Available now</h2>
          <div className="coming-later-grid">
            {products.map(p => <ProductCard key={p.id} product={p} />)}
          </div>
        </section>
      )}
    </div>
  )
}
