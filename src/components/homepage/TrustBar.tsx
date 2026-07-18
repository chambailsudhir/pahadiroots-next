import type { SiteSettings } from '@/types'

interface Props { settings: SiteSettings }

export default function TrustBar({ settings }: Props) {
  const items = [1,2,3,4].map(i => ({
    icon:   settings[`trust_${i}_icon`]  || '',
    title:  settings[`trust_${i}_title`] || '',
    sub:    settings[`trust_${i}_sub`]   || '',
    hidden: settings[`trust_${i}_hide`] === 'true',
  })).filter(t => !t.hidden && t.title)

  const fallback = [
    { icon: '🌿', title: '100% Natural',      sub: 'No chemicals, no preservatives' },
    { icon: '🏔️', title: 'Himalayan Sourced', sub: 'Directly from mountain farms'  },
    { icon: '🤝', title: 'Fair Trade',         sub: 'Supporting local farmers'       },
    // BUG FIX (P3): fallback corrected from '799' to '0' — confirmed via
    // direct DB query that free_shipping_min is genuinely '0' live
    // (free shipping on every order). Same reasoning as AnnouncementBar.tsx.
    { icon: '🚚', title: 'Free Shipping',      sub: `On orders above ₹${settings.free_shipping_min || '0'}` },
  ]

  const display = items.length > 0 ? items : fallback

  return (
    <div className="trust-bar">
      {display.map((item, i) => (
        <div key={i} className="trust-cell">
          <span className="trust-icon">{item.icon}</span>
          <div>
            <div className="trust-title">{item.title}</div>
            <div className="trust-sub">{item.sub}</div>
          </div>
        </div>
      ))}
    </div>
  )
}
