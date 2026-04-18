import type { SiteSettings } from '@/types'

interface Props { settings: SiteSettings }

export default function TrustBar({ settings }: Props) {
  // Read trust items from site_settings (trust_1_*, trust_2_*, etc.)
  // Your DB has: trust_1_icon, trust_1_title, trust_1_sub, trust_1_hide
  const items = [1, 2, 3, 4].map(i => ({
    icon:   settings[`trust_${i}_icon`]  || '',
    title:  settings[`trust_${i}_title`] || '',
    sub:    settings[`trust_${i}_sub`]   || '',
    hidden: settings[`trust_${i}_hide`] === 'true',
  })).filter(t => !t.hidden && t.title)

  // Fallback if no trust items configured
  const fallback = [
    { icon: '🌿', title: '100% Natural',       sub: 'No chemicals, no preservatives' },
    { icon: '🏔️', title: 'Himalayan Sourced',  sub: 'Directly from mountain farms' },
    { icon: '🤝', title: 'Fair Trade',          sub: 'Supporting local farmers always' },
    { icon: '🚚', title: 'Free Shipping',       sub: `On orders above ₹${settings.free_shipping_min || '799'}` },
  ]

  const displayItems = items.length > 0 ? items : fallback

  return (
    <section className="border-y border-stone-100 bg-gradient-to-r from-forest-50 to-stone-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
          {displayItems.map((item, i) => (
            <div key={i} className="flex items-center gap-3">
              <span className="text-2xl">{item.icon}</span>
              <div>
                <div className="text-xs font-bold text-stone-800">{item.title}</div>
                <div className="text-[11px] text-stone-500 leading-snug">{item.sub}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
