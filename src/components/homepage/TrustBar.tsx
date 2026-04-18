// TrustBar.tsx
import type { SiteSettings } from '@/types'

interface Props { settings: SiteSettings }

const TRUST_ITEMS = [
  { icon: '🌿', label: '100% Natural', sub: 'No preservatives or additives' },
  { icon: '🚚', label: 'Free Shipping',  sub: 'On orders above ₹{min}' },
  { icon: '🏔️', label: 'Direct Sourced', sub: 'From mountain farmers' },
  { icon: '🔒', label: 'Secure Payments', sub: 'Razorpay · UPI · COD' },
  { icon: '↩️', label: 'Easy Returns',   sub: '7-day return policy' },
]

export default function TrustBar({ settings }: Props) {
  const min = settings.free_shipping_min || '799'

  return (
    <section className="border-y border-stone-100 bg-stone-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {TRUST_ITEMS.map(item => (
            <div key={item.label} className="flex items-center gap-3">
              <span className="text-xl">{item.icon}</span>
              <div>
                <div className="text-xs font-bold text-stone-800">{item.label}</div>
                <div className="text-[10px] text-stone-500">
                  {item.sub.replace('{min}', min)}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
