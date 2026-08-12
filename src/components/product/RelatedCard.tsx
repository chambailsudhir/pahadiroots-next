'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useState, useEffect, useRef } from 'react'
import { useCartStore } from '@/store/cartStore'
import { useUIStore } from '@/store/uiStore'

// Normalised shape produced by RelatedProducts / normalizeProduct
interface RelatedProduct {
  id: number | string
  name: string
  slug: string
  emoji: string | null
  price: number
  selling_price?: number | null
  mrp: number | null
  image_url: string | null
  unit_label: string | null
  gst_rate: number
  available_stock: number
  state_id: string | null
  badges_organic: boolean
  badges_bestseller: boolean
  // Fields injected by normalizeProduct
  _firstImage?: string | null
  _variants?: Array<{
    id: number | string
    price: number
    mrp: number | null
    size?: string | null
    variant_value?: string | null
    available_stock: number
  }>
}

export default function RelatedCard({ product: p }: { product: RelatedProduct }) {
  const addItem  = useCartStore(s => s.addItem)
  const openCart = useUIStore(s => s.openCart)
  const [btnText, setBtnText] = useState('+ Add to Cart')

  // BUG FIX: handleATC's setTimeout(() => setBtnText(...), 1500) fired on an
  // unmounted component if the user clicked "Add to Cart" and then
  // immediately clicked the card (router.push to the product page) before
  // the 1.5s reset elapsed — same class of bug already fixed in
  // AddToCartSection (timersRef + cleanup-on-unmount pattern, reused here).
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([])
  useEffect(() => {
    return () => {
      // Intentional: timersRef is a mutable accumulator (timers pushed
      // after this effect's single mount run), not a DOM-node ref. Reading
      // .current fresh at cleanup time is correct here; copying it to a
      // local variable inside the effect body (the rule's generic
      // suggestion) would freeze the copy at the initial empty array and
      // silently stop clearing any timers added later. Same reasoning as
      // AddToCartSection.tsx.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      timersRef.current.forEach(clearTimeout)
    }
  }, [])

  const baseVariant = p._variants?.[0] ?? null
  // BUG FIX (catalogue-wide audit, Aug 2026): products.price is a legacy
  // column the pricing engine no longer writes to — prefer selling_price.
  const price = baseVariant?.price ?? p.selling_price ?? p.price ?? 0
  const mrp   = baseVariant?.mrp ?? p.mrp ?? p.selling_price ?? 0
  const disc  = mrp && mrp > price ? Math.round((1 - price / mrp) * 100) : 0
  const img   = p._firstImage || p.image_url || ''
  const slug  = p.slug || String(p.id)

  function handleATC(e: React.MouseEvent) {
    e.stopPropagation()
    addItem({
      productId: String(p.id),
      variantId: String(baseVariant?.id ?? p.id),
      name:      p.name,
      slug:      p.slug,
      image:     img,
      emoji:     p.emoji,
      size:      baseVariant?.variant_value ?? baseVariant?.size ?? p.unit_label ?? '',
      price,
      mrp:       mrp || price,
      gstRate:   p.gst_rate ?? 5,
      maxQty:    baseVariant?.available_stock ?? p.available_stock ?? 99,
      qty:       1,
      isOrganic:    !!(p.badges_organic),
      isHimalayan:  !!(p.state_id),
      isBestseller: !!(p.badges_bestseller),
    })
    openCart()
    setBtnText('✅ Added!')
    // BUG FIX: capture the timer ID so the cleanup effect can cancel it on unmount.
    const t = setTimeout(() => setBtnText('+ Add to Cart'), 1500)
    timersRef.current.push(t)
  }

  // BUG FIX (A11y + SEO): was a plain <div onClick={router.push(...)}> with
  // no tabIndex, role, or onKeyDown — keyboard/screen-reader users could not
  // navigate to related products, and crawlers had no <a href> to follow.
  // Changed to Link so it's keyboard-reachable, screen-reader accessible, and
  // crawlable (matching ProductCard.tsx on the listing page).
  return (
    <Link
      href={`/products/${slug}`}
      prefetch={false}
      style={{
        border: '1.5px solid #e8e0d0', borderRadius: '16px', overflow: 'hidden',
        cursor: 'pointer', transition: 'all .25s', background: '#fff',
      }}
      className="pdp-rel-card"
    >
      {/* Image */}
      <div style={{ position: 'relative', aspectRatio: '1', overflow: 'hidden', background: '#f8f5f0' }}>
        {img
          // BUG FIX (same oversized-image issue as ProductCard.tsx): this
          // card renders inside `.rgrid` (globals.css), which is
          // `grid-template-columns: repeat(3,1fr)` inside a `max-width:1120px`
          // container — so each card caps at ~360px wide on any screen
          // beyond ~1120px, it does not keep growing with the viewport.
          // The old "25vw" told the optimizer ~480px on a 1920px screen —
          // ~1.8x the real width per side, ~3x the file size. Fixed to the
          // real capped width.
          ? <Image src={img} alt={p.name} fill sizes="(max-width:880px) 50vw, 360px"
              style={{ objectFit: 'cover', transition: 'transform .4s' }}
              className="pdp-rel-img" />
          : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '50px' }}>
              {p.emoji || '🌿'}
            </div>}
        {disc > 0 && (
          <span style={{
            position: 'absolute', top: '10px', right: '10px',
            background: '#c0392b', color: '#fff', fontSize: '10px',
            fontWeight: 900, padding: '3px 8px', borderRadius: '12px',
          }}>-{disc}%</span>
        )}
      </div>

      {/* Body */}
      <div style={{ padding: '13px' }}>
        <div style={{ fontSize: '10px', fontWeight: 900, color: '#c8920a', letterSpacing: '.6px', textTransform: 'uppercase', marginBottom: '3px', fontFamily: "'Josefin Sans',sans-serif" }}>
          5 PAHADI ROOTS
        </div>
        <div style={{ fontSize: '13px', fontWeight: 800, color: '#1a1a1a', marginBottom: '8px', lineHeight: 1.35 }}>
          {p.name}
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '7px', marginBottom: '10px' }}>
          <span style={{ fontSize: '15px', fontWeight: 900, color: '#1a3a1e' }}>₹{price}</span>
          {mrp && mrp > price && (
            <span style={{ fontSize: '12px', color: '#7a7a7a', textDecoration: 'line-through' }}>₹{mrp}</span>
          )}
        </div>
        <button
          type="button"
          onClick={handleATC}
          style={{
            width: '100%', padding: '9px 0', background: '#1a3a1e', color: '#fff',
            border: 'none', borderRadius: '9px', fontSize: '12.5px', fontWeight: 800,
            cursor: 'pointer', transition: 'all .2s', letterSpacing: '.2px', fontFamily: 'inherit',
          }}
        >
          {btnText}
        </button>
      </div>

      <style>{`
        .pdp-rel-card:hover{border-color:#3d6b42!important;box-shadow:0 12px 40px rgba(0,0,0,.14);transform:translateY(-4px)}
        .pdp-rel-card:hover .pdp-rel-img{transform:scale(1.07)}
        .pdp-rel-card{text-decoration:none;display:block;color:inherit}
      `}</style>
    </Link>
  )
}
