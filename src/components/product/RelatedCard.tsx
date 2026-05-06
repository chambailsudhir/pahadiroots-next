'use client'

import Image from 'next/image'
import { useState, useEffect} from 'react'
import { useRouter } from 'next/navigation'
import { useCartStore } from '@/store/cartStore'
import { useUIStore } from '@/store/uiStore'

export default function RelatedCard({ product: p }: { product: any }) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])

  const router   = useRouter()
  const addItem  = useCartStore(s => s.addItem)
  const openCart = useUIStore(s => s.openCart)
  const [btnText, setBtnText] = useState('+ Add to Cart')

  const baseVariant = p._variants?.[0] ?? null
  const price = baseVariant?.price ?? p.price ?? 0
  const mrp   = baseVariant?.mrp ?? p.mrp ?? 0
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
    })
    openCart()
    setBtnText('✅ Added!')
    setTimeout(() => setBtnText('+ Add to Cart'), 1500)
  }

  if (!mounted) return null

  return (
    <div
      onClick={() => router.push(`/products/${slug}`)}
      style={{
        border: '1.5px solid #e8e0d0', borderRadius: '16px', overflow: 'hidden',
        cursor: 'pointer', transition: 'all .25s', background: '#fff',
      }}
      className="pdp-rel-card"
    >
      {/* Image */}
      <div style={{ position: 'relative', aspectRatio: '1', overflow: 'hidden', background: '#f8f5f0' }}>
        {img
          ? <Image src={img} alt={p.name} fill sizes="(max-width:880px) 50vw, 25vw"
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
      `}</style>
    </div>
  )
}
