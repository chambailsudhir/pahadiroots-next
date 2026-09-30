'use client'

import { useEffect, useRef, type ReactNode } from 'react'
import s from './OurStory.module.css'

/**
 * Scroll behaviour for /our-stories (word-by-word statement, pinned photo that
 * follows the chapters, panorama parallax, reveal-on-scroll).
 * Progressive enhancement: everything is fully visible/readable until this
 * effect adds the `js` class, so crawlers and no-JS visitors see all content.
 */
export default function OurStoryShell({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const root = ref.current
    if (!root) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    root.classList.add(s.js)

    const q = <T extends HTMLElement>(sel: string) => Array.from(root.querySelectorAll<T>(sel))
    const words = q('[data-w]'), steps = q('[data-step]'), frames = q('[data-f]')
    const man = root.querySelector<HTMLElement>('[data-man]')
    const pano = root.querySelector<HTMLElement>('[data-pano]')

    let io: IntersectionObserver | undefined
    if (reduce) {
      q('[data-r]').forEach(n => n.classList.add(s.v))
    } else {
      io = new IntersectionObserver(es => es.forEach(e => {
        if (e.isIntersecting) { e.target.classList.add(s.v); io?.unobserve(e.target) }
      }), { threshold: 0.15 })
      q('[data-r]').forEach(n => io!.observe(n))
    }

    const tick = () => {
      const vh = window.innerHeight
      if (man && !reduce) {
        const r = man.getBoundingClientRect()
        const p = Math.min(1, Math.max(0, (vh * 0.85 - r.top) / (r.height + vh * 0.35)))
        words.forEach((w, i) => w.classList.toggle(s.on, i / words.length < p * 1.05))
      }
      let a = 0
      steps.forEach((st, i) => { if (st.getBoundingClientRect().top < vh * 0.55) a = i })
      steps.forEach((st, i) => st.classList.toggle(s.on, i === a))
      frames.forEach((f, i) => f.classList.toggle(s.on, i === a))
      if (pano && !reduce) {
        const q2 = pano.parentElement!.getBoundingClientRect()
        pano.style.transform = `translateY(${(q2.top + q2.height / 2 - vh / 2) * -0.12}px)`
      }
    }
    if (reduce) words.forEach(w => w.classList.add(s.on))

    let raf = 0
    const onScroll = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(tick) }
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    tick()
    return () => {
      io?.disconnect(); cancelAnimationFrame(raf)
      window.removeEventListener('scroll', onScroll); window.removeEventListener('resize', onScroll)
    }
  }, [])

  return <div ref={ref} className={s.root}>{children}</div>
}
