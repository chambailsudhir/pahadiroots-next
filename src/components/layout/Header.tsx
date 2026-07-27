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
    // yet, viewport metrics not fully settled right after navigation,
    // etc. can all shift layout right after hydration). If that first
    // getBoundingClientRect() read landed during such a moment, the
    // hero's box could transiently measure shorter than its real 82vh —
    // occasionally short enough for `bottom` to already read at/under
    // topBarHeightRef, incorrectly setting heroPast=true right out of
    // the gate, with scrollY still genuinely at 0 and the full hero
    // visible on screen. Nothing then corrected it: with no scroll or
    // resize event, the effect never re-ran to re-measure.
    //
    // BUG FIX 3 (this stayed stuck white even after fix 2, confirmed on
    // video where the hero photo had clearly finished loading below an
    // still-solid nav): the previous attempt added a `window.load`
    // listener as a safety net, but `load` fires exactly once — if it
    // had already fired before this effect got a chance to attach its
    // listener (very plausible; hydration can lag behind resource
    // loading on a fast connection), that listener would simply never
    // fire again for the rest of the page's life, so the bad initial
    // reading was never corrected. Replacing it with a handful of
    // delayed re-checks (not tied to any one-shot browser event) keeps
    // re-verifying for about a second after mount regardless of exactly
    // when layout actually settles, and a ResizeObserver on the hero
    // element itself re-verifies any time its own box genuinely changes
    // size thereafter.
    //
    // BUG FIX 4 (the actual root cause of the recurring "white nav on
    // hard refresh" reports): diagnostic logging eventually proved
    // heroPast was being computed correctly (false) every single time
    // this white-nav symptom was captured — the bug was never in this
    // effect's JS logic at all. It was that all of Header's CSS used to
    // live in a plain `<style>` tag rendered inline in the JSX (further
    // down this file, after the <nav> in DOM order), not a real
    // stylesheet loaded via <head> — so there was a genuine race on a
    // fresh hard refresh between the browser painting <nav> and it
    // finishing parsing that trailing <style> block. If paint won even
    // once, <nav> rendered with none of these classes' rules applied
    // yet, including the .overlay-nav-transparent background override,
    // which is how a nav React had already correctly marked
    // "transparent" could still render solid white for a frame. That
    // CSS now lives in globals.css, loaded normally via <head>, which
    // the browser guarantees is ready before painting anything that
    // depends on it — no such race is possible anymore.
    let ticking = false
    const update = () => {
      const rect = el.getBoundingClientRect()
      // Guard against any reading well below the hero's real minimum
      // height (540px, see HeroBanner.tsx) rather than only an exact
      // zero — a transient layout-not-settled reading during load could
      // land on some small-but-nonzero value too, not just exactly 0.
      if (rect.height > 200) setHeroPast(rect.bottom <= topBarHeightRef.current)
      ticking = false
    }
    const onScrollOrResize = () => {
      if (ticking) return
      ticking = true
      requestAnimationFrame(update)
    }
    update()
    const retryTimers = [50, 150, 400, 800, 1500].map(ms => window.setTimeout(update, ms))
    window.addEventListener('scroll', onScrollOrResize, { passive: true })
    window.addEventListener('resize', onScrollOrResize)
    let ro: ResizeObserver | undefined
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(update)
      ro.observe(el)
    }
    return () => {
      retryTimers.forEach(clearTimeout)
      window.removeEventListener('scroll', onScrollOrResize)
      window.removeEventListener('resize', onScrollOrResize)
      ro?.disconnect()
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
    </div>
    </>
  )
}
