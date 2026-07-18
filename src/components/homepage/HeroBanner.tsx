'use client'

import { useState, useCallback } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import type { SiteSettings } from '@/types'
import { useAutoplayInterval } from '@/hooks/useAutoplayInterval'

interface HeroImage { url: string; alt_text?: string | null; title?: string; subtitle?: string }
interface Props { images: HeroImage[]; settings: SiteSettings }

export default function HeroBanner({ images, settings }: Props) {
  const [current, setCurrent] = useState(0)
  const slides = images.length > 0 ? images : null
  const total  = slides ? slides.length : 1

  const next = useCallback(() => setCurrent(c => (c + 1) % total), [total])
  // BUG FIX (P2): previously a raw setInterval with no
  // prefers-reduced-motion check and no pause when the tab is
  // backgrounded — see hooks/useAutoplayInterval.ts.
  useAutoplayInterval(next, 4500, total > 1)

  return (
    <>
      {/* ── Slider track ── */}
      <div style={{ position: 'relative', width: '100%', height: '75vh', minHeight: 500, maxHeight: '75vh', overflow: 'hidden' }}>

        {slides ? slides.map((img, i) => {
          // BUG FIX (P1 — SEO/accessibility): every slide used to render
          // its own <h1>, and since all slides stay mounted simultaneously
          // (only opacity toggles), that meant N slides = N <h1> elements
          // coexisting in the DOM at once — bad for SEO (search engines
          // expect one clear top-level heading) and for screen readers,
          // which read every hidden slide's text in full since none of
          // them were aria-hidden. Fix: only the currently-visible slide
          // is a real <h1>; the rest render the identical visual style on
          // a non-heading element, and the whole hidden slide is
          // aria-hidden so assistive tech skips it entirely.
          const isVisible = i === current
          const HeadingTag = isVisible ? 'h1' : 'p'
          const headingStyle = { fontFamily:'"Playfair Display",Georgia,serif', fontSize:'clamp(32px,4.5vw,62px)', fontWeight:900 as const, lineHeight:1.05, color:'#fff', margin:'0 0 16px', textShadow:'0 2px 20px rgba(0,0,0,.4)', letterSpacing:'-1px' }
          return (
          <div key={i} aria-hidden={!isVisible} style={{
            position: 'absolute', inset: 0,
            opacity: isVisible ? 1 : 0,
            transition: 'opacity 0.9s cubic-bezier(0.4,0,0.2,1)',
            pointerEvents: isVisible ? 'auto' : 'none',
          }}>
            <Image src={img.url} alt={img.alt_text || 'HimVeda by Pahadi Roots'} fill sizes="100vw"
              style={{ objectFit: 'cover', objectPosition: 'center' }} priority={i === 0} />
            {/* Dark-left gradient overlay */}
            <div style={{ position:'absolute', inset:0, background:'linear-gradient(100deg,rgba(5,20,8,.82) 0%,rgba(5,20,8,.6) 45%,rgba(5,20,8,.15) 70%,rgba(5,20,8,.05) 100%)', zIndex:1 }} />
            {/* Content */}
            <div style={{ position:'absolute', inset:0, zIndex:2, display:'flex', alignItems:'center' }}>
              <div className="hslide-content-inner" style={{ maxWidth:600, display:'flex', flexDirection:'column', gap:0 }}>
                <div style={{ display:'inline-flex', alignItems:'center', gap:6, fontSize:11, fontWeight:700, letterSpacing:'1.5px', textTransform:'uppercase', color:'rgba(255,255,255,.75)', background:'rgba(255,255,255,.1)', border:'1px solid rgba(255,255,255,.18)', borderRadius:30, padding:'5px 14px', width:'fit-content', marginBottom:18, backdropFilter:'blur(4px)' }}>
                  🌿 Pure · Himalayan · Natural
                </div>
                <HeadingTag style={headingStyle}>
                  {img.title ? img.title : <>{`Born in the`}<br/><em style={{fontStyle:'italic',color:'var(--gd)'}}>Himalayas,</em><br/>{`For Your Table`}</>}
                </HeadingTag>
                <p style={{ fontSize:'clamp(13px,1.5vw,16px)', color:'rgba(255,255,255,.8)', lineHeight:1.6, margin:'0 0 28px', maxWidth:440 }}>
                  {img.subtitle || 'Handpicked from the purest altitudes — where clean air, ancient soil, and tradition create nature\'s finest.'}
                </p>
                <div style={{ display:'flex', gap:12, alignItems:'center', flexWrap:'wrap' }}>
                  <Link href="/products" style={{ display:'inline-flex', alignItems:'center', gap:6, background:'var(--g)', color:'#fff', fontSize:14, fontWeight:800, padding:'13px 28px', borderRadius:50, textDecoration:'none', boxShadow:'0 4px 20px rgba(0,0,0,.25)', letterSpacing:'.2px', transition:'all .25s' }}>
                    Explore Our Store
                  </Link>
                  <Link href="/about" style={{ display:'inline-flex', alignItems:'center', fontSize:13, fontWeight:700, color:'rgba(255,255,255,.85)', textDecoration:'none', padding:'12px 0', gap:6, transition:'color .2s' }}>
                    Our Story →
                  </Link>
                </div>
              </div>
            </div>
          </div>
          )
        }) : (
          /* Fallback slide — no images configured */
          <div style={{ position:'absolute', inset:0, background:'linear-gradient(150deg,#071a09 0%,#0d2410 30%,#1a3a1e 65%,#2d5233 100%)', display:'flex', alignItems:'center' }}>
            <div className="hslide-content-inner" style={{ maxWidth:600, display:'flex', flexDirection:'column', gap:0 }}>
              <div style={{ display:'inline-flex', alignItems:'center', gap:6, fontSize:11, fontWeight:700, letterSpacing:'1.5px', textTransform:'uppercase', color:'rgba(255,255,255,.75)', background:'rgba(255,255,255,.1)', border:'1px solid rgba(255,255,255,.18)', borderRadius:30, padding:'5px 14px', width:'fit-content', marginBottom:18, backdropFilter:'blur(4px)' }}>
                🌿 Pure · Himalayan · Natural
              </div>
              <h1 style={{ fontFamily:'"Playfair Display",Georgia,serif', fontSize:'clamp(32px,4.5vw,62px)', fontWeight:900, lineHeight:1.05, color:'#fff', margin:'0 0 16px', textShadow:'0 2px 20px rgba(0,0,0,.4)', letterSpacing:'-1px' }}>
                Born in the<br/><em style={{fontStyle:'italic',color:'var(--gd)'}}>Himalayas,</em><br/>For Your Table
              </h1>
              <p style={{ fontSize:'clamp(13px,1.5vw,16px)', color:'rgba(255,255,255,.8)', lineHeight:1.6, margin:'0 0 28px', maxWidth:440 }}>
                Handpicked from the purest altitudes — where clean air, ancient soil, and tradition create nature&apos;s finest.
              </p>
              <div style={{ display:'flex', gap:12, alignItems:'center', flexWrap:'wrap' }}>
                <Link href="/products" style={{ display:'inline-flex', alignItems:'center', gap:6, background:'var(--g)', color:'#fff', fontSize:14, fontWeight:800, padding:'13px 28px', borderRadius:50, textDecoration:'none', boxShadow:'0 4px 20px rgba(0,0,0,.25)', letterSpacing:'.2px' }}>
                  Explore Our Store
                </Link>
                <Link href="/about" style={{ display:'inline-flex', alignItems:'center', fontSize:13, fontWeight:700, color:'rgba(255,255,255,.85)', textDecoration:'none', padding:'12px 0', gap:6 }}>
                  Our Story →
                </Link>
              </div>
            </div>
          </div>
        )}

        {/* Prev / Next arrows */}
        {total > 1 && (<>
          <button onClick={() => setCurrent(c => (c - 1 + total) % total)} aria-label="Previous"
            style={{ position:'absolute', left:20, top:'calc(50% - 35px)', transform:'translateY(-50%)', zIndex:20, background:'rgba(0,0,0,.35)', backdropFilter:'blur(10px)', border:'1.5px solid rgba(255,255,255,.4)', color:'#fff', width:46, height:46, borderRadius:'50%', fontSize:26, display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', boxShadow:'0 2px 12px rgba(0,0,0,.4)' }}>
            ‹
          </button>
          <button onClick={next} aria-label="Next"
            style={{ position:'absolute', right:20, top:'calc(50% - 35px)', transform:'translateY(-50%)', zIndex:20, background:'rgba(0,0,0,.35)', backdropFilter:'blur(10px)', border:'1.5px solid rgba(255,255,255,.4)', color:'#fff', width:46, height:46, borderRadius:'50%', fontSize:26, display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', boxShadow:'0 2px 12px rgba(0,0,0,.4)' }}>
            ›
          </button>
        </>)}

        {/* Dots */}
        {total > 1 && (
          <div style={{ position:'absolute', bottom:20, left:'50%', transform:'translateX(-50%)', display:'flex', gap:8, zIndex:10 }}>
            {Array.from({ length: total }).map((_, i) => (
              <button key={i} onClick={() => setCurrent(i)} aria-label={`Slide ${i+1}`}
                style={{ height:8, borderRadius: i===current ? 4 : '50%', width: i===current ? 24 : 8, background: i===current ? '#fff' : 'rgba(255,255,255,.35)', border:'none', cursor:'pointer', transition:'all .3s', padding:0 }} />
            ))}
          </div>
        )}
      </div>

      {/* ── Stats bar — sits directly below slider, no gap ── */}
      <div style={{ background:'rgba(5,20,8,.97)', display:'flex', alignItems:'center', justifyContent:'center', gap:0, padding:'16px 40px', flexWrap:'wrap', marginTop:'-2px', position:'relative', zIndex:10 }}>
        {[
          { num: '500+',  lbl: 'Farmer Families'   },
          { num: `${settings.states_covered || '10'}+`, lbl: 'Himalayan States' },
          { num: '10K+',  lbl: 'Happy Customers'   },
          { num: '48hr',  lbl: 'Avg Dispatch'       },
        ].map((s, i) => (
          <div key={i} style={{ display:'flex', alignItems:'center', gap:0 }}>
            <div style={{ textAlign:'center', padding:'0 32px' }}>
              <div style={{ fontFamily:'"Playfair Display",Georgia,serif', fontSize:'clamp(22px,2.5vw,32px)', fontWeight:900, color:'var(--gd2)', lineHeight:1.1 }}>{s.num}</div>
              <div style={{ fontSize:10.5, color:'rgba(255,255,255,.5)', letterSpacing:1, marginTop:3, textTransform:'uppercase' }}>{s.lbl}</div>
            </div>
            {i < 3 && <div style={{ width:1, height:36, background:'rgba(255,255,255,.15)', flexShrink:0 }} />}
          </div>
        ))}
      </div>

      <style>{`
        .hslide-content-inner { padding: 0 0 0 72px; }
        @media(max-width:860px){
          .hslide-content-inner { padding: 0 20px !important; }
        }
        @media(max-width:540px){
          .hslide-content-inner { padding: 0 16px !important; }
        }
      `}</style>
    </>
  )
}
