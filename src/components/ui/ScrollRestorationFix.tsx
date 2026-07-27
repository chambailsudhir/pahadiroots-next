'use client'

import { useEffect } from 'react'

/**
 * BUG FIX (the actual root cause behind the recurring "header shows solid
 * white instead of transparent right after a hard refresh" reports): the
 * header itself was never wrong for the scroll position the page had
 * actually loaded at — browsers restore the previous scroll offset on a
 * plain reload by default (`history.scrollRestoration === 'auto'`), so a
 * hard refresh could silently land the page already scrolled well past
 * the hero (confirmed directly: a refresh landed on the "Our Finest
 * Offerings" product grid section, not the top of the page). A solid nav
 * at that scroll position is correct — the bug was that the page loaded
 * scrolled down at all, when a fresh reload should always start at the
 * top like a first visit.
 *
 * Setting scrollRestoration to 'manual' tells the browser not to do this
 * automatic restoration, so a reload naturally renders at the top (matching
 * the freshly server-rendered HTML) instead of jumping to a remembered
 * offset afterwards. This has to run as early as possible on the client,
 * before the user has a chance to perceive any restored scroll position,
 * which is why it lives in its own tiny component mounted at the very top
 * of the app in layout.tsx rather than being buried inside Header.tsx.
 */
export default function ScrollRestorationFix() {
  useEffect(() => {
    if (typeof window === 'undefined' || !('scrollRestoration' in window.history)) return
    const previous = window.history.scrollRestoration
    window.history.scrollRestoration = 'manual'
    // The browser can restore a remembered scroll offset before this
    // effect even gets a chance to run, so disabling future restoration
    // alone doesn't fix *this* load if it already happened. Force back to
    // the top now too — except when the URL has a hash (#section), which
    // is a genuine, intentional anchor link the person should still land
    // on, not something to override.
    if (!window.location.hash) window.scrollTo(0, 0)
    return () => { window.history.scrollRestoration = previous }
  }, [])

  return null
}
