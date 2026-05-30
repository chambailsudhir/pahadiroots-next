'use client'

import { memo, useState, useEffect } from 'react'

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
    const t = setInterval(() => setIdx(i => (i + 1) % reviews.length), 3800)
    return () => clearInterval(t)
  }, [reviews.length])

  if (!reviews.length) return null

  return (
    <div className="rv-card">
      <h3 className="rv-heading">What Customers Say</h3>
      <div
        className="rv-body"
        role="region"
        aria-label="Customer reviews"
        aria-live="polite"
        aria-atomic="true"
      >
        <div className="rv-stars" aria-label="5 out of 5 stars">★★★★★</div>
        <p className="rv-text">"{reviews[idx].text}"</p>
        <div className="rv-author">— {reviews[idx].name}, {reviews[idx].location}</div>
      </div>
      {reviews.length > 1 && (
        <div className="rv-dots" role="group" aria-label="Review navigation">
          {reviews.map((r, i) => (
            <button
              key={i}
              className={`rv-dot${i === idx ? ' active' : ''}`}
              onClick={() => setIdx(i)}
              aria-label={`Show review by ${r.name}`}
              aria-pressed={i === idx}
            />
          ))}
        </div>
      )}
      <style>{`
        .rv-card{background:#fff;border-radius:14px;
          box-shadow:0 2px 8px rgba(0,0,0,.06),0 0 0 1px rgba(0,0,0,.03);
          border:1px solid #e2dbd0;padding:18px 20px;}
        .rv-heading{font-family:var(--font-playfair,'Playfair Display',serif);
          font-size:15px;font-weight:700;color:#1a1a1a;margin:0 0 12px;}
        .rv-body{text-align:center;padding:0 4px;}
        .rv-stars{font-size:19px;color:#c8920a;letter-spacing:2px;margin-bottom:8px;}
        .rv-text{font-family:var(--font-playfair,'Playfair Display',serif);
          font-size:14px;color:#1a1a1a;font-style:italic;line-height:1.6;margin:0 0 6px;}
        .rv-author{font-size:12px;color:#7a7565;font-weight:600;}
        .rv-dots{display:flex;justify-content:center;gap:6px;margin-top:12px;}
        .rv-dot{width:8px;height:8px;border-radius:50%;background:#ddd;border:none;
          cursor:pointer;transition:all .2s;padding:0;}
        .rv-dot.active{background:#1a3a1e;width:20px;border-radius:4px;}
      `}</style>
    </div>
  )
})

export default ReviewSection
