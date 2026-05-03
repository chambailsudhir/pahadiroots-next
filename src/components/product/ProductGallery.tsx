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
    </div>
  )
}
