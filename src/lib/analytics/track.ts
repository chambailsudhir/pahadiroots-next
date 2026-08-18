// ─────────────────────────────────────────────────────────────
// In-house visitor analytics — client side.
//
// Two IDs:
//   visitor_id — long-lived, localStorage, identifies a browser across visits
//   session_id — short-lived, sessionStorage + 30-min inactivity timeout,
//                identifies one browsing session
//
// track() is fire-and-forget: it never throws into the caller and never
// blocks navigation. Uses sendBeacon where available (survives page unload,
// important for the checkout→purchase and page-exit cases), falling back to
// fetch(keepalive) otherwise.
//
// This never touches localStorage/sessionStorage during SSR — every call
// site must be inside a 'use client' component that has already mounted.
// ─────────────────────────────────────────────────────────────

const VISITOR_KEY  = 'pr_vid'
const SESSION_KEY  = 'pr_sid'
const SESSION_META = 'pr_sid_meta'
const SESSION_TIMEOUT_MS = 30 * 60 * 1000 // 30 min inactivity

const TRACK_URL = '/api/v1/analytics/track'

export type EventType =
  | 'page_view' | 'search' | 'product_view'
  | 'add_to_cart' | 'checkout_start' | 'purchase'

function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  // Fallback for older browsers
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

function getVisitorId(): string {
  try {
    let id = localStorage.getItem(VISITOR_KEY)
    if (!id) {
      id = uuid()
      localStorage.setItem(VISITOR_KEY, id)
    }
    return id
  } catch {
    return uuid() // storage blocked (private mode etc.) — degrade gracefully
  }
}

interface SessionInfo { id: string; isNew: boolean }

function getSessionId(): SessionInfo {
  try {
    const now = Date.now()
    const metaRaw = sessionStorage.getItem(SESSION_META)
    const meta = metaRaw ? JSON.parse(metaRaw) as { lastActive: number } : null
    let id = sessionStorage.getItem(SESSION_KEY)
    let isNew = false

    if (!id || !meta || now - meta.lastActive > SESSION_TIMEOUT_MS) {
      id = `${uuid()}`
      isNew = true
      sessionStorage.setItem(SESSION_KEY, id)
    }
    sessionStorage.setItem(SESSION_META, JSON.stringify({ lastActive: now }))
    return { id, isNew }
  } catch {
    return { id: uuid(), isNew: true }
  }
}

function classifyPage(path: string): string {
  if (path === '/') return 'home'
  if (path.startsWith('/products/')) return 'product'
  if (path.startsWith('/collections') || path.startsWith('/regions')) return 'category'
  if (path.startsWith('/search')) return 'search'
  if (path.startsWith('/cart')) return 'cart'
  if (path.startsWith('/checkout') || path.startsWith('/payment')) return 'checkout'
  if (path.startsWith('/order-success')) return 'order_success'
  if (path.startsWith('/blog')) return 'blog'
  if (path.startsWith('/account')) return 'account'
  return 'other'
}

interface TrackPayload {
  event_type:    EventType
  path?:         string
  page_type?:    string
  product_id?:   number
  variant_id?:   number
  search_query?: string
  results_count?: number
  source?:       string
  metadata?:     Record<string, unknown>
}

export function track(payload: TrackPayload): void {
  if (typeof window === 'undefined') return

  try {
    const visitor_id = getVisitorId()
    const { id: session_id, isNew } = getSessionId()

    const body: Record<string, unknown> = {
      ...payload,
      session_id,
      visitor_id,
    }

    if (isNew) {
      body.landing_page = payload.path || window.location.pathname
      body.referrer = document.referrer || ''
      const params = new URLSearchParams(window.location.search)
      if (params.get('utm_source'))   body.utm_source   = params.get('utm_source')
      if (params.get('utm_medium'))   body.utm_medium   = params.get('utm_medium')
      if (params.get('utm_campaign')) body.utm_campaign = params.get('utm_campaign')
    }

    const json = JSON.stringify(body)

    if (navigator.sendBeacon) {
      const blob = new Blob([json], { type: 'application/json' })
      navigator.sendBeacon(TRACK_URL, blob)
    } else {
      fetch(TRACK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: json,
        keepalive: true,
      }).catch(() => {})
    }
  } catch {
    // Analytics must never break the page.
  }
}

export function trackPageView(path: string): void {
  track({ event_type: 'page_view', path, page_type: classifyPage(path) })
}

export function trackSearch(query: string, resultsCount: number): void {
  track({ event_type: 'search', search_query: query, results_count: resultsCount, path: '/search', page_type: 'search' })
}

export function trackProductView(productId: number, source: string, path?: string): void {
  track({ event_type: 'product_view', product_id: productId, source, path, page_type: 'product' })
}

export function trackAddToCart(productId: number, variantId: number | undefined, source: string): void {
  track({ event_type: 'add_to_cart', product_id: productId, variant_id: variantId, source })
}

export function trackCheckoutStart(): void {
  track({ event_type: 'checkout_start', path: '/checkout', page_type: 'checkout' })
}

export function trackPurchase(orderId: string, value: number): void {
  track({ event_type: 'purchase', path: '/order-success', page_type: 'order_success', metadata: { order_id: orderId, value } })
}
