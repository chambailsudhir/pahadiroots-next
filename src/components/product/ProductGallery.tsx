'use client'

import { useState } from 'react'
import Image from 'next/image'

interface GalleryImage { url: string; alt: string }
interface Props { images: GalleryImage[]; productName: string; savings?: number }

export default function ProductGallery({ images, productName, savings = 0 }: Props) {
  const [active, setActive] = useState(0)
  const [zoomed, setZoomed] = useState(false)

  if (!images.length) {
    return (
      <div style={{ position: 'relative', borderRadius: '20px', overflow: 'hidden', background: 'var(--bg2)', aspectRatio: '4/5', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '120px' }}>
        🌿
      </div>
    )
  }

  const prev = () => setActive(i => (i - 1 + images.length) % images.length)
  const next = () => setActive(i => (i + 1) % images.length)

  return (
    <div>
      {/* Main Image */}
      <div
        className="main-img-wrap"
        onClick={() => setZoomed(true)}
        role="button"
        tabIndex={0}
        onKeyDown={e => e.key === 'Enter' && setZoomed(true)}
      >
        {/* Discount badge */}
        {savings >= 5 && (
          <div className="disc-badge">-{savings}%</div>
        )}

        <div className="img-zoom-icon">
          <svg viewBox="0 0 24 24" style={{ width: '24px', height: '24px', stroke: '#1a3a1e', strokeWidth: 2, fill: 'none' }}>
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
            <line x1="11" y1="8" x2="11" y2="14" /><line x1="8" y1="11" x2="14" y2="11" />
          </svg>
        </div>

        <Image
          src={images[active].url}
          alt={images[active].alt}
          fill
          sizes="(max-width: 900px) 100vw, 50vw"
          className="main-img"
          priority
        />

        {/* Left/Right arrows */}
        {images.length > 1 && (
          <>
            <button
              className="img-arrow img-arrow-prev"
              onClick={e => { e.stopPropagation(); prev() }}
              aria-label="Previous image"
            >
              ‹
            </button>
            <button
              className="img-arrow img-arrow-next"
              onClick={e => { e.stopPropagation(); next() }}
              aria-label="Next image"
            >
              ›
            </button>
            <div className="img-counter">{active + 1} / {images.length}</div>
          </>
        )}
      </div>

      {/* Thumbnails */}
      {images.length > 1 && (
        <div className="thumb-row">
          {images.map((img, i) => (
            <button
              key={i}
              onClick={() => setActive(i)}
              className={`thumb ${i === active ? 'active' : ''}`}
              aria-label={`View image ${i + 1}`}
            >
              <Image
                src={img.url}
                alt={img.alt}
                fill
                sizes="80px"
                style={{ objectFit: 'cover' }}
              />
            </button>
          ))}
        </div>
      )}

      {/* Zoom Lightbox */}
      {zoomed && (
        <div
          className="zoom-overlay open"
          onClick={() => setZoomed(false)}
          role="dialog"
          aria-modal
        >
          <button
            className="zoom-close"
            onClick={() => setZoomed(false)}
            aria-label="Close"
          >
            ×
          </button>
          <div style={{ position: 'relative', width: '90vw', maxWidth: '800px', aspectRatio: '1' }}
            onClick={e => e.stopPropagation()}>
            <Image
              src={images[active].url}
              alt={images[active].alt}
              fill
              sizes="90vw"
              style={{ objectFit: 'contain' }}
              priority
            />
          </div>
        </div>
      )}

      <style>{`
        .main-img-wrap{
          position:relative;border-radius:20px;overflow:hidden;background:var(--bg2,#f8f9f5);
          aspect-ratio:4/5;cursor:zoom-in;box-shadow:0 8px 40px rgba(0,0,0,.14);
        }
        .main-img-wrap::after{content:'';position:absolute;inset:0;background:rgba(26,58,30,0);
          transition:background .35s ease;pointer-events:none;border-radius:20px}
        .main-img-wrap:hover::after{background:rgba(26,58,30,0.18)}
        .main-img{object-fit:cover;transition:transform .55s cubic-bezier(.25,.46,.45,.94)}
        .main-img-wrap:hover .main-img{transform:scale(1.07)}
        .disc-badge{position:absolute;top:16px;right:16px;background:#c0392b;color:#fff;
          font-size:12px;font-weight:900;padding:5px 13px;border-radius:20px;z-index:2;letter-spacing:.3px}
        .img-zoom-icon{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%) scale(0);
          width:54px;height:54px;background:rgba(255,255,255,.92);border-radius:50%;
          display:flex;align-items:center;justify-content:center;z-index:4;
          transition:transform .3s cubic-bezier(.34,1.56,.64,1),opacity .3s;opacity:0;pointer-events:none}
        .main-img-wrap:hover .img-zoom-icon{transform:translate(-50%,-50%) scale(1);opacity:1}
        .img-arrow{position:absolute;top:50%;transform:translateY(-50%);width:44px;height:44px;
          background:rgba(192,57,43,.88);color:#fff;border:none;border-radius:50%;font-size:24px;font-weight:700;
          display:flex;align-items:center;justify-content:center;z-index:5;
          transition:all .25s;box-shadow:0 2px 14px rgba(192,57,43,.35);
          backdrop-filter:blur(6px);opacity:0;pointer-events:none;cursor:pointer}
        .main-img-wrap:hover .img-arrow{opacity:1;pointer-events:all}
        .img-arrow:hover{background:#c0392b;box-shadow:0 4px 20px rgba(192,57,43,.55);transform:translateY(-50%) scale(1.1)}
        .img-arrow-prev{left:12px}
        .img-arrow-next{right:12px}
        .img-counter{position:absolute;bottom:14px;right:14px;background:rgba(0,0,0,.52);color:#fff;
          font-size:11px;font-weight:700;padding:4px 10px;border-radius:20px;z-index:2;backdrop-filter:blur(4px)}
        .thumb-row{display:flex;gap:10px;margin-top:14px;flex-wrap:wrap}
        .thumb{width:80px;height:80px;border-radius:12px;overflow:hidden;cursor:pointer;
          border:2.5px solid transparent;transition:all .25s;flex-shrink:0;
          background:var(--bg2,#f8f9f5);box-shadow:0 2px 8px rgba(0,0,0,.06);position:relative}
        .thumb.active{border-color:#1a3a1e;box-shadow:0 0 0 3px rgba(26,58,30,.12)}
        .thumb:hover:not(.active){border-color:rgba(26,58,30,.22)}
        .zoom-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,.88);z-index:2000;
          align-items:center;justify-content:center;cursor:zoom-out}
        .zoom-overlay.open{display:flex}
        .zoom-close{position:absolute;top:20px;right:24px;background:rgba(255,255,255,.15);
          border:none;color:#fff;font-size:28px;cursor:pointer;border-radius:50%;
          width:44px;height:44px;display:flex;align-items:center;justify-content:center}
      `}</style>
    </div>
  )
}
