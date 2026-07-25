'use client'

import Link from 'next/link'
import Image from 'next/image'
import { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { useCartStore, selectCartCount } from '@/store/cartStore'
import { useUIStore } from '@/store/uiStore'
import { useUserStore } from '@/store/userStore'
import type { SiteSettings, Category, State } from '@/types'
import { isEnabled } from '@/lib/getSiteSettings'
import { performHeaderLogout } from '@/lib/clientLogout'
import MegaMenu from './MegaMenu'
import AnnouncementBar from './AnnouncementBar'
import TickerBar from './TickerBar'

interface Props {
  settings:   SiteSettings
  categories?: Category[]
  states?:     State[]
}

export default function Header({ settings, categories = [], states = [] }: Props) {
  // selectCartCount: stable selector — only re-renders when count changes
  const cartCount  = useCartStore(selectCartCount)
  const wishlist   = useUserStore(s => s.wishlist)
  const user       = useUserStore(s => s.user)
  const { openCart, openSearch, openMobileMenu, openAuth } = useUIStore()

  const [scrolled, setScrolled] = useState(false)
  // BUG FIX (requested): the transparent-over-hero nav used to switch to
  // its solid/frosted look as soon as the page scrolled past a flat 60px
  // — but the hero itself is 75vh tall, so for most of the scroll through
  // the hero the nav was already showing its frosted-white backing on top
  // of a photo that was still fully in view, washing it out (this is the
  // "turns white on scroll" complaint — the reference site keeps its nav
  // fully see-through for as long as the hero itself is on screen, only
  // switching once the hero has scrolled away entirely). heroPast tracks
  // that by measuring the hero element's own position on scroll (see the
  // effect below) rather than a guessed pixel threshold, so it stays
  // correct regardless of hero height.
  const [heroPast, setHeroPast] = useState(false)
  const [acctOpen, setAcctOpen] = useState(false)
  // ── Mount guard: Zustand persist reads localStorage which doesn't exist on server.
  // Rendering persisted values before mount causes React hydration errors #418/#423/#425.
  const [mounted,  setMounted]  = useState(false)
  // Track dark mode for aria-pressed on the toggle button (WCAG 4.1.2)
  const [isDark, setIsDark] = useState(false)
  // BUG FIX (P1): guards against double-firing the real logout below while
  // the network calls are in flight (was previously just a <Link>, so this
  // guard didn't exist because there was nothing to guard).
  const [loggingOut, setLoggingOut] = useState(false)

  // FEATURE (requested): on the homepage, the hero banner was always
  // squeezed into whatever height was left below this header — the
  // announcement bar + ticker + 64px nav row all reserved flow space
  // above it, forcing the hero's background image to be cropped more
  // than necessary to fit the leftover box. Overlaying a transparent
  // nav directly on top of the hero (below the still-solid announcement
  // bar/ticker) gives the hero its full height back. Only the homepage
  // gets this treatment — every other page keeps the normal solid,
  // in-flow nav exactly as before, so nothing else on the site changes.
  const pathname = usePathname()
  const isHome = pathname === '/'
  // The nav is always position:fixed on the homepage (never toggled
  // between fixed/static) — only its background/text colour switches
  // between transparent (over the hero, unscrolled) and solid (once
  // scrolled past the hero) via the existing `scrolled` state. Toggling
  // position itself would reserve/free flow space right at the scroll
  // threshold and cause a visible content jump; toggling only colour
  // does not.
  const overlayNav = isHome

  // Announcement bar + ticker stay in normal document flow (unchanged),
  // so the overlay nav needs to sit just below them, not at the very
  // top of the viewport. Their combined height is measured rather than
  // hardcoded, since either can be hidden via settings (ann_hide /
  // ticker settings) or wrap onto a second line on narrow screens.
  const topBarRef = useRef<HTMLDivElement>(null)
  const [topBarHeight, setTopBarHeight] = useState(0)
  // Mirrors topBarHeight without needing the heroPast effect below to
  // depend on it (see that effect for why that dependency was the bug).
  const topBarHeightRef = useRef(0)

  useEffect(() => {
    const el = topBarRef.current
    if (!el) return
    const measure = () => {
      topBarHeightRef.current = el.offsetHeight
      setTopBarHeight(el.offsetHeight)
    }
    measure()
    window.addEventListener('resize', measure)
    if (typeof ResizeObserver === 'undefined') {
      return () => window.removeEventListener('resize', measure)
    }
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => { ro.disconnect(); window.removeEventListener('resize', measure) }
  }, [])

  useEffect(() => {
    // Genuinely necessary exception: this is client-mount detection to
    // avoid hydration mismatches (React errors #418/#423/#425) when
    // rendering Zustand `persist`-middleware state that reads localStorage,
    // which doesn't exist during SSR. Whether we're mounted on the client
    // cannot be known during ANY render phase (server or client) — only
    // after the effect phase runs — so there is no render-time-adjustment
    // equivalent here, unlike the prop-driven cases elsewhere in this
    // codebase (see SearchOverlay.tsx / AuthModal.tsx for the pattern that
    // DOES apply).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true)
    setIsDark(document.documentElement.classList.contains('dark'))
    // BUG FIX (root cause of the "white gap" over the hero): this only
    // ever set `scrolled` in response to a *scroll event* — it never
    // checked the actual current window.scrollY on mount. Browsers
    // commonly restore the previous scroll position on refresh/back-
    // navigation, so the page can load already scrolled well past the
    // hero while React still thinks scrolled=false. That mismatch made
    // the nav keep its transparent-over-hero styling (white text,
    // see-through background) while it was actually sitting over a
    // plain white/cream page section further down — white text on a
    // white background, which is exactly the blank-looking band being
    // reported. Checking the real scroll position immediately (not
    // just listening for the next scroll event) keeps the two in sync
    // from the very first paint.
    const onScroll = () => setScrolled(window.scrollY > 60)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    // Only the homepage has a hero to watch; every other page keeps the
    // plain solid nav and never reads heroPast at all.
    if (!overlayNav) return
    const el = document.getElementById('home-hero-banner')
    if (!el) return

    // BUG FIX (the random transparent/solid "flicker" reported on the
    // live site, happening even with no scrolling at all): this used to
    // be an IntersectionObserver whose rootMargin was built from
    // `topBarHeight`, with the *effect itself* depending on
    // `[overlayNav, topBarHeight]` — so every time topBarHeight state
    // updated (its ResizeObserver can fire from sub-pixel layout
    // recalculations that don't reflect any real visible change), the
    // whole observer was disconnected and a brand-new one created. A
    // freshly created IntersectionObserver's first callback can report
    // a transient/stale isIntersecting reading before settling on the
    // correct one (browsers queue that first callback for the next
    // frame, right when a resize-triggered recalculation was already in
    // flight) — so every one of those silent recreations was a chance
    // to misfire heroPast to `true` for a frame, snapping the nav to
    // solid, before the next correct callback flipped it back. On a
    // page where topBarHeight was churning even slightly, that added up
    // to exactly the random flicker being reported.
    //
    // A plain scroll handler that reads the hero's own
    // getBoundingClientRect() sidesteps all of this: it never gets
    // torn down and recreated (this effect now only depends on
    // `overlayNav`, which is stable for the life of the page), and it
    // always reads the *current* topBarHeightRef value rather than
    // needing to be rebuilt whenever that number changes.
    // BUG FIX 2 (the flicker fix above stopped the *recreation* churn,
    // but hard refreshes could still occasionally show the nav solid on
    // the very first paint): the initial update() call ran synchronously
    // inside this effect, immediately on mount — before the browser had
    // necessarily finished a real layout pass for a freshly-hydrated,
    // still-loading page (web fonts swapping in, images not decoded
    // yet, etc. can all shift layout right after hydration). If that
    // first getBoundingClientRect() read landed during such a moment,
    // the hero's box could transiently measure as far shorter than its
    // real 82vh — occasionally short enough for `bottom` to already be
    // at/under topBarHeightRef, incorrectly setting heroPast=true right
    // out of the gate. Nothing then corrected it: with no scroll or
    // resize event, the effect never re-ran to re-measure. Two changes
    // fix this: (1) treat a measurement where the hero still reads as
    // ~0 height as not-yet-ready and skip it rather than trusting it,
    // and (2) re-check again after the page's `load` event, once fonts
    // and images have actually settled, as a safety net independent of
    // scroll/resize ever firing.
    let ticking = false
    const update = () => {
      const rect = el.getBoundingClientRect()
      if (rect.height > 0) setHeroPast(rect.bottom <= topBarHeightRef.current)
      ticking = false
    }
    const onScrollOrResize = () => {
      if (ticking) return
      ticking = true
      requestAnimationFrame(update)
    }
    update()
    window.addEventListener('scroll', onScrollOrResize, { passive: true })
    window.addEventListener('resize', onScrollOrResize)
    window.addEventListener('load', update)
    return () => {
      window.removeEventListener('scroll', onScrollOrResize)
      window.removeEventListener('resize', onScrollOrResize)
      window.removeEventListener('load', update)
    }
  }, [overlayNav])

  const showWishlist = isEnabled(settings.show_wishlist)
  const showTrack    = isEnabled(settings.show_track_order_page)
  const siteName     = settings.site_name || 'HimVeda by Pahadi Roots'
  const logoUrl      = settings.logo_url || ''
  const freeShipMin  = settings.free_shipping_min || '0'

  const firstName = user?.name?.split(' ')[0] || ''
  const initials  = firstName ? firstName[0].toUpperCase() : ''

  return (
    <>
      {/* Skip to main content — keyboard/screen-reader accessibility */}
      <a href="#main-content" className="old-skip-link">Skip to main content</a>

      <div className="sticky top-0 z-30">
      <div ref={topBarRef}>
        <AnnouncementBar settings={settings} />
        <TickerBar settings={settings} />
      </div>

      {/* On the homepage, whether the nav is "solid" is governed by
          heroPast (has the hero scrolled fully out of view), not the
          generic 60px `scrolled` flag — the hero is 75vh tall, and
          switching to a solid/frosted background at just 60px meant the
          nav was already showing its solid backing while the hero photo
          itself was still mostly on screen behind it. Every other page
          keeps using the plain `scrolled` flag exactly as before. */}
      <nav
        className={`old-nav${(overlayNav ? heroPast : scrolled) ? ' scrolled' : ''}${overlayNav ? ' overlay-nav' : ''}${overlayNav && !heroPast ? ' overlay-nav-transparent' : ''}`}
        style={overlayNav ? { position: 'fixed', top: topBarHeight, left: 0, right: 0, zIndex: 30 } : undefined}
      >
        {/* Logo — single combined "HimVeda by Pahadi Roots" mark (transparent
            PNG). Previously this stacked two separate opaque-background
            images, which is what caused the white-box artifact in the
            transparent overlay-nav state: the invert filter had no alpha
            channel to respect, so each image's whole rectangle went white.
            One properly-trimmed transparent asset avoids that class of bug
            entirely and is also just simpler to lay out. If an admin sets a
            custom logo via Settings → logo_url, that (single) image is used
            instead — same as before. */}
        <Link href="/" className="old-logo">
          <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '10px' }}>
            {logoUrl
              ? <Image src={logoUrl} alt={siteName} width={160} height={48} style={{ height: '48px', width: 'auto', objectFit: 'contain' }} />
              : <Image src="/logo-full.png" alt={siteName} width={124} height={46} style={{ height: '46px', width: 'auto', objectFit: 'contain' }} priority />}
            <span className="old-logo-divider" />
            <div className="old-logo-tl">Himalayan<br />Natural Store</div>
          </div>
        </Link>

        {/* Desktop nav links */}
        <ul className="old-nav-links">
          <li><Link href="/">Home</Link></li>
          <li><Link href="/about">Our Story</Link></li>
          <MegaMenu categories={categories} states={states} />
          {showTrack && <li><Link href="/track">Track Order</Link></li>}
          <li><Link href="/payment">Payment</Link></li>
          <li><Link href="/contact">Contact</Link></li>
        </ul>

        {/* Right actions */}
        <div className="old-nav-right">
          {/* Search */}
          <button type="button" onClick={openSearch} aria-label="Search" className="old-nib" title="Search products"><span aria-hidden="true">🔍</span></button>

          {/* Wishlist */}
          {showWishlist && (
            <Link href="/wishlist" aria-label="Wishlist" className="old-nib" style={{ position: 'relative' }}>
              <span aria-hidden="true">❤️</span>
              {mounted && wishlist.length > 0 && (
                // aria-hidden: count already in link aria-label isn't practical here, but the
                // number badge is decorative alongside the icon. Announce via aria-label update instead.
                <span className="old-wl-badge" aria-hidden="true">{wishlist.length > 9 ? '9+' : wishlist.length}</span>
              )}
            </Link>
          )}

          {/* Account with hover + focus dropdown (WCAG 2.1.1: keyboard accessible) */}
          <div
            style={{ position: 'relative' }}
            onMouseEnter={() => setAcctOpen(true)}
            onMouseLeave={() => setAcctOpen(false)}
            onFocus={() => setAcctOpen(true)}
            onBlur={(e) => {
              // Only close if focus leaves the entire dropdown container
              if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                setAcctOpen(false)
              }
            }}
          >
            <Link href="/account" className="old-nib" style={{ position: 'relative' }}
              aria-label={mounted && user ? `My Account, ${firstName}` : 'My Account'}
              aria-haspopup="true"
              aria-expanded={acctOpen}
            >
              {mounted && user && initials
                ? <span className="old-acct-av">{initials}</span>
                : <span aria-hidden="true">👤</span>}
              {mounted && user && <span className="old-acct-dot" />}
            </Link>

            {acctOpen && (
              <div className="old-acct-dd" role="menu" aria-label="Account menu">
                <div className="old-dd-head">
                  {mounted && user
                    ? <><div className="old-dd-name">Hi, {firstName}!</div><div className="old-dd-sub">{user.email || ''}</div></>
                    : <><div className="old-dd-name">Welcome!</div><div className="old-dd-sub">Login to manage your account</div></>}
                </div>
                <Link href="/account" className="old-dd-item" role="menuitem" onClick={() => setAcctOpen(false)}>
                  <span aria-hidden="true">📦</span> My Orders
                </Link>
                <Link href="/wishlist" className="old-dd-item" role="menuitem" onClick={() => setAcctOpen(false)}>
                  <span aria-hidden="true">🤍</span> Wishlist
                </Link>
                <Link href="/account/addresses" className="old-dd-item" role="menuitem" onClick={() => setAcctOpen(false)}>
                  <span aria-hidden="true">👤</span> Profile &amp; Address
                </Link>
                <div className="old-dd-foot">
                  {mounted && user
                    // BUG FIX (P1 — security): this was previously
                    // `<Link href="/account">` — it navigated to the
                    // account page but never actually ended the session,
                    // so "Logout" silently did nothing. Now calls the real
                    // shared logout helper (clears the httpOnly session
                    // cookie + the client user store) before reloading.
                    ? <button
                        type="button"
                        className="old-dd-btn"
                        role="menuitem"
                        style={{ background: '#fdecea', color: '#c0392b' }}
                        disabled={loggingOut}
                        onClick={async () => {
                          setAcctOpen(false)
                          setLoggingOut(true)
                          await performHeaderLogout()
                          // performHeaderLogout() reloads the page on success;
                          // setLoggingOut(false) only matters if that somehow
                          // doesn't happen (e.g. reload blocked in a test env).
                          setLoggingOut(false)
                        }}
                      >
                        {loggingOut ? 'Logging out…' : 'Logout'}
                      </button>
                    : <button type="button" className="old-dd-btn" role="menuitem" onClick={() => { setAcctOpen(false); openAuth() }}>Login / Sign Up</button>}
                </div>
              </div>
            )}
          </div>

          {/* Dark mode toggle — aria-pressed reflects current mode (WCAG 4.1.2) */}
          <button
            type="button"
            className="old-dark-btn"
            title="Toggle dark mode"
            aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            aria-pressed={isDark}
            onClick={() => {
              document.documentElement.classList.toggle('dark')
              setIsDark(d => !d)
            }}
          ><span aria-hidden="true">🌙</span></button>

          {/* Cart — aria-label includes count so SR announces "Open cart, 3 items" (WCAG 4.1.2) */}
          <button
            type="button"
            onClick={openCart}
            aria-label={mounted && cartCount > 0
              ? `Open cart, ${cartCount} item${cartCount > 1 ? 's' : ''}`
              : 'Open cart'}
            className="old-cart-btn"
          >
            <span aria-hidden="true">🛒</span> Cart
            {mounted && cartCount > 0 && (
              // aria-hidden: count already conveyed in button aria-label above
              <span className="old-cbadge" aria-hidden="true">{cartCount > 9 ? '9+' : cartCount}</span>
            )}
          </button>

          {/* Mobile menu */}
          <button type="button" onClick={openMobileMenu} aria-label="Open menu" className="old-nib old-mob-btn">
            <svg width="22" height="22" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
            </svg>
          </button>
        </div>
      </nav>

      <style>{`
        /* ── Old-site nav styles ── */
        .old-nav{
          background:#fff;padding:0 32px;border-bottom:1px solid rgba(26,58,30,.12);
          display:flex;align-items:center;justify-content:space-between;
          height:64px;position:relative;transition:box-shadow .2s;
        }
        .old-nav.scrolled{box-shadow:0 4px 20px rgba(0,0,0,.08)}
        /* Homepage-only fixed overlay nav (see overlayNav in Header.tsx).
           Only background/text-colour transition — position never
           changes — so scrolling past the hero never causes a layout
           jump, just a smooth colour fade from transparent to solid. */
        .old-nav.overlay-nav{ transition: background-color .3s ease, border-color .3s ease, box-shadow .3s ease, backdrop-filter .3s ease; }
        .old-nav.overlay-nav-transparent{
          background:transparent; border-bottom-color:transparent; box-shadow:none;
        }
        /* BUG FIX (requested): once scrolled, this used to jump straight to
           flat solid #fff (inherited from the base .old-nav rule) — a hard,
           jarring "white slab" snap. Reference sites (e.g. mypahadidukan.com)
           never show that abrupt flat-white transition; their nav stays
           visually consistent throughout. Frosted glass (translucent white +
           blur) reads the same as solid white to users at a glance — text
           stays legible — but never presents as a harsh flat rectangle
           appearing out of nowhere, and it still transitions smoothly from
           the fully-transparent state instead of snapping. */
        .old-nav.overlay-nav.scrolled{
          background:rgba(255,255,255,.72);
          backdrop-filter:blur(14px) saturate(160%);
          -webkit-backdrop-filter:blur(14px) saturate(160%);
          border-bottom-color:rgba(26,58,30,.1);
        }
        .old-nav.overlay-nav-transparent .old-logo-tl,
        .old-nav.overlay-nav-transparent .old-nav-links li a,
        .old-nav.overlay-nav-transparent .old-nav-links li button,
        .old-nav.overlay-nav-transparent .old-nib,
        .old-nav.overlay-nav-transparent .old-dark-btn{
          color:#fff; text-shadow:0 1px 3px rgba(0,0,0,.55);
        }
        .old-nav.overlay-nav-transparent .old-nav-links li a:hover,
        .old-nav.overlay-nav-transparent .old-nav-links li button:hover,
        .old-nav.overlay-nav-transparent .old-nib:hover,
        .old-nav.overlay-nav-transparent .old-dark-btn:hover{
          color:#fff; background:rgba(255,255,255,.18);
        }
        /* MegaMenu's own trigger styling lives in globals.css with
           !important rules — matching specificity + !important here so
           this override actually wins instead of losing silently. */
        .old-nav.overlay-nav-transparent .mega-trigger{ color:#fff !important; text-shadow:0 1px 3px rgba(0,0,0,.55) !important; }
        .old-nav.overlay-nav-transparent .mega-trigger:hover,
        .old-nav.overlay-nav-transparent .mega-parent.open .mega-trigger{
          color:#fff !important; background:rgba(255,255,255,.18) !important;
        }
        /* BUG FIX (requested): this used to force the logo to a flat
           white silhouette (brightness(0) invert(1)) over the hero —
           the client's actual brand mark is two-tone (dark green +
           gold, see public/logo-full.png), and that color is what
           should show, not a monochrome substitute.

           BUG FIX (requested, round 2): the first attempt at fixing
           that used a strong white glow (0.85 alpha, 6px+3px blur) to
           help the colour version stand out against photos. That was
           too strong in the other direction — against the hero's
           brighter/lighter slides (snow, sky) it washed the whole logo
           out to a pale, low-contrast blur, and at the small size the
           fine cursive "by Pahadi Roots" script renders at, a 6px blur
           radius is wider than the strokes themselves, so it smeared
           the script into the glow instead of just outlining it —
           reported as "by Pahadi Roots is not visible". A dark shadow
           instead of a light glow reads correctly against both bright
           and dark photo backgrounds (dark backgrounds already have
           contrast; the shadow mainly helps on bright ones), and a
           much smaller, tighter blur radius stays inside the letter
           strokes instead of bleeding across them. */
        .old-nav.overlay-nav-transparent .old-logo img{
          filter:
            drop-shadow(0 1px 2px rgba(0,0,0,.45))
            drop-shadow(0 0 5px rgba(0,0,0,.25));
        }
        .old-nav.overlay-nav-transparent .old-cart-btn{
          background:rgba(255,255,255,.16); border:1px solid rgba(255,255,255,.5); backdrop-filter:blur(6px);
        }
        .old-nav.overlay-nav-transparent .old-cart-btn:hover{ background:rgba(255,255,255,.3); color:#fff; }
        .old-logo{display:flex;align-items:center;text-decoration:none;flex-shrink:0}
        /* BUG FIX (P2): #c8920a on white computes to ~2.77:1 contrast —
           fails WCAG AA's 4.5:1 requirement for text this small (9px).
           Verified by computing actual relative luminance (not eyeballed).
           #8a6508 is the same gold hue, darkened, at a verified 5.32:1. */
        .old-logo-divider{width:1px;height:26px;background:#c9a44c;opacity:.5}
        .old-logo-tl{font-size:9px;color:#8a6508;font-weight:800;letter-spacing:1px;text-transform:uppercase;line-height:1.4;text-align:left}
        .old-nav-links{display:flex;gap:0;list-style:none;margin:0;padding:0;align-items:center;height:64px;}
        .old-nav-links li{height:64px;display:flex;align-items:center;}
        .old-nav-links li a,.old-nav-links li button{
          color:#2a2a2a;text-decoration:none;font-size:13.5px;
          font-weight:600;padding:0 14px;height:64px;display:flex;align-items:center;
          transition:color .2s,background .2s;border:none;background:none;cursor:pointer;
          font-family:inherit;white-space:nowrap;
        }
        .old-nav-links li a:hover,.old-nav-links li button:hover{color:#1a3a1e;background:rgba(26,58,30,.04)}
        .old-nav-links li a.active-nav{color:#1a3a1e}
        .old-nav-right{display:flex;align-items:center;gap:2px;flex-shrink:0}
        .old-nib{
          width:38px;height:38px;border-radius:50%;border:none;
          background:transparent;color:#555;font-size:18px;
          cursor:pointer;display:flex;align-items:center;justify-content:center;
          transition:background .2s,color .2s;text-decoration:none;position:relative;
        }
        .old-nib:hover{background:rgba(26,58,30,.06);color:#1a3a1e}
        .old-acct-av{
          width:28px;height:28px;border-radius:50%;
          background:#c8920a;color:#fff;font-size:12px;font-weight:900;
          display:flex;align-items:center;justify-content:center;font-family:'Playfair Display',serif;
        }
        .old-acct-dot{
          position:absolute;top:5px;right:4px;
          width:7px;height:7px;background:#4caf50;border-radius:50%;border:1.5px solid #fff;
        }
        .old-wl-badge{
          position:absolute;top:2px;right:2px;
          background:#c0392b;color:#fff;border-radius:50%;
          width:16px;height:16px;font-size:9px;font-weight:900;
          display:flex;align-items:center;justify-content:center;border:1.5px solid #fff;
        }
        .old-dark-btn{
          background:transparent;border:none;color:#888;
          font-size:17px;cursor:pointer;padding:8px;border-radius:8px;
          transition:all .2s;
        }
        .old-dark-btn:hover{background:rgba(26,58,30,.06);color:#1a3a1e}
        .old-cart-btn{
          display:flex;align-items:center;gap:7px;
          background:#c8920a;color:#fff;border:none;border-radius:24px;
          padding:8px 16px;font-size:13px;font-weight:800;cursor:pointer;
          font-family:inherit;transition:background .2s;white-space:nowrap;
          margin-left:4px;
        }
        .old-cart-btn:hover{background:#e8b050;color:#1a1a1a}
        .old-cbadge{
          background:#fff;color:#1a3a1e;border-radius:50%;
          width:18px;height:18px;font-size:10px;font-weight:900;
          display:flex;align-items:center;justify-content:center;
        }
        /* Account dropdown */
        .old-acct-dd{
          position:absolute;top:100%;right:0;width:220px;
          background:#fff;border-radius:14px;
          box-shadow:0 8px 32px rgba(0,0,0,.18);
          border:1px solid #f0f0f0;z-index:9999;overflow:hidden;padding:8px 0;
        }
        .old-dd-head{padding:12px 16px;border-bottom:1px solid #f5f5f5}
        .old-dd-name{font-size:13px;font-weight:800;color:#1a3a1e}
        .old-dd-sub{font-size:11px;color:#888;margin-top:2px}
        .old-dd-item{
          padding:11px 16px;font-size:13px;color:#333;cursor:pointer;
          display:flex;align-items:center;gap:10px;text-decoration:none;
          transition:background .15s;
        }
        .old-dd-item:hover{background:#f9f9f9}
        .old-dd-foot{padding:8px 16px;border-top:1px solid #f5f5f5}
        .old-dd-btn{
          width:100%;padding:9px;background:#1a3a1e;color:#fff;
          border:none;border-radius:8px;font-size:13px;font-weight:700;
          cursor:pointer;font-family:inherit;text-align:center;
          text-decoration:none;display:block;
        }
        .old-dd-btn:disabled{opacity:.6;cursor:not-allowed}
        .old-mob-btn{display:none!important}
        @media(max-width:900px){
          .old-nav-links{display:none!important}
          .old-mob-btn{display:flex!important}
        }
        @media(max-width:520px){
          .old-nav{padding:0 12px}
          .old-cart-btn span:first-child{display:none}
          .old-logo-tl{font-size:8px}
        }
        .old-skip-link{
          position:absolute;left:-9999px;top:4px;z-index:9999;
          background:#1a3a1e;color:#fff;padding:8px 16px;
          font-size:13px;font-weight:700;border-radius:0 0 6px 0;
          text-decoration:none;
        }
        .old-skip-link:focus{left:4px}
      `}</style>
    </div>
    </>
  )
}
