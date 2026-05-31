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
    // Respect the user's OS motion preference — do not auto-rotate for
    // users with vestibular disorders who have set prefers-reduced-motion.
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    if (mq.matches) return
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
              type="button"
              className={`rv-dot${i === idx ? ' active' : ''}`}
              onClick={() => setIdx(i)}
              aria-label={`Show review by ${r.name}`}
              aria-pressed={i === idx}
            />
          ))}
        </div>
      )}
      <style>{`
        .rv-card{
          background:linear-gradient(160deg,#fdf9f2,#faf5e8);
          border-radius:16px;
          box-shadow:0 2px 14px rgba(26,22,17,.07),0 0 0 1px rgba(26,22,17,.04);
          border:1px solid #e0d5c5;padding:20px 22px;
        }
        .rv-heading{
          font-family:var(--font-playfair,'Playfair Display',serif);
          font-size:14px;font-weight:700;color:#6b5620;margin:0 0 14px;
          letter-spacing:.5px;text-transform:uppercase;
          display:flex;align-items:center;gap:8px;
        }
        .rv-heading::before,.rv-heading::after{
          content:'';flex:1;height:1px;
          background:linear-gradient(to right,transparent,#d8c9a8);
        }
        .rv-heading::after{background:linear-gradient(to left,transparent,#d8c9a8);}
        .rv-body{text-align:center;padding:0 6px;}
        .rv-stars{
          font-size:18px;color:#c9a240;letter-spacing:3px;margin-bottom:10px;
          text-shadow:0 1px 4px rgba(201,162,64,.35);
        }
        .rv-text{
          font-family:var(--font-playfair,'Playfair Display',serif);
          font-size:14.5px;color:#1a1611;font-style:italic;
          line-height:1.7;margin:0 0 8px;
        }
        .rv-author{font-size:11.5px;color:#9a8e7e;font-weight:700;letter-spacing:.3px;}
        .rv-dots{display:flex;justify-content:center;gap:6px;margin-top:14px;}
        .rv-dot{
          width:7px;height:7px;border-radius:50%;
          background:#d8c9a8;border:none;
          cursor:pointer;transition:all .25s;padding:0;
        }
        .rv-dot.active{background:#c9a240;width:22px;border-radius:4px;}
        .rv-dot:hover:not(.active){background:#b8a888;}
      `}</style>
    </div>
  )
})

export default ReviewSection
