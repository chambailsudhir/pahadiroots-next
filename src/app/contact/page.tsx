'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { supabase } from '@/lib/supabase'
import type { SiteSettings } from '@/types'

const FAQ = [
  { q: 'How long does delivery take?',               a: '3–5 business days across India. We ship via trusted courier partners.' },
  { q: 'Do you offer Cash on Delivery?',             a: 'Yes! COD is available on orders up to ₹3000. For higher amounts, please pay online.' },
  { q: 'Are your products certified organic?',       a: 'Our products are 100% natural — no preservatives, no additives. We work directly with farmers but do not carry formal organic certifications as these are expensive and inaccessible to small mountain farmers.' },
  { q: 'What if my product arrives damaged?',        a: 'Please WhatsApp us a photo within 48 hours of delivery. We will send a replacement or full refund — no questions asked.' },
  { q: 'Can I return a product?',                    a: 'Yes, we accept returns within 7 days if the product is unopened and in original condition. For quality issues, we accept returns regardless of whether it has been opened.' },
  { q: 'Where are your products sourced from?',      a: 'Directly from farming communities across Uttarakhand, Himachal Pradesh, Assam, Manipur, Sikkim, and other Himalayan states. Every product has a source story.' },
  { q: 'Do you ship internationally?',               a: 'Currently we ship only within India. International shipping is on our roadmap.' },
  { q: 'How do I track my order?',                   a: 'Visit our Track Order page and enter your order number and phone number. We also send WhatsApp updates when your order ships.' },
]

function FAQItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border-b border-stone-100 last:border-0">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between gap-4 py-4 text-left"
      >
        <span className="text-sm font-semibold text-stone-800">{q}</span>
        <svg
          className={`w-4 h-4 text-stone-400 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="pb-4 text-sm text-stone-500 leading-relaxed">{a}</div>
      )}
    </div>
  )
}

export default function ContactPage() {
  const { data: settingsRows } = useSWR('site_settings_contact', async () => {
    const { data } = await supabase.from('site_settings').select('key, value')
    return Object.fromEntries((data || []).map((r: { key: string; value: string }) => [r.key, r.value])) as SiteSettings
  })
  const settings = settingsRows || {} as SiteSettings
  const waNumber = settings.whatsapp_number || '919899984895'

  const [form, setForm]     = useState({ name: '', email: '', message: '' })
  const [status, setStatus] = useState<'idle' | 'sending' | 'done' | 'error'>('idle')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name || !form.email || !form.message) return
    setStatus('sending')
    try {
      const res = await fetch('/api/v1/actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'contact', ...form }),
      })
      setStatus(res.ok ? 'done' : 'error')
    } catch (e: unknown) {
      // BUG FIX [ERROR HANDLING]: previously bare `catch {}` — no logging.
      console.error('[contact] form submit failed:', e)
      setStatus('error')
    }
  }

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <div className="text-center mb-12">
        <h1 className="text-3xl font-bold text-stone-900 mb-2">Get in Touch</h1>
        <p className="text-stone-500 text-sm">We're a small team and we personally respond to every query.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 mb-16">

        {/* Left: Contact methods */}
        <div className="space-y-4">
          {/* WhatsApp — primary */}
          <a
            href={`https://wa.me/${waNumber.replace(/\D/g, '')}?text=Hi Pahadi Roots, I need help`}
            target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-4 p-5 bg-green-50 border border-green-100 rounded-2xl hover:bg-green-100 transition-colors group"
          >
            <div className="w-12 h-12 bg-green-600 rounded-xl flex items-center justify-center shrink-0">
              <svg className="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 24 24">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a12.8 12.8 0 00-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
              </svg>
            </div>
            <div>
              <div className="text-sm font-bold text-green-800 group-hover:text-green-900">WhatsApp us</div>
              <div className="text-xs text-green-700 mt-0.5">Fastest response — usually within 1 hour</div>
              <div className="text-xs text-green-600 font-mono mt-1">+{waNumber}</div>
            </div>
          </a>

          {/* Email */}
          {settings.contact_email && (
            <a
              href={`mailto:${settings.contact_email}`}
              className="flex items-center gap-4 p-5 bg-blue-50 border border-blue-100 rounded-2xl hover:bg-blue-100 transition-colors group"
            >
              <div className="w-12 h-12 bg-blue-600 rounded-xl flex items-center justify-center shrink-0">
                <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
                </svg>
              </div>
              <div>
                <div className="text-sm font-bold text-blue-800">Email us</div>
                <div className="text-xs text-blue-600 mt-0.5">{settings.contact_email}</div>
                <div className="text-xs text-blue-500 mt-1">Response within 24 hours</div>
              </div>
            </a>
          )}

          {/* Address */}
          {settings.contact_address && (
            <div className="flex items-start gap-4 p-5 bg-stone-50 border border-stone-100 rounded-2xl">
              <div className="w-12 h-12 bg-stone-600 rounded-xl flex items-center justify-center shrink-0">
                <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
                </svg>
              </div>
              <div>
                <div className="text-sm font-bold text-stone-700">Our Address</div>
                <div className="text-xs text-stone-500 mt-0.5 leading-relaxed">{settings.contact_address}</div>
              </div>
            </div>
          )}
        </div>

        {/* Right: Contact form */}
        <div className="bg-white border border-stone-200 rounded-2xl p-6">
          <h2 className="text-base font-bold text-stone-900 mb-4">Send us a Message</h2>

          {status === 'done' ? (
            <div className="text-center py-8">
              <div className="text-4xl mb-3">✅</div>
              <h3 className="font-semibold text-stone-800 mb-1">Message received!</h3>
              <p className="text-stone-500 text-sm">We'll get back to you within 24 hours.</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {[
                { field: 'name',    label: 'Your Name',    type: 'text',  placeholder: 'Ravi Kumar' },
                { field: 'email',   label: 'Email',        type: 'email', placeholder: 'ravi@example.com' },
              ].map(({ field, label, type, placeholder }) => (
                <div key={field}>
                  <label className="block text-xs font-semibold text-stone-600 mb-1">{label}</label>
                  <input
                    type={type}
                    value={form[field as keyof typeof form]}
                    onChange={e => setForm(f => ({ ...f, [field]: e.target.value }))}
                    placeholder={placeholder}
                    required
                    className="w-full border border-stone-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-forest-500 transition-colors"
                  />
                </div>
              ))}
              <div>
                <label className="block text-xs font-semibold text-stone-600 mb-1">Message</label>
                <textarea
                  value={form.message}
                  onChange={e => setForm(f => ({ ...f, message: e.target.value }))}
                  placeholder="Tell us how we can help…"
                  required
                  rows={4}
                  className="w-full border border-stone-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-forest-500 resize-none transition-colors"
                />
              </div>
              {status === 'error' && (
                <p className="text-xs text-red-500">Something went wrong. Please WhatsApp us instead.</p>
              )}
              <button
                type="submit"
                disabled={status === 'sending'}
                className="w-full bg-forest-700 hover:bg-forest-800 text-white font-bold py-3 rounded-xl text-sm transition-colors disabled:opacity-60"
              >
                {status === 'sending' ? 'Sending…' : 'Send Message'}
              </button>
            </form>
          )}
        </div>
      </div>

      {/* FAQ */}
      <div>
        <h2 className="text-2xl font-bold text-stone-900 mb-6 text-center">Frequently Asked Questions</h2>
        <div className="max-w-2xl mx-auto bg-white border border-stone-200 rounded-2xl p-2 divide-y divide-stone-100">
          {FAQ.map(({ q, a }) => (
            <FAQItem key={q} q={q} a={a} />
          ))}
        </div>
      </div>
    </div>
  )
}
