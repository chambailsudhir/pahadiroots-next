import type { SiteSettings } from '@/types'

interface Props { settings: SiteSettings }

export default function TrustBar({ settings }: Props) {
  // BUG FIX: `configured` distinguishes "admin has saved this section at
  // least once" from "nothing is set up yet". Previously the fallback below
  // kicked in any time the *filtered* list was empty — which also happens
  // the moment an admin hides all 4 badges on purpose. Result: hiding every
  // badge in the admin panel silently un-hid them again on the live site via
  // the fallback array, so "Trust Bar hidden in admin" never actually hid
  // anything. Now the fallback only fires for a genuinely unconfigured store
  // (no trust_N_title ever saved), and an intentional all-hidden state
  // renders nothing, as it should.
  const configured = [1,2,3,4].some(i => settings[`trust_${i}_title`])

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
    { icon: '🚚', title: 'Free Shipping',      sub: `On orders above ₹${settings.free_shipping_min || '500'}` },
  ]

  const display = configured ? items : fallback

  if (display.length === 0) return null

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
