'use client'

import Link from 'next/link'
import Image from 'next/image'
import { useState } from 'react'
import type { SiteSettings } from '@/types'

interface Props { settings: SiteSettings }

const gold = '#d2a33a'
const cream = '#f4efe3'
const muted = 'rgba(244,239,227,.66)'
const forest = '#082b19'

function ArrowIcon() {
  return <span aria-hidden="true" className="hv-footer-arrow">→</span>
}

function SocialIcon({ name }: { name: string }) {
  if (name === 'instagram') return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7.5 2.75h9A4.75 4.75 0 0 1 21.25 7.5v9a4.75 4.75 0 0 1-4.75 4.75h-9A4.75 4.75 0 0 1 2.75 16.5v-9A4.75 4.75 0 0 1 7.5 2.75Zm0 1.8A2.95 2.95 0 0 0 4.55 7.5v9a2.95 2.95 0 0 0 2.95 2.95h9a2.95 2.95 0 0 0 2.95-2.95v-9a2.95 2.95 0 0 0-2.95-2.95h-9Zm4.5 2.75a4.7 4.7 0 1 1 0 9.4 4.7 4.7 0 0 1 0-9.4Zm0 1.8a2.9 2.9 0 1 0 0 5.8 2.9 2.9 0 0 0 0-5.8Zm5.15-2.3a1.1 1.1 0 1 1 0 2.2 1.1 1.1 0 0 1 0-2.2Z" /></svg>
  if (name === 'facebook') return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13.6 21v-8h2.7l.4-3h-3.1V8.08c0-.87.24-1.46 1.52-1.46h1.63V3.94c-.28-.04-1.24-.12-2.36-.12-2.34 0-3.94 1.43-3.94 4.05V10H7.8v3h2.65v8h3.15Z" /></svg>
  if (name === 'x') return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.2 3.5h3.55l4.02 5.38 4.72-5.38h1.98l-5.8 6.6 7.13 9.4h-3.55l-4.52-5.96L6.5 19.5H4.52l5.93-6.77L4.2 3.5Zm2.8 1.7 9.94 12.6h.99L7.99 5.2H7Z" /></svg>
  if (name === 'youtube') return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21.6 7.05a2.85 2.85 0 0 0-2-2C17.85 4.55 12 4.55 12 4.55s-5.85 0-7.6.5a2.85 2.85 0 0 0-2 2C1.9 8.8 1.9 12 1.9 12s0 3.2.5 4.95a2.85 2.85 0 0 0 2 2c1.75.5 7.6.5 7.6.5s5.85 0 7.6-.5a2.85 2.85 0 0 0 2-2c.5-1.75.5-4.95.5-4.95s0-3.2-.5-4.95ZM10 15.55v-7.1l5.7 3.55-5.7 3.55Z" /></svg>
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.2 4.4h11.6v3.1H14v12.1h-3.5V7.5H6.2V4.4Z" /></svg>
}

