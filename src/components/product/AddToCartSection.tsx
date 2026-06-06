'use client'

import { useState, useEffect, useRef } from 'react'
import { useCartStore } from '@/store/cartStore'
import { useUIStore } from '@/store/uiStore'
import { useUserStore } from '@/store/userStore'
import { useRouter } from 'next/navigation'
import type { Product, ProductVariant, SiteSettings } from '@/types'

interface Props {
  product:  Product
  variants: ProductVariant[]
  settings: SiteSettings
}

export default function AddToCartSection({ product, variants, settings }: Props) {
  const router    = useRouter()
  const addItem   = useCartStore(s => s.addItem)
  const openCart  = useUIStore(s => s.openCart)

  // Read wishlist state from store — direct selector so the component re-renders
  // when the wishlist changes (e.g. from another tab or the Header heart icon).
  // Local useState(false) was a bug: state was never persisted to the store and
  // reset to false on every page navigation.
  const inWishlist         = useUserStore(s => s.wishlist.includes(String(product.id)))
  const addToWishlist      = useUserStore(s => s.addToWishlist)
  const removeFromWishlist = useUserStore(s => s.removeFromWishlist)

  const [selectedVariant, setSelectedVariant] = useState<ProductVariant | null>(
    variants.length > 0 ? variants[0] : null
  )
  const [qty, setQty]         = useState(1)
  const [added, setAdded]     = useState(false)
  const [buying, setBuying]   = useState(false)

  const price    = selectedVariant?.price   ?? product.price
  const mrp      = selectedVariant?.mrp     ?? product.mrp ?? product.price
  const maxStock = selectedVariant?.available_stock ?? product.available_stock ?? 0
  const inStock  = maxStock > 0

  function selectVariant(v: ProductVariant) {
    if (v.available_stock <= 0) return
    setSelectedVariant(v)
    setQty(1)
  }

  function changeQty(d: number) {
    setQty(q => Math.max(1, Math.min(q + d, maxStock || 99)))
  }

  // BUG FIX: track timers so they can be cleared on unmount.
  // The two setTimeout calls inside handleAdd — router.push (300 ms) and
  // setAdded reset (2200 ms) — fired on the unmounted component if the user
  // navigated away before the delay elapsed. React 18 strict mode surfaced this
  // as a "Can't perform a React state update on an unmounted component" warning.
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([])
  useEffect(() => {
    return () => {
      // Cleanup: cancel any in-flight timers when the component unmounts.
      timersRef.current.forEach(clearTimeout)
    }
  }, [])

  function handleAdd(mode: 'add' | 'buy') {
    if (!inStock) return
    const variantId = selectedVariant
      ? String(selectedVariant.id)
      : String(product.id)
    const size = selectedVariant?.size
      || (selectedVariant as ProductVariant & { variant_value?: string })?.variant_value
      || product.unit_label
      || ''

    addItem({
      productId: String(product.id),
      variantId,
      name:      product.name + (size ? ` (${size})` : ''),
      slug:      product.slug,
      image:     product.image_url,
      emoji:     product.emoji,
      size,
      price,
      mrp:    mrp ?? price,
      gstRate: product.gst_rate,
      maxQty:  maxStock,
      qty,
      isOrganic:    product.badges_organic    ?? false,
      isHimalayan:  !!(product.state_id),
      isBestseller: product.badges_bestseller ?? false,
    })

    if (mode === 'buy') {
      setBuying(true)
      // BUG FIX: capture the timer ID so the cleanup effect can cancel it on unmount.
      const t = setTimeout(() => router.push('/checkout'), 300)
      timersRef.current.push(t)
    } else {
      setAdded(true)
      openCart()
      setQty(1)
      // BUG FIX: capture the timer ID so the cleanup effect can cancel it on unmount.
      const t = setTimeout(() => setAdded(false), 2200)
      timersRef.current.push(t)
    }
  }

  const hasMore = variants.length > 3

  return (
    <div style={{ marginTop: '20px', position: 'relative', zIndex: 2 }}>

      {/* ── Variant selector ── */}
      {variants.length > 0 && (
        <div style={{ marginBottom: '4px', paddingTop: '14px' }}>
          <div className="pdp-variants-label">
            Select Size: <span id="var-label-display">{selectedVariant?.size || variants[0]?.size}</span>
          </div>
          <div className={`pdp-variant-grid${hasMore ? ' has-more' : ''}`}>
            {variants.map((v, i) => {
              const savePct = v.mrp && v.mrp > v.price ? Math.round((1 - v.price / v.mrp) * 100) : 0
              const isActive = selectedVariant?.id === v.id
              const oos = v.available_stock <= 0
              // Build a descriptive label so screen readers announce size, price,
              // discount, and availability — not just "button, pressed".
              const variantLabel = [
                `Select ${v.size}`,
                `₹${v.price}`,
                savePct > 0 ? `Save ${savePct}%` : null,
                oos ? 'Out of stock' : null,
              ].filter(Boolean).join(', ')
              return (
                <button
                  key={v.id}
                  type="button"
                  className={`pdp-vcard${isActive ? ' active' : ''}`}
                  onClick={() => selectVariant(v)}
                  disabled={oos}
                  aria-pressed={isActive}
                  aria-label={variantLabel}
                >
                  {i === 1 && variants.length >= 3 && (
                    <span className="pdp-vcard-tag best">Best Value</span>
                  )}
                  {i === variants.length - 1 && variants.length >= 3 && i !== 1 && (
                    <span className="pdp-vcard-tag deal">Steal Deal</span>
                  )}
                  <span className="pdp-vc-size">{v.size}</span>
                  <span className="pdp-vc-price">
                    ₹{v.price}
                    {v.mrp && v.mrp > v.price && (
                      <span className="pdp-vc-orig"> ₹{v.mrp}</span>
                    )}
                  </span>
                  {savePct > 0 && <span className="pdp-vc-save">Save {savePct}%</span>}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Qty + Cart row ── */}
      <div className="pdp-qty-atc">
        <div className="pdp-qty-row">
          {/* Qty control */}
          <div className="pdp-qty-ctrl">
            <div className="pdp-qty-above" aria-hidden="true">Qty</div>
            {/* role=group gives the stepper a named region so SR users
                hear "Quantity for [product], decrease, 1, increase" */}
            <div
              className="pdp-qty-inner"
              role="group"
              aria-label={`Quantity for ${product.name}`}
            >
              <button
                type="button"
                className="pdp-qty-btn"
                onClick={() => changeQty(-1)}
                disabled={qty <= 1}
                aria-label="Decrease quantity"
              >−</button>
              <span
                className="pdp-qty-num"
                aria-live="polite"
                aria-atomic="true"
                aria-label={`${qty} selected`}
              >{qty}</span>
              <button
                type="button"
                className="pdp-qty-btn"
                onClick={() => changeQty(1)}
                disabled={qty >= (maxStock || 99)}
                aria-label="Increase quantity"
              >+</button>
            </div>
          </div>

          {/* Wishlist — aria-pressed reflects toggle state; label flips on change */}
          <button
            type="button"
            className={`pdp-wl-btn${inWishlist ? ' active' : ''}`}
            onClick={() => inWishlist
              ? removeFromWishlist(String(product.id))
              : addToWishlist(String(product.id))
            }
            aria-pressed={inWishlist}
            aria-label={inWishlist ? `Remove ${product.name} from wishlist` : `Add ${product.name} to wishlist`}
          >
            <span aria-hidden="true">{inWishlist ? '❤️' : '🤍'}</span>
          </button>

          {/* Add to Cart — label conveys product name + state change for SR */}
          <button
            type="button"
            className={`pdp-btn-atc${added ? ' added' : ''}`}
            onClick={() => handleAdd('add')}
            disabled={!inStock || added}
            aria-label={
              added    ? `${product.name} added to cart` :
              !inStock ? `${product.name} out of stock` :
              `Add ${product.name} to cart`
            }
          >
            {added ? '✅ Added to Cart!' : !inStock ? 'Out of Stock' : '🛒 Add to Cart'}
          </button>
        </div>

        {/* Buy Now — include product name so SR users aren't left wondering "buy what?" */}
        {inStock && (
          <button
            type="button"
            className="pdp-btn-buy"
            onClick={() => handleAdd('buy')}
            disabled={buying}
            aria-label={buying ? `Processing order for ${product.name}` : `Buy ${product.name} now`}
          >
            {buying ? '⚡ Processing…' : '⚡ Buy Now'}
          </button>
        )}
      </div>

    </div>
  )
}
