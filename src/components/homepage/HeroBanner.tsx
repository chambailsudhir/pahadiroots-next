'use client'

import { useState, useEffect, useCallback } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import type { SiteSettings } from '@/types'

interface HeroImage { url: string; alt_text?: string | null; title?: string; subtitle?: string }
interface Props { images: HeroImage[]; settings: SiteSettings }

const LEAVES = ['🍃','🌿','🍀','☘️','🌱']

export default function HeroBanner({ images, settings }: Props) {
  const [current, setCurrent] = useState(0)
  const [mounted, setMounted] = useState(false)
  const slides = images.length > 0 ? images : null
  const total  = slides ? slides.length : 1

  const next = useCallback(() => setCurrent(c => (c + 1) % total), [total])

  useEffect(() => { setMounted(true) }, [])
  useEffect(() => {
    if (total <= 1) return
    const iv = setInterval(next, 4500)
    return () => clearInterval(iv)
  }, [next, total])

  const leafData = [
    { top: '10%', left: '8%',  size: 22, dur: '12s', delay: '0s'   },
    { top: '5%',  left: '25%', size: 16, dur: '15s', delay: '2s'   },
    { top: '15%', left: '70%', size: 20, dur: '11s', delay: '4s'   },
    { top: '8%',  left: '85%', size: 14, dur: '14s', delay: '1.5s' },
    { top: '20%', left: '50%', size: 18, dur: '13s', delay: '3s'   },
  ]

  return (
    <section className="hero">
      {/* Slides */}
      {slides ? (
        slides.map((img, i) => (
          <div key={i} className="absolute inset-0" style={{ opacity: i === current ? 1 : 0, transition: 'opacity .7s' }}>
            <Image src={img.url} alt={img.alt_text || 'Pahadi Roots'} fill sizes="100vw" className="object-cover" priority={i === 0} />
            <div className="absolute inset-0" style={{ background: 'linear-gradient(170deg,rgba(7,26,9,.65) 0%,rgba(26,58,30,.4) 60%,transparent 100%)' }} />
          </div>
        ))
      ) : (
        <div className="absolute inset-0" style={{ background: 'linear-gradient(170deg,#071a09 0%,#0e2812 25%,#1a3a1e 55%,#2d5233 80%,#3a6140 100%)' }} />
      )}

      {/* Overlay */}
      <div className="hero-overlay" />

      {/* Falling leaves */}
      {mounted && leafData.map((l, i) => (
        <div key={i} className="lf" style={{ top: l.top, left: l.left, fontSize: l.size, animationDuration: l.dur, animationDelay: l.delay }}>
          {LEAVES[i % LEAVES.length]}
        </div>
      ))}

      {/* Mountain silhouette */}
      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '30%', pointerEvents: 'none', zIndex: 2 }}>
        <svg viewBox="0 0 1440 220" preserveAspectRatio="none" style={{ width: '100%', height: '100%', display: 'block' }}>
          <polygon points="0,220 180,80 360,140 540,60 720,120 900,50 1080,110 1260,70 1440,100 1440,220" fill="rgba(7,26,9,0.55)" />
          <polygon points="0,220 200,110 400,160 600,90 800,150 1000,80 1200,130 1440,120 1440,220" fill="rgba(7,26,9,0.35)" />
        </svg>
      </div>

      {/* Content */}
      <div className="hero-content">
        <div className="eyebrow">✦ PURE HIMALAYAN NATURALS ✦</div>
        <h1 className="hero-h1">
          {slides && slides[current]?.title ? (
            slides[current].title
          ) : (
            <>From the Heart of<br /><em>The Himalayas</em></>
          )}
        </h1>
        <p className="hero-sub">
          {slides && slides[current]?.subtitle
            ? slides[current].subtitle
            : 'Sourced directly from mountain farming communities — wild honey, A2 ghee, saffron & more. No middlemen, just pure goodness.'
          }
        </p>
        <div className="hbtns">
          <Link href="/products" className="btn-g">Shop Now</Link>
          <Link href="/about" className="btn-w">Our Story</Link>
        </div>

        {/* Stats */}
        <div className="hstats">
          <div className="hstat">
            <div className="hstat-num">500<em>+</em></div>
            <div className="hstat-lbl">HAPPY CUSTOMERS</div>
          </div>
          <div className="hstat-div" />
          <div className="hstat">
            <div className="hstat-num">{settings.states_covered || '10'}<em>+</em></div>
            <div className="hstat-lbl">HIMALAYAN STATES</div>
          </div>
          <div className="hstat-div" />
          <div className="hstat">
            <div className="hstat-num">100<em>%</em></div>
            <div className="hstat-lbl">NATURAL</div>
          </div>
          <div className="hstat-div" />
          <div className="hstat">
            <div className="hstat-num">4.9<em>★</em></div>
            <div className="hstat-lbl">CUSTOMER RATING</div>
          </div>
        </div>
      </div>

      {/* Scroll cue */}
      <div className="scroll-cue">
        <span>SCROLL</span>
        <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
        </svg>
      </div>

      {/* Dots */}
      {total > 1 && (
        <div style={{ position: 'absolute', bottom: 24, left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: 6, zIndex: 4 }}>
          {Array.from({ length: total }).map((_, i) => (
            <button key={i} onClick={() => setCurrent(i)} aria-label={`Slide ${i + 1}`}
              style={{ height: 6, borderRadius: 3, background: 'rgba(255,255,255,0.9)', width: i === current ? 24 : 6, opacity: i === current ? 1 : 0.4, border: 'none', cursor: 'pointer', transition: 'all .3s' }} />
          ))}
        </div>
      )}

      {/* Prev/Next */}
      {total > 1 && (
        <>
          <button onClick={() => setCurrent(c => (c - 1 + total) % total)} aria-label="Previous"
            style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', zIndex: 4, background: 'rgba(255,255,255,.2)', backdropFilter: 'blur(4px)', border: 'none', borderRadius: '50%', width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', cursor: 'pointer' }}>
            <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" /></svg>
          </button>
          <button onClick={next} aria-label="Next"
            style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', zIndex: 4, background: 'rgba(255,255,255,.2)', backdropFilter: 'blur(4px)', border: 'none', borderRadius: '50%', width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', cursor: 'pointer' }}>
            <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" /></svg>
          </button>
        </>
      )}
    </section>
  )
}
