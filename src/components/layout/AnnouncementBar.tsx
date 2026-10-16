import type { SiteSettings } from '@/types'
import { getStatesCovered } from '@/lib/heroStats'
import { freeShippingPhrase } from '@/lib/shippingCopy'
import { isCodEnabled } from '@/lib/siteSettingsHelpers'

interface Props { settings: SiteSettings }

export default function AnnouncementBar({ settings }: Props) {
  if (settings.ann_hide === 'true') return null
  // ann_text is sanitized server-side in app/layout.tsx (via
  // sanitizeHtml()) before this component ever receives it — this
  // component sits in Header.tsx's 'use client' tree, so it can't import
  // the server-only sanitize module directly (that has `import
  // 'server-only'`, which hard-fails the build if bundled for the
  // browser). Sanitizing once at the layout level, before any client
  // component sees the value, is both safe and correct.
  const text = settings.ann_text?.trim()
  // Admin's Announcement Bar section lets the store owner pick a
  // background/text color (ann_bg_color / ann_text_color); falls back to
  // the original dark-green/gold if unset so existing stores don't change
  // appearance.
  const bg  = settings.ann_bg_color   || '#1a3a1e'
  const txt = settings.ann_text_color || '#d4af37'
  return (
    <div className="ann-bar" style={{ background: bg, color: txt }}>
      {text ? (
        <span dangerouslySetInnerHTML={{ __html: text }} />
      ) : (
        <span>
          {/* F-02: the sentence comes from the live free_shipping_min setting (0 → "on all orders"),
              never from a hard-coded amount. */}
          🌿 {freeShippingPhrase(settings)} &nbsp;|&nbsp;{' '}
          <a href="/checkout">UPI · Cards{isCodEnabled(settings) ? ' · COD' : ''}</a> &nbsp;|&nbsp;{' '}
          {/* BUG FIX: was settings.states_covered, a key the admin panel
              never actually writes to. The real key it manages is
              stat_himalayan_states (see lib/heroStats.ts). */}
          {getStatesCovered(settings) && settings.stat_hide_stat_himalayan_states !== 'true'
            ? <>&nbsp;|&nbsp;{' '}{getStatesCovered(settings)} Himalayan States Covered</>
            : null}
        </span>
      )}
    </div>
  )
}
