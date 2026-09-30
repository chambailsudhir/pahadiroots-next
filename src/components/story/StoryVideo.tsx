'use client'

import { useEffect, useRef, type CSSProperties } from 'react'

/**
 * Silent, looping ambient video for the /mountain-stories page.
 * - The file itself has NO audio track (stripped at encode time); `muted` is belt-and-braces and
 *   is also what lets browsers autoplay it.
 * - Plays only while on screen (saves data/battery), and not at all for people who prefer reduced
 *   motion: they get the poster frame with normal controls instead.
 */
export default function StoryVideo({ src, poster, label, className, style }: {
  src: string; poster: string; label: string; className?: string; style?: CSSProperties
}) {
  const ref = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const v = ref.current
    if (!v) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { v.controls = true; return }
    v.muted = true          // required by browsers for autoplay; the clip has no audio track anyway
    v.playsInline = true    // iOS Safari: play in the page instead of fullscreen
    if (!('IntersectionObserver' in window)) { v.play()?.catch(() => {}); return }
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) v.play()?.catch(() => {})
      else v.pause()
    }, { threshold: 0.25 })
    io.observe(v)
    return () => io.disconnect()
  }, [])

  return (
    <video ref={ref} className={className} style={style} muted loop playsInline preload="metadata" poster={poster} aria-label={label}>
      <source src={src} type="video/mp4" />
    </video>
  )
}
