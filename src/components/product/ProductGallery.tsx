'use client'

import { useState } from 'react'
import Image from 'next/image'

interface GalleryImage { url: string; alt: string }
interface Props { images: GalleryImage[]; productName: string }

export default function ProductGallery({ images, productName }: Props) {
  const [active, setActive]   = useState(0)
  const [zoomed, setZoomed]   = useState(false)

  if (!images.length) {
    return (
      <div className="aspect-square rounded-2xl bg-stone-100 flex items-center justify-center">
        <span className="text-7xl">🌿</span>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">

      {/* Main image */}
      <div
        className="relative aspect-square rounded-2xl overflow-hidden bg-stone-50 cursor-zoom-in"
        onClick={() => setZoomed(true)}
      >
        <Image
          src={images[active].url}
          alt={images[active].alt}
          fill
          sizes="(max-width: 1024px) 100vw, 50vw"
          className="object-cover"
          priority
        />
        <button
          className="absolute top-3 right-3 w-8 h-8 bg-white/90 rounded-full flex items-center justify-center shadow"
          aria-label="Zoom image"
          onClick={e => { e.stopPropagation(); setZoomed(true) }}
        >
          <svg className="w-4 h-4 text-stone-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607zM10.5 7.5v6m3-3h-6" />
          </svg>
        </button>
      </div>

      {/* Thumbnail strip */}
      {images.length > 1 && (
        <div className="flex gap-2 overflow-x-auto no-scrollbar">
          {images.map((img, i) => (
            <button
              key={i}
              onClick={() => setActive(i)}
              className={`relative w-16 h-16 shrink-0 rounded-xl overflow-hidden border-2 transition-all ${
                i === active
                  ? 'border-forest-600 opacity-100'
                  : 'border-transparent opacity-60 hover:opacity-90'
              }`}
              aria-label={`View image ${i + 1}`}
            >
              <Image
                src={img.url}
                alt={img.alt}
                fill
                sizes="64px"
                className="object-cover"
              />
            </button>
          ))}
        </div>
      )}

      {/* Zoom lightbox */}
      {zoomed && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
          onClick={() => setZoomed(false)}
        >
          <button
            className="absolute top-4 right-4 w-10 h-10 bg-white/20 hover:bg-white/30 rounded-full flex items-center justify-center text-white transition-colors"
            aria-label="Close zoom"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
          <div className="relative w-full max-w-2xl aspect-square">
            <Image
              src={images[active].url}
              alt={images[active].alt}
              fill
              sizes="90vw"
              className="object-contain"
              priority
            />
          </div>
        </div>
      )}
    </div>
  )
}
