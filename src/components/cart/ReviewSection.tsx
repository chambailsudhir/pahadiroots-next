'use client'

import { memo, useState, useEffect, useRef, useCallback } from 'react'
import styles from './ReviewSection.module.css'

interface Review {
  name: string
  location: string
  text: string
}

interface Props {
  reviews: Review[]
}

const ReviewSection = memo(function ReviewSection({ reviews }: Props) {
  const [idx, setIdx] = useState(0)
  // Pause auto-rotation when the user focuses inside the carousel —
  // aria-live=polite announcing every 3.8 s is noisy for screen reader users.
  const [paused, setPaused] = useState(false)
  const cardRef = useRef<HTMLDivElement>(null)

  const handleFocus = useCallback(() => setPaused(true), [])
  const handleBlur  = useCallback((e: React.FocusEvent) => {
    // Only resume if focus left the card entirely
    if (!cardRef.current?.contains(e.relatedTarget as Node)) {
      setPaused(false)
    }
  }, [])

  useEffect(() => {
    if (reviews.length <= 1 || paused) return
    // Respect the user's OS motion preference — do not auto-rotate for
    // users with vestibular disorders who have set prefers-reduced-motion.
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    if (mq.matches) return
    const t = setInterval(() => setIdx(i => (i + 1) % reviews.length), 3800)
    return () => clearInterval(t)
  }, [reviews.length, paused])

  if (!reviews.length) return null

  return (
    <div
      ref={cardRef}
      className={styles.card}
      onFocus={handleFocus}
      onBlur={handleBlur}
    >
      <h3 className={styles.heading}>What Customers Say</h3>
      <div
        className={styles.body}
        role="region"
        aria-label="Customer reviews"
        aria-live="polite"
        aria-atomic="true"
      >
        <div className={styles.stars} aria-label="5 out of 5 stars">★★★★★</div>
        <p className={styles.text}>&quot;{reviews[idx].text}&quot;</p>
        <div className={styles.author}>— {reviews[idx].name}, {reviews[idx].location}</div>
      </div>
      {reviews.length > 1 && (
        <div className={styles.dots} role="group" aria-label="Review navigation">
          {reviews.map((r, i) => (
            <button
              key={i}
              type="button"
              className={`${styles.dot}${i === idx ? ` ${styles.active}` : ''}`}
              onClick={() => { setPaused(true); setIdx(i) }}
              aria-label={`Show review by ${r.name}`}
              aria-pressed={i === idx}
            />
          ))}
        </div>
      )}
    </div>
  )
})

export default ReviewSection
