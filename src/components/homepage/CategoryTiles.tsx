'use client'

import { useEffect, useRef } from 'react'
import Link from 'next/link'
import type { Category } from '@/types'

interface Props { categories: Category[] }

function emojiFor(cat: Category): string {
  const slug = (cat.slug || '').toLowerCase()
  const name = (cat.name || '').toLowerCase()
  const bySlug: Record<string, string> = {
    honey: '🍯', jams: '🍓', juice: '🧃', oil: '🫚',
    pulses: '🫘', rice: '🌾', shilajit: '🪨', spices: '🌿', tea: '🍵',
  }
  if (bySlug[slug]) return bySlug[slug]
  if (name.includes('honey'))  return '🍯'
  if (name.includes('ghee'))   return '🥛'
  if (name.includes('herb') || name.includes('spice')) return '🌿'
  if (name.includes('tea'))    return '🍵'
  if (name.includes('rice') || name.includes('grain') || name.includes('millet')) return '🌾'
  if (name.includes('oil'))    return '🫙'
  if (name.includes('juice'))  return '🧃'
  if (name.includes('shilajit') || name.includes('resin')) return '🪨'
  if (name.includes('jam') || name.includes('preserve')) return '🍓'
  if (name.includes('pulse') || name.includes('dal')) return '🫘'
  if (name.includes('coffee')) return '☕'
  return '🏔️'
}

