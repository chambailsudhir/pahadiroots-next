import type { Metadata } from 'next'
import { getSiteSettings } from '@/lib/getSiteSettings'
import { isCodEnabled, asNumber } from '@/lib/siteSettingsHelpers'
import { parseServiceableStates } from '@/lib/serviceability'
import { freeShippingPhrase } from '@/lib/shippingCopy'

// SEO FIX: added canonical — same gap as /about, no other public page fix
// needed here since this is a simple informational page with no OG-worthy
// image to share.
//
// F-05 (Oct 2026 audit): this page used to promise "COD up to ₹3,000 across all 10 Himalayan
// states" while COD was switched off and the shop delivers beyond four regions. Every claim below
// is now rendered from the live admin settings (cod_enabled, cod_max_value, prepaid_discount_pct,
// serviceable_states, free_shipping_min) and is refreshed when settings are saved
// (/api/v1/revalidate → '/payment'). The static metadata promises nothing that can change.
export const metadata: Metadata = {
  // layout.tsx appends ` | ${siteName}` via title.template, so page titles must NOT repeat the brand
  // (it rendered "… | HimVeda by Pahadi Roots | HimVeda by Pahadi Roots"). openGraph/twitter titles are not templated and keep it.
  title: 'Payment Methods',
  description: 'Secure online payment options — UPI, Cards and Net Banking',
  alternates: { canonical: '/payment' },
}

export default async function PaymentPage() {
  // strict: this page is ISR — on a transient Supabase failure, throw so Next keeps serving the last
  // good HTML instead of freezing default-settings copy (COD off, all-free shipping) into the cache.
  const settings   = await getSiteSettings({ strict: true })
  const cod        = isCodEnabled(settings)
  const codMax     = asNumber(settings.cod_max_value, 3000)
  const prepaidPct = asNumber(settings.prepaid_discount_pct, 0)
  const states     = parseServiceableStates((settings as unknown as Record<string, string | undefined>).serviceable_states)
  const where      = states.length > 0 ? 'in the states we currently deliver to' : 'across India'

  const cards: Array<{ icon: string; title: string; desc: string }> = [
    {
      icon: '💳', title: 'UPI / Cards / Net Banking',
      desc: 'Pay securely via Razorpay — supports all UPI apps (GPay, PhonePe, Paytm), Debit/Credit cards, and Net Banking. Instant confirmation.'
        + (prepaidPct > 0 ? ` Pay online and get ${prepaidPct}% off your order.` : ''),
    },
    cod
      ? { icon: '💵', title: 'Cash on Delivery (COD)', desc: `Available for orders up to ₹${codMax.toLocaleString('en-IN')} ${where}. Pay when your order arrives at your doorstep.` }
      : { icon: '💵', title: 'Cash on Delivery (COD)', desc: 'Cash on Delivery is not available at the moment — all orders are paid online, securely, at checkout.' },
    { icon: '🚚', title: 'Shipping', desc: `${freeShippingPhrase(settings)}, delivered ${where}.` },
    { icon: '🔒', title: '100% Secure', desc: 'All transactions are SSL-encrypted. We never store your card details. Powered by Razorpay — PCI DSS compliant.' },
    { icon: '↩️', title: 'Easy Refunds', desc: 'Refunds for prepaid orders are processed within 5–7 business days to your original payment method.' },
  ]

  return (
    <main style={{ maxWidth: '800px', margin: '0 auto', padding: '48px 24px' }}>
      <h1 style={{ fontFamily: 'var(--font-playfair), Playfair Display, serif', fontSize: '32px', color: '#1a3a1e', marginBottom: '8px' }}>
        Payment Methods
      </h1>
      <p style={{ color: '#888', marginBottom: '40px', fontSize: '15px' }}>
        We offer secure, hassle-free payment options for all our customers.
      </p>

      <div style={{ display: 'grid', gap: '20px' }}>
        {cards.map(({ icon, title, desc }) => (
          <div key={title} style={{ background: '#fff', border: '1px solid #ede9e3', borderRadius: '16px', padding: '24px', display: 'flex', gap: '20px' }}>
            <div style={{ fontSize: '36px', flexShrink: 0 }}>{icon}</div>
            <div>
              <div style={{ fontWeight: 700, fontSize: '16px', color: '#1a3a1e', marginBottom: '6px' }}>{title}</div>
              <div style={{ fontSize: '14px', color: '#666', lineHeight: 1.7 }}>{desc}</div>
            </div>
          </div>
        ))}
      </div>
    </main>
  )
}
