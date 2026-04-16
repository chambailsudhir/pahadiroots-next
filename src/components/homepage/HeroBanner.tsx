'use client'

import { useState, useEffect, useCallback } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import type { SiteSettings } from '@/types'

interface HeroImage { url: string; alt_text?: string | null }

interface Props {
  images:   HeroImage[]
  settings: SiteSettings
}

const FALLBACK_SLIDES = [
  { gradient: 'from-forest-900 to-forest-700', label: 'Pure Himalayan Honey 🍯' },
  { gradient: 'from-earth-800 to-earth-600',   label: 'Mountain Spices 🌶️' },
  { gradient: 'from-stone-800 to-stone-600',   label: 'Natural Grains 🌾' },
]

export default function HeroBanner({ images, settings }: Props) {
  const [current, setCurrent] = useState(0)
  const slides = images.length > 0 ? images : null

  const next = useCallback(() => {
    const max = slides ? slides.length : FALLBACK_SLIDES.length
    setCurrent(c => (c + 1) % max)
  }, [slides])

  useEffect(() => {
    const interval = setInterval(next, 4500)
    return () => clearInterval(interval)
  }, [next])

  const totalSlides = slides ? slides.length : FALLBACK_SLIDES.length

  return (
    <section className="relative w-full overflow-hidden bg-forest-900" style={{ height: 'clamp(340px, 55vw, 600px)' }}>

      {/* Slides */}
      {slides ? (
        slides.map((img, i) => (
          <div
            key={i}
            className={`absolute inset-0 transition-opacity duration-700 ${i === current ? 'opacity-100' : 'opacity-0'}`}
          >
            <Image
              src={img.url}
              alt={img.alt_text || 'Pahadi Roots'}
              fill
              sizes="100vw"
              className="object-cover"
              priority={i === 0}
            />
            <div className="absolute inset-0 bg-gradient-to-r from-black/60 via-black/30 to-transparent" />
          </div>
        ))
      ) : (
        FALLBACK_SLIDES.map((slide, i) => (
          <div
            key={i}
            className={`absolute inset-0 bg-gradient-to-br ${slide.gradient} transition-opacity duration-700 ${i === current ? 'opacity-100' : 'opacity-0'}`}
          >
            <div className="absolute inset-0 flex items-center justify-center opacity-10 text-[200px]">
              🏔️
            </div>
          </div>
        ))
      )}

      {/* Content overlay */}
      <div className="relative h-full flex items-center">
        <div className="max-w-7xl mx-auto px-6 sm:px-10 lg:px-16 w-full">
          <div className="max-w-xl">
            <div className="inline-flex items-center gap-2 bg-white/15 backdrop-blur-sm text-white text-xs font-semibold px-3 py-1.5 rounded-full mb-4 border border-white/20">
              <span className="w-1.5 h-1.5 bg-green-400 rounded-full" />
              100% Natural · Direct from Farmers
            </div>
            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-white leading-tight mb-4">
              Pure Products from<br />
              <span className="text-earth-300">The Himalayas</span>
            </h1>
            <p className="text-base text-white/80 mb-7 max-w-md leading-relaxed">
              Sourced directly from mountain farming communities. No middlemen, no additives — just the pure goodness of the mountains.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link
                href="/products"
                className="inline-flex items-center gap-2 bg-earth-500 hover:bg-earth-600 text-white font-bold px-6 py-3 rounded-xl text-sm transition-colors shadow-lg"
              >
                Shop Now
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                </svg>
              </Link>
              <Link
                href="/about"
                className="inline-flex items-center gap-2 bg-white/15 hover:bg-white/25 text-white font-semibold px-6 py-3 rounded-xl text-sm transition-colors border border-white/30 backdrop-blur-sm"
              >
                Our Story
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* Dots */}
      {totalSlides > 1 && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-1.5">
          {Array.from({ length: totalSlides }).map((_, i) => (
            <button
              key={i}
              onClick={() => setCurrent(i)}
              aria-label={`Go to slide ${i + 1}`}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                i === current ? 'bg-white w-6' : 'bg-white/40 w-1.5'
              }`}
            />
          ))}
        </div>
      )}

      {/* Prev / Next */}
      {totalSlides > 1 && (
        <>
          <button
            onClick={() => setCurrent(c => (c - 1 + totalSlides) % totalSlides)}
            aria-label="Previous slide"
            className="absolute left-3 top-1/2 -translate-y-1/2 w-9 h-9 bg-white/20 hover:bg-white/30 backdrop-blur-sm text-white rounded-full flex items-center justify-center transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
            </svg>
          </button>
          <button
            onClick={next}
            aria-label="Next slide"
            className="absolute right-3 top-1/2 -translate-y-1/2 w-9 h-9 bg-white/20 hover:bg-white/30 backdrop-blur-sm text-white rounded-full flex items-center justify-center transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
            </svg>
          </button>
        </>
      )}
    </section>
  )
}
