'use client'

import Image from 'next/image'
import { useState } from 'react'
import { useCartStore } from '@/store/cartStore'
import { useUIStore } from '@/store/uiStore'
import type { Product } from '@/types'

export default function RelatedCard({ product: p }: { product: Product }) {
  const addItem  = useCartStore(s => s.addItem)
  const openCart = useUIStore(s => s.openCart)
  const [btnText, setBtnText] = useState('+ Add to Cart')

  const variants = p.product_variants?.filter(v => v.is_active) || []
  const baseVariant = variants.length > 0 ? variants.reduce((min, v) => v.price < min.price ? v : min, variants[0]) : null
  const price = baseVariant?.price ?? p.price
  const mrp   = baseVariant?.mrp ?? p.mrp ?? p.price
  const disc  = mrp && mrp > price ? Math.round((1 - price / mrp) * 100) : 0
  const slug  = p.slug || String(p.id)

  function handleATC() {
    addItem({
      productId: String(p.id),
      variantId: String(baseVariant?.id ?? p.id),
      name:      p.name,
      slug:      p.slug,
      image:     p.image_url,
      emoji:     p.emoji,
      size:      baseVariant?.size ?? p.unit_label ?? '',
      price,
      mrp:       mrp ?? price,
      gstRate:   p.gst_rate,
      maxQty:    baseVariant?.available_stock ?? p.available_stock,
      qty:       1,
    })
    openCart()
    setBtnText('✅ Added!')
    setTimeout(() => setBtnText('+ Add to Cart'), 1500)
  }

  return (
    <div className="rel-card">
      <div className="rel-img" onClick={() => window.location.href = `/products/${slug}`} style={{ cursor: 'pointer' }}>
        {p.image_url
          ? <Image src={p.image_url} alt={p.name} fill sizes="(max-width:880px) 50vw, 25vw" style={{ objectFit: 'cover' }} />
          : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '50px' }}>{p.emoji || '🌿'}</div>}
        {disc > 0 && <span className="rel-disc">-{disc}%</span>}
      </div>
      <div className="rel-body">
        <div className="rel-brand">5 PAHADI ROOTS</div>
        <div className="rel-name" onClick={() => window.location.href = `/products/${slug}`}>{p.name}</div>
        <div className="rel-price-row">
          <span className="rel-price">₹{price}</span>
          {mrp && mrp > price && <span className="rel-orig">₹{mrp}</span>}
        </div>
        <button className="rel-atc" onClick={handleATC} type="button">{btnText}</button>
      </div>
    </div>
  )
}
