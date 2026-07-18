'use client'

import Link from 'next/link'
import Image from 'next/image'
import { useEffect, useState } from 'react'
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
    const onScroll = () => setScrolled(window.scrollY > 60)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

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
      <AnnouncementBar settings={settings} />
      <TickerBar settings={settings} />

      <nav className={`old-nav${scrolled ? ' scrolled' : ''}`}>
        {/* Logo */}
        <Link href="/" className="old-logo">
          <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '10px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
              {logoUrl
                ? <Image src={logoUrl} alt={siteName} width={160} height={48} style={{ height: '48px', width: 'auto', objectFit: 'contain' }} />
                : <Image src="/logo-header.png" alt={siteName} width={123} height={34} style={{ height: '34px', width: 'auto', objectFit: 'contain' }} priority />}
              {!logoUrl && <Image src="/by-pahadi-roots.png" alt="by Pahadi Roots" width={133} height={22} style={{ height: '22px', width: 'auto', objectFit: 'contain', marginTop: '1px' }} />}
            </div>
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
