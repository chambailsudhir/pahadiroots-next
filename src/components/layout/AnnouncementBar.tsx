import type { SiteSettings } from '@/types'
import { isEnabled } from '@/lib/getSiteSettings'

interface Props {
  settings: SiteSettings
}

export default function AnnouncementBar({ settings }: Props) {
  if (!isEnabled(settings.ann_hide, true) === false) return null
  // ann_hide = 'true' means hidden
  if (settings.ann_hide === 'true') return null

  const text = settings.ann_text?.trim()

  return (
    <div className="bg-forest-800 text-forest-50 text-center py-2 px-4 text-xs font-medium tracking-wide">
      {text ? (
        <span dangerouslySetInnerHTML={{ __html: text }} />
      ) : (
        <span>
          🚚 Free shipping above ₹{settings.free_shipping_min || '799'} &nbsp;·&nbsp;
          💳 UPI · Cards · COD &nbsp;·&nbsp;
          🏔️ {settings.states_covered || '20+'} Himalayan States Covered
        </span>
      )}
    </div>
  )
}
