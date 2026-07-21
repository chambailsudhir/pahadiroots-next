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
    // NOTE: this fallback array is only used if all 4 admin trust items
    // are ever cleared — per your admin screenshots, they're currently
    // all configured, so this isn't live today. Value corrected from an
    // earlier '0' (confirmed via a direct DB query at the time) to '500'
    // — a later admin-panel screenshot showed the real current shipping
    // threshold is ₹500. If this number changes again, it'll drift from
    // reality here too, same as it did before — the real fix would be
    // computing this from settings.free_shipping_min directly instead of
    // a hardcoded fallback string, but that's a design call (whether the
    // fallback should ever differ from the live setting) rather than a
    // clear-cut bug fix, so left as a plain value update for now.
    { icon: '🚚', title: 'Free Shipping',      sub: `On orders above ₹${settings.free_shipping_min || '500'}` },
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
