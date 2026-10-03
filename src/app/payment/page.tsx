import type { Metadata } from 'next'

// SEO FIX: added canonical — same gap as /about, no other public page fix
// needed here since this is a simple informational page with no OG-worthy
// image to share.
export const metadata: Metadata = {
  title: 'Payment Methods | HimVeda by Pahadi Roots',
  description: 'Secure payment options — UPI, Cards, Net Banking and Cash on Delivery',
  alternates: { canonical: '/payment' },
}

export default function PaymentPage() {
  return (
    <main style={{ maxWidth: '800px', margin: '0 auto', padding: '48px 24px' }}>
      <h1 style={{ fontFamily: 'var(--font-playfair), Playfair Display, serif', fontSize: '32px', color: '#1a3a1e', marginBottom: '8px' }}>
        Payment Methods
      </h1>
      <p style={{ color: '#888', marginBottom: '40px', fontSize: '15px' }}>
        We offer secure, hassle-free payment options for all our customers.
      </p>

      <div style={{ display: 'grid', gap: '20px' }}>
        {[
          { icon: '💳', title: 'UPI / Cards / Net Banking', desc: 'Pay securely via Razorpay — supports all UPI apps (GPay, PhonePe, Paytm), Debit/Credit cards, and Net Banking. Instant confirmation.' },
          { icon: '💵', title: 'Cash on Delivery (COD)', desc: 'Available for orders up to ₹3,000 across all 10 Himalayan states. Pay when your order arrives at your doorstep.' },
          { icon: '🔒', title: '100% Secure', desc: 'All transactions are SSL-encrypted. We never store your card details. Powered by Razorpay — PCI DSS compliant.' },
          { icon: '↩️', title: 'Easy Refunds', desc: 'Refunds for prepaid orders are processed within 5–7 business days to your original payment method.' },
        ].map(({ icon, title, desc }) => (
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
