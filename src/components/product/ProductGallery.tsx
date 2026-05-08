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
      <div style={{
        borderRadius: '20px', overflow: 'hidden', background: '#f8f9f5',
        aspectRatio: '4/5', display: 'flex', alignItems: 'center',
        justifyContent: 'center', fontSize: '120px',
        boxShadow: '0 8px 40px rgba(0,0,0,.14)'
      }}>
        🌿
      </div>
    )
  }

  const prev = () => setActive(i => (i - 1 + images.length) % images.length)
  const next = () => setActive(i => (i + 1) % images.length)

  return (
    <>
      {/* Main image */}
      <div
        style={{
          position: 'relative', borderRadius: '20px', overflow: 'hidden',
          background: '#f8f5f0', aspectRatio: '4/5', cursor: 'zoom-in',
          boxShadow: '0 8px 40px rgba(0,0,0,.14)'
        }}
        onClick={() => setZoomed(true)}
        role="button"
        aria-label="View full image"
        tabIndex={0}
        onKeyDown={e => e.key === 'Enter' && setZoomed(true)}
      >
        {/* Discount badge */}
        {savings >= 5 && (
          <div style={{
            position: 'absolute', top: '16px', right: '16px',
            background: '#c0392b', color: '#fff', fontSize: '12px',
            fontWeight: 900, padding: '5px 13px', borderRadius: '20px',
            zIndex: 2, letterSpacing: '.3px'
          }}>
            -{savings}%
          </div>
        )}

        {/* Zoom icon */}
        <div style={{
          position: 'absolute', top: '50%', left: '50%',
          transform: 'translate(-50%,-50%) scale(0)',
          width: '54px', height: '54px', background: 'rgba(255,255,255,.92)',
          borderRadius: '50%', display: 'flex', alignItems: 'center',
          justifyContent: 'center', zIndex: 4, pointerEvents: 'none',
          transition: 'transform .3s cubic-bezier(.34,1.56,.64,1), opacity .3s',
          opacity: 0,
        }} className="pdp-gallery-zoom-icon">
          <svg viewBox="0 0 24 24" style={{ width: '24px', height: '24px', stroke: '#1a3a1e', strokeWidth: 2, fill: 'none' }}>
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
            <line x1="11" y1="8" x2="11" y2="14" /><line x1="8" y1="11" x2="14" y2="11" />
          </svg>
        </div>

        <Image
          src={images[active].url}
          alt={images[active].alt}
          fill
          sizes="(max-width:900px) 100vw, 50vw"
          className="pdp-gallery-main-img"
          style={{ objectFit: 'cover', transition: 'transform .55s cubic-bezier(.25,.46,.45,.94)' }}
          priority
        />

        {/* Navigation arrows */}
        {images.length > 1 && (
          <>
            <button
              type="button"
              onClick={e => { e.stopPropagation(); prev() }}
              aria-label="Previous image"
              style={{
                position: 'absolute', top: '50%', left: '12px',
                transform: 'translateY(-50%)', width: '44px', height: '44px',
                background: 'rgba(192,57,43,.88)', color: '#fff', border: 'none',
                borderRadius: '50%', fontSize: '20px', fontWeight: 700,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                zIndex: 5, cursor: 'pointer', backdropFilter: 'blur(6px)',
                boxShadow: '0 2px 14px rgba(192,57,43,.35)',
              }}
            >‹</button>
            <button
              type="button"
              onClick={e => { e.stopPropagation(); next() }}
              aria-label="Next image"
              style={{
                position: 'absolute', top: '50%', right: '12px',
                transform: 'translateY(-50%)', width: '44px', height: '44px',
                background: 'rgba(192,57,43,.88)', color: '#fff', border: 'none',
                borderRadius: '50%', fontSize: '20px', fontWeight: 700,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                zIndex: 5, cursor: 'pointer', backdropFilter: 'blur(6px)',
                boxShadow: '0 2px 14px rgba(192,57,43,.35)',
              }}
            >›</button>
            <div style={{
              position: 'absolute', bottom: '14px', right: '14px',
              background: 'rgba(0,0,0,.52)', color: '#fff', fontSize: '11px',
              fontWeight: 700, padding: '4px 10px', borderRadius: '20px',
              zIndex: 2, backdropFilter: 'blur(4px)',
            }}>
              {active + 1} / {images.length}
            </div>
          </>
        )}
      </div>

      {/* Thumbnails */}
      {images.length > 1 && (
        <div style={{ display: 'flex', gap: '10px', marginTop: '14px', flexWrap: 'wrap' }}>
          {images.map((img, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setActive(i)}
              aria-label={`Image ${i + 1}`}
              style={{
                width: '80px', height: '80px', borderRadius: '12px',
                overflow: 'hidden', cursor: 'pointer', position: 'relative',
                border: `2.5px solid ${i === active ? '#1a3a1e' : 'transparent'}`,
                boxShadow: i === active ? '0 0 0 3px rgba(26,58,30,.12)' : '0 2px 8px rgba(0,0,0,.06)',
                background: '#f8f5f0', flexShrink: 0, padding: 0,
                transition: 'all .25s',
              }}
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

      {/* Zoom lightbox */}
      {zoomed && (
        <div
          onClick={() => setZoomed(false)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,.88)',
            zIndex: 2000, display: 'flex', alignItems: 'center',
            justifyContent: 'center', cursor: 'zoom-out',
          }}
          role="dialog"
          aria-modal
          aria-label="Image zoom"
        >
          <button
            type="button"
            onClick={() => setZoomed(false)}
            style={{
              position: 'absolute', top: '20px', right: '24px',
              background: 'rgba(255,255,255,.15)', border: 'none',
              color: '#fff', fontSize: '28px', cursor: 'pointer',
              borderRadius: '50%', width: '44px', height: '44px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
            aria-label="Close"
          >×</button>
          {images.length > 1 && (
            <>
              <button type="button" onClick={e => { e.stopPropagation(); prev() }}
                style={{ position: 'absolute', left: '20px', top: '50%', transform: 'translateY(-50%)', background: 'rgba(255,255,255,.15)', border: 'none', color: '#fff', fontSize: '32px', cursor: 'pointer', borderRadius: '50%', width: '50px', height: '50px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >‹</button>
              <button type="button" onClick={e => { e.stopPropagation(); next() }}
                style={{ position: 'absolute', right: '20px', top: '50%', transform: 'translateY(-50%)', background: 'rgba(255,255,255,.15)', border: 'none', color: '#fff', fontSize: '32px', cursor: 'pointer', borderRadius: '50%', width: '50px', height: '50px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >›</button>
            </>
          )}
          <div
            onClick={e => e.stopPropagation()}
            style={{ position: 'relative', width: '90vw', maxWidth: '800px', aspectRatio: '1' }}
          >
            <Image
              src={images[active].url}
              alt={images[active].alt}
              fill
              sizes="90vw"
              style={{ objectFit: 'contain', borderRadius: '12px' }}
              priority
            />
          </div>
        </div>
      )}
    </>
  )
}
