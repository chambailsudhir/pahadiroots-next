import type { SiteSettings } from '@/types'

interface Props { settings: SiteSettings }

export default function AnnouncementBar({ settings }: Props) {
  if (settings.ann_hide === 'true') return null
  // BUG FIX (found via manual audit): ann_text is now sanitized server-side
  // before this component ever receives it (see getSiteSettings.ts) — this
  // component is rendered inside Header.tsx's 'use client' tree, so it
  // can't import the server-only sanitizeHtml() utility directly (that
  // module has `import 'server-only'`, which hard-fails the build if ever
  // bundled for the browser). Sanitizing once at the data-fetching layer
  // is both safe and correct: every consumer of settings.ann_text gets the
  // already-clean value, not just this one render site.
  const text = settings.ann_text?.trim()
  return (
    <div className="ann-bar">
      {text ? (
        <span dangerouslySetInnerHTML={{ __html: text }} />
      ) : (
        <span>
          🌿 Free Shipping above ₹{settings.free_shipping_min || '799'} &nbsp;|&nbsp;{' '}
          <a href="/checkout">UPI · Cards · COD</a> &nbsp;|&nbsp;{' '}
          {settings.states_covered || '10'} Himalayan States Covered
        </span>
      )}
    </div>
  )
}
