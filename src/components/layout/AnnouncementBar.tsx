import type { SiteSettings } from '@/types'

interface Props { settings: SiteSettings }

export default function AnnouncementBar({ settings }: Props) {
  if (settings.ann_hide === 'true') return null
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
