'use client'

// Mobile bottom navigation + floating scroll-to-top button.
//
// Built to match the "app shell" pattern large mobile-web storefronts
// (Amazon, Myntra) use: a fixed, always-reachable action bar so a user
// mid-scroll never has to hunt back up to the header for cart/search/menu.
//
// Two deliberate choices for correctness/perf:
//  1. Reuses the SAME useUIStore actions Header.tsx already calls
//     (openCart/openSearch/openMobileMenu) — one source of truth for
//     panel state, no risk of the header and this bar disagreeing.
//  2. The scroll-to-top button is driven by IntersectionObserver against
//     a sentinel near the top of the page (rendered in layout.tsx), not a
//     scroll event listener. IntersectionObserver runs off the main
//     thread's scroll path entirely — it doesn't fire on every scroll
//     frame — which is the same technique large sites use to avoid
//     scroll-jank from a naive `window.addEventListener('scroll', ...)`.

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { useCartStore, selectCartCount } from '@/store/cartStore'
import { useUIStore } from '@/store/uiStore'
import type { SiteSettings } from '@/types'

interface Props {
  settings: SiteSettings
}

export default function MobileBottomNav({ settings }: Props) {
  const cartCount = useCartStore(selectCartCount)
  const { openSearch, openCart, openMobileMenu } = useUIStore()
  const pathname = usePathname()

  // Mount guard for the same hydration-mismatch reason as Header.tsx —
  // cartCount is persisted (localStorage), so it must not render before
  // the client has mounted (see Header.tsx's `mounted` for the identical
  // pattern already established in this codebase).
  const [mounted, setMounted] = useState(false)
  const [showTop, setShowTop] = useState(false)

  useEffect(() => {
    // Same client-mount detection as Header.tsx's `mounted` guard — this
    // genuinely can't be known during any render phase, only after the
    // effect phase runs, so there's no render-time-adjustment equivalent.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true)
    const sentinel = document.getElementById('mbn-scroll-sentinel')
    if (!sentinel) return
    const observer = new IntersectionObserver(
      ([entry]) => setShowTop(!entry.isIntersecting),
      // Trigger line sits 300px below the sentinel — button appears once
      // the user has scrolled roughly a screen's worth down.
      { rootMargin: '-300px 0px 0px 0px' }
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [])

  const waNumber = settings.whatsapp_number?.replace(/\D/g, '') || ''

  // BUG FIX (found on re-check): /account already renders its own
  // contextual mobile tab bar (account.module.css .mobTabs — Orders,
  // Wishlist, etc.) and /checkout has its own sticky mobile CTA bar
  // (checkout.css .ck-mob-bar — price + Place Order). Rendering this
  // global bar on top of either would stack two fixed bottom bars on
  // the same screen. Large sites suppress the generic bottom nav on
  // these focused/contextual flows for exactly this reason.
  if (pathname?.startsWith('/account') || pathname?.startsWith('/checkout')) return null

  return (
    <>
      <button
        type="button"
        onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
        className={`stt-btn${showTop ? ' visible' : ''}`}
        aria-label="Scroll to top"
        aria-hidden={!showTop}
        tabIndex={showTop ? 0 : -1}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 19V5m0 0l-6 6m6-6l6 6" />
        </svg>
      </button>

      <nav className="mbn" aria-label="Mobile quick navigation">
        <Link href="/" className="mbn-item">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 9.5L12 3l9 6.5V21a1 1 0 01-1 1h-5v-7H9v7H4a1 1 0 01-1-1V9.5z" />
          </svg>
          Home
        </Link>

        <button type="button" onClick={openSearch} className="mbn-item">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
            <circle cx="11" cy="11" r="7" /><path strokeLinecap="round" d="M21 21l-4.3-4.3" />
          </svg>
          Search
        </button>

        <button
          type="button"
          onClick={openCart}
          className="mbn-item"
          aria-label={mounted && cartCount > 0 ? `Open cart, ${cartCount} item${cartCount > 1 ? 's' : ''}` : 'Open cart'}
        >
          <span style={{ position: 'relative' }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
              <circle cx="9" cy="20" r="1.4" /><circle cx="18" cy="20" r="1.4" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.5 3h2l2.4 12.2a2 2 0 002 1.6h8.2a2 2 0 002-1.6L21 7H6" />
            </svg>
            {mounted && cartCount > 0 && (
              <span className="mbn-badge" aria-hidden="true">{cartCount > 9 ? '9+' : cartCount}</span>
            )}
          </span>
          Cart
        </button>

        {waNumber && (
          <a
            href={`https://wa.me/${waNumber}?text=${encodeURIComponent('Hi, I need help')}`}
            target="_blank"
            rel="noopener noreferrer"
            className="mbn-item"
          >
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
            </svg>
            Chat
          </a>
        )}

        <button type="button" onClick={openMobileMenu} className="mbn-item" aria-label="Open menu">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
          </svg>
          More
        </button>
      </nav>
    </>
  )
}
