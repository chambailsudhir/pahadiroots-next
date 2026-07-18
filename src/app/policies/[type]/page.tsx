import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import Link from 'next/link'

export const revalidate = 86400 // 24hr

// BUG FIX (Next.js 15+/16 migration): `params` is now a Promise.
interface Props { params: Promise<{ type: string }> }

const POLICIES: Record<string, { title: string; content: React.ReactNode }> = {
  shipping: {
    title: 'Shipping Policy',
    content: (
      <div className="prose prose-stone max-w-none text-sm leading-relaxed space-y-5">
        <section>
          <h2 className="text-base font-bold text-stone-900 mb-2">Delivery Timelines</h2>
          <p className="text-stone-600">We typically dispatch orders within 1–2 business days. Once shipped, delivery takes 3–5 business days across India. Remote areas (Andaman, Lakshadweep, Northeastern states) may take up to 7–10 days.</p>
        </section>
        <section>
          <h2 className="text-base font-bold text-stone-900 mb-2">Shipping Charges</h2>
          <ul className="list-disc list-inside text-stone-600 space-y-1">
            <li>Free shipping on orders above ₹799</li>
            <li>Flat ₹99 shipping charge on orders below ₹799</li>
            <li>No additional charges for COD orders</li>
          </ul>
        </section>
        <section>
          <h2 className="text-base font-bold text-stone-900 mb-2">Tracking</h2>
          <p className="text-stone-600">Once your order ships, you will receive tracking details via WhatsApp. You can also track your order on our <Link href="/track" className="text-forest-700 hover:underline">Track Order</Link> page.</p>
        </section>
        <section>
          <h2 className="text-base font-bold text-stone-900 mb-2">Damaged or Missing Orders</h2>
          <p className="text-stone-600">If your order arrives damaged or a product is missing, please WhatsApp us a photo within 48 hours of delivery. We will resolve it immediately — replacement or full refund.</p>
        </section>
      </div>
    ),
  },
  returns: {
    title: 'Return & Refund Policy',
    content: (
      <div className="prose prose-stone max-w-none text-sm leading-relaxed space-y-5">
        <section>
          <h2 className="text-base font-bold text-stone-900 mb-2">Return Window</h2>
          <p className="text-stone-600">We accept returns within 7 days of delivery for unopened products in original condition. For quality issues (wrong product, damaged, expired), we accept returns regardless of whether the product has been opened.</p>
        </section>
        <section>
          <h2 className="text-base font-bold text-stone-900 mb-2">Non-Returnable Items</h2>
          <ul className="list-disc list-inside text-stone-600 space-y-1">
            <li>Opened perishable products (unless quality issue)</li>
            <li>Products damaged due to mishandling after delivery</li>
          </ul>
        </section>
        <section>
          <h2 className="text-base font-bold text-stone-900 mb-2">Refund Process</h2>
          <p className="text-stone-600">Once we receive and verify the returned product, refunds are processed within 5–7 business days. Online payments are refunded to the original payment method. COD orders receive refunds via UPI or bank transfer.</p>
        </section>
        <section>
          <h2 className="text-base font-bold text-stone-900 mb-2">How to Initiate a Return</h2>
          <p className="text-stone-600">WhatsApp us at +91 98999 84895 with your order number and reason for return. We will arrange pickup or guide you through the return process.</p>
        </section>
      </div>
    ),
  },
  privacy: {
    title: 'Privacy Policy',
    content: (
      <div className="prose prose-stone max-w-none text-sm leading-relaxed space-y-5">
        <p className="text-stone-600">This policy describes how HimVeda by Pahadi Roots collects and uses your personal information.</p>
        <section>
          <h2 className="text-base font-bold text-stone-900 mb-2">Information We Collect</h2>
          <ul className="list-disc list-inside text-stone-600 space-y-1">
            <li>Name, phone number, email address when you place an order</li>
            <li>Delivery address for order fulfilment</li>
            <li>Payment information (processed securely by Razorpay — we never store card details)</li>
            <li>Order history and browsing preferences</li>
          </ul>
        </section>
        <section>
          <h2 className="text-base font-bold text-stone-900 mb-2">How We Use Your Information</h2>
          <ul className="list-disc list-inside text-stone-600 space-y-1">
            <li>To process and deliver your orders</li>
            <li>To send order confirmations and tracking updates</li>
            <li>To respond to customer support queries</li>
            <li>To improve our products and services</li>
          </ul>
        </section>
        <section>
          <h2 className="text-base font-bold text-stone-900 mb-2">Data Sharing</h2>
          <p className="text-stone-600">We do not sell your personal data. We share only what is necessary with our delivery partners (name, phone, address) to fulfil your order.</p>
        </section>
        <section>
          <h2 className="text-base font-bold text-stone-900 mb-2">Contact</h2>
          <p className="text-stone-600">For any privacy-related queries, write to us at <a href="mailto:hello@pahadiroots.com" className="text-forest-700 hover:underline">hello@pahadiroots.com</a>.</p>
        </section>
      </div>
    ),
  },
  terms: {
    title: 'Terms of Service',
    content: (
      <div className="prose prose-stone max-w-none text-sm leading-relaxed space-y-5">
        <p className="text-stone-600">By using pahadiroots.com, you agree to these terms. Please read them carefully.</p>
        <section>
          <h2 className="text-base font-bold text-stone-900 mb-2">Orders and Payment</h2>
          <ul className="list-disc list-inside text-stone-600 space-y-1">
            <li>All prices are in Indian Rupees (INR) inclusive of applicable taxes</li>
            <li>We reserve the right to cancel orders in case of pricing errors or stock unavailability</li>
            <li>Payments are processed securely by Razorpay</li>
          </ul>
        </section>
        <section>
          <h2 className="text-base font-bold text-stone-900 mb-2">Product Information</h2>
          <p className="text-stone-600">We make every effort to describe our products accurately. Actual colours may vary slightly from screen representations. Natural products may have slight variations in appearance, colour, and texture — this is normal and not a defect.</p>
        </section>
        <section>
          <h2 className="text-base font-bold text-stone-900 mb-2">Intellectual Property</h2>
          <p className="text-stone-600">All content on this website — including images, text, and design — is the property of HimVeda by Pahadi Roots and may not be reproduced without written permission.</p>
        </section>
        <section>
          <h2 className="text-base font-bold text-stone-900 mb-2">Governing Law</h2>
          <p className="text-stone-600">These terms are governed by the laws of India. Any disputes shall be subject to the jurisdiction of courts in Delhi.</p>
        </section>
      </div>
    ),
  },
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { type } = await params
  const policy = POLICIES[type]
  if (!policy) return { title: 'Policy Not Found' }
  return { title: `${policy.title} — HimVeda by Pahadi Roots` }
}

