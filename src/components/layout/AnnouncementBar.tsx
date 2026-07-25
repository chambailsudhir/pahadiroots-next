import type { SiteSettings } from '@/types'
import { getStatesCovered } from '@/lib/heroStats'

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
  // the original dark-green/gold if unset so existing stores don't change.
  const bg   = settings.ann_bg_color   || 'var(--g)'
  const txt  = settings.ann_text_color || '#d4af37'
  return (
    <div className="ann-bar" style={{ background: bg, color: txt }}>
      {text ? (
        <span dangerouslySetInnerHTML={{ __html: text }} />
      ) : (
        <span>
          {/* NOTE: fallback value corrected 0 → 500 — an earlier direct
              DB query showed '0'; a later admin-panel screenshot showed
              the real current value is '500'. Both this component and
              the shipping setting are read live, so this only matters
              if the setting is ever missing entirely. */}
          🌿 Free Shipping above ₹{settings.free_shipping_min || '500'} &nbsp;|&nbsp;{' '}
          <a href="/checkout" style={{ color: txt }}>UPI · Cards · COD</a> &nbsp;|&nbsp;{' '}
          {/* BUG FIX: was settings.states_covered, a key the admin panel
              never actually writes to. The real key it manages is
              stat_himalayan_states (see lib/heroStats.ts). */}
          {getStatesCovered(settings)} Himalayan States Covered
        </span>
      )}
    </div>
  )
}
