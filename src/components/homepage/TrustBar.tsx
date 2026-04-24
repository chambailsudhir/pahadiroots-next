import type { SiteSettings } from '@/types'

interface Props { settings: SiteSettings }

export default function TrustBar({ settings }: Props) {
  const allItems = [1,2,3,4].map(i => ({
    icon:   settings[`trust_${i}_icon`]  || '',
    title:  settings[`trust_${i}_title`] || '',
    sub:    settings[`trust_${i}_sub`]   || '',
    hidden: settings[`trust_${i}_hide`] === 'true',
  }))

  // Check if any DB data exists at all (i.e. admin has saved trust bar at least once)
  const hasDBData = allItems.some(t => t.title)

  // If admin has never configured trust bar → show hardcoded fallback
  // If admin HAS configured it → respect their hide flags exactly (even if all hidden)
  const display = hasDBData
    ? allItems.filter(t => !t.hidden && t.title)
    : [
        { icon: '🌿', title: '100% Natural',      sub: 'No chemicals, no preservatives' },
        { icon: '🏔️', title: 'Himalayan Sourced', sub: 'Directly from mountain farms'  },
        { icon: '🤝', title: 'Fair Trade',         sub: 'Supporting local farmers'       },
        { icon: '🚚', title: 'Free Shipping',      sub: `On orders above ₹${settings.free_shipping_min || '799'}` },
      ]

  if (display.length === 0) return null   // All hidden by admin → hide the whole bar

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