export default function Footer({ settings }: Props) {
  const [email, setEmail] = useState('')
  const [subDone, setSubDone] = useState(false)
  const [subLoading, setSubLoading] = useState(false)

  async function handleSub(e: React.FormEvent) {
    e.preventDefault()
    if (!email.includes('@')) return
    setSubLoading(true)
    try {
      await fetch('/api/v1/actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'subscribe', email }),
      })
    } catch (err) {
      console.error('[Footer] newsletter subscribe failed:', err)
    }
    setSubDone(true)
    setSubLoading(false)
  }

  const instagramUrl = settings.social_instagram || 'https://www.instagram.com/5pahadiroots/?hl=en'
  const facebookUrl = settings.social_facebook || 'https://www.facebook.com/HimVedaByPahadiRoots'
  const youtubeUrl = settings.social_youtube || 'https://www.youtube.com/@pahadiroots'
  const twitterUrl = settings.social_twitter || 'https://twitter.com/pahadiroots'
  const pinterestUrl = settings.social_pinterest || ''
  const linkedinUrl = settings.linkedin_url || 'https://www.linkedin.com/company/pahadiroots/about/?viewAsMember=true'
  const phone = settings.contact_phone || '+919899984895'
  const email2 = settings.contact_email || 'hello@pahadiroots.com'
  const address = settings.contact_address || 'Village Sakoh, PO Sakoh, Distt Kangra, Himachal Pradesh 176082'

  const products = [
    ['Wild Honey', '/products?category=wild-honey'],
    ['A2 Bilona Ghee', '/products?category=ghee'],
    ['Kashmiri Saffron', '/products?category=saffron'],
    ['Ladakhi Shilajit', '/collections/shilajit'],
    ['Himalayan Teas', '/collections/himalayan-teas'],
    ['Ancient Grains', '/collections/heritage-rice'],
  ] as const

  const company = [
    ['Our Story', '/our-stories'],
    ['By Region', '/regions'],
    ['Returns & Refunds', '/policies/returns'],
    ['Shipping Policy', '/policies/shipping'],
    ['Privacy Policy', '/policies/privacy'],
    ['Terms & Conditions', '/policies/terms'],
  ].filter(([label]) => label !== 'Our Story' || settings.about_page_enabled !== 'false')

  return (
    <footer className="hv-footer">
      <div className="hv-footer-landscape" aria-hidden="true">
        <div className="hv-footer-landscape-fade" />
      </div>

      <div className="hv-footer-body">
        <div className="hv-footer-motif hv-footer-motif-left" aria-hidden="true">
          <span>❧</span><span>⌁</span><span>❧</span>
        </div>
        <div className="hv-footer-motif hv-footer-motif-right" aria-hidden="true">
          <span>❧</span><span>⌁</span><span>❧</span>
        </div>

        <div className="hv-footer-main">
          <section className="hv-footer-brand">
            <div className="hv-footer-leaf" aria-hidden="true">⌁</div>
            <h2>HimVeda <em>by Pahadi Roots</em></h2>
            <div className="hv-footer-kicker">Himalayan Natural Store</div>
            <p>
              Born in the mountains, delivered to your doorstep. Pure Himalayan natural products,
              sourced with love from farming communities across 10 Himalayan states.
            </p>
            <div className="hv-footer-newsletter">
              <div className="hv-footer-newsletter-label">Stories &amp; new harvests</div>
              {subDone ? (
                <div className="hv-footer-newsletter-success">Thank you — you&apos;re on the list.</div>
              ) : (
                <form onSubmit={handleSub}>
                  <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="Your email address"
                    aria-label="Email address for newsletter"
                    required
                    autoComplete="email"
                  />
                  <button type="submit" disabled={subLoading}>{subLoading ? '…' : 'Join'}</button>
                </form>
              )}
            </div>
          </section>

          <section className="hv-footer-column">
            <div className="hv-footer-heading">Quick Selects</div>
            <ul>
              {products.map(([label, href]) => (
                <li key={label}><Link href={href}>{label}<ArrowIcon /></Link></li>
              ))}
            </ul>
          </section>

          <section className="hv-footer-column">
            <div className="hv-footer-heading">Company</div>
            <ul>
              {company.map(([label, href]) => (
                <li key={label}><Link href={href}>{label}<ArrowIcon /></Link></li>
              ))}
            </ul>
          </section>

          <section className="hv-footer-column hv-footer-contact">
            <div className="hv-footer-heading">Connect With Us</div>
            <a href="https://www.pahadiroots.com" target="_blank" rel="noopener noreferrer"><span>◎</span>pahadiroots.com</a>
            <a href={`mailto:${email2}`}><span>✉</span>{email2}</a>
            <a href={`tel:${phone.replace(/\s/g, '')}`}><span>⌕</span>{phone}</a>
            <div className="hv-footer-address"><span>⌖</span><p>{address}</p></div>
          </section>
        </div>

        <div className="hv-footer-divider" />

        <div className="hv-footer-bottom">
          <div className="hv-footer-socials" aria-label="Social media links">
            <a href={instagramUrl} target="_blank" rel="noopener noreferrer" aria-label="Instagram"><SocialIcon name="instagram" /></a>
            <a href={facebookUrl} target="_blank" rel="noopener noreferrer" aria-label="Facebook"><SocialIcon name="facebook" /></a>
            <a href={twitterUrl} target="_blank" rel="noopener noreferrer" aria-label="X"><SocialIcon name="x" /></a>
            <a href={youtubeUrl} target="_blank" rel="noopener noreferrer" aria-label="YouTube"><SocialIcon name="youtube" /></a>
            {pinterestUrl && <a href={pinterestUrl} target="_blank" rel="noopener noreferrer" aria-label="Pinterest"><SocialIcon name="pinterest" /></a>}
            <a href={linkedinUrl} target="_blank" rel="noopener noreferrer" aria-label="LinkedIn"><SocialIcon name="linkedin" /></a>
          </div>

          {settings.fssai_license && (
            <div className="hv-footer-fssai">
              <Image src="/fssai-logo.png" alt="FSSAI" width={48} height={37} />
              <span />
              <div><strong>FSSAI Licensed</strong><small>Lic. No. {settings.fssai_license}</small></div>
            </div>
          )}

          <div className="hv-footer-trust">
            <div><b>⌁</b><span>Pure &amp; Natural</span></div>
            <div><b>⌁</b><span>Sourced from<br />Himalayan Regions</span></div>
            <div><b>♡</b><span>Supports Local<br />Communities</span></div>
            <div><b>❧</b><span>Sustainable &amp; Ethical</span></div>
          </div>
        </div>

        <div className="hv-footer-copyright">
          © {new Date().getFullYear()} <strong>HimVeda by Pahadi Roots</strong> · Himachal Pradesh, India
        </div>
      </div>

      <style>{`
        .hv-footer{position:relative;overflow:hidden;background:${forest};color:${cream};font-family:var(--font-lato),Lato,sans-serif}
        .hv-footer-landscape{height:238px;background-image:url('/footer-himalaya.jpg');background-size:cover;background-position:center top;position:relative}
        .hv-footer-landscape-fade{position:absolute;inset:auto 0 0;height:90px;background:linear-gradient(to bottom,rgba(8,43,25,0),${forest} 82%)}
        .hv-footer-body{position:relative;margin-top:-28px;padding:0 6.5% 22px;background:${forest}}
        .hv-footer-main{position:relative;z-index:2;display:grid;grid-template-columns:1.25fr .9fr .9fr 1.15fr;gap:56px;max-width:1500px;margin:0 auto;padding:0 0 34px}
        .hv-footer-brand{padding-right:20px}
        .hv-footer-leaf{font-family:Georgia,serif;color:${gold};font-size:30px;line-height:1;margin-bottom:6px}
        .hv-footer-brand h2{font-family:var(--font-playfair),Georgia,serif;font-size:28px;line-height:1.1;margin:0 0 8px;font-weight:700;color:#fff}
        .hv-footer-brand h2 em{font-style:normal;font-weight:400}
        .hv-footer-kicker,.hv-footer-heading{font-size:11px;font-weight:700;letter-spacing:2.5px;text-transform:uppercase;color:${gold}}
        .hv-footer-kicker{display:inline-flex;align-items:center;gap:12px;margin-bottom:16px}
        .hv-footer-kicker:before,.hv-footer-kicker:after{content:'';width:48px;height:1px;background:rgba(210,163,58,.65)}
        .hv-footer-brand p{max-width:455px;color:${muted};font-size:13.5px;line-height:1.75;margin:0}
        .hv-footer-newsletter{margin-top:20px;max-width:380px}
        .hv-footer-newsletter-label{font-size:10px;letter-spacing:1.7px;text-transform:uppercase;color:rgba(244,239,227,.45);margin-bottom:7px}
        .hv-footer-newsletter form{display:flex;border-bottom:1px solid rgba(210,163,58,.55)}
        .hv-footer-newsletter input{min-width:0;flex:1;padding:9px 4px;background:transparent;border:0;outline:0;color:#fff;font:13px inherit}
        .hv-footer-newsletter input::placeholder{color:rgba(244,239,227,.4)}
        .hv-footer-newsletter button{border:0;background:transparent;color:${gold};font-weight:700;letter-spacing:1px;padding:8px 4px;cursor:pointer}
        .hv-footer-newsletter-success{font-size:12px;color:${gold};padding:9px 0;border-bottom:1px solid rgba(210,163,58,.4)}
        .hv-footer-heading{padding-bottom:12px;border-bottom:1px solid rgba(210,163,58,.28);margin-bottom:14px}
        .hv-footer-column ul{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:10px}
        .hv-footer-column li a{display:flex;justify-content:space-between;align-items:center;color:rgba(244,239,227,.68);text-decoration:none;font-size:13.5px;line-height:1.45;transition:color .2s,transform .2s}
        .hv-footer-column li a:hover{color:#fff;transform:translateX(4px)}
        .hv-footer-arrow{color:${gold};opacity:.7;font-size:13px;margin-left:10px}
        .hv-footer-contact>a,.hv-footer-address{display:flex;gap:12px;align-items:flex-start;color:rgba(244,239,227,.68);font-size:13.5px;line-height:1.55;text-decoration:none;margin-bottom:13px;transition:color .2s}
        .hv-footer-contact>a:hover{color:#fff}
        .hv-footer-contact>a span,.hv-footer-address>span{width:20px;flex:0 0 20px;color:${gold};font-size:18px;line-height:1}
        .hv-footer-address p{margin:0}
        .hv-footer-divider{height:1px;background:rgba(210,163,58,.34);max-width:1500px;margin:0 auto}
        .hv-footer-bottom{max-width:1500px;margin:0 auto;padding:22px 0 18px;display:grid;grid-template-columns:auto auto 1fr;align-items:center;gap:30px}
        .hv-footer-socials{display:flex;gap:9px;flex-wrap:wrap}
        .hv-footer-socials a{width:43px;height:43px;border:1px solid rgba(210,163,58,.55);border-radius:50%;display:grid;place-items:center;color:${gold};transition:background .2s,color .2s,transform .2s}
        .hv-footer-socials a:hover{background:${gold};color:${forest};transform:translateY(-2px)}
        .hv-footer-socials svg{width:18px;height:18px;fill:currentColor}
        .hv-footer-fssai{display:flex;align-items:center;gap:10px;background:#fff;border-radius:8px;padding:7px 13px;color:#19351f;white-space:nowrap}
        .hv-footer-fssai img{object-fit:contain}
        .hv-footer-fssai>span{height:26px;width:1px;background:#ddd}
        .hv-footer-fssai strong{display:block;font-size:10.5px}
        .hv-footer-fssai small{display:block;font-size:9.5px;color:#657065;margin-top:2px}
        .hv-footer-trust{display:flex;justify-content:flex-end;gap:26px}
        .hv-footer-trust div{display:flex;align-items:center;gap:9px;color:rgba(244,239,227,.68);font-size:11.5px;line-height:1.35}
        .hv-footer-trust b{color:${gold};font-size:22px;font-family:Georgia,serif;font-weight:400}
        .hv-footer-copyright{max-width:1500px;margin:0 auto;color:rgba(244,239,227,.38);font-size:11px;padding-top:2px}
        .hv-footer-copyright strong{color:rgba(244,239,227,.72);font-weight:700}
        .hv-footer-motif{position:absolute;z-index:1;top:115px;color:rgba(210,163,58,.28);font-family:Georgia,serif;font-size:38px;display:flex;flex-direction:column;gap:18px;line-height:.6}
        .hv-footer-motif-left{left:1.2%}.hv-footer-motif-right{right:1.2%;transform:scaleX(-1)}
        @media(max-width:1180px){.hv-footer-main{grid-template-columns:1.3fr 1fr 1fr;gap:38px}.hv-footer-contact{grid-column:2 / 4}.hv-footer-bottom{grid-template-columns:auto auto;}.hv-footer-trust{grid-column:1 / -1;justify-content:flex-start;flex-wrap:wrap}}
        @media(max-width:760px){.hv-footer-landscape{height:185px}.hv-footer-body{margin-top:-18px;padding:0 22px 20px}.hv-footer-main{grid-template-columns:1fr;gap:28px;padding-bottom:28px}.hv-footer-brand{padding-right:0}.hv-footer-brand h2{font-size:25px}.hv-footer-contact{grid-column:auto}.hv-footer-bottom{grid-template-columns:1fr;gap:18px;padding-top:18px}.hv-footer-trust{gap:16px}.hv-footer-trust div{font-size:11px}.hv-footer-motif{display:none}.hv-footer-divider{margin:0}.hv-footer-copyright{font-size:10.5px;line-height:1.6}}
        @media(max-width:430px){.hv-footer-landscape{height:150px}.hv-footer-body{padding-left:17px;padding-right:17px}.hv-footer-socials a{width:40px;height:40px}.hv-footer-fssai{width:max-content;max-width:100%}.hv-footer-trust{display:grid;grid-template-columns:1fr 1fr}.hv-footer-kicker:before,.hv-footer-kicker:after{width:28px}}
      `}</style>
    </footer>
  )
}
