'use client'

import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react'
import s from './story.module.css'

/**
 * Fades/slides children in once when they scroll into view.
 * Progressive enhancement: content is fully visible without JS (the hidden
 * state is only applied after this effect runs) and for users who prefer
 * reduced motion.
 */
export default function Reveal({
  children, delay = 0, as: Tag = 'div', className = '', style,
}: {
  children: ReactNode
  delay?: number
  as?: 'div' | 'p' | 'h2' | 'figure' | 'article' | 'li'
  className?: string
  style?: CSSProperties
}) {
  const ref = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || !('IntersectionObserver' in window)) return
    el.classList.add(s.rvArm)
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) { el.classList.add(s.rvIn); io.disconnect() }
    }, { threshold: 0.12 })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  const Comp = Tag as any
  return (
    <Comp ref={ref} className={className} style={{ ...style, transitionDelay: delay ? `${delay}s` : undefined }}>
      {children}
    </Comp>
  )
}
