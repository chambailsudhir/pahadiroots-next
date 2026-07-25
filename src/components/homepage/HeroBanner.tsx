'use client'

import { useState, useCallback } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import type { SiteSettings } from '@/types'
import { useAutoplayInterval } from '@/hooks/useAutoplayInterval'
import { getHeroStats } from '@/lib/heroStats'

interface HeroImage {
  url: string
  video?: string
  alt_text?: string | null
  title?: string
  title_colour?: string
  subtitle?: string
  sub_colour?: string
  eyebrow?: string
  eyebrow_colour?: string
  coupon_label?: string
  coupon_offer?: string
  coupon_code?: string
  cta_text?: string
  cta_link?: string
  cta2_text?: string
  cta2_link?: string
}
interface Props { images: HeroImage[]; settings: SiteSettings }

// BUG FIX: the admin's "Headline" field explicitly documents `*word*` as
// the syntax for the italic/gold highlight ("Use *word* for italic gold
// highlight" — see admin/media/hero), but this component used to just
// print img.title as a flat string, so that markup showed up as literal
// asterisks on the live site instead of being rendered as a highlight.
// Only the hardcoded fallback copy ever got the gold-italic treatment.
function renderHeadline(text: string) {
  const parts = text.split(/(\*[^*]+\*)/g).filter(Boolean)
  return parts.map((part, idx) =>
    part.startsWith('*') && part.endsWith('*') && part.length > 2
      ? <em key={idx} style={{ fontStyle: 'italic', color: 'var(--gd)' }}>{part.slice(1, -1)}</em>
      : <span key={idx}>{part}</span>
  )
}

