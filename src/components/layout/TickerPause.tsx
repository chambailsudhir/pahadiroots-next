'use client'

import { useState } from 'react'

// WCAG 2.2.2 (Pause, Stop, Hide): content that scrolls automatically for more than 5 seconds needs a way to pause
// it that works for everyone — the old CSS only paused on mouse hover, which keyboard and touch users never get.
// The button toggles a class on the enclosing .ticker-wrap (see globals.css), so TickerBar itself can stay a
// server component. Hidden entirely when the visitor prefers reduced motion (the ticker is static then).
export default function TickerPause() {
  const [paused, setPaused] = useState(false)
  return (
    <button
      type="button"
      className="ticker-pause"
      aria-pressed={paused}
      aria-label={paused ? 'Resume scrolling announcements' : 'Pause scrolling announcements'}
      onClick={e => {
        const next = !paused
        setPaused(next)
        e.currentTarget.closest('.ticker-wrap')?.classList.toggle('ticker-paused', next)
      }}
    >
      <span aria-hidden="true">{paused ? '▶' : '⏸'}</span>
    </button>
  )
}
