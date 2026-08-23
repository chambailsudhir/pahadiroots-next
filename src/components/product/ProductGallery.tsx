'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import Image from 'next/image'

interface GalleryImage { url: string; alt: string }
interface Props { images: GalleryImage[]; productName: string; savings?: number }

export default function ProductGallery({ images, productName, savings = 0 }: Props) {
  const [active, setActive]   = useState(0)
  const [zoomed, setZoomed]   = useState(false)
  // BUG FIX (portal): the lightbox was rendered in-place as a plain
  // descendant of ProductGallery, which lives inside `.pdp-img-col`
  // (`position: sticky` in pdp.css). `position: sticky` unconditionally
  // creates a new CSS stacking context (same as fixed/absolute + z-index,
  // per the CSS Positioned Layout spec) — so even though the modal is
  // `position: fixed` with `zIndex: 2000`, that z-index was only ever being
  // compared against OTHER elements inside `.pdp-img-col`'s own stacking
  // context. It could never out-rank `.pdp-info-col` (the variant/qty/
  // Add-to-Cart/Buy-Now column), a plain sibling one level up in the grid —
  // that column simply paints after `.pdp-img-col` in normal DOM order and
  // wins by default, regardless of the modal's z-index. That's exactly
  // what was reported: the dark zoom backdrop showing behind the fully
  // opaque buy box instead of underneath it.
  // `createPortal` renders the modal as a direct child of <body>, outside
  // every ancestor's stacking context (including any future one), so its
  // z-index is finally compared at the document root where 2000 actually
  // wins against everything else in the app (highest prior use was 200,
  // in QuickViewModal). No mount-guard/useEffect needed for the SSR/client
  // document check — `zoomed` can only ever become true via the onClick/
  // onKeyDown handlers below, which only run after hydration, so `document`
  // is always defined by the time this branch renders.
  // BUG FIX (3.7 + A11y): track the trigger element so focus can be restored
  // to it when the lightbox closes (WCAG 2.1 SC 2.4.3)
  const triggerRef            = useRef<HTMLDivElement>(null)
  // BUG FIX (A11y): first focusable element inside lightbox for focus trap
  const closeBtnRef           = useRef<HTMLButtonElement>(null)

  const openZoom  = useCallback(() => setZoomed(true),  [])
  const closeZoom = useCallback(() => {
    setZoomed(false)
    // Restore focus to the gallery trigger (WCAG 2.4.3)
    setTimeout(() => triggerRef.current?.focus(), 0)
  }, [])

  // BUG FIX (A11y): Escape key closes the lightbox
  useEffect(() => {
    if (!zoomed) return
    // Move focus into the lightbox when it opens
    closeBtnRef.current?.focus()

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') { closeZoom(); return }
      // Basic focus trap — keep Tab cycling within the lightbox
      if (e.key === 'Tab') {
        const modal = document.getElementById('pdp-zoom-modal')
        if (!modal) return
        const focusable = Array.from(
          modal.querySelectorAll<HTMLElement>(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
          )
        ).filter(el => !el.hasAttribute('disabled'))
        if (!focusable.length) return
        const first = focusable[0]
        const last  = focusable[focusable.length - 1]
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault(); last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault(); first.focus()
        }
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [zoomed, closeZoom])

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
        ref={triggerRef}
        style={{
          position: 'relative', borderRadius: '20px', overflow: 'hidden',
          background: '#f8f5f0', aspectRatio: '4/5', cursor: 'zoom-in',
          boxShadow: '0 8px 40px rgba(0,0,0,.14)'
        }}
        onClick={openZoom}
        role="button"
        aria-label="View full image"
        tabIndex={0}
        onKeyDown={e => e.key === 'Enter' && openZoom()}
        className="pdp-gallery-trigger"
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

        {/* BUG FIX (3.7): zoom icon was permanently invisible because class
            pdp-gallery-zoom-icon had zero matching CSS rules anywhere in the
            project. Now uses the pdp-gallery-trigger:hover CSS rule added in
            globals.css to reveal it on hover. */}
        <div
          style={{
            position: 'absolute', top: '50%', left: '50%',
            transform: 'translate(-50%,-50%) scale(0)',
            width: '54px', height: '54px', background: 'rgba(255,255,255,.92)',
            borderRadius: '50%', display: 'flex', alignItems: 'center',
            justifyContent: 'center', zIndex: 4, pointerEvents: 'none',
            transition: 'transform .3s cubic-bezier(.34,1.56,.64,1), opacity .3s',
            opacity: 0,
          }}
          className="pdp-gallery-zoom-icon"
          aria-hidden="true"
        >
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
              aria-pressed={i === active}
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

      {/* BUG FIX (Aug 23 2026 — background page text still legible through the
          zoom backdrop, flagged with a screenshot after the stacking-context/
          portal fix above): that portal fix was working correctly — pixel-
          sampled the "visible" area and it's genuinely darkened uniformly
          everywhere (~30/255, exactly what rgba(0,0,0,.88) produces over a
          white background). The remaining problem is simpler: 88% opacity
          black over crisp black-on-white body text still leaves just enough
          contrast for the letterforms to read. No amount of opacity alone
          fully solves this for arbitrary underlying contrast — 0.97 would
          still leave *some* residual difference. Added `backdropFilter: blur`
          instead (with a modest opacity bump), which destroys the letter
          shapes geometrically rather than merely dimming them, so it can't
          become readable again regardless of what's rendered underneath. */}
      {zoomed && createPortal(
        <div
          id="pdp-zoom-modal"
          onClick={closeZoom}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(10,12,10,.94)',
            backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)',
            zIndex: 2000, display: 'flex', alignItems: 'center',
            justifyContent: 'center', cursor: 'zoom-out',
          }}
          role="dialog"
          aria-modal={true}
          aria-label={`${productName} — full size image`}
        >
          <button
            ref={closeBtnRef}
            type="button"
            onClick={closeZoom}
            style={{
              position: 'absolute', top: '20px', right: '24px',
              background: 'rgba(255,255,255,.15)', border: 'none',
              color: '#fff', fontSize: '28px', cursor: 'pointer',
              borderRadius: '50%', width: '44px', height: '44px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
            aria-label="Close image zoom (Escape)"
          >×</button>
          {images.length > 1 && (
            <>
              <button type="button" onClick={e => { e.stopPropagation(); prev() }}
                aria-label="Previous image"
                style={{ position: 'absolute', left: '20px', top: '50%', transform: 'translateY(-50%)', background: 'rgba(255,255,255,.15)', border: 'none', color: '#fff', fontSize: '32px', cursor: 'pointer', borderRadius: '50%', width: '50px', height: '50px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >‹</button>
              <button type="button" onClick={e => { e.stopPropagation(); next() }}
                aria-label="Next image"
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
        </div>,
        document.body
      )}
    </>
  )
}
