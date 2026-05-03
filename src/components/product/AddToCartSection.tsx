'use client'

import { useState } from 'react'
import { useCartStore } from '@/store/cartStore'
import { useUIStore } from '@/store/uiStore'
import type { Product, ProductVariant, SiteSettings } from '@/types'

interface Props {
  product:  Product
  variants: ProductVariant[]
  settings: SiteSettings
}

export default function AddToCartSection({ product, variants, settings }: Props) {
  const addItem  = useCartStore(s => s.addItem)
  const openCart = useUIStore(s => s.openCart)

  const [selectedVariant, setSelectedVariant] = useState<ProductVariant | null>(
    variants.length > 0 ? variants[0] : null
  )
  const [qty, setQty]     = useState(1)
  const [added, setAdded] = useState(false)
  const [buying, setBuying] = useState(false)

  const price    = selectedVariant?.price ?? product.price
  const mrp      = selectedVariant?.mrp   ?? product.mrp ?? product.price
  const maxStock = selectedVariant?.available_stock ?? product.available_stock
  const inStock  = maxStock > 0

  function handleAdd(mode: 'add' | 'buy' = 'add') {
    if (!inStock) return
    addItem({
      productId: String(product.id),
      variantId: String(selectedVariant?.id ?? product.id),
      name:      product.name,
      slug:      product.slug,
      image:     product.image_url,
      emoji:     product.emoji,
      size:      selectedVariant?.size ?? product.unit_label ?? '',
      price,
      mrp:       mrp ?? price,
      gstRate:   product.gst_rate,
      maxQty:    maxStock,
      qty,
    })
    if (mode === 'buy') {
      setBuying(true)
      setTimeout(() => { window.location.href = '/checkout' }, 300)
    } else {
      setAdded(true)
      openCart()
      setQty(1)
      setTimeout(() => setAdded(false), 2200)
    }
  }

  const hasMore = variants.length > 3

  return (
    <div>
      {/* Variant selector */}
      {variants.length > 0 && (
        <div className="variants-section">
          <div className="variants-label">
            Select Size: <span id="var-label">{selectedVariant?.size || variants[0]?.size}</span>
          </div>
          <div className={`variant-grid${hasMore ? ' has-more' : ''}`}>
            {variants.map((v, i) => {
              const savePct = v.mrp && v.mrp > v.price ? Math.round((1 - v.price / v.mrp) * 100) : 0
              const isActive = selectedVariant?.id === v.id
              const oos = v.available_stock <= 0
              return (
                <button
                  key={v.id}
                  className={`vcard${isActive ? ' active' : ''}${oos ? ' oos' : ''}`}
                  onClick={() => !oos && setSelectedVariant(v)}
                  disabled={oos}
                  type="button"
                >
                  {i === 1 && variants.length >= 3 && <span className="vcard-tag best">Best Value</span>}
                  {i === variants.length - 1 && variants.length >= 3 && i !== 1 && <span className="vcard-tag deal">Steal Deal</span>}
                  <span className="vc-size">{v.size}</span>
                  <span className="vc-price">
                    ₹{v.price}
                    {v.mrp && v.mrp > v.price && <span className="vc-orig"> ₹{v.mrp}</span>}
                  </span>
                  {savePct > 0 && <span className="vc-save">Save {savePct}%</span>}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Qty + Buttons */}
      <div className="qty-atc">
        <div className="qty-row">
          <div className="qty-ctrl">
            <div className="qty-above">Qty</div>
            <div className="qty-ctrl-inner">
              <button
                className="qty-btn"
                onClick={() => setQty(q => Math.max(1, q - 1))}
                style={{ opacity: qty <= 1 ? 0.3 : 1 }}
                type="button"
                aria-label="Decrease"
              >−</button>
              <span className="qty-num">{qty}</span>
              <button
                className="qty-btn"
                onClick={() => setQty(q => Math.min(maxStock || 99, q + 1))}
                style={{ opacity: qty >= (maxStock || 99) ? 0.3 : 1 }}
                type="button"
                aria-label="Increase"
              >+</button>
            </div>
          </div>

          {inStock ? (
            <button
              className={`btn-add-cart${added ? ' added' : ''}`}
              onClick={() => handleAdd('add')}
              disabled={!inStock || added}
              type="button"
            >
              {added ? '✅ Added to Cart!' : '🛒 Add to Cart'}
            </button>
          ) : (
            <button className="btn-add-cart" disabled type="button">Out of Stock</button>
          )}
        </div>

        {inStock && (
          <button
            className="btn-buy-now"
            onClick={() => handleAdd('buy')}
            disabled={buying}
            type="button"
          >
            {buying ? '⚡ Processing…' : '⚡ Buy Now'}
          </button>
        )}
      </div>

      <style>{`
        .variants-section{margin-bottom:20px;padding-top:14px}
        .variants-label{font-size:11px;font-weight:700;color:var(--tx3,#7a7a7a);margin-bottom:12px;
          letter-spacing:1.5px;text-transform:uppercase;font-family:'Josefin Sans',sans-serif}
        .variants-label span{color:var(--g,#1a3a1e);font-weight:800}
        .variant-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:9px}
        .variant-grid.has-more{grid-template-columns:repeat(2,1fr)}
        .vcard{position:relative;padding:12px 14px;border:2px solid #e0d8cc!important;
          border-radius:12px!important;font-size:12.5px;font-weight:700;cursor:pointer;
          background:#fff;color:var(--tx,#1a1a1a);transition:all .22s;text-align:left;
          box-shadow:0 1px 4px rgba(0,0,0,.04);font-family:inherit}
        .vcard:hover:not(.oos){border-color:var(--g,#1a3a1e)!important;
          background:linear-gradient(135deg,#f5faf5,#edf5ee);box-shadow:0 3px 12px rgba(26,58,30,.1)}
        .vcard.active{border-color:var(--g,#1a3a1e)!important;
          background:linear-gradient(135deg,#f0f7f0,#e8f5e9)!important;
          box-shadow:0 0 0 3px rgba(26,58,30,.08),0 3px 12px rgba(26,58,30,.1)!important}
        .vcard.oos{opacity:.4;cursor:not-allowed}
        .vc-size{font-size:13px;font-weight:800;color:var(--tx,#1a1a1a);display:block;margin-bottom:3px}
        .vc-price{font-size:14px;font-weight:900;color:var(--g,#1a3a1e);display:block}
        .vc-orig{font-size:11px;color:var(--tx3,#7a7a7a);text-decoration:line-through;display:inline;margin-left:4px}
        .vc-save{font-size:10.5px;color:var(--gd,#c8920a);font-weight:800;display:block;margin-top:2px}
        .vcard-tag{position:absolute;top:-8px;left:10px;font-size:9px;font-weight:900;
          padding:3px 9px;border-radius:4px;letter-spacing:.5px;color:#fff;
          font-family:'Josefin Sans',sans-serif;text-transform:uppercase;z-index:3}
        .vcard-tag.best{background:var(--g,#1a3a1e)}
        .vcard-tag.deal{background:#b8700a}
        .qty-atc{display:flex;flex-direction:column;gap:10px;margin-bottom:28px}
        .qty-row{display:flex;align-items:center;gap:10px}
        .qty-ctrl{display:inline-flex;align-items:center;border:2px solid #e8e0d0;
          border-radius:10px;overflow:hidden;background:#fff;flex-direction:column;min-width:72px}
        .qty-ctrl-inner{display:flex;align-items:center}
        .qty-above{font-size:10px;font-weight:700;color:var(--tx3,#7a7a7a);text-align:center;
          padding:3px 10px 0;letter-spacing:.3px;text-transform:uppercase;
          border-bottom:1px solid rgba(26,58,30,.12);width:100%}
        .qty-btn{width:34px;height:38px;border:none;background:#fff;font-size:18px;font-weight:700;
          cursor:pointer;color:var(--g,#1a3a1e);transition:background .15s;
          display:flex;align-items:center;justify-content:center;font-family:inherit}
        .qty-btn:hover{background:var(--bg2,#f8f9f5)}
        .qty-num{width:36px;height:38px;display:flex;align-items:center;justify-content:center;
          font-size:15px;font-weight:900;
          border-left:1.5px solid rgba(26,58,30,.12);border-right:1.5px solid rgba(26,58,30,.12);
          user-select:none}
        .btn-add-cart{flex:1;height:52px;background:#c0392b;color:#fff;border:none;
          border-radius:12px;font-size:15px;font-weight:700;cursor:pointer;
          display:flex;align-items:center;justify-content:center;gap:9px;
          transition:all .25s;box-shadow:0 4px 14px rgba(192,57,43,.3);font-family:inherit}
        .btn-add-cart:hover:not(:disabled){background:#a93226;
          box-shadow:0 6px 20px rgba(192,57,43,.4);transform:translateY(-1px)}
        .btn-add-cart.added{background:#922b21;transform:none}
        .btn-add-cart:disabled{opacity:.45;cursor:not-allowed;transform:none}
        .btn-buy-now{width:100%;height:52px;background:linear-gradient(135deg,#1a3a1e,#2d5a32);
          color:#fff;border:none;border-radius:12px;font-size:15px;font-weight:700;
          letter-spacing:.2px;cursor:pointer;display:flex;align-items:center;
          justify-content:center;gap:9px;transition:all .25s;
          box-shadow:0 4px 14px rgba(26,58,30,.35);font-family:inherit;position:relative}
        .btn-buy-now::after{content:'Skip cart — instant checkout';position:absolute;
          bottom:-18px;left:50%;transform:translateX(-50%);font-size:10px;
          color:var(--tx3,#7a7a7a);white-space:nowrap;letter-spacing:.2px;font-weight:500}
        .btn-buy-now:hover:not(:disabled){background:linear-gradient(135deg,#2d5a32,#3a7042);
          transform:translateY(-1px);box-shadow:0 6px 20px rgba(26,58,30,.45)}
        .btn-buy-now:disabled{opacity:.45;cursor:not-allowed;transform:none}
      `}</style>
    </div>
  )
}
