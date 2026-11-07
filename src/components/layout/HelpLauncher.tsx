'use client'

// HelpLauncher — one "Help" entry point for WhatsApp and the Pahadi_AI assistant (Nov 2026 redesign).
//
// Before: up to four floating controls shared the bottom-right corner (WhatsApp, the AI avatar, back-to-top and, on
// phones, the bottom nav), and on the mobile listing page back-to-top covered a product's Add to Cart button.
// Now:
//   • Desktop: one floating Help button. Back-to-top sits above it.
//   • Phones:  no floating button. The bottom nav's "Help" item opens the same sheet. On routes without the bottom nav
//              (checkout, the signed-in account area) the floating button is shown instead, so help is always reachable.
//   • The sheet offers WhatsApp with three pre-filled starting messages (product, order, delivery), the AI assistant and
//     order tracking.
//
// The assistant itself is still public/js/ai-assistant.js (unchanged). Its own launcher (#pr-ai-fab) and WhatsApp
// button (#pr-wa) are hidden by globals.css; "Ask Pahadi_AI" clicks that hidden launcher. While the chat is open the
// launcher reappears in exactly this button's spot as its ✕ close button, and when the chat closes focus returns here.
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useCallback, useEffect, useId, useRef } from 'react'
import { useUIStore } from '@/store/uiStore'
import { useUserStore } from '@/store/userStore'
import { bottomNavHidden } from '@/components/layout/MobileBottomNav'

interface Props {
  /** Digits only, with country code. Empty hides the WhatsApp options. */
  whatsappNumber: string
}

export const HELP_MESSAGES = [
  { label: 'A question about a product', text: 'Namaste! I have a question about a product.' },
  { label: 'Help with my order',         text: 'Namaste! I need help with my order. My order number is ' },
  { label: 'Delivery to my PIN code',    text: 'Namaste! Do you deliver to PIN code ' },
] as const

export function waLink(number: string, text: string): string {
  return `https://wa.me/${number}?text=${encodeURIComponent(text)}`
}

/** Opens the Pahadi_AI chat panel. The widget loads lazily, so wait (up to ~4s) for its launcher to exist. */
export function openAssistant(onUnavailable?: () => void): void {
  let tries = 0
  const attempt = () => {
    const fab = document.getElementById('pr-ai-fab')
    if (fab) {
      // Deferred by a tick: the widget closes its panel on any document click outside it, and the click that got us
      // here is still bubbling. Opening synchronously would be undone by that same click.
      if (fab.getAttribute('aria-expanded') !== 'true') fab.click()
      return
    }
    if (++tries > 20) { onUnavailable?.(); return }
    setTimeout(attempt, 200)
  }
  setTimeout(attempt, 0)
}

export default function HelpLauncher({ whatsappNumber }: Props) {
  const isOpen    = useUIStore(s => s.isHelpOpen)
  const openHelp  = useUIStore(s => s.openHelp)
  const closeHelp = useUIStore(s => s.closeHelp)
  const pathname  = usePathname()
  const router    = useRouter()
  const signedIn  = useUserStore(s => !!s.user)
  const sheetRef  = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const titleId   = useId()
  const navHidden = bottomNavHidden(pathname, signedIn)

  const close = useCallback((returnFocus = true) => {
    closeHelp()
    if (returnFocus) buttonRef.current?.focus()
  }, [closeHelp])

  // Escape and outside click close the sheet; focus moves into it on open.
  useEffect(() => {
    if (!isOpen) return
    sheetRef.current?.querySelector<HTMLElement>('a,button')?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node
      if (sheetRef.current?.contains(t) || buttonRef.current?.contains(t)) return
      if ((t as Element).closest?.('[data-help-trigger]')) return
      close(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onDown)
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('pointerdown', onDown) }
  }, [isOpen, close])

  // When the assistant's chat closes, hand focus back to Help (its own launcher is hidden again by then).
  useEffect(() => {
    let observer: MutationObserver | null = null
    const watch = () => {
      const fab = document.getElementById('pr-ai-fab')
      if (!fab) return false
      observer = new MutationObserver(() => {
        if (fab.getAttribute('aria-expanded') === 'false' && document.activeElement === fab) buttonRef.current?.focus()
      })
      observer.observe(fab, { attributes: true, attributeFilter: ['aria-expanded'] })
      return true
    }
    let timer: ReturnType<typeof setInterval> | null = null
    if (!watch()) timer = setInterval(() => { if (watch() && timer) clearInterval(timer) }, 1000)
    return () => { observer?.disconnect(); if (timer) clearInterval(timer) }
  }, [])

  const askAssistant = () => {
    close(false)
    openAssistant(() => router.push('/contact'))
  }

  return (
    <div className={`help-root${navHidden ? ' help-root-always' : ''}`}>
      <button
        ref={buttonRef}
        type="button"
        className="help-fab"
        aria-expanded={isOpen}
        aria-controls="help-sheet"
        onClick={() => (isOpen ? close() : openHelp())}
        data-help-trigger
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 12a8 8 0 1 1 3.2 6.4L4 19.5l1-3.3A7.96 7.96 0 0 1 4 12z" />
          <path strokeLinecap="round" d="M9.6 9.6a2.4 2.4 0 1 1 3.3 2.2c-.6.3-.9.8-.9 1.4v.3" /><circle cx="12" cy="16.4" r=".6" fill="currentColor" />
        </svg>
        <span>Help</span>
      </button>

      <div
        id="help-sheet"
        ref={sheetRef}
        className={`help-sheet${isOpen ? ' open' : ''}`}
        role="dialog"
        aria-modal="false"
        aria-labelledby={titleId}
        hidden={!isOpen}
      >
        <div className="help-sheet-head">
          <h2 id={titleId}>How can we help?</h2>
          <button type="button" className="help-close" onClick={() => close()} aria-label="Close help">
            <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>

        {whatsappNumber && (
          <div className="help-group">
            <p className="help-label">WhatsApp us · real people reply</p>
            <ul>
              {HELP_MESSAGES.map(m => (
                <li key={m.label}>
                  <a href={waLink(whatsappNumber, m.text)} target="_blank" rel="noopener noreferrer" onClick={() => close(false)}>
                    {m.label}<span aria-hidden="true">→</span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="help-group">
          <p className="help-label">Other ways</p>
          <ul>
            <li><button type="button" onClick={askAssistant}>Ask Pahadi_AI, our product assistant<span aria-hidden="true">→</span></button></li>
            <li><Link href="/track" onClick={() => close(false)}>Track an order<span aria-hidden="true">→</span></Link></li>
          </ul>
        </div>
      </div>
    </div>
  )
}
