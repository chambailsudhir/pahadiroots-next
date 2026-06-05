'use client'

import { memo, useState, useEffect } from 'react'
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

  useEffect(() => {
    if (reviews.length <= 1) return
    // Respect the user's OS motion preference — do not auto-rotate for
    // users with vestibular disorders who have set prefers-reduced-motion.
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    if (mq.matches) return
    const t = setInterval(() => setIdx(i => (i + 1) % reviews.length), 3800)
    return () => clearInterval(t)
  }, [reviews.length])

  if (!reviews.length) return null

  return (
    <div className={styles.card}>
      <h3 className={styles.heading}>What Customers Say</h3>
      <div
        className={styles.body}
        role="region"
        aria-label="Customer reviews"
        aria-live="polite"
        aria-atomic="true"
      >
        <div className={styles.stars} aria-label="5 out of 5 stars">★★★★★</div>
        <p className={styles.text}>"{reviews[idx].text}"</p>
        <div className={styles.author}>— {reviews[idx].name}, {reviews[idx].location}</div>
      </div>
      {reviews.length > 1 && (
        <div className={styles.dots} role="group" aria-label="Review navigation">
          {reviews.map((r, i) => (
            <button
              key={i}
              type="button"
              className={`${styles.dot}${i === idx ? ` ${styles.active}` : ''}`}
              onClick={() => setIdx(i)}
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
