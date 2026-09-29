'use client'

import { useEffect, useRef, useState } from 'react'
import { catSlug } from '@/lib/utils'
import Link from 'next/link'
import { useUIStore } from '@/store/uiStore'
import type { SiteSettings, Category, State } from '@/types'
import { isEnabled } from '@/lib/siteSettingsHelpers'

interface Props {
  settings:    SiteSettings
  categories?: Category[]
  states?:     State[]
}

export default function MobileMenu({ settings, categories = [], states = [] }: Props) {
  const isMobileMenuOpen = useUIStore(s => s.isMobileMenuOpen)
  const closeMobileMenu  = useUIStore(s => s.closeMobileMenu)
  const panelRef  = useRef<HTMLDivElement>(null)
  const closeRef  = useRef<HTMLButtonElement>(null)
  // WCAG 2.1 §3.2 — focus must return to whatever opened the dialog once
  // it closes.
  const openerRef = useRef<HTMLElement | null>(null)

  // BUG FIX (mobile header overflow, continued): Header.tsx's dark-mode
  // toggle is now hidden at the same ≤900px breakpoint as the other
  // overflow-causing icons (see globals.css/Header.tsx) — even after
  // trimming Search/Cart/hamburger, Wishlist + Account + this toggle still
  // didn't leave enough room next to the logo on a real phone width (the
  // toggle was the one getting clipped this time). Rather than dropping
  // the feature on mobile, it moves in here, same class of fix as Search/
  // Cart/hamburger already being covered by MobileBottomNav. Same mount-
  // guard pattern as Header.tsx's own toggle — reading document.documentElement
  // during render (before mount) would cause a hydration mismatch (React
  // errors #418/#423/#425), so `isDark` starts false and syncs in an effect.
  const [isDark, setIsDark] = useState(false)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsDark(document.documentElement.classList.contains('dark'))
  }, [])

  // BUG FIX (P2): this declared role="dialog" aria-modal="true" but
  // implemented none of the behavior that contract promises — no initial
  // focus, no Tab focus-trap, no focus-restore on close. CartDrawer.tsx
  // already has the correct version of this exact pattern (same
  // aria-modal contract) — ported directly from there instead of
  // reinventing it, so both dialogs behave consistently.
  useEffect(() => {
    let focusTimer: ReturnType<typeof setTimeout> | null = null
    const FOCUSABLE = 'a[href],button:not([disabled]),input,select,textarea,[tabindex]:not([tabindex="-1"])'

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { closeMobileMenu(); return }
      if (e.key === 'Tab' && panelRef.current) {
        const els = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE))
        if (!els.length) return
        const first = els[0], last = els[els.length - 1]
        if (e.shiftKey) {
          if (document.activeElement === first) { e.preventDefault(); last.focus() }
        } else {
          if (document.activeElement === last) { e.preventDefault(); first.focus() }
        }
      }
    }

    if (isMobileMenuOpen) {
      openerRef.current = document.activeElement as HTMLElement
      document.addEventListener('keydown', onKey)
      focusTimer = setTimeout(() => closeRef.current?.focus(), 50)
    } else {
      if (openerRef.current && typeof openerRef.current.focus === 'function') {
        openerRef.current.focus()
        openerRef.current = null
      }
    }

    return () => {
      document.removeEventListener('keydown', onKey)
      if (focusTimer !== null) clearTimeout(focusTimer)
    }
  }, [isMobileMenuOpen, closeMobileMenu])

  useEffect(() => {
    document.body.style.overflow = isMobileMenuOpen ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [isMobileMenuOpen])

  const showTrack    = isEnabled(settings.show_track_order_page)
  const showWishlist = isEnabled(settings.show_wishlist)
  const showBlog     = settings.show_blog !== 'false'
  const showAbout    = settings.about_page_enabled !== 'false'

  const navLinks = [
    { href: '/',                         label: 'Home',        icon: '🏡' },
    // BUG FIX: '/collections/best-sellers' 404s (not a real category slug) —
    // same fix as MegaMenu.tsx, points at the working 'popular' sort instead.
    { href: '/products?sort=popular',    label: 'Best Sellers',icon: '⭐' },
    // BUG FIX: mobile menu had no New Arrivals entry at all, unlike the
    // desktop MegaMenu's CURATED list — added for parity.
    { href: '/new-arrivals',             label: 'New Arrivals', icon: '🆕' },
    { href: '/products',                 label: 'All Products', icon: '🌿' },
    ...(showAbout    ? [{ href: '/our-stories', label: 'Our Story',   icon: '📖' }] : []),
    ...(showBlog     ? [{ href: '/blog',     label: 'Blog',        icon: '✍️' }] : []),
    ...(showTrack    ? [{ href: '/track',    label: 'Track Order', icon: '📦' }] : []),
    ...(showWishlist ? [{ href: '/wishlist', label: 'Wishlist',    icon: '❤️' }] : []),
    { href: '/account',                  label: 'My Account',   icon: '👤' },
    { href: '/contact',                  label: 'Contact',      icon: '💬' },
  ]

  return (
    <div className={`mob-nav${isMobileMenuOpen ? ' open' : ''}`} role="dialog" aria-modal="true">
      <div className="mob-nav-bg" onClick={closeMobileMenu} aria-hidden="true" />
      <div className="mob-nav-panel" ref={panelRef}>
        <button ref={closeRef} className="mob-close" onClick={closeMobileMenu} aria-label="Close menu">✕</button>
        <div className="mob-nav-logo">🌿 {settings.site_name || 'HimVeda by Pahadi Roots'}</div>

        {/* Dark mode toggle — moved here from the header (see the effect
            above for why); same aria-pressed contract as Header.tsx's
            original button (WCAG 4.1.2). */}
        <button
          type="button"
          className="mob-dark-toggle"
          aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
          aria-pressed={isDark}
          onClick={() => {
            document.documentElement.classList.toggle('dark')
            setIsDark(d => !d)
          }}
        >
          <span aria-hidden="true">{isDark ? '☀️' : '🌙'}</span>
          {isDark ? 'Light Mode' : 'Dark Mode'}
        </button>

        {/* Primary links */}
        {navLinks.map(item => (
          <Link key={item.href} href={item.href} onClick={closeMobileMenu}>
            <span style={{ marginRight: 8 }}>{item.icon}</span>{item.label}
          </Link>
        ))}

        {/* Categories */}
        {categories.length > 0 && (
          <>
            <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 2, color: 'var(--gd)', textTransform: 'uppercase', padding: '16px 14px 6px' }}>
              By Category
            </div>
            {categories.filter(c => c.is_active).map(cat => (
              <Link key={cat.id} href={`/collections/${catSlug(cat)}`} onClick={closeMobileMenu}>
                {cat.name}
              </Link>
            ))}
          </>
        )}

        {/* Regions */}
        {states.length > 0 && (
          <>
            <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 2, color: 'var(--gd)', textTransform: 'uppercase', padding: '16px 14px 6px' }}>
              By Region
            </div>
            {states.slice(0, 8).map(s => (
              <Link key={s.id} href={`/regions/${s.slug}`} onClick={closeMobileMenu}>
                🏔️ {s.name}
              </Link>
            ))}
            {states.length > 8 && (
              <Link href="/regions" onClick={closeMobileMenu} style={{ fontWeight: 800, color: 'var(--gd)' }}>
                View All Regions →
              </Link>
            )}
          </>
        )}

        {/* WhatsApp CTA */}
        {settings.whatsapp_number && (
          <a
            href={`https://wa.me/${settings.whatsapp_number.replace(/\D/g, '')}?text=${encodeURIComponent('Hi, I need help')}`}
            target="_blank" rel="noopener noreferrer"
            style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '20px 0 0', background: '#25D366', color: '#fff', fontWeight: 800, fontSize: 13, padding: '10px 14px', borderRadius: 10 }}
          >
            <svg width="16" height="16" fill="currentColor" viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
            WhatsApp Support
          </a>
        )}

        <p style={{ fontSize: 11, color: 'var(--tx3)', marginTop: 16 }}>© {new Date().getFullYear()} HimVeda by Pahadi Roots</p>
      </div>
    </div>
  )
}
