'use client'

import { useEffect, useRef } from 'react'
import s from './blog.module.css'

/** Thin gold bar at the top of the viewport that fills as the article is read. */
export default function ReadingProgress({ targetId }: { targetId: string }) {
  const bar = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = document.getElementById(targetId)
    if (!el) return
    let raf = 0
    const update = () => {
      raf = 0
      const r = el.getBoundingClientRect()
      const total = r.height - window.innerHeight * 0.6
      const done = Math.min(Math.max(-r.top + window.innerHeight * 0.2, 0), Math.max(total, 1))
      if (bar.current) bar.current.style.width = `${Math.min(100, (done / Math.max(total, 1)) * 100)}%`
    }
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(update) }
    update()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => { window.removeEventListener('scroll', onScroll); window.removeEventListener('resize', onScroll); if (raf) cancelAnimationFrame(raf) }
  }, [targetId])
  return <div ref={bar} className={s.progress} role="presentation" aria-hidden="true" />
}