export default function HeroBanner({ images, settings }: Props) {
  const [current, setCurrent] = useState(0)
  const slides = images.length > 0 ? images : null
  const total  = slides ? slides.length : 1
  const heroStats = getHeroStats(settings)

  // BUG FIX (found in a fresh re-audit): unlike CategoryTiles.tsx (which
  // correctly pauses its own autoplay on hover/touch), this had NO
  // pause-on-interaction at all — the slideshow kept auto-advancing even
  // while someone was actively reading the hero text or about to click
  // an arrow/dot. Matching the same hover/touch-pause pattern here.
  const [isHovering, setIsHovering] = useState(false)

  const next = useCallback(() => setCurrent(c => (c + 1) % total), [total])
  // BUG FIX (P2): previously a raw setInterval with no
  // prefers-reduced-motion check and no pause when the tab is
  // backgrounded — see hooks/useAutoplayInterval.ts.
  useAutoplayInterval(next, 4500, total > 1 && !isHovering)

  return (
    <>
      {/* ── Slider track ── */}
      <div
        id="home-hero-banner"
        onMouseEnter={() => setIsHovering(true)}
        onMouseLeave={() => setIsHovering(false)}
        onTouchStart={() => setIsHovering(true)}
        onTouchEnd={() => setTimeout(() => setIsHovering(false), 1800)}
        style={{ position: 'relative', width: '100%', height: '75vh', minHeight: 500, maxHeight: '75vh', overflow: 'hidden' }}
      >

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
          // BUG FIX: a slide's Background Image can itself be a fully
          // designed banner graphic — its own headline, subtitle, and CTA
          // baked directly into the photo (this is exactly what happens
          // when an admin uploads a ready-made marketing banner and
          // deliberately leaves the Eyebrow/Headline/Subtext/Buttons
          // fields blank, since the image already says everything). This
          // component used to always draw the dark gradient plus the
          // hardcoded default headline/CTA on top regardless, so a
          // self-contained banner ended up with its own baked-in title
          // fighting for space with an unrelated overlaid title, plus a
          // second "Explore Our Store" button nobody asked for. Now: only
          // draw the overlay (gradient, eyebrow, headline, subtext,
          // coupon, buttons) when the admin actually set at least one of
          // those fields for this slide; otherwise show the image clean,
          // edge to edge, with just an offscreen heading kept for SEO.
          const hasOverlayContent = Boolean(
            img.eyebrow || img.title || img.subtitle ||
            img.coupon_offer || img.coupon_code || img.cta_text || img.cta2_text
          )
          const srOnlyStyle = { position: 'absolute' as const, width: 1, height: 1, padding: 0, margin: -1, overflow: 'hidden' as const, clip: 'rect(0,0,0,0)', whiteSpace: 'nowrap' as const, border: 0 }
          return (
          <div key={i} aria-hidden={!isVisible} style={{
            position: 'absolute', inset: 0,
            opacity: isVisible ? 1 : 0,
            transition: 'opacity 0.9s cubic-bezier(0.4,0,0.2,1)',
            pointerEvents: isVisible ? 'auto' : 'none',
          }}>
            {/* BUG FIX: the admin panel lets each slide carry its own
                Background Video (autoplaying, muted, with the image as a
                poster fallback), and a slide can be video-only with no
                still image at all — the admin's own "active" check is
                `img || video`. This previously only ever rendered
                <Image src={img.url}>, so a) any video the admin uploaded
                never appeared on the live site, and b) a video-only slide
                (empty img.url) would crash next/image with an empty src.

                BUG FIX: a self-contained banner graphic was briefly given
                object-fit:contain so its own baked-in text/CTA would
                never get cropped — but on a wide desktop viewport the
                hero container is much wider/shorter than the banner's own
                aspect ratio, so "contain" just letterboxed it with solid
                blank bars down both sides. Cover (cropping a little off
                the top/bottom only, never the sides) is what actually
                fills the section without wasted space.

                BUG FIX (requested): with objectPosition:'center', that
                top/bottom crop was split evenly — on a typical desktop
                viewport the hero container is roughly 2.9:1 while these
                banners are shot around 1.9:1, so ~35% of the image's
                total height was being cropped away, roughly half off
                the top. That silently deleted whatever sat near the top
                of the frame (e.g. a prayer-flag strand in one banner) on
                every single slide, with no way to know it was happening
                short of comparing side-by-side against the original
                file. Biasing the crop to keep the top ~22% of the frame
                (rather than 0%, i.e. dead centre) keeps most banners'
                top flourishes intact while still leaving enough of the
                lower two-thirds — where the product bottle and headline
                actually sit — in frame. It's a single global default,
                not a per-slide setting, so it's a real trade-off: a
                slide whose important content sits right at the very
                bottom edge would now lose slightly more of that than
                before. */}
            {img.video ? (
              <video
                src={img.video}
                poster={img.url || undefined}
                autoPlay={isVisible}
                muted
                loop
                playsInline
                style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center 22%' }}
              />
            ) : img.url ? (
              <Image src={img.url} alt={img.alt_text || 'HimVeda by Pahadi Roots'} fill sizes="100vw"
                style={{ objectFit: 'cover', objectPosition: 'center 22%' }} priority={i === 0} />
            ) : (
              <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(150deg,#071a09 0%,#0d2410 30%,#1a3a1e 65%,#2d5233 100%)' }} />
            )}
            {hasOverlayContent ? (
              <>
                {/* Dark-left gradient overlay */}
                <div style={{ position:'absolute', inset:0, background:'linear-gradient(100deg,rgba(5,20,8,.82) 0%,rgba(5,20,8,.6) 45%,rgba(5,20,8,.15) 70%,rgba(5,20,8,.05) 100%)', zIndex:1 }} />
                {/* Content */}
                <div style={{ position:'absolute', inset:0, zIndex:2, display:'flex', alignItems:'center' }}>
                  <div className="hslide-content-inner" style={{ maxWidth:600, display:'flex', flexDirection:'column', gap:0 }}>
                    {/* BUG FIX: the eyebrow tag, headline colour, subtext
                        colour, coupon badge, and per-slide button text/links
                        are all fields the admin panel (Hero Banners page)
                        lets an editor set per-slide, but this component never
                        read any of them — the eyebrow was hardcoded, colours
                        were ignored, the coupon badge never rendered, and both
                        buttons always pointed at /products and /about no
                        matter what a slide's own CTA fields said. */}
                    <div style={{ display:'inline-flex', alignItems:'center', gap:6, fontSize:11, fontWeight:700, letterSpacing:'1.5px', textTransform:'uppercase', color: img.eyebrow_colour || 'rgba(255,255,255,.75)', background:'rgba(255,255,255,.1)', border:'1px solid rgba(255,255,255,.18)', borderRadius:30, padding:'5px 14px', width:'fit-content', marginBottom:18, backdropFilter:'blur(4px)' }}>
                      {img.eyebrow || '🌿 Pure · Himalayan · Natural'}
                    </div>
                    <HeadingTag style={{ ...headingStyle, color: img.title_colour || headingStyle.color }}>
                      {img.title ? renderHeadline(img.title) : <>{`Born in the`}<br/><em style={{fontStyle:'italic',color:'var(--gd)'}}>Himalayas,</em><br/>{`For Your Table`}</>}
                    </HeadingTag>
                    <p style={{ fontSize:'clamp(13px,1.5vw,16px)', color: img.sub_colour || 'rgba(255,255,255,.8)', lineHeight:1.6, margin:'0 0 20px', maxWidth:440 }}>
                      {img.subtitle || 'Handpicked from the purest altitudes — where clean air, ancient soil, and tradition create nature\'s finest.'}
                    </p>
                    {(img.coupon_offer || img.coupon_code) && (
                      <div style={{ display:'inline-flex', alignItems:'center', gap:8, background:'rgba(255,255,255,.95)', borderRadius:8, padding:'6px 14px', width:'fit-content', marginBottom:20 }}>
                        {img.coupon_label && <span style={{ fontSize:10, fontWeight:700, color:'#1b4332', textTransform:'uppercase', letterSpacing:'.5px' }}>{img.coupon_label}</span>}
                        {img.coupon_offer && <strong style={{ fontSize:13, fontWeight:900, color:'#1b4332' }}>{img.coupon_offer}</strong>}
                        {img.coupon_code && <span style={{ fontSize:11, fontWeight:700, color:'#bc4749' }}>· {img.coupon_code}</span>}
                      </div>
                    )}
                    <div style={{ display:'flex', gap:12, alignItems:'center', flexWrap:'wrap' }}>
                      <Link href={img.cta_link || '/products'} style={{ display:'inline-flex', alignItems:'center', gap:6, background:'var(--g)', color:'#fff', fontSize:14, fontWeight:800, padding:'13px 28px', borderRadius:50, textDecoration:'none', boxShadow:'0 4px 20px rgba(0,0,0,.25)', letterSpacing:'.2px', transition:'all .25s' }}>
                        {img.cta_text || 'Explore Our Store'}
                      </Link>
                      <Link href={img.cta2_link || '/about'} style={{ display:'inline-flex', alignItems:'center', fontSize:13, fontWeight:700, color:'rgba(255,255,255,.85)', textDecoration:'none', padding:'12px 0', gap:6, transition:'color .2s' }}>
                        {img.cta2_text || 'Our Story'} →
                      </Link>
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <HeadingTag style={srOnlyStyle}>{img.alt_text || 'HimVeda by Pahadi Roots'}</HeadingTag>
            )}
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

      {/* ── Stats bar — sits directly below slider, no gap ──
          BUG FIX: this used to be a hardcoded array with 3 of its 4
          stats not reading from settings at all, and the 4th reading a
          key (states_covered) the admin panel never actually writes to
          (its real key is stat_himalayan_states). See lib/heroStats.ts
          for the full explanation — this now reads the same admin
          fields the "Hero Stats Bar" panel actually manages, including
          respecting each stat's show/hide toggle for the first time.

          BUG FIX: this container used to render unconditionally even
          when every one of the 4 stats was hidden via its admin
          toggle — heroStats.map then produced nothing, but the
          near-black background (rgba(5,20,8,.97)) still rendered as a
          bare, empty strip wedged between the hero photo and the trust
          bar below it (the "black gap" being reported). Skipping the
          whole bar when there's nothing to show it removes that
          strip entirely instead of leaving an empty dark band. */}
      {heroStats.length > 0 && (
        <div style={{ background:'rgba(5,20,8,.97)', display:'flex', alignItems:'center', justifyContent:'center', gap:0, padding:'16px 40px', flexWrap:'wrap', marginTop:'-2px', position:'relative', zIndex:10 }}>
          {heroStats.map((s, i) => (
            <div key={s.key} style={{ display:'flex', alignItems:'center', gap:0 }}>
              <div style={{ textAlign:'center', padding:'0 32px' }}>
                <div style={{ fontFamily:'"Playfair Display",Georgia,serif', fontSize:'clamp(22px,2.5vw,32px)', fontWeight:900, color:'var(--gd2)', lineHeight:1.1 }}>{s.num}</div>
                <div style={{ fontSize:10.5, color:'rgba(255,255,255,.5)', letterSpacing:1, marginTop:3, textTransform:'uppercase' }}>{s.lbl}</div>
              </div>
              {i < heroStats.length - 1 && <div style={{ width:1, height:36, background:'rgba(255,255,255,.15)', flexShrink:0 }} />}
            </div>
          ))}
        </div>
      )}

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
