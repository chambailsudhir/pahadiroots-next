'use client'

import { useState, useCallback, useEffect, useRef, type TouchEvent } from 'react'
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

  // BUG FIX (mobile hero, round 3 — reported via screenshot: even the
  // blurred backdrop from the previous fix still left a visible grey band
  // on Wild Honey, since blur only hides WHAT fills a gap, not the fact
  // there IS one). The real fix is to stop guessing a single 1.87:1 ratio
  // for every banner and instead measure each image's own actual ratio
  // once it loads, then shape the container to match THAT slide exactly.
  // With the container's shape correct for the specific banner on screen,
  // object-fit:contain fits it with zero (or a sub-pixel, imperceptible)
  // gap — no crop, no visible letterbox, no blur workaround needed for
  // properly-measured slides. 1.87 stays only as the fallback shown for
  // an instant before an image's own dimensions are known (or if `onLoad`
  // never fires for some reason) — the blurred backdrop from the previous
  // fix stays in place purely as a safety net for that brief/edge case,
  // not as the primary fix anymore.
  const [slideRatios, setSlideRatios] = useState<Record<number, number>>({})
  const handleImgLoad = useCallback((i: number, e: React.SyntheticEvent<HTMLImageElement>) => {
    const { naturalWidth: w, naturalHeight: h } = e.currentTarget
    if (w > 0 && h > 0) {
      setSlideRatios(prev => (prev[i] ? prev : { ...prev, [i]: w / h }))
    }
  }, [])
  const handleVideoMeta = useCallback((i: number, e: React.SyntheticEvent<HTMLVideoElement>) => {
    const { videoWidth: w, videoHeight: h } = e.currentTarget
    if (w > 0 && h > 0) {
      setSlideRatios(prev => (prev[i] ? prev : { ...prev, [i]: w / h }))
    }
  }, [])
  const activeRatio = slideRatios[current] ?? 1.87

  // Mobile layout for slides that carry text/buttons over a photo.
  // Admin setting `hero_mobile_layout` (site_settings):
  //   'stack' (default, "Option B") — photo on top, copy on a dark panel that
  //           the photo fades into. Text never covers the picture.
  //   'full'  ("Option A") — photo fills the screen, copy over a gradient.
  // Only affects phones (<=768px) and only slides with overlay text.
  const mobileLayout: 'stack' | 'full' =
    String(settings?.hero_mobile_layout || '').toLowerCase().trim() === 'full' ? 'full' : 'stack'

  // Tap-to-unmute: browsers block unmuted autoplay outright, so every
  // video starts muted (required for autoplay to work at all). This lets
  // a visitor opt in to sound with one click — which browsers do allow,
  // since it's a direct user gesture. Declared before the ref/play effect
  // below since that effect reads isMuted.
  const [isMuted, setIsMuted] = useState(true)

  // BUG FIX: all slides stay mounted simultaneously (only opacity toggles),
  // which means each slide's <video> element is already sitting in the DOM
  // well before it's ever shown. The HTML `autoplay` attribute only makes a
  // browser start playback once, at the moment that element is first
  // inserted/loaded — flipping the React `autoPlay` prop later (when a
  // later slide's turn comes up in rotation) changes the attribute in the
  // DOM, but browsers don't re-evaluate `autoplay` after the fact and start
  // playing from that. Net effect: only the video on the slide that happens
  // to be visible on initial page load ever actually plays; every other
  // slide's video just sits on its first frame indefinitely, which looks
  // identical to a static background image. Explicitly calling .play() /
  // .pause() via refs, driven off `current`, fixes every slide regardless
  // of load order.
  const videoRefs = useRef<(HTMLVideoElement | null)[]>([])
  useEffect(() => {
    videoRefs.current.forEach((el, i) => {
      if (!el) return
      if (i === current) {
        el.muted = isMuted
        // el.play() returns a Promise in every evergreen browser, but is
        // guarded here rather than assumed — some embedded/webview
        // contexts and test environments (jsdom) don't return one.
        const playResult = el.play()
        if (playResult && typeof playResult.catch === 'function') {
          playResult.catch(() => {}) // browser may still block until user interacts once
        }
      }
      else el.pause()
    })
  }, [current, isMuted])

  useEffect(() => {
    videoRefs.current.forEach(el => { if (el) el.muted = isMuted })
  }, [isMuted])

  // BUG FIX (found in a fresh re-audit): unlike CategoryTiles.tsx (which
  // correctly pauses its own autoplay on hover/touch), this had NO
  // pause-on-interaction at all — the slideshow kept auto-advancing even
  // while someone was actively reading the hero text or about to click
  // an arrow/dot. Matching the same hover/touch-pause pattern here.
  const [isHovering, setIsHovering] = useState(false)

  const next = useCallback(() => setCurrent(c => (c + 1) % total), [total])
  const prev = useCallback(() => setCurrent(c => (c - 1 + total) % total), [total])
  // BUG FIX (P2): previously a raw setInterval with no
  // prefers-reduced-motion check and no pause when the tab is
  // backgrounded — see hooks/useAutoplayInterval.ts.
  useAutoplayInterval(next, 4500, total > 1 && !isHovering)

  // MISSING FEATURE (found during mobile audit): touch users had no way
  // to change slides except tapping the tiny arrow buttons — swiping the
  // banner itself, which is the expected gesture on every mobile
  // storefront/app carousel, did nothing but pause autoplay. Tracked via
  // a ref (not state) since we only need the value at touchend, and a
  // ref avoids a re-render on every touchstart. 40px threshold matches
  // common carousel libraries (Swiper's default is 50px) — high enough
  // to ignore an accidental brush, low enough to feel responsive.
  const touchStartX = useRef<number | null>(null)
  const handleTouchStart = (e: TouchEvent) => {
    touchStartX.current = e.touches[0].clientX
    setIsHovering(true)
  }
  const handleTouchEnd = (e: TouchEvent) => {
    if (touchStartX.current !== null && total > 1) {
      const delta = e.changedTouches[0].clientX - touchStartX.current
      if (delta < -40) next()
      else if (delta > 40) prev()
    }
    touchStartX.current = null
    setTimeout(() => setIsHovering(false), 1800)
  }

  return (
    <>
      {/* ── Slider track ── */}
      {/* BUG FIX (requested): even after biasing the crop toward the
          top (see objectPosition below), a meaningful chunk was still
          being cut from the bottom of every slide. The real cause
          wasn't the bias — it's that this container's shape (roughly
          2.4:1 wide at typical desktop sizes, from 75vh tall against
          a full-width viewport) is quite a bit more panoramic than
          these banners are actually shot (~1.87:1), so object-fit:
          cover has to crop away a large chunk of height no matter
          where the bias points; shifting the bias only moves *where*
          that crop lands, not how much of it there is. Increasing the
          container's height (75vh → 82vh) brings its shape closer to
          the banners' native proportions, roughly halving the total
          crop (from ~35% of the image's height down to ~12-14% at a
          typical desktop size) so both the top and bottom survive
          with much less lost. It doesn't reach zero — matching that
          exactly would mean an almost full-screen-height hero, which
          is a bigger visual change than a crop fix — but it's a large,
          safe reduction. For a zero-crop hero, banners would need to
          be exported nearer a 2.2–2.4:1 aspect ratio to begin with. */}
      <div
        id="home-hero-banner"
        className={`hhero-layout-${mobileLayout}${slides && (() => { const c: any = slides[current]; return Boolean(c && (c.eyebrow || c.title || c.subtitle || c.coupon_offer || c.coupon_code || c.cta_text || c.cta2_text)) })() ? ' hhero-ov-active' : ''}`}
        onMouseEnter={() => setIsHovering(true)}
        onMouseLeave={() => setIsHovering(false)}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        style={{ position: 'relative', width: '100%', height: '82vh', minHeight: 540, maxHeight: '82vh', overflow: 'hidden', touchAction: 'pan-y', ['--hero-ratio' as string]: activeRatio }}
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
          <div key={i} aria-hidden={!isVisible} className={`hhero-slide${hasOverlayContent ? ' hhero-slide-ov' : ''}${isVisible ? ' hhero-slide-on' : ''}`} style={{
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
                file. Biasing the crop to keep the top ~30% of the frame
                (rather than 0%, i.e. dead centre) keeps most banners'
                top flourishes intact while still leaving enough of the
                lower two-thirds — where the product bottle and headline
                actually sit — in frame. It's a single global default,
                not a per-slide setting, so it's a real trade-off: a
                slide whose important content sits right at the very
                bottom edge would now lose slightly more of that than
                before. */}
            {/* BUG FIX (mobile "stack" layout cropped the photo — reported via
                screenshot of the Cow Ghee banner, a correctly-sized 2:1 image
                whose jar sat cut off at the right edge): slides that carry
                overlay text use the stack layout, where this wrapper used to
                be forced to a fixed 1.55:1 box with object-fit:cover. A 2:1
                photo in a 1.55:1 box loses ~22% of its width (sides cropped),
                which is exactly what sliced the jar. The box now takes THIS
                slide's own measured ratio (--media-ratio, clamped to a sane
                range, default 2 = the recommended 2400x1200 export), so cover
                has nothing left to crop. */}
            <div className="hhero-media" style={{ position: 'absolute', inset: 0, ['--media-ratio' as string]: Math.min(2.4, Math.max(1.3, slideRatios[i] ?? 2)) }}>
            {img.video ? (
              <video
                ref={el => { videoRefs.current[i] = el }}
                src={img.video}
                poster={img.url || undefined}
                autoPlay={isVisible}
                muted={isMuted}
                loop
                playsInline
                onLoadedMetadata={e => handleVideoMeta(i, e)}
                style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center 30%' }}
              />
            ) : img.url ? (
              !hasOverlayContent ? (
                // BUG FIX (mobile hero letterbox bars — reported via
                // screenshot, right after the object-fit:contain fix
                // above): a flat-colour backdrop behind the contained
                // image works fine when a banner's real aspect ratio is
                // close to the container's 1.87:1 (invisible sliver), but
                // Wild Honey's actual ratio is far enough off 1.87:1 that
                // contain leaves a real gap top and bottom — and a flat
                // dark-green bar filling that gap reads as an obviously
                // broken UI element, not a subtle edge, exactly as
                // reported. Sea Buckthorn (also baked-in-text, confirmed
                // via the same blank-overlay-fields check) happens to be
                // shot close enough to 1.87:1 that its own gap was never
                // visible — which is why only one of the two banners
                // showed the problem despite both using the same code
                // path. A blurred, scaled-up copy of the SAME image
                // behind the sharp contained one (the standard technique
                // for exactly this — Netflix/YouTube-style letterbox
                // fill) means any gap, regardless of its size on any
                // given banner, blends as a soft continuation of the
                // photo rather than a mismatched solid bar.
                <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
                  <Image src={img.url} alt="" aria-hidden="true" fill sizes="100vw"
                    className="hhero-baked-backdrop"
                    style={{ objectFit: 'cover', objectPosition: 'center 30%' }} />
                  <Image src={img.url} alt={img.alt_text || 'HimVeda by Pahadi Roots'} fill sizes="100vw"
                    className="hhero-baked-img"
                    onLoad={e => handleImgLoad(i, e)}
                    style={{ objectFit: 'cover', objectPosition: 'center 30%', position: 'absolute' }} priority={i === 0} />
                </div>
              ) : (
                <Image src={img.url} alt={img.alt_text || 'HimVeda by Pahadi Roots'} fill sizes="100vw"
                  onLoad={e => handleImgLoad(i, e)}
                  style={{ objectFit: 'cover', objectPosition: 'center 30%' }} priority={i === 0} />
              )
            ) : (
              <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(150deg,#071a09 0%,#0d2410 30%,#1a3a1e 65%,#2d5233 100%)' }} />
            )}
            </div>
            {hasOverlayContent ? (
              <>
                {/* Dark-left gradient overlay */}
                <div className="hhero-grad" style={{ position:'absolute', inset:0, background:'linear-gradient(100deg,rgba(5,20,8,.82) 0%,rgba(5,20,8,.6) 45%,rgba(5,20,8,.15) 70%,rgba(5,20,8,.05) 100%)', zIndex:1 }} />
                {/* Content */}
                <div className="hhero-content" style={{ position:'absolute', inset:0, zIndex:2, display:'flex', alignItems:'center' }}>
                  <div className="hslide-content-inner" style={{ maxWidth:600, display:'flex', flexDirection:'column', gap:0 }}>
                    {/* BUG FIX: the eyebrow tag, headline colour, subtext
                        colour, coupon badge, and per-slide button text/links
                        are all fields the admin panel (Hero Banners page)
                        lets an editor set per-slide, but this component never
                        read any of them — the eyebrow was hardcoded, colours
                        were ignored, the coupon badge never rendered, and both
                        buttons always pointed at /products and /about no
                        matter what a slide's own CTA fields said. */}
                    <div className="hhero-eyebrow" style={{ display:'inline-flex', alignItems:'center', gap:6, fontSize:11, fontWeight:700, letterSpacing:'1.5px', textTransform:'uppercase', color: img.eyebrow_colour || 'rgba(255,255,255,.75)', background:'rgba(255,255,255,.1)', border:'1px solid rgba(255,255,255,.18)', borderRadius:30, padding:'5px 14px', width:'fit-content', marginBottom:18, backdropFilter:'blur(4px)' }}>
                      {img.eyebrow || '🌿 Pure · Himalayan · Natural'}
                    </div>
                    <HeadingTag className="hhero-h" style={{ ...headingStyle, color: img.title_colour || headingStyle.color }}>
                      {img.title ? renderHeadline(img.title) : <>{`Born in the`}<br/><em style={{fontStyle:'italic',color:'var(--gd)'}}>Himalayas,</em><br/>{`For Your Table`}</>}
                    </HeadingTag>
                    <p className="hhero-sub" style={{ fontSize:'clamp(13px,1.5vw,16px)', color: img.sub_colour || 'rgba(255,255,255,.8)', lineHeight:1.6, margin:'0 0 20px', maxWidth:440 }}>
                      {img.subtitle || 'Handpicked from the purest altitudes — where clean air, ancient soil, and tradition create nature\'s finest.'}
                    </p>
                    {(img.coupon_offer || img.coupon_code) && (
                      <div style={{ display:'inline-flex', alignItems:'center', gap:8, background:'rgba(255,255,255,.95)', borderRadius:8, padding:'6px 14px', width:'fit-content', marginBottom:20 }}>
                        {img.coupon_label && <span style={{ fontSize:10, fontWeight:700, color:'#1b4332', textTransform:'uppercase', letterSpacing:'.5px' }}>{img.coupon_label}</span>}
                        {img.coupon_offer && <strong style={{ fontSize:13, fontWeight:900, color:'#1b4332' }}>{img.coupon_offer}</strong>}
                        {img.coupon_code && <span style={{ fontSize:11, fontWeight:700, color:'#bc4749' }}>· {img.coupon_code}</span>}
                      </div>
                    )}
                    <div className="hhero-ctas" style={{ display:'flex', gap:12, alignItems:'center', flexWrap:'wrap' }}>
                      <Link className="hhero-cta1" href={img.cta_link || '/products'} style={{ display:'inline-flex', alignItems:'center', gap:6, background:'var(--g)', color:'#fff', fontSize:14, fontWeight:800, padding:'13px 28px', borderRadius:50, textDecoration:'none', boxShadow:'0 4px 20px rgba(0,0,0,.25)', letterSpacing:'.2px', transition:'all .25s' }}>
                        {img.cta_text || 'Explore Our Store'}
                      </Link>
                      <Link className="hhero-cta2" href={img.cta2_link || '/our-stories'} style={{ display:'inline-flex', alignItems:'center', fontSize:13, fontWeight:700, color:'rgba(255,255,255,.85)', textDecoration:'none', padding:'12px 0', gap:6, transition:'color .2s' }}>
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
                <Link href="/our-stories" style={{ display:'inline-flex', alignItems:'center', fontSize:13, fontWeight:700, color:'rgba(255,255,255,.85)', textDecoration:'none', padding:'12px 0', gap:6 }}>
                  Our Story →
                </Link>
              </div>
            </div>
          </div>
        )}

        {/* Prev / Next arrows */}
        {total > 1 && (<>
          <button onClick={prev} aria-label="Previous" className="hhero-arrow hhero-arrow-prev"
            style={{ position:'absolute', left:20, top:'calc(50% - 35px)', transform:'translateY(-50%)', zIndex:20, background:'rgba(0,0,0,.35)', backdropFilter:'blur(10px)', border:'1.5px solid rgba(255,255,255,.4)', color:'#fff', width:46, height:46, borderRadius:'50%', fontSize:26, display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', boxShadow:'0 2px 12px rgba(0,0,0,.4)' }}>
            ‹
          </button>
          <button onClick={next} aria-label="Next" className="hhero-arrow hhero-arrow-next"
            style={{ position:'absolute', right:20, top:'calc(50% - 35px)', transform:'translateY(-50%)', zIndex:20, background:'rgba(0,0,0,.35)', backdropFilter:'blur(10px)', border:'1.5px solid rgba(255,255,255,.4)', color:'#fff', width:46, height:46, borderRadius:'50%', fontSize:26, display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', boxShadow:'0 2px 12px rgba(0,0,0,.4)' }}>
            ›
          </button>
        </>)}

        {/* Mute / unmute — only relevant when the current slide has a
            video, and only rendered once here (not per-slide) since only
            one video ever plays at a time. */}
        {slides && slides[current]?.video && (
          <button onClick={() => setIsMuted(m => !m)} aria-label={isMuted ? 'Unmute video' : 'Mute video'}
            style={{ position:'absolute', right:20, bottom:66, zIndex:20, background:'rgba(0,0,0,.35)', backdropFilter:'blur(10px)', border:'1.5px solid rgba(255,255,255,.4)', color:'#fff', width:40, height:40, borderRadius:'50%', display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', boxShadow:'0 2px 12px rgba(0,0,0,.4)' }}>
            {isMuted ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                <line x1="23" y1="9" x2="17" y2="15" />
                <line x1="17" y1="9" x2="23" y2="15" />
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
              </svg>
            )}
          </button>
        )}

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
      {heroStats.length > 0 && (() => {
        // Admin's Hero Stats Bar section lets the store owner pick a
        // background/number color (stat_bg_color / stat_number_color);
        // falls back to the original near-black/gold if unset so existing
        // stores don't change appearance. Label text dims to 50% opacity of
        // the same color, matching how the fixed white label was rendered
        // before.
        const statsBg   = settings.stat_bg_color     || 'rgba(5,20,8,.97)'
        const statsNum  = settings.stat_number_color || 'var(--gd2)'
        return (
        <div style={{ background:statsBg, display:'flex', alignItems:'center', justifyContent:'center', gap:0, padding:'8px 40px', flexWrap:'wrap', marginTop:'-2px', position:'relative', zIndex:10 }}>
          {heroStats.map((s, i) => (
            <div key={s.key} style={{ display:'flex', alignItems:'center', gap:0 }}>
              <div style={{ textAlign:'center', padding:'0 32px' }}>
                <div style={{ fontFamily:'"Playfair Display",Georgia,serif', fontSize:'clamp(20px,2.2vw,28px)', fontWeight:900, color:statsNum, lineHeight:1.1 }}>{s.num}</div>
                <div style={{ fontSize:10.5, color:statsNum, opacity:0.5, letterSpacing:1, marginTop:2, textTransform:'uppercase' }}>{s.lbl}</div>
              </div>
              {i < heroStats.length - 1 && <div style={{ width:1, height:36, background:'rgba(255,255,255,.15)', flexShrink:0 }} />}
            </div>
          ))}
        </div>
        )
      })()}

      <style>{`
        .hslide-content-inner { padding: 0 0 0 72px; }
        @media(max-width:860px){
          .hslide-content-inner { padding: 0 20px !important; }
        }
        @media(max-width:540px){
          .hslide-content-inner { padding: 0 16px !important; }
        }
        /* BUG FIX (mobile hero cropped/"zoomed" — reported via screenshot,
           pahadiroots.com vs. a competitor's site rendering the same kind
           of banner correctly on phone):
           The container above is a fixed 82vh tall regardless of viewport
           width. That's a deliberate, tuned trade-off on desktop (see the
           long comment on #home-hero-banner) where 82vh keeps the
           container's shape close to these banners' native ~1.87:1 aspect
           ratio, so object-fit:cover only crops a small amount off the
           top/bottom. On a narrow phone, 82vh is still 82% of the SCREEN
           HEIGHT — e.g. ~550-600px tall on a typical phone — against a
           viewport that's only ~380-420px WIDE. That makes the container's
           shape roughly 0.65:1 (tall and narrow) instead of 1.87:1 (wide),
           the opposite problem from desktop: now object-fit:cover has to
           crop enormously off the LEFT and RIGHT to fill that tall shape,
           which is exactly what sliced the "V" off "Veda" and the bottle
           label in the reported screenshot — only a thin center strip of
           each wide banner survives.
           Fix: below 768px, let the container's height follow the image's
           own aspect ratio (matching the ~1.87:1 these banners are shot
           at, per the note above) instead of a fixed viewport-height
           value. With the container's shape matching the image's shape,
           cover has nothing left to crop horizontally — the full banner
           (all baked-in text/logo included) stays in frame, just shorter,
           the same way a responsive banner behaves on any other mobile
           commerce site. !important is required on height/min-height/
           max-height only because those three are set via inline style
           above, which otherwise always wins over an external stylesheet
           rule regardless of specificity. */
        @media(max-width:768px){
          #home-hero-banner {
            height: auto !important;
            min-height: 0 !important;
            max-height: none !important;
            /* BUG FIX (round 3): was a flat 1.87 for every banner; now
               reads the current slide's own measured ratio via the
               --hero-ratio custom property set above (falls back to 1.87
               only before that slide's real ratio is known). See the
               long comment by slideRatios/activeRatio above for why. */
            aspect-ratio: var(--hero-ratio, 1.87) / 1;
          }
        }
        /* BUG FIX (round 2 — mobile hero letterbox bars showed as a solid
           green bar on Wild Honey, reported via screenshot; Sea Buckthorn
           didn't show it despite the identical code path, because its own
           image happens to already sit close to 1.87:1 — different
           banners genuinely have different real aspect ratios, so a flat-
           colour fallback was always going to look fine on some and
           broken on others). Replaced the flat-gradient backdrop with a
           blurred, scaled-up copy of the SAME image (.hhero-baked-backdrop,
           rendered behind this one in the JSX above) — the standard fix
           for letterboxing (Netflix/YouTube use the same technique): any
           gap this leaves, on any banner regardless of its real ratio,
           now reads as a soft continuation of the photo instead of a
           mismatched solid bar. scale(1.15) keeps the blur's own soft
           edge from ever being visible at the container's boundary. */
        @media(max-width:768px){
          .hhero-baked-img{
            object-fit: contain !important;
          }
          .hhero-baked-backdrop{
            filter: blur(30px) brightness(0.75);
            transform: scale(1.15);
          }
        }
        /* BUG FIX (mobile hero arrows still reading as too big/prominent —
           reported via screenshot even after the shrink-and-recenter fix
           above): shrinking them to 36px was a half-measure. Every major
           FMCG/D2C mobile hero (Amazon, Nykaa, Blinkit, Sephora, etc.)
           doesn't show prev/next arrow buttons on phones at all — on a
           touch screen, swipe is the expected gesture, and a persistent
           dark circle sitting on top of hero art/copy just adds visual
           clutter with no real function once swipe works. The dot/pill
           position indicator (rendered separately, unaffected by this
           change) is what phones use to show "which slide am I on";
           arrows are a mouse-era affordance that only earns its place on
           desktop, where there's no swipe gesture and hover discovery
           makes sense. Hiding them outright (rather than the earlier
           shrink) matches that convention and fully declutters the
           banner on mobile; the touchStart/touchEnd swipe handlers above
           are untouched and remain the only mobile navigation. Desktop
           (>768px) keeps the original 46px arrows exactly as before —
           this rule only fires below the same 768px breakpoint already
           used for the rest of the mobile hero layout. */
        @media(max-width:768px){
          .hhero-arrow {
            display: none !important;
          }
        }
        /* MOBILE — slides that carry text/buttons over a photo (headline,
           subtitle, CTA set in the admin). Two layouts, chosen by the admin
           setting hero_mobile_layout (see mobileLayout above). Banners with
           the text baked into the image, and all desktop layouts, are not
           affected by anything below. */
        @media(max-width:768px){
          /* shared */
          .hhero-slide-ov .hhero-sub{ font-size: 14px !important; margin: 0 0 16px !important; }
          .hhero-slide-ov .hhero-h{ font-weight: 600 !important; letter-spacing: -0.3px !important; }

          /* ── B: "stack" (default) — photo on top, fades into a dark panel ── */
          #home-hero-banner.hhero-layout-stack.hhero-ov-active{
            aspect-ratio: auto !important;
            height: auto !important;
            min-height: 0 !important;
            max-height: none !important;
            background: #0d2410;
          }
          .hhero-layout-stack.hhero-ov-active .hhero-slide-ov.hhero-slide-on{
            position: relative !important;
            inset: auto !important;
            display: flex;
            flex-direction: column;
          }
          .hhero-layout-stack .hhero-slide-ov .hhero-media{
            position: relative !important;
            inset: auto !important;
            width: 100%;
            aspect-ratio: var(--media-ratio, 2) / 1;
            flex-shrink: 0;
          }
          .hhero-layout-stack .hhero-slide-ov .hhero-media::after{
            content: ""; position: absolute; left: 0; right: 0; bottom: 0; height: 42%;
            background: linear-gradient(180deg, rgba(13,36,16,0), #0d2410);
            pointer-events: none;
          }
          .hhero-layout-stack .hhero-slide-ov .hhero-grad{ display: none !important; }
          .hhero-layout-stack .hhero-slide-ov .hhero-content{
            position: relative !important;
            inset: auto !important;
            margin-top: -34px;
            align-items: flex-start !important;
            padding: 0 0 52px;
          }
          .hhero-layout-stack .hhero-slide-ov .hhero-h{
            font-size: clamp(25px, 7.4vw, 30px) !important;
            line-height: 1.12 !important;
            margin: 0 0 10px !important;
          }
          .hhero-layout-stack .hhero-slide-ov .hhero-eyebrow{
            background: none !important; border: none !important; padding: 0 !important;
            backdrop-filter: none !important; margin-bottom: 10px !important;
          }
          .hhero-layout-stack .hhero-slide-ov .hhero-ctas{ flex-wrap: nowrap !important; gap: 14px !important; width: 100%; }
          .hhero-layout-stack .hhero-slide-ov .hhero-cta1{
            flex: 1; justify-content: center; text-align: center;
            background: #e0b64a !important; color: #0d2410 !important;
            padding: 13px 16px !important; font-size: 13px !important; border-radius: 6px !important;
            text-transform: uppercase; letter-spacing: .5px !important; box-shadow: none !important;
          }
          .hhero-layout-stack .hhero-slide-ov .hhero-cta2{ white-space: nowrap; }

          /* ── A: "full" — photo fills the screen, copy over a gradient ── */
          #home-hero-banner.hhero-layout-full.hhero-ov-active{
            aspect-ratio: auto !important;
            height: min(600px, 86vh) !important;
            min-height: 480px !important;
            max-height: none !important;
          }
          .hhero-layout-full .hhero-slide-ov .hhero-media img{ object-position: 62% center !important; }
          .hhero-layout-full .hhero-slide-ov .hhero-grad{
            background: linear-gradient(180deg, rgba(6,22,10,.82) 0%, rgba(6,22,10,.55) 38%, rgba(6,22,10,0) 62%, rgba(6,22,10,.55) 100%) !important;
          }
          .hhero-layout-full .hhero-slide-ov .hhero-content{ align-items: stretch !important; }
          .hhero-layout-full .hhero-slide-ov .hslide-content-inner{
            height: 100%; max-width: none !important;
            padding: 26px 22px 46px !important;
          }
          .hhero-layout-full .hhero-slide-ov .hhero-h{
            font-size: clamp(27px, 8vw, 32px) !important;
            line-height: 1.1 !important; margin: 0 0 12px !important;
          }
          .hhero-layout-full .hhero-slide-ov .hhero-sub{
            display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;
            max-width: 300px !important; margin: 0 !important;
          }
          .hhero-layout-full .hhero-slide-ov .hhero-ctas{
            flex-direction: column; align-items: stretch !important; gap: 10px !important; margin-top: auto;
          }
          .hhero-layout-full .hhero-slide-ov .hhero-cta1,
          .hhero-layout-full .hhero-slide-ov .hhero-cta2{
            justify-content: center; text-align: center; border-radius: 6px !important;
            padding: 14px !important; font-size: 13px !important; text-transform: uppercase; letter-spacing: .6px !important;
          }
          .hhero-layout-full .hhero-slide-ov .hhero-cta2{
            border: 1px solid rgba(255,255,255,.7); background: rgba(255,255,255,.12); color: #fff !important;
          }
        }
      `}</style>
    </>
  )
}
