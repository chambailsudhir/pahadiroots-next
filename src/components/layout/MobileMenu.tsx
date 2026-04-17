'use client'

import { useEffect, useRef } from 'react'
import Link from 'next/link'
import { useUIStore } from '@/store/uiStore'
import type { SiteSettings, Category, State } from '@/types'
import { isEnabled } from '@/lib/getSiteSettings'

interface Props {
  settings:   SiteSettings
  categories?: Category[]
  states?:     State[]
}

export default function MobileMenu({ settings, categories = [], states = [] }: Props) {
  const isMobileMenuOpen = useUIStore(s => s.isMobileMenuOpen)
  const closeMobileMenu  = useUIStore(s => s.closeMobileMenu)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeMobileMenu()
    if (isMobileMenuOpen) document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [isMobileMenuOpen, closeMobileMenu])

  useEffect(() => {
    document.body.style.overflow = isMobileMenuOpen ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [isMobileMenuOpen])

  const showTrack    = isEnabled(settings.show_track_order_page)
  const showWishlist = isEnabled(settings.show_wishlist)
  const showBlog     = settings.show_blog !== 'false'

  return (
    <>
      {/* Overlay */}
      {isMobileMenuOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={closeMobileMenu}
          aria-hidden="true"
        />
      )}

      {/* Drawer */}
      <div
        ref={menuRef}
        role="dialog"
        aria-label="Navigation menu"
        aria-modal="true"
        className={`fixed top-0 left-0 h-full w-80 max-w-[85vw] bg-white z-50 flex flex-col shadow-2xl transition-transform duration-300 lg:hidden ${
          isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-stone-100">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 bg-forest-700 rounded-lg flex items-center justify-center">
              <span className="text-white font-bold text-xs">PR</span>
            </div>
            <span className="text-sm font-bold text-forest-900">Pahadi Roots</span>
          </div>
          <button
            onClick={closeMobileMenu}
            aria-label="Close menu"
            className="p-2 rounded-lg text-stone-400 hover:bg-stone-50"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Nav content */}
        <div className="flex-1 overflow-y-auto py-4">

          {/* Primary links */}
          <div className="px-3 space-y-0.5 mb-4">
            {[
              { href: '/',                        label: 'Home',         icon: '🏠' },
              { href: '/collections/best-sellers', label: 'Best Sellers', icon: '🔥' },
              { href: '/products',                label: 'All Products', icon: '🌿' },
              { href: '/about',                   label: 'Our Story',    icon: '📖' },
              ...(showBlog     ? [{ href: '/blog',    label: 'Blog',         icon: '✍️' }] : []),
              ...(showTrack    ? [{ href: '/track',   label: 'Track Order',  icon: '📦' }] : []),
              ...(showWishlist ? [{ href: '/wishlist',label: 'Wishlist',     icon: '❤️' }] : []),
              { href: '/account',                 label: 'My Account',   icon: '👤' },
              { href: '/contact',                 label: 'Contact',      icon: '💬' },
            ].map(item => (
              <Link
                key={item.href}
                href={item.href}
                onClick={closeMobileMenu}
                className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-stone-700 hover:bg-stone-50 hover:text-forest-700 transition-colors"
              >
                <span className="text-base w-5 text-center">{item.icon}</span>
                {item.label}
              </Link>
            ))}
          </div>

          {/* Categories */}
          {categories.length > 0 && (
            <div className="mx-3 mb-4">
              <div className="text-[10px] font-bold uppercase tracking-widest text-stone-400 px-3 mb-2">
                Shop by Category
              </div>
              <div className="space-y-0.5">
                {categories.filter(c => c.is_active).map(cat => (
                  <Link
                    key={cat.id}
                    href={`/collections/${cat.slug}`}
                    onClick={closeMobileMenu}
                    className="flex items-center px-3 py-2 rounded-xl text-sm text-stone-600 hover:bg-stone-50 hover:text-forest-700 transition-colors"
                  >
                    {cat.name}
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* Regions */}
          {states.length > 0 && (
            <div className="mx-3 mb-4">
              <div className="text-[10px] font-bold uppercase tracking-widest text-stone-400 px-3 mb-2">
                Shop by Region
              </div>
              <div className="space-y-0.5">
                {states.slice(0, 8).map(state => (
                  <Link
                    key={state.id}
                    href={`/regions/${state.slug}`}
                    onClick={closeMobileMenu}
                    className="flex items-center px-3 py-2 rounded-xl text-sm text-stone-600 hover:bg-stone-50 hover:text-forest-700 transition-colors"
                  >
                    {state.name}
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-stone-100 px-5 py-4">
          {settings.whatsapp_number && (
            <a
              href={`https://wa.me/${settings.whatsapp_number.replace(/\D/g, '')}?text=Hi, I need help`}
              target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-3 text-sm font-semibold text-green-700 hover:text-green-900 transition-colors"
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a12.8 12.8 0 00-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
              </svg>
              WhatsApp Support
            </a>
          )}
          <p className="text-[10px] text-stone-400 mt-2">© {new Date().getFullYear()} Pahadi Roots</p>
        </div>
      </div>
    </>
  )
}