export default async function PolicyPage({ params }: Props) {
  const { type } = await params
  const policy = POLICIES[type]
  if (!policy) notFound()

  const allPolicies = [
    { href: '/policies/shipping', label: 'Shipping Policy' },
    { href: '/policies/returns',  label: 'Return & Refund' },
    { href: '/policies/privacy',  label: 'Privacy Policy' },
    { href: '/policies/terms',    label: 'Terms of Service' },
  ]

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
      <div className="flex flex-col sm:flex-row gap-8">

        {/* Sidebar nav */}
        <aside className="sm:w-48 shrink-0">
          <div className="text-[10px] font-bold uppercase tracking-widest text-stone-400 mb-2">Policies</div>
          <nav className="space-y-1">
            {allPolicies.map(p => (
              <Link
                key={p.href}
                href={p.href}
                className={`block text-sm px-3 py-2 rounded-xl transition-colors ${
                  p.href.endsWith(type)
                    ? 'bg-forest-700 text-white font-semibold'
                    : 'text-stone-600 hover:bg-stone-100'
                }`}
              >
                {p.label}
              </Link>
            ))}
          </nav>
        </aside>

        {/* Content */}
        <main className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold text-stone-900 mb-6">{policy.title}</h1>
          <div className="bg-white border border-stone-200 rounded-2xl p-6 sm:p-8">
            {policy.content}
          </div>
          <p className="text-xs text-stone-400 mt-4 text-center">
            Questions? <Link href="/contact" className="text-forest-700 hover:underline">Contact us</Link>
          </p>
        </main>
      </div>
    </div>
  )
}

export function generateStaticParams() {
  return Object.keys(POLICIES).map(type => ({ type }))
}
