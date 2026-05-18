'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useState } from 'react'

function SuccessContent() {
  const params      = useSearchParams()
  const orderNumber = params.get('id')     || ''
  const total       = params.get('total')  || ''
  const method      = params.get('method') || ''
  const isCOD       = method === 'cod'

  const [mounted, setMounted] = useState(false)
  const [confettiPieces] = useState(() =>
    Array.from({ length: 30 }, (_, i) => ({
      id: i,
      x: Math.random() * 100,
      delay: Math.random() * 1.5,
      duration: 2 + Math.random() * 2,
      color: ['#2D5016', '#4A7C59', '#F5C842', '#C8A96E', '#8B4513', '#D4AF37'][Math.floor(Math.random() * 6)],
      size: 4 + Math.random() * 8,
      rotation: Math.random() * 360,
    }))
  )

  useEffect(() => { setMounted(true) }, [])

  const steps = [
    { icon: '📦', title: 'Order Being Packed', desc: 'Fresh Himalayan products packed with care', status: 'active' },
    { icon: '🚚', title: 'Dispatched in 24 hrs', desc: 'Expected delivery in 3–5 business days', status: 'pending' },
    { icon: '💬', title: 'WhatsApp Updates', desc: "Tracking details sent to your WhatsApp", status: 'pending' },
    { icon: '📧', title: 'Confirmation Email', desc: 'Invoice sent to your registered email', status: 'pending' },
  ]

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;1,400;1,500&family=DM+Sans:wght@300;400;500;600&display=swap');

        .success-page { font-family: 'DM Sans', sans-serif; background: #0f1f0a; min-height: 100vh; position: relative; overflow: hidden; }
        .success-page::before { content: ''; position: fixed; top: -20%; left: 50%; transform: translateX(-50%); width: 800px; height: 600px; background: radial-gradient(ellipse, rgba(74,124,89,0.18) 0%, transparent 65%); pointer-events: none; z-index: 0; }
        .mountain-bg { position: fixed; bottom: 0; left: 0; width: 100%; height: 200px; opacity: 0.07; z-index: 0; pointer-events: none; }
        .confetti-piece { position: fixed; top: -20px; border-radius: 2px; animation: confetti-fall linear forwards; z-index: 50; pointer-events: none; }
        @keyframes confetti-fall { 0% { transform: translateY(0) rotate(0deg); opacity: 1; } 80% { opacity: 1; } 100% { transform: translateY(110vh) rotate(720deg); opacity: 0; } }
        .card { background: linear-gradient(145deg, rgba(255,255,255,0.035) 0%, rgba(255,255,255,0.015) 100%); border: 1px solid rgba(212,175,55,0.15); backdrop-filter: blur(16px); border-radius: 24px; position: relative; z-index: 1; }
        .card::before { content: ''; position: absolute; inset: 0; border-radius: 24px; background: linear-gradient(135deg, rgba(212,175,55,0.06) 0%, transparent 50%, rgba(74,124,89,0.06) 100%); pointer-events: none; }
        .card-accent { height: 1px; background: linear-gradient(90deg, transparent, rgba(212,175,55,0.6), rgba(74,124,89,0.4), transparent); margin-bottom: 2rem; }
        .success-ring { width: 100px; height: 100px; position: relative; margin: 0 auto 1.5rem; }
        .success-ring svg.ring { position: absolute; inset: 0; animation: ring-spin 8s linear infinite; }
        @keyframes ring-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .success-ring .inner { position: absolute; inset: 12px; background: linear-gradient(135deg, #1a3a0e, #2D5016); border-radius: 50%; display: flex; align-items: center; justify-content: center; box-shadow: 0 0 30px rgba(74,124,89,0.4), inset 0 1px 0 rgba(212,175,55,0.2); }
        .check-icon { animation: check-pop 0.6s cubic-bezier(0.34,1.56,0.64,1) 0.3s both; }
        @keyframes check-pop { from { transform: scale(0) rotate(-45deg); opacity: 0; } to { transform: scale(1) rotate(0deg); opacity: 1; } }
        .page-content { animation: content-rise 0.7s cubic-bezier(0.16,1,0.3,1) 0.1s both; }
        @keyframes content-rise { from { transform: translateY(30px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
        .order-title { font-family: 'Cormorant Garamond', serif; font-size: 2.6rem; font-weight: 500; line-height: 1.1; color: #e8d5a3; letter-spacing: -0.01em; }
        .order-subtitle { color: rgba(232,213,163,0.55); font-size: 0.875rem; font-weight: 300; letter-spacing: 0.02em; }
        .order-meta { background: rgba(212,175,55,0.06); border: 1px solid rgba(212,175,55,0.12); border-radius: 12px; padding: 1rem 1.5rem; display: flex; gap: 2rem; justify-content: center; flex-wrap: wrap; }
        .order-meta-item label { display: block; font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.12em; color: rgba(212,175,55,0.5); margin-bottom: 3px; font-weight: 500; }
        .order-meta-item span { font-family: 'Cormorant Garamond', serif; font-size: 1.05rem; font-weight: 600; color: #D4AF37; letter-spacing: 0.05em; }
        .steps-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; }
        .step-item { background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06); border-radius: 14px; padding: 0.875rem 1rem; display: flex; align-items: flex-start; gap: 0.75rem; transition: border-color 0.2s, background 0.2s; }
        .step-item:hover { border-color: rgba(212,175,55,0.2); background: rgba(212,175,55,0.04); }
        .step-emoji { font-size: 1.3rem; line-height: 1; margin-top: 2px; }
        .step-title { font-size: 0.75rem; font-weight: 600; color: rgba(255,255,255,0.75); margin-bottom: 2px; }
        .step-desc { font-size: 0.7rem; color: rgba(255,255,255,0.3); line-height: 1.4; font-weight: 300; }
        .step-item.active { border-color: rgba(74,124,89,0.25); background: rgba(74,124,89,0.06); }
        .btn-primary { display: flex; align-items: center; justify-content: center; gap: 0.5rem; padding: 0.875rem 1.5rem; background: linear-gradient(135deg, #2D5016, #3d6b20); border: 1px solid rgba(74,124,89,0.5); color: #a8d5a2; font-family: 'DM Sans', sans-serif; font-size: 0.875rem; font-weight: 600; border-radius: 14px; text-decoration: none; transition: all 0.2s; letter-spacing: 0.02em; box-shadow: 0 4px 20px rgba(45,80,22,0.4); }
        .btn-primary:hover { background: linear-gradient(135deg, #3d6b20, #4A7C59); transform: translateY(-1px); }
        .btn-gold { display: flex; align-items: center; justify-content: center; gap: 0.5rem; padding: 0.875rem 1.5rem; background: linear-gradient(135deg, #b8920a, #D4AF37); border: 1px solid rgba(212,175,55,0.4); color: #1a0f00; font-family: 'DM Sans', sans-serif; font-size: 0.875rem; font-weight: 700; border-radius: 14px; text-decoration: none; transition: all 0.2s; letter-spacing: 0.03em; box-shadow: 0 4px 20px rgba(212,175,55,0.25); }
        .btn-gold:hover { background: linear-gradient(135deg, #D4AF37, #e8c84a); transform: translateY(-1px); }
        .btn-ghost { display: flex; align-items: center; justify-content: center; padding: 0.75rem 1.5rem; background: transparent; border: 1px solid rgba(255,255,255,0.08); color: rgba(255,255,255,0.35); font-family: 'DM Sans', sans-serif; font-size: 0.8rem; font-weight: 400; border-radius: 12px; text-decoration: none; transition: all 0.2s; }
        .btn-ghost:hover { border-color: rgba(255,255,255,0.18); color: rgba(255,255,255,0.6); }
        .divider { height: 1px; background: linear-gradient(90deg, transparent, rgba(255,255,255,0.07), transparent); margin: 1.25rem 0; }
        .badge { display: inline-flex; align-items: center; gap: 0.4rem; padding: 0.3rem 0.75rem; background: rgba(74,124,89,0.15); border: 1px solid rgba(74,124,89,0.25); border-radius: 100px; font-size: 0.7rem; font-weight: 500; color: #7ec88a; letter-spacing: 0.06em; text-transform: uppercase; }
        .step-item:nth-child(1) { animation: step-in 0.5s cubic-bezier(0.16,1,0.3,1) 0.5s both; }
        .step-item:nth-child(2) { animation: step-in 0.5s cubic-bezier(0.16,1,0.3,1) 0.6s both; }
        .step-item:nth-child(3) { animation: step-in 0.5s cubic-bezier(0.16,1,0.3,1) 0.7s both; }
        .step-item:nth-child(4) { animation: step-in 0.5s cubic-bezier(0.16,1,0.3,1) 0.8s both; }
        @keyframes step-in { from { transform: translateY(16px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
        .pulse-dot { width: 7px; height: 7px; background: #4A7C59; border-radius: 50%; display: inline-block; animation: pulse-anim 2s ease-in-out infinite; }
        @keyframes pulse-anim { 0%, 100% { opacity: 1; transform: scale(1); box-shadow: 0 0 0 0 rgba(74,124,89,0.5); } 50% { opacity: 0.8; transform: scale(1.1); box-shadow: 0 0 0 5px rgba(74,124,89,0); } }
        @media (max-width: 500px) { .order-title { font-size: 2rem; } .steps-grid { grid-template-columns: 1fr; } .btn-row { flex-direction: column; } }
      `}</style>

      <div className="success-page">
        <svg className="mountain-bg" viewBox="0 0 1440 200" preserveAspectRatio="none" fill="white">
          <path d="M0,200 L0,120 L120,60 L240,110 L360,40 L480,90 L600,20 L720,80 L840,30 L960,85 L1080,45 L1200,95 L1320,50 L1440,80 L1440,200 Z"/>
        </svg>

        {mounted && confettiPieces.map(p => (
          <div key={p.id} className="confetti-piece" style={{ left: `${p.x}%`, width: p.size, height: p.size * 0.6, background: p.color, animationDelay: `${p.delay}s`, animationDuration: `${p.duration}s`, transform: `rotate(${p.rotation}deg)` }} />
        ))}

        <div style={{ position: 'relative', zIndex: 1, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem 1rem' }}>
          <div style={{ width: '100%', maxWidth: '460px' }} className="page-content">
            <div className="card" style={{ padding: '2rem' }}>
              <div className="card-accent" />

              <div style={{ textAlign: 'center', marginBottom: '1.75rem' }}>
                <div style={{ fontSize: '0.6rem', textTransform: 'uppercase', letterSpacing: '0.18em', color: 'rgba(212,175,55,0.5)', marginBottom: '0.5rem', fontWeight: 500 }}>
                  Pahadi Roots · Himalayan Natural Store
                </div>

                <div className="success-ring">
                  <svg className="ring" viewBox="0 0 100 100" fill="none">
                    <circle cx="50" cy="50" r="46" stroke="url(#ringGrad)" strokeWidth="1.5" strokeDasharray="8 6" strokeLinecap="round"/>
                    <defs>
                      <linearGradient id="ringGrad" x1="0" y1="0" x2="100" y2="100" gradientUnits="userSpaceOnUse">
                        <stop stopColor="#D4AF37" stopOpacity="0.6"/>
                        <stop offset="0.5" stopColor="#4A7C59" stopOpacity="0.4"/>
                        <stop offset="1" stopColor="#D4AF37" stopOpacity="0.6"/>
                      </linearGradient>
                    </defs>
                  </svg>
                  <div className="inner">
                    <svg className="check-icon" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#a8d5a2" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M4.5 12.75l6 6 9-13.5"/>
                    </svg>
                  </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '0.75rem' }}>
                  <span className="badge"><span className="pulse-dot"/>{isCOD ? 'COD Confirmed' : 'Payment Confirmed'}</span>
                </div>

                <h1 className="order-title">{isCOD ? 'Order Placed!' : 'Payment Confirmed!'}</h1>
                <p className="order-subtitle" style={{ marginTop: '0.5rem' }}>
                  {isCOD ? 'Your order is confirmed. We've sent details on WhatsApp.' : 'Your payment was successful. Order is now being processed.'}
                </p>
              </div>

              {(orderNumber || total) && (
                <div className="order-meta" style={{ marginBottom: '1.25rem' }}>
                  {orderNumber && (
                    <div className="order-meta-item" style={{ textAlign: 'center' }}>
                      <label>Order Number</label>
                      <span>{orderNumber}</span>
                    </div>
                  )}
                  {total && (
                    <div className="order-meta-item" style={{ textAlign: 'center' }}>
                      <label>Amount Paid</label>
                      <span>₹{total}</span>
                    </div>
                  )}
                  <div className="order-meta-item" style={{ textAlign: 'center' }}>
                    <label>Est. Delivery</label>
                    <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: '0.85rem', color: '#a8d5a2' }}>3–5 Days</span>
                  </div>
                </div>
              )}

              <div className="divider"/>

              <div style={{ marginBottom: '1.5rem' }}>
                <div style={{ fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.12em', color: 'rgba(255,255,255,0.25)', marginBottom: '0.75rem', fontWeight: 500 }}>
                  What happens next
                </div>
                <div className="steps-grid">
                  {steps.map(step => (
                    <div key={step.title} className={`step-item ${step.status}`}>
                      <div className="step-emoji">{step.icon}</div>
                      <div>
                        <div className="step-title">{step.title}</div>
                        <div className="step-desc">{step.desc}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="divider"/>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
                <div className="btn-row" style={{ display: 'flex', gap: '0.625rem' }}>
                  <Link href="/products" className="btn-primary" style={{ flex: 1 }}>🛍 Shop More</Link>
                  {orderNumber ? (
                    <Link href={`/track?id=${orderNumber}`} className="btn-gold" style={{ flex: 1 }}>📍 Track Order</Link>
                  ) : (
                    <Link href="/account" className="btn-gold" style={{ flex: 1 }}>My Orders</Link>
                  )}
                </div>
                <Link href="/" className="btn-ghost">← Back to Home</Link>
              </div>
            </div>

            <p style={{ textAlign: 'center', fontSize: '0.68rem', color: 'rgba(255,255,255,0.18)', marginTop: '1.25rem', letterSpacing: '0.04em' }}>
              From the Himalayas, with love 🌿
            </p>
          </div>
        </div>
      </div>
    </>
  )
}

export default function OrderSuccessPage() {
  return (
    <Suspense fallback={
      <div style={{ minHeight: '100vh', background: '#0f1f0a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ width: 320, height: 480, background: 'rgba(255,255,255,0.04)', borderRadius: 24 }} />
      </div>
    }>
      <SuccessContent />
    </Suspense>
  )
}
