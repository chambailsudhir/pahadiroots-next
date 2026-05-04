'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useCartStore } from '@/store/cartStore'
import { useUIStore } from '@/store/uiStore'
import { useUserStore } from '@/store/userStore'
import type { SiteSettings, Category, State } from '@/types'
import { isEnabled } from '@/lib/getSiteSettings'
import MegaMenu from './MegaMenu'
import AnnouncementBar from './AnnouncementBar'
import TickerBar from './TickerBar'

interface Props {
  settings:   SiteSettings
  categories?: Category[]
  states?:     State[]
}

export default function Header({ settings, categories = [], states = [] }: Props) {
  const cartCount  = useCartStore(s => s.cartCount)()
  const wishlist   = useUserStore(s => s.wishlist)
  const user       = useUserStore(s => s.user)
  const { openCart, openSearch, openMobileMenu } = useUIStore()

  const [scrolled, setScrolled] = useState(false)
  const [acctOpen, setAcctOpen] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 60)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const showWishlist = isEnabled(settings.show_wishlist)
  const showTrack    = isEnabled(settings.show_track_order_page)
  const siteName     = settings.site_name || '5 Pahadi Roots'
  const logoUrl      = settings.logo_url || ''
  const freeShipMin  = settings.free_shipping_min || '0'

  const firstName = user?.name?.split(' ')[0] || ''
  const initials  = firstName ? firstName[0].toUpperCase() : ''

  return (
    <div className="sticky top-0 z-30">
      <AnnouncementBar settings={settings} />
      <TickerBar settings={settings} />

      <nav className={`old-nav${scrolled ? ' scrolled' : ''}`}>
        {/* Logo */}
        <Link href="/" className="old-logo">
          <div className="old-logo-icon">
            {logoUrl
              ? <img src={logoUrl} alt={siteName} style={{ height: '40px', width: '40px', objectFit: 'contain' }} />
              : <span style={{ fontSize: '28px' }}>🌿</span>}
          </div>
          <div className="old-logo-words">
            <div className="old-logo-name">{siteName}</div>
            <div className="old-logo-tl">Himalayan Natural Store</div>
          </div>
        </Link>

        {/* Desktop nav links */}
        <ul className="old-nav-links">
          <li><Link href="/">Home</Link></li>
          <li><Link href="/about">Our Story</Link></li>
          <li><MegaMenu categories={categories} states={states} /></li>
          {showTrack && <li><Link href="/track">Track Order</Link></li>}
          <li><Link href="/payment">Payment</Link></li>
          <li><Link href="/contact">Contact</Link></li>
        </ul>

        {/* Right actions */}
        <div className="old-nav-right">
          {/* Search */}
          <button onClick={openSearch} aria-label="Search" className="old-nib" title="Search products">🔍</button>

          {/* Wishlist */}
          {showWishlist && (
            <Link href="/wishlist" aria-label="Wishlist" className="old-nib" style={{ position: 'relative' }}>
              ❤️
              {wishlist.length > 0 && (
                <span className="old-wl-badge">{wishlist.length > 9 ? '9+' : wishlist.length}</span>
              )}
            </Link>
          )}

          {/* Account with hover dropdown */}
          <div
            style={{ position: 'relative' }}
            onMouseEnter={() => setAcctOpen(true)}
            onMouseLeave={() => setAcctOpen(false)}
          >
            <Link href="/account" className="old-nib" aria-label="My Account" style={{ position: 'relative' }}>
              {user && initials
                ? <span className="old-acct-av">{initials}</span>
                : <span>👤</span>}
              {user && <span className="old-acct-dot" />}
            </Link>

            {acctOpen && (
              <div className="old-acct-dd">
                <div className="old-dd-head">
                  {user
                    ? <><div className="old-dd-name">Hi, {firstName}!</div><div className="old-dd-sub">{user.email || ''}</div></>
                    : <><div className="old-dd-name">Welcome!</div><div className="old-dd-sub">Login to manage your account</div></>}
                </div>
                <Link href="/account" className="old-dd-item" onClick={() => setAcctOpen(false)}>
                  <span>📦</span> My Orders
                </Link>
                <Link href="/wishlist" className="old-dd-item" onClick={() => setAcctOpen(false)}>
                  <span>🤍</span> Wishlist
                </Link>
                <Link href="/account/addresses" className="old-dd-item" onClick={() => setAcctOpen(false)}>
                  <span>👤</span> Profile &amp; Address
                </Link>
                <div className="old-dd-foot">
                  {user
                    ? <Link href="/account" className="old-dd-btn" style={{ background: '#fdecea', color: '#c0392b' }} onClick={() => setAcctOpen(false)}>Logout</Link>
                    : <button className="old-dd-btn" onClick={() => { setAcctOpen(false); window.location.href='/?login=1' }}>Login / Sign Up</button>}
                </div>
              </div>
            )}
          </div>

          {/* Dark mode toggle */}
          <button
            className="old-dark-btn"
            title="Toggle dark mode"
            onClick={() => document.documentElement.classList.toggle('dark')}
          >🌙</button>

          {/* Cart */}
          <button onClick={openCart} aria-label="Cart" className="old-cart-btn">
            🛒 Cart
            {cartCount > 0 && (
              <span className="old-cbadge">{cartCount > 9 ? '9+' : cartCount}</span>
            )}
          </button>

          {/* Mobile menu */}
          <button onClick={openMobileMenu} aria-label="Open menu" className="old-nib old-mob-btn">
            <svg width="22" height="22" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
            </svg>
          </button>
        </div>
      </nav>

      <style>{`
        /* ── Old-site nav styles ── */
        .old-nav{
          background:#1a3a1e;padding:0 24px;
          display:flex;align-items:center;justify-content:space-between;
          height:62px;position:relative;transition:box-shadow .2s;
        }
        .old-nav.scrolled{box-shadow:0 4px 20px rgba(0,0,0,.3)}
        .old-logo{display:flex;align-items:center;gap:10px;text-decoration:none;flex-shrink:0}
        .old-logo-icon{width:44px;height:44px;display:flex;align-items:center;justify-content:center;flex-shrink:0}
        .old-logo-words{}
        .old-logo-name{font-family:'Playfair Display',serif;font-size:17px;font-weight:900;color:#fff;line-height:1.1}
        .old-logo-tl{font-size:9px;color:#c8920a;font-weight:800;letter-spacing:1px;text-transform:uppercase}
        .old-nav-links{display:flex;gap:0;list-style:none;margin:0;padding:0}
        .old-nav-links li a,.old-nav-links li button{
          color:rgba(255,255,255,.75);text-decoration:none;font-size:13px;
          font-weight:600;padding:0 14px;height:62px;display:flex;align-items:center;
          transition:color .2s,background .2s;border:none;background:none;cursor:pointer;
          font-family:inherit;white-space:nowrap;
        }
        .old-nav-links li a:hover,.old-nav-links li button:hover{color:#c8920a;background:rgba(255,255,255,.04)}
        .old-nav-links li a.active-nav{color:#c8920a}
        .old-nav-right{display:flex;align-items:center;gap:2px;flex-shrink:0}
        .old-nib{
          width:38px;height:38px;border-radius:50%;border:none;
          background:transparent;color:rgba(255,255,255,.8);font-size:17px;
          cursor:pointer;display:flex;align-items:center;justify-content:center;
          transition:background .2s,color .2s;text-decoration:none;position:relative;
        }
        .old-nib:hover{background:rgba(255,255,255,.1);color:#fff}
        .old-acct-av{
          width:28px;height:28px;border-radius:50%;
          background:#c8920a;color:#fff;font-size:12px;font-weight:900;
          display:flex;align-items:center;justify-content:center;font-family:'Playfair Display',serif;
        }
        .old-acct-dot{
          position:absolute;top:5px;right:4px;
          width:7px;height:7px;background:#4caf50;border-radius:50%;border:1.5px solid #1a3a1e;
        }
        .old-wl-badge{
          position:absolute;top:2px;right:2px;
          background:#c0392b;color:#fff;border-radius:50%;
          width:16px;height:16px;font-size:9px;font-weight:900;
          display:flex;align-items:center;justify-content:center;border:1.5px solid #1a3a1e;
        }
        .old-dark-btn{
          background:transparent;border:none;color:rgba(255,255,255,.7);
          font-size:17px;cursor:pointer;padding:8px;border-radius:8px;
          transition:all .2s;
        }
        .old-dark-btn:hover{background:rgba(255,255,255,.1);color:#fff}
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
        .old-mob-btn{display:none!important}
        @media(max-width:900px){
          .old-nav-links{display:none!important}
          .old-mob-btn{display:flex!important}
        }
        @media(max-width:520px){
          .old-nav{padding:0 12px}
          .old-cart-btn span:first-child{display:none}
        }
      `}</style>
    </div>
  )
}
