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
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 60)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const showWishlist = isEnabled(settings.show_wishlist)
  const showTrack    = isEnabled(settings.show_track_order_page)

  return (
    <div className="sticky top-0 z-30">
      <AnnouncementBar settings={settings} />
      <TickerBar settings={settings} />

      <nav className={`main-nav${scrolled ? ' shadow' : ''}`}>
        {/* Logo */}
        <Link href="/" className="logo">
          <span className="logo-icon">🌿</span>
          <div>
            <div className="logo-name">{settings.site_name || '5 Pahadi Roots'}</div>
            <div className="logo-tagline">HIMALAYAN NATURALS</div>
          </div>
        </Link>

        {/* Desktop nav links */}
        <ul className="nav-links">
          <li><Link href="/collections/best-sellers">Best Sellers</Link></li>
          <li><MegaMenu categories={categories} states={states} /></li>
          <li><Link href="/about">Our Story</Link></li>
          {settings.show_blog !== 'false' && <li><Link href="/blog">Blog</Link></li>}
          {showTrack && <li><Link href="/track">Track Order</Link></li>}
        </ul>

        {/* Right actions */}
        <div className="nav-right">
          {/* Shipping badge */}
          <div className="ship-badge">
            <span>🚚</span> Free over ₹{settings.free_shipping_min || '799'}
          </div>

          {/* Search */}
          <button onClick={openSearch} aria-label="Search" className="nib" title="Search">
            <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <circle cx="11" cy="11" r="8"/><path strokeLinecap="round" d="m21 21-4.35-4.35"/>
            </svg>
          </button>

          {/* Wishlist */}
          {showWishlist && (
            <Link href="/wishlist" aria-label="Wishlist" className="nib" style={{ display: 'flex' }}>
              <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" />
              </svg>
              {wishlist.length > 0 && <span className="badge show">{wishlist.length > 9 ? '9+' : wishlist.length}</span>}
            </Link>
          )}

          {/* Account */}
          <Link href="/account" aria-label="Account" className="nib" style={{ display: 'flex' }}>
            <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
            </svg>
          </Link>

          {/* Cart */}
          <button onClick={openCart} aria-label="Cart" className="cart-btn">
            <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 0 0-3 3h15.75m-12.75-3h11.218c1.121-2.3 2.1-4.684 2.924-7.138a60.114 60.114 0 0 0-16.536-1.84M7.5 14.25 5.106 5.272M6 20.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Zm12.75 0a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Z" />
            </svg>
            <span>Cart</span>
            {cartCount > 0 && <span className="cbadge">{cartCount > 9 ? '9+' : cartCount}</span>}
          </button>

          {/* Mobile menu button */}
          <button
            onClick={openMobileMenu}
            aria-label="Open menu"
            className="nib"
            style={{ display: 'none' }}
            id="mob-menu-btn"
          >
            <svg width="22" height="22" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
            </svg>
          </button>
        </div>
      </nav>

      <style>{`
        @media(max-width:820px) {
          .nav-links { display: none !important; }
          #mob-menu-btn { display: flex !important; }
        }
        @media(max-width:520px) {
          .ship-badge { display: none !important; }
        }
      `}</style>
    </div>
  )
}
