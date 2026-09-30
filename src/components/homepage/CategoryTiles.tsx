'use client'

import { useEffect, useRef } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import type { Category } from '@/types'
import { emojiForCategory } from '@/lib/categoryEmoji'

interface Props { categories: Category[] }


export default function CategoryTiles({ categories }: Props) {
  const active = categories.filter(c => c.is_active)
  const gridRef   = useRef<HTMLDivElement>(null)
  const pausedRef = useRef(false)
  const animRef   = useRef(false)

  useEffect(() => {
    if (!gridRef.current || active.length < 2) return
    const cgrid: HTMLDivElement = gridRef.current

    // BUG FIX (P2): VISIBLE used to be a `const` computed once when this
    // effect ran (i.e. at mount), then captured in the cellW()/setWidths()
    // closures below. onResize() called setWidths() again on every resize,
    // but setWidths() was still reading that same stale, mount-time
    // VISIBLE value — so resizing the window across the 640px/960px
    // breakpoints (e.g. rotating a tablet, or resizing a desktop window)
    // left the tile-width math computed for the WRONG number of visible
    // tiles, drifting the carousel's loop/scroll math out of sync with
    // what's actually on screen. Fixed by making this a function computed
    // fresh on every call instead of a value frozen at mount time.
    function getVisible() { return window.innerWidth < 640 ? 2 : window.innerWidth < 960 ? 4 : 6 }

    function cellW() { return cgrid.getBoundingClientRect().width / getVisible() }

    const allCells = Array.from(cgrid.querySelectorAll<HTMLElement>('.cc-cell'))
    function setWidths() {
      const w = cgrid.getBoundingClientRect().width / getVisible()
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

    // BUG FIX (found in a fresh re-audit): the "seamless infinite loop"
    // boundary reset above only ran inside goNext()'s animation-completion
    // callback — meaning it only fired when a user clicked the arrow
    // buttons. Since this track is a plain native-scrollable div
    // (overflowX: scroll), a user can also just swipe/drag it directly —
    // very likely on mobile — and scrolling that way past the boundary
    // never triggered any reset at all: they'd scroll into the cloned
    // duplicate set and hit a hard stop at its end instead of looping.
    // This listener catches that case too. Debounced (settles 120ms after
    // scrolling stops) so it doesn't try to snap mid-drag, which would
    // fight the user's own touch/momentum scrolling. Ignores scroll
    // events fired by our own goNext()/goPrev() animation (animRef.current)
    // so the two mechanisms don't conflict.
    let scrollEndTimer: ReturnType<typeof setTimeout> | null = null
    function onScroll() {
      if (animRef.current) return
      if (scrollEndTimer) clearTimeout(scrollEndTimer)
      scrollEndTimer = setTimeout(() => {
        const w = cellW()
        if (w <= 0) return
        const setWidth = origCount * w
        // Subtract exactly one full set's width rather than snapping
        // straight to 0 — preserves how far into the set the user had
        // actually scrolled, instead of jumping back to the very start
        // regardless of drag distance.
        if (cgrid.scrollLeft >= setWidth) cgrid.scrollLeft -= setWidth
      }, 120)
    }
    cgrid.addEventListener('scroll', onScroll, { passive: true })

    // BUG FIX (P2): this interval used to run forever with no
    // prefers-reduced-motion check and no pause when the tab was
    // backgrounded. Reusing the existing pausedRef (already used for
    // hover/touch pause) to also cover tab-visibility, and skipping
    // autoplay entirely for users who've set prefers-reduced-motion.
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const onVisibilityChange = () => { pausedRef.current = document.visibilityState !== 'visible' }
    document.addEventListener('visibilitychange', onVisibilityChange)
    const timer = reducedMotion ? null : setInterval(() => { if (!pausedRef.current) goNext() }, 2500)
    const onEnter = () => { pausedRef.current = true }
    const onLeave = () => { pausedRef.current = false }
    const onTouchStart = () => { pausedRef.current = true }
    const onTouchEnd = () => { setTimeout(() => { pausedRef.current = false }, 1800) }
    wrap.addEventListener('mouseenter', onEnter)
    wrap.addEventListener('mouseleave', onLeave)
    wrap.addEventListener('touchstart', onTouchStart, { passive: true })
    wrap.addEventListener('touchend', onTouchEnd, { passive: true })

    const onResize = () => { setWidths(); cgrid.scrollLeft = 0 }
    window.addEventListener('resize', onResize)

    return () => {
      if (timer) clearInterval(timer)
      if (scrollEndTimer) clearTimeout(scrollEndTimer)
      cgrid.removeEventListener('scroll', onScroll)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('resize', onResize)
      wrap.removeEventListener('mouseenter', onEnter)
      wrap.removeEventListener('mouseleave', onLeave)
      wrap.removeEventListener('touchstart', onTouchStart)
      wrap.removeEventListener('touchend', onTouchEnd)
    }
  }, [active.length])

  if (!active.length) return null

  // Duplicate for seamless infinite loop
  const doubled = [...active, ...active]

  return (
    <section className="coll-bg" style={{ padding: '40px 0 52px', overflow: 'visible' }}>

      {/* Header */}
      <div style={{ textAlign: 'center', marginBottom: '28px', padding: '0 40px' }}>
        <div style={{
          display: 'inline-block', border: '1.5px solid #c8920a', borderRadius: '20px',
          padding: '5px 18px', fontFamily: 'var(--font-lato,Lato,sans-serif)',
          fontSize: '11px', fontWeight: 700, letterSpacing: '2px', color: '#8a6508',
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
          className="cgrid-track"
          style={{
            display: 'flex', overflowX: 'scroll', overflowY: 'hidden',
            scrollbarWidth: 'none', width: '100%', position: 'relative',
            padding: '8px 4px 16px',
          }}
        >
          {doubled.map((cat, idx) => {
            const emoji = emojiForCategory(cat)
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
                    border: '2px solid #c8920a', background: '#fafaf8',
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

                    {/* PERF FIX: was a raw <img src={cat.image_url}> — same issue as the
                        product cards had (see ProductCard.tsx) — every tile downloaded the
                        full-resolution original from Supabase storage with no resizing or
                        compression. next/image serves a properly sized, compressed version
                        per breakpoint instead, matching the ~6/4/2 visible tiles at each
                        screen width (see VISIBLE above). */}
                    {cat.image_url && (
                      <Image
                        src={cat.image_url}
                        alt={cat.name}
                        fill
                        sizes="(max-width:640px) 50vw, (max-width:960px) 25vw, 17vw"
                        quality={75}
                        loading={idx < 6 ? 'eager' : 'lazy'}
                        priority={idx < 6}
                        className="cc-img"
                        style={{
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

      <style>{`
        /* BUG FIX (P1): this selector previously read
           div[style*="overflowX: scroll"] — which can never match, since
           React serializes inline styles as kebab-case with no space
           after the colon (overflow-x:scroll), not camelCase with a
           space. The WebKit scrollbar was never actually hidden on
           Chrome/Edge/Safari, despite scrollbarWidth:'none' (a real
           inline style, so it worked) already hiding it correctly on
           Firefox. Fixed to target the real className instead. */
        .cgrid-track::-webkit-scrollbar { display: none; }
        .cc-cell:hover { transform: translateY(-4px) !important; }
        .cc-cell:hover .cc-box { border-color: #8a6508 !important; box-shadow: 0 6px 24px rgba(200,146,10,.32) !important; }
        .cc-cell:hover .cc-img { transform: scale(1.06) !important; }
        .cgrid-arrow:hover { background: #f5f5f5 !important; box-shadow: 0 4px 16px rgba(0,0,0,.18) !important; border-color: #ccc !important; }
        @media(max-width:640px) { .cgrid-arrow { display: none !important; } }
      `}</style>
    </section>
  )
}
