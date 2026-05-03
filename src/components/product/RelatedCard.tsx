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
      <style>{`
        .rel-card{border:1.5px solid #e8e0d0;border-radius:16px;overflow:hidden;transition:all .25s;background:#fff}
        .rel-card:hover{border-color:var(--g3,#3d6b42);box-shadow:0 12px 40px rgba(0,0,0,.14);transform:translateY(-4px)}
        .rel-img{position:relative;aspect-ratio:1;overflow:hidden;background:var(--bg2,#f8f9f5)}
        .rel-img img{transition:transform .4s}
        .rel-card:hover .rel-img img{transform:scale(1.07)}
        .rel-disc{position:absolute;top:10px;right:10px;background:#c0392b;color:#fff;
          font-size:10px;font-weight:900;padding:3px 8px;border-radius:12px}
        .rel-body{padding:13px}
        .rel-brand{font-size:10px;font-weight:900;color:var(--gd,#c8920a);letter-spacing:.6px;text-transform:uppercase;margin-bottom:3px}
        .rel-name{font-size:13px;font-weight:800;color:var(--tx,#1a1a1a);margin-bottom:8px;line-height:1.35;cursor:pointer}
        .rel-name:hover{color:var(--g,#1a3a1e)}
        .rel-price-row{display:flex;align-items:baseline;gap:7px;margin-bottom:10px}
        .rel-price{font-size:15px;font-weight:900;color:var(--g,#1a3a1e)}
        .rel-orig{font-size:12px;color:var(--tx3,#7a7a7a);text-decoration:line-through}
        .rel-atc{width:100%;padding:9px 0;background:var(--g,#1a3a1e);color:#fff;border:none;
          border-radius:9px;font-size:12.5px;font-weight:800;cursor:pointer;
          transition:all .2s;letter-spacing:.2px;font-family:inherit}
        .rel-atc:hover{background:var(--g2,#2d5233);transform:translateY(-1px);box-shadow:0 4px 12px rgba(26,58,30,.25)}
      `}</style>
    </div>
  )
}
