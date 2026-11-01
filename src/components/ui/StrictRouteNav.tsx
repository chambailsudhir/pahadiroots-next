'use client'

import { useEffect } from 'react'

/**
 * Checkout and account are protected by a strict per-request Content-Security-Policy (src/lib/strictCsp.ts). A browser applies
 * the policy of the DOCUMENT it loaded, and a client-side (soft) navigation never loads a new document — so arriving at
 * /checkout or /account by clicking a <Link> from the homepage would keep the homepage's looser policy. This turns clicks on
 * internal links to those routes into real page loads, so they always get their own strict policy.
 *
 * It only calls preventDefault(): Next's <Link> checks defaultPrevented and skips its own navigation, while the link's own
 * onClick (cart analytics etc.) still runs. Modified clicks (new tab / window) and target=_blank are left alone.
 */
export const STRICT_NAV_PATH = /^\/(checkout|account)(\/|$)/

export function strictNavTarget(a: HTMLAnchorElement | null, origin: string): string | null {
  if (!a || a.target === '_blank' || a.hasAttribute('download')) return null
  let url: URL
  try { url = new URL(a.href, origin) } catch { return null }
  if (url.origin !== origin || !STRICT_NAV_PATH.test(url.pathname)) return null
  return url.pathname + url.search + url.hash
}

export default function StrictRouteNav() {
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      const a = (e.target as Element | null)?.closest?.('a') as HTMLAnchorElement | null
      const dest = strictNavTarget(a, window.location.origin)
      if (!dest) return
      // Already inside the strict area (same top-level section): a soft navigation keeps the strict document, so let it be.
      const section = (p: string) => /^\/(checkout|account)/.exec(p)?.[1]
      if (section(window.location.pathname) && section(window.location.pathname) === section(dest)) return
      e.preventDefault()
      setTimeout(() => window.location.assign(dest), 0)   // after the link's own onClick handlers have run
    }
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [])
  return null
}
