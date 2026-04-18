'use client'

import Link from 'next/link'
import Image from 'next/image'
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
  const cartCount      = useCartStore(s => s.cartCount)()
  const wishlist       = useUserStore(s => s.wishlist)
  const user           = useUserStore(s => s.user)
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
      {/* Announcement bar */}
      <AnnouncementBar settings={settings} />

      {/* Ticker bar */}
      <TickerBar settings={settings} />

      {/* Main header */}
      <header
        className={`bg-white transition-shadow duration-200 ${
          scrolled ? 'shadow-md' : 'border-b border-stone-100'
        }`}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">

            {/* Logo */}
            <Link href="/" className="flex items-center gap-2.5 shrink-0">
              <div className="w-8 h-8 bg-forest-700 rounded-lg flex items-center justify-center">
                <span className="text-white font-bold text-sm">PR</span>
              </div>
              <div className="hidden sm:block">
                <div className="text-sm font-bold text-forest-900 leading-none">Pahadi Roots</div>
                <div className="text-[10px] text-stone-500 leading-none mt-0.5">Natural Himalayan Products</div>
              </div>
            </Link>

            {/* Desktop nav */}
            <nav className="hidden lg:flex items-center gap-7">
              <Link
                href="/collections/best-sellers"
                className="text-sm font-semibold text-earth-600 hover:text-earth-800 transition-colors"
              >
                Best Sellers
              </Link>
              <MegaMenu categories={categories} states={states} />
              <Link
                href="/about"
                className="text-sm font-medium text-stone-600 hover:text-forest-700 transition-colors"
              >
                Our Story
              </Link>
              {settings.show_blog !== 'false' && (
                <Link
                  href="/blog"
                  className="text-sm font-medium text-stone-600 hover:text-forest-700 transition-colors"
                >
                  Blog
                </Link>
              )}
              {showTrack && (
                <Link
                  href="/track"
                  className="text-sm font-medium text-stone-600 hover:text-forest-700 transition-colors"
                >
                  Track Order
                </Link>
              )}
            </nav>

            {/* Right actions */}
            <div className="flex items-center gap-1 sm:gap-2">

              {/* Search */}
              <button
                onClick={openSearch}
                aria-label="Search"
                className="p-2 rounded-lg text-stone-500 hover:text-forest-700 hover:bg-stone-50 transition-colors"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
                </svg>
              </button>

              {/* Wishlist */}
              {showWishlist && (
                <Link
                  href="/wishlist"
                  aria-label={`Wishlist (${wishlist.length})`}
                  className="relative p-2 rounded-lg text-stone-500 hover:text-forest-700 hover:bg-stone-50 transition-colors hidden sm:flex"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" />
                  </svg>
                  {wishlist.length > 0 && (
                    <span className="absolute top-1 right-1 w-4 h-4 bg-earth-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center">
                      {wishlist.length > 9 ? '9+' : wishlist.length}
                    </span>
                  )}
                </Link>
              )}

              {/* Account */}
              <Link
                href={user ? '/account' : '/account'}
                aria-label="My Account"
                className="p-2 rounded-lg text-stone-500 hover:text-forest-700 hover:bg-stone-50 transition-colors hidden sm:flex"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
                </svg>
              </Link>

              {/* Cart */}
              <button
                onClick={openCart}
                aria-label={`Cart (${cartCount} items)`}
                className="relative flex items-center gap-2 bg-forest-700 hover:bg-forest-800 text-white pl-3 pr-4 py-2 rounded-xl text-sm font-semibold transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 00-3 3h15.75m-12.75-3h11.218c1.121-2.3 2.1-4.684 2.924-7.138a60.114 60.114 0 00-16.536-1.84M7.5 14.25L5.106 5.272M6 20.25a.75.75 0 11-1.5 0 .75.75 0 011.5 0zm12.75 0a.75.75 0 11-1.5 0 .75.75 0 011.5 0z" />
                </svg>
                <span className="hidden xs:inline">Cart</span>
                {cartCount > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-earth-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                    {cartCount > 9 ? '9+' : cartCount}
                  </span>
                )}
              </button>

              {/* Mobile menu */}
              <button
                onClick={openMobileMenu}
                aria-label="Open menu"
                className="lg:hidden p-2 rounded-lg text-stone-500 hover:bg-stone-50 transition-colors ml-1"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
                </svg>
              </button>

            </div>
          </div>
        </div>
      </header>
    </div>
  )
}
