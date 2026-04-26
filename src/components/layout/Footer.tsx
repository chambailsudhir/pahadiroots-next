'use client'

import Link from 'next/link'
import { useState } from 'react'
import type { SiteSettings } from '@/types'
import { whatsappURL } from '@/lib/utils'
import { isEnabled } from '@/lib/getSiteSettings'

interface Props { settings: SiteSettings }

const NAV_LINKS = [
  { label: 'Best Sellers',    href: '/collections/best-sellers' },
  { label: 'All Products',    href: '/products' },
  { label: 'Our Story',       href: '/about' },
  { label: 'Track Order',     href: '/track' },
  { label: 'Contact Us',      href: '/contact' },
  { label: 'Blog',            href: '/blog' },
]

const POLICY_LINKS = [
  { label: 'Shipping Policy',  href: '/policies/shipping' },
  { label: 'Return Policy',    href: '/policies/returns' },
  { label: 'Privacy Policy',   href: '/policies/privacy' },
  { label: 'Terms of Service', href: '/policies/terms' },
]

export default function Footer({ settings }: Props) {
  const waNumber   = settings.whatsapp_number || '919899984895'
  const showTrack  = isEnabled(settings.show_track_order_page)
  const [email, setEmail]   = useState('')
  const [subDone, setSubDone] = useState(false)

  async function handleSub(e: React.FormEvent) {
    e.preventDefault()
    if (!email.includes('@')) return
    try {
      await fetch('/api/v1/cart', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'subscribe', email }),
      })
      setSubDone(true)
    } catch { setSubDone(true) }
  }

  return (
    <footer className="site-footer">

      {/* Newsletter strip */}
      <div className="f-newsletter">
        <div className="f-nl-inner">
          <div className="f-nl-text">
            <h4>Join the Mountain Community</h4>
            <p>Stories, harvests & exclusive offers. No spam, ever.</p>
          </div>
          {subDone ? (
            <div style={{ color: 'var(--gd2)', fontWeight: 700, fontSize: 14 }}>🎉 Thank you for subscribing!</div>
          ) : (
            <form onSubmit={handleSub} className="f-nl-form">
              <input
                type="email" value={email} onChange={e => setEmail(e.target.value)}
                placeholder="your@email.com" required className="f-nl-inp"
              />
              <button type="submit" className="f-nl-btn">Subscribe</button>
            </form>
          )}
        </div>
      </div>

      {/* Main columns */}
      <div className="f-main">
        {/* Brand */}
        <div>
          <div className="f-logo-name">🌿 {settings.site_name || '5 Pahadi Roots'}</div>
          <div className="f-logo-tag">HIMALAYAN NATURALS</div>
          <p className="f-brand-desc">
            Pure, natural products sourced directly from mountain farming communities across
            the Himalayas. No middlemen, no additives — just the goodness of altitude.
          </p>
          <div className="f-soc-row">
            {settings.instagram_url && (
              <a href={settings.instagram_url} target="_blank" rel="noopener noreferrer" aria-label="Instagram" className="f-soc">
                <svg width="16" height="16" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/></svg>
              </a>
            )}
            {settings.facebook_url && (
              <a href={settings.facebook_url} target="_blank" rel="noopener noreferrer" aria-label="Facebook" className="f-soc">
                <svg width="16" height="16" fill="currentColor" viewBox="0 0 24 24"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
              </a>
            )}
            <a href={whatsappURL(waNumber, 'Hi! I need help with my order.')} target="_blank" rel="noopener noreferrer" aria-label="WhatsApp" className="f-soc">
              <svg width="16" height="16" fill="currentColor" viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
            </a>
          </div>

          {/* FSSAI badge */}
          <div style={{ marginTop: 20, display: 'inline-flex', alignItems: 'center', gap: 10, background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.1)', borderRadius: 10, padding: '10px 14px' }}>
            <div style={{ background: '#fff', borderRadius: 6, padding: '4px 8px', fontSize: 11, fontWeight: 900, color: '#1a6b1a', letterSpacing: '.5px' }}>FSSAI</div>
            <div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,.7)', fontWeight: 700 }}>Licensed & Certified</div>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,.4)' }}>Food Safety Standards</div>
            </div>
          </div>
        </div>

        {/* Quick Links */}
        <div>
          <div className="fh">Quick Links</div>
          <ul className="ful">
            {NAV_LINKS.filter(l => l.href !== '/track' || showTrack).map(link => (
              <li key={link.href}><Link href={link.href}>→ {link.label}</Link></li>
            ))}
          </ul>
        </div>

        {/* Policies */}
        <div>
          <div className="fh">Policies</div>
          <ul className="ful">
            {POLICY_LINKS.map(link => (
              <li key={link.href}><Link href={link.href}>→ {link.label}</Link></li>
            ))}
          </ul>
        </div>

        {/* Contact */}
        <div>
          <div className="fh">Contact Us</div>
          {settings.contact_phone && (
            <div className="f-contact-item">
              <span className="f-contact-icon">📞</span>
              <div className="f-contact-text">
                <a href={`tel:${settings.contact_phone}`}>{settings.contact_phone}</a>
              </div>
            </div>
          )}
          {settings.contact_email && (
            <div className="f-contact-item">
              <span className="f-contact-icon">✉️</span>
              <div className="f-contact-text">
                <a href={`mailto:${settings.contact_email}`}>{settings.contact_email}</a>
              </div>
            </div>
          )}
          {settings.contact_address && (
            <div className="f-contact-item">
              <span className="f-contact-icon">📍</span>
              <div className="f-contact-text">{settings.contact_address}</div>
            </div>
          )}

          <a
            href={whatsappURL(waNumber, 'Hi! I need help with my order.')}
            target="_blank" rel="noopener noreferrer"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: '#25D366', color: '#fff', fontWeight: 800, fontSize: 12, padding: '8px 16px', borderRadius: 10, marginTop: 12, textDecoration: 'none' }}
          >
            <svg width="14" height="14" fill="currentColor" viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
            WhatsApp Support
          </a>
        </div>
      </div>

      {/* Bottom bar */}
      <div className="f-bot">
        <div className="f-bot-left">
          © {new Date().getFullYear()} <strong>5 Pahadi Roots</strong>. All rights reserved. &nbsp;·&nbsp; Made with 🌿 in the Mountains.
        </div>
        <div className="f-bot-tag">Secure Payments: Razorpay · UPI · Cards · COD</div>
      </div>
    </footer>
  )
}
