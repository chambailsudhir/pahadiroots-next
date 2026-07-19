import type { SiteSettings } from '@/types'
import { getStatesCovered } from '@/lib/heroStats'

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
          {/* BUG FIX (P3): this fallback said '799', but the live DB
              value (confirmed via direct query) is genuinely '0' — free
              shipping on every order is the actual current policy. The
              old '799' fallback never fired in practice (the DB row
              exists), but would have silently reverted to a stale,
              wrong threshold the moment that row was ever missing. */}
          🌿 Free Shipping above ₹{settings.free_shipping_min || '0'} &nbsp;|&nbsp;{' '}
          <a href="/checkout">UPI · Cards · COD</a> &nbsp;|&nbsp;{' '}
          {/* BUG FIX: was settings.states_covered, a key the admin panel
              never actually writes to. The real key it manages is
              stat_himalayan_states (see lib/heroStats.ts). */}
          {getStatesCovered(settings)} Himalayan States Covered
        </span>
      )}
    </div>
  )
}