export default function CategoryTiles({ categories }: Props) {
  const active = categories.filter(c => c.is_active)
  const gridRef   = useRef<HTMLDivElement>(null)
  const pausedRef = useRef(false)
  const animRef   = useRef(false)

  useEffect(() => {
    if (!gridRef.current || active.length < 2) return
    const cgrid: HTMLDivElement = gridRef.current

    const VISIBLE = window.innerWidth < 640 ? 2 : window.innerWidth < 960 ? 4 : 6

    function cellW() { return cgrid.getBoundingClientRect().width / VISIBLE }

    const allCells = Array.from(cgrid.querySelectorAll<HTMLElement>('.cc-cell'))
    function setWidths() {
      const w = cgrid.getBoundingClientRect().width / VISIBLE
      allCells.forEach(c => { c.style.width = w + 'px'; c.style.minWidth = w + 'px'; c.style.flex = 'none' })
    }
    setWidths()
    cgrid.scrollLeft = 0

    function ease(t: number) { return t < 0.5 ? 2*t*t : -1+(4-2*t)*t }

    function animScroll(from: number, to: number, done?: () => void) {
      animRef.current = true
      const dur = 500; let t0: number | null = null
      const frame = (ts: number) => {
        if (!t0) t0 = ts
        const p = Math.min((ts - t0) / dur, 1)
        cgrid.scrollLeft = from + (to - from) * ease(p)
        if (p < 1) requestAnimationFrame(frame)
        else { cgrid.scrollLeft = to; animRef.current = false; done?.() }
      }
      requestAnimationFrame(frame)
    }

    const origCount = active.length

    function goNext() {
      if (animRef.current) return
      const w = cellW()
      const from = cgrid.scrollLeft
      animScroll(from, from + w, () => {
        if (cgrid.scrollLeft >= origCount * w) cgrid.scrollLeft = 0
      })
    }
    function goPrev() {
      if (animRef.current) return
      const w = cellW()
      if (cgrid.scrollLeft <= 0) cgrid.scrollLeft = origCount * w
      const from = cgrid.scrollLeft
      animScroll(from, from - w)
    }

    const wrap = cgrid.parentElement!
    const lb = wrap.querySelector<HTMLButtonElement>('.cgrid-arrow.left')
    const rb = wrap.querySelector<HTMLButtonElement>('.cgrid-arrow.right')
    if (lb) lb.onclick = () => { pausedRef.current = true; goPrev(); setTimeout(() => { pausedRef.current = false }, 1000) }
    if (rb) rb.onclick = () => { pausedRef.current = true; goNext(); setTimeout(() => { pausedRef.current = false }, 1000) }

    const timer = setInterval(() => { if (!pausedRef.current) goNext() }, 2500)
    wrap.addEventListener('mouseenter', () => { pausedRef.current = true })
    wrap.addEventListener('mouseleave', () => { pausedRef.current = false })
    wrap.addEventListener('touchstart', () => { pausedRef.current = true }, { passive: true })
    wrap.addEventListener('touchend', () => { setTimeout(() => { pausedRef.current = false }, 1800) }, { passive: true })

    const onResize = () => { setWidths(); cgrid.scrollLeft = 0 }
    window.addEventListener('resize', onResize)

    return () => { clearInterval(timer); window.removeEventListener('resize', onResize) }
  }, [active.length])

  if (!active.length) return null

  // Duplicate for seamless infinite loop
  const doubled = [...active, ...active]

  return (
    <section style={{ background: 'linear-gradient(180deg,#f9f4ec,#ede8d5)', padding: '40px 0 52px', overflow: 'visible' }}>

      {/* Header */}
      <div style={{ textAlign: 'center', marginBottom: '28px', padding: '0 40px' }}>
        <div style={{
          display: 'inline-block', border: '1.5px solid #c9a84c', borderRadius: '20px',
          padding: '5px 18px', fontFamily: 'var(--font-lato,Lato,sans-serif)',
          fontSize: '11px', fontWeight: 700, letterSpacing: '2px', color: '#a07830',
          textTransform: 'uppercase', marginBottom: '12px',
        }}>Browse Collections</div>
        <h2 style={{
          fontFamily: 'var(--font-playfair,"Playfair Display",Georgia,serif)',
          fontSize: 'clamp(28px,4vw,52px)', fontWeight: 700, color: '#1a3a1e',
          margin: '0 0 10px', lineHeight: 1.15, fontStyle: 'italic',
        }}>What the Mountains Offer</h2>
        <p style={{ fontSize: '14px', color: '#7a7a7a', maxWidth: '440px', margin: '0 auto', lineHeight: 1.6 }}>
          Every category tells a story of altitude, tradition, and purity.
        </p>
      </div>

      {/* Carousel */}
      <div style={{ position: 'relative', padding: '12px 52px 28px', boxSizing: 'border-box', overflow: 'hidden' }}>

        <button className="cgrid-arrow left" aria-label="Previous" style={{
          position: 'absolute', top: '50%', transform: 'translateY(-60%)', zIndex: 10,
          left: '8px', width: '36px', height: '36px', background: '#fff',
          border: '1.5px solid #e0e0e0', borderRadius: '50%', display: 'flex',
          alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
          boxShadow: '0 2px 10px rgba(0,0,0,.12)', fontSize: '18px', color: '#333',
          transition: 'all .2s',
        }}>&#8249;</button>

        <button className="cgrid-arrow right" aria-label="Next" style={{
          position: 'absolute', top: '50%', transform: 'translateY(-60%)', zIndex: 10,
          right: '8px', width: '36px', height: '36px', background: '#fff',
          border: '1.5px solid #e0e0e0', borderRadius: '50%', display: 'flex',
          alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
          boxShadow: '0 2px 10px rgba(0,0,0,.12)', fontSize: '18px', color: '#333',
          transition: 'all .2s',
        }}>&#8250;</button>

        {/* Track */}
        <div
          ref={gridRef}
          style={{
            display: 'flex', overflowX: 'scroll', overflowY: 'hidden',
            scrollbarWidth: 'none', width: '100%', position: 'relative',
            padding: '8px 4px 16px',
          }}
        >
          {doubled.map((cat, idx) => {
            const emoji = emojiFor(cat)
            const isClone = idx >= active.length
            return (
              <div
                key={`${cat.id}-${idx}`}
                className="cc-cell"
                aria-hidden={isClone ? 'true' : undefined}
                style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center',
                  gap: '10px', padding: '0 8px', boxSizing: 'border-box',
                  transition: 'transform .25s',
                }}
              >
                <Link href={`/collections/${cat.slug}`} style={{ display: 'block', width: '100%', textDecoration: 'none' }}>
                  <div className="cc-box" style={{
                    width: '100%', aspectRatio: '1/1', borderRadius: '16px',
                    border: '2px solid #c9a84c', background: '#fafaf8',
                    position: 'relative', overflow: 'hidden',
                    boxShadow: '0 2px 12px rgba(201,168,76,.18)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    transition: 'border-color .25s, box-shadow .25s',
                  }}>
                    <span className="cc-emo" style={{
                      fontSize: '52px', lineHeight: 1, position: 'absolute', zIndex: 1,
                      top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
                      transition: 'opacity .3s', pointerEvents: 'none',
                    }}>{emoji}</span>

                    {cat.image_url && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={cat.image_url}
                        alt={cat.name}
                        loading={idx < 6 ? 'eager' : 'lazy'}
                        className="cc-img"
                        style={{
                          position: 'absolute', inset: 0, width: '100%', height: '100%',
                          objectFit: 'cover', zIndex: 2, opacity: 0,
                          transition: 'opacity .35s, transform .35s',
                        }}
                        onLoad={e => {
                          const img = e.currentTarget
                          img.style.opacity = '1'
                          const emo = img.previousElementSibling as HTMLElement | null
                          if (emo?.classList.contains('cc-emo')) emo.style.opacity = '0'
                        }}
                        onError={e => { e.currentTarget.remove() }}
                      />
                    )}
                  </div>
                </Link>

                <Link href={`/collections/${cat.slug}`} style={{
                  fontFamily: '"Playfair Display",serif',
                  fontSize: '14px', fontWeight: 700, color: '#1a3a1e',
                  textAlign: 'center', lineHeight: 1.3, width: '100%',
                  textDecoration: 'none', display: 'block',
                }}>{cat.name}</Link>
              </div>
            )
          })}
        </div>
      </div>

      {/* View All */}
      <div style={{ textAlign: 'center', marginTop: '4px' }}>
        <Link href="/products" style={{
          display: 'inline-flex', alignItems: 'center', gap: '8px',
          background: '#1a3a1e', color: '#fff',
          fontFamily: 'var(--font-lato,Lato,sans-serif)',
          fontSize: '13px', fontWeight: 800, letterSpacing: '.5px',
          padding: '11px 24px', borderRadius: '24px', textDecoration: 'none',
          transition: 'all .2s',
        }}>
          🌿 View All Products <span style={{ fontSize: '16px' }}>→</span>
        </Link>
      </div>

      <style>{`
        div[style*="overflowX: scroll"]::-webkit-scrollbar { display: none; }
        .cc-cell:hover { transform: translateY(-4px) !important; }
        .cc-cell:hover .cc-box { border-color: #a07830 !important; box-shadow: 0 6px 24px rgba(201,168,76,.32) !important; }
        .cc-cell:hover .cc-img { transform: scale(1.06) !important; }
        .cgrid-arrow:hover { background: #f5f5f5 !important; box-shadow: 0 4px 16px rgba(0,0,0,.18) !important; border-color: #ccc !important; }
        @media(max-width:640px) { .cgrid-arrow { display: none !important; } }
      `}</style>
    </section>
  )
}
