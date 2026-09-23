import type { Metadata } from 'next'

// SEO FIX: page.tsx renders a real, useful FAQ block (delivery, COD,
// returns, sourcing) with zero FAQPage structured data — a free rich-snippet
// opportunity. page.tsx is 'use client' so it can't export server metadata
// or render a script tag that survives hydration reliably for crawlers;
// this layout (a Server Component) is the right place for it instead.
// IMPORTANT: kept in sync manually with the `FAQ` array in ./page.tsx — if
// that array changes, update this one too.
const FAQ = [
  { q: 'How long does delivery take?',           a: '3–5 business days across India. We ship via trusted courier partners.' },
  { q: 'Do you offer Cash on Delivery?',         a: 'Yes! COD is available on orders up to ₹3000. For higher amounts, please pay online.' },
  { q: 'Are your products certified organic?',   a: 'Our products are 100% natural — no preservatives, no additives. We work directly with farmers but do not carry formal organic certifications as these are expensive and inaccessible to small mountain farmers.' },
  { q: 'What if my product arrives damaged?',    a: 'Please WhatsApp us a photo within 48 hours of delivery. We will send a replacement or full refund — no questions asked.' },
  { q: 'Can I return a product?',                a: 'For non-edible items, yes — within 48 hours of delivery, unopened and in original condition. Edible/food items (honey, ghee, shilajit, spices, tea, etc.) are generally not returnable once opened, per food-safety norms — but we do consider damage or quality-defect claims raised within 48 hours with photo/video proof. See our Return & Refund Policy for full details.' },
  { q: 'Where are your products sourced from?',  a: 'Directly from farming communities across Uttarakhand, Himachal Pradesh, Assam, Manipur, Sikkim, and other Himalayan states. Every product has a source story.' },
  { q: 'Do you ship internationally?',           a: 'Currently we ship only within India. International shipping is on our roadmap.' },
  { q: 'How do I track my order?',               a: 'Visit our Track Order page and enter your order number and phone number. We also send WhatsApp updates when your order ships.' },
]

export const metadata: Metadata = {
  title: 'Contact Us — HimVeda by Pahadi Roots',
  description: 'Get in touch with the HimVeda by Pahadi Roots team. We\'re here to help with orders, product questions, and anything else.',
  // SEO FIX: no canonical previously — added for consistency with every
  // other public route (cart, regions, blog, products all have one).
  alternates: { canonical: '/contact' },
  openGraph: {
    title: 'Contact Us — HimVeda by Pahadi Roots',
    description: 'Reach out to the HimVeda by Pahadi Roots team — we\'d love to hear from you.',
    url: 'https://www.pahadiroots.com/contact',
    siteName: 'HimVeda by Pahadi Roots',
    type: 'website',
    // BUG FIX: no `images` here — this page's own openGraph object
    // replaces the layout's entirely, so this route had no og:image.
    images: [{ url: '/logo.png', width: 1200, height: 630, alt: 'Contact Us — HimVeda by Pahadi Roots' }],
  },
  twitter: {
    card: 'summary',
    title: 'Contact Us — HimVeda by Pahadi Roots',
    description: 'Reach out to the HimVeda by Pahadi Roots team — we\'d love to hear from you.',
  },
}

export default function ContactLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'FAQPage',
            mainEntity: FAQ.map(({ q, a }) => ({
              '@type': 'Question',
              name: q,
              acceptedAnswer: { '@type': 'Answer', text: a },
            })),
          })
            .replace(/</g, '\\u003c')
            .replace(/>/g, '\\u003e')
            .replace(/&/g, '\\u0026'),
        }}
      />
      {children}
    </>
  )
}
