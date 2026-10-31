'use client'

import { Component, useEffect, useState, type ComponentProps, type ReactNode } from 'react'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
import { useUIStore } from '@/store/uiStore'
import type CartDrawerType from '@/components/cart/CartDrawer'
import type MobileMenuType from '@/components/layout/MobileMenu'

/**
 * Cart drawer, search overlay, mobile menu and login modal — the four panels that are invisible until the visitor taps
 * something. They used to be bundled and hydrated with every page (about 2,000 lines of components plus their
 * dependencies), competing with the hero image and the first interaction for the main thread.
 *
 * Now each one is a separate chunk (`next/dynamic`, client-only) that is mounted — and therefore downloaded —
 *   1. the moment its panel is opened (the store flag flips), and
 *   2. automatically ~3s after the page has finished loading, while the browser is idle,
 * so by the time a visitor reaches for the cart it is normally already there and behaves exactly as before
 * (including the slide-in animation). Once mounted a panel stays mounted.
 *
 * Safety net: if a chunk cannot be downloaded (flaky network) the error is contained by `PanelBoundary` — the page keeps
 * working — and, if the visitor was trying to open the cart or search, they are taken to the full /cart or /search page.
 */
const CartDrawer    = dynamic(() => import('@/components/cart/CartDrawer'),       { ssr: false })
const SearchOverlay = dynamic(() => import('@/components/search/SearchOverlay'),  { ssr: false })
const MobileMenu    = dynamic(() => import('@/components/layout/MobileMenu'),     { ssr: false })
const AuthModal     = dynamic(() => import('@/components/auth/AuthModal'),        { ssr: false })

type SiteSettings = ComponentProps<typeof CartDrawerType>['settings'] & ComponentProps<typeof MobileMenuType>['settings']
type Props = {
  settings:   SiteSettings
  categories: ComponentProps<typeof MobileMenuType>['categories']
  states:     ComponentProps<typeof MobileMenuType>['states']
}

/** Contains a failed panel (e.g. its chunk did not download) so it can never take the whole page down. */
class PanelBoundary extends Component<{ children: ReactNode; onError?: () => void }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(error: Error) {
    console.error('[LazyOverlays] a panel failed to load', error)
    this.props.onError?.()
  }
  render() { return this.state.failed ? null : this.props.children }
}

/** True from the first moment the panel is opened (or the background warm-up fires) — and stays true. */
function useMountedOnce(isOpen: boolean, warm: boolean): boolean {
  const [mounted, setMounted] = useState(false)
  if ((isOpen || warm) && !mounted) setMounted(true)
  return mounted
}

export default function LazyOverlays({ settings, categories, states }: Props) {
  const router = useRouter()
  const cartOpen   = useUIStore(s => s.isCartOpen)
  const searchOpen = useUIStore(s => s.isSearchOpen)
  const menuOpen   = useUIStore(s => s.isMobileMenuOpen)
  const authOpen   = useUIStore(s => s.isAuthOpen)

  // Warm-up: once the page has finished loading, wait 3s and then for the browser to be idle (max 6s).
  const [warm, setWarm] = useState(false)
  useEffect(() => {
    let cancelled = false, idleId: number | undefined, timer: ReturnType<typeof setTimeout> | undefined
    const go = () => { if (!cancelled) setWarm(true) }
    const schedule = () => {
      timer = setTimeout(() => {
        if (typeof window.requestIdleCallback === 'function') idleId = window.requestIdleCallback(go, { timeout: 6000 })
        else go()
      }, 3000)
    }
    if (document.readyState === 'complete') schedule(); else window.addEventListener('load', schedule, { once: true })
    return () => {
      cancelled = true
      window.removeEventListener('load', schedule)
      if (timer) clearTimeout(timer)
      if (idleId !== undefined && typeof window.cancelIdleCallback === 'function') window.cancelIdleCallback(idleId)
    }
  }, [])

  const cartOn   = useMountedOnce(cartOpen, warm)
  const searchOn = useMountedOnce(searchOpen, warm)
  const menuOn   = useMountedOnce(menuOpen, warm)
  const authOn   = useMountedOnce(authOpen, warm)

  return (
    <>
      {cartOn   && <PanelBoundary onError={() => { if (cartOpen)   router.push('/cart') }}><CartDrawer settings={settings} /></PanelBoundary>}
      {searchOn && <PanelBoundary onError={() => { if (searchOpen) router.push('/search') }}><SearchOverlay /></PanelBoundary>}
      {menuOn   && <PanelBoundary><MobileMenu settings={settings} categories={categories} states={states} /></PanelBoundary>}
      {authOn   && <PanelBoundary><AuthModal /></PanelBoundary>}
    </>
  )
}
