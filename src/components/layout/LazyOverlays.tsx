'use client'

import { useCallback, useEffect, useRef, useState, type ComponentProps, type ComponentType } from 'react'
import { useUIStore } from '@/store/uiStore'
import type CartDrawer from '@/components/cart/CartDrawer'
import type SearchOverlay from '@/components/search/SearchOverlay'
import type MobileMenu from '@/components/layout/MobileMenu'
import type AuthModal from '@/components/auth/AuthModal'

/**
 * Cart drawer, search overlay, mobile menu and login modal — the four panels that are invisible until the visitor taps
 * something. They used to be bundled and hydrated with every page (about 2,000 lines of components plus their
 * dependencies), competing with the hero image and the first interaction for the main thread.
 *
 * Now each one is a separate chunk that is:
 *   1. downloaded + mounted the moment its panel is opened (the store flag flips), and
 *   2. warmed up automatically ~3s after the page has loaded, while the browser is idle,
 * so by the time a visitor reaches for the cart it is normally already there and behaves exactly as before
 * (including the slide-in animation). If a chunk fails to download (flaky network) it simply retries the next time the
 * panel is opened.
 */
function useLazyPanel<P extends object>(loader: () => Promise<{ default: ComponentType<P> }>, isOpen: boolean, warm: boolean) {
  const [Comp, setComp] = useState<ComponentType<P> | null>(null)
  const inFlight = useRef(false)

  const load = useCallback(() => {
    if (inFlight.current) return
    inFlight.current = true
    loader().then(m => setComp(() => m.default)).catch(() => { inFlight.current = false })   // retried on next open
  }, [loader])

  useEffect(() => { if (isOpen && !Comp) load() }, [isOpen, Comp, load])
  useEffect(() => { if (warm && !Comp) load() }, [warm, Comp, load])
  return Comp
}

const loadCart   = () => import('@/components/cart/CartDrawer')
const loadSearch = () => import('@/components/search/SearchOverlay')
const loadMenu   = () => import('@/components/layout/MobileMenu')
const loadAuth   = () => import('@/components/auth/AuthModal')

type CartProps   = ComponentProps<typeof CartDrawer>
type SearchProps = ComponentProps<typeof SearchOverlay> & object   // takes no props
type MenuProps   = ComponentProps<typeof MobileMenu>
type AuthProps   = ComponentProps<typeof AuthModal> & object        // takes no props

// The layout passes the same site settings to the cart drawer and the mobile menu.
type Props = { settings: CartProps['settings'] & MenuProps['settings']; categories: MenuProps['categories']; states: MenuProps['states'] }

export default function LazyOverlays({ settings, categories, states }: Props) {
  const cartOpen   = useUIStore(s => s.isCartOpen)
  const searchOpen = useUIStore(s => s.isSearchOpen)
  const menuOpen   = useUIStore(s => s.isMobileMenuOpen)
  const authOpen   = useUIStore(s => s.isAuthOpen)

  // Warm-up: once the page has finished loading, wait for the browser to be idle (max 6s) and then fetch the panels.
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

  const Cart   = useLazyPanel<CartProps>(loadCart, cartOpen, warm)
  const Search = useLazyPanel<SearchProps>(loadSearch, searchOpen, warm)
  const Menu   = useLazyPanel<MenuProps>(loadMenu, menuOpen, warm)
  const Auth   = useLazyPanel<AuthProps>(loadAuth, authOpen, warm)

  return (
    <>
      {Cart   && <Cart settings={settings} />}
      {Search && <Search />}
      {Menu   && <Menu settings={settings} categories={categories} states={states} />}
      {Auth   && <Auth />}
    </>
  )
}
