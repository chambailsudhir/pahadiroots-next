'use client'

import Link from 'next/link'
import Image from 'next/image'
import type { SiteSettings } from '@/types'

interface Props { settings: SiteSettings }

const gold = '#d7a63a'
const cream = '#f5f0e5'
const green = '#063b22'
const greenDark = '#052d1b'
const muted = 'rgba(245,240,229,.78)'

function SocialIcon({ type }: { type: 'instagram'|'facebook'|'x'|'youtube'|'linkedin' }) {
  const common = { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  if (type === 'instagram') return <svg {...common}><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r=".8" fill="currentColor" stroke="none"/></svg>
  if (type === 'facebook') return <svg {...common} fill="currentColor" stroke="none"><path d="M14.2 21v-8h2.7l.4-3h-3.1V8.1c0-.9.3-1.5 1.6-1.5h1.7V4a21 21 0 0 0-2.5-.1c-2.5 0-4.2 1.5-4.2 4.3V10H8v3h2.8v8z"/></svg>
  if (type === 'x') return <svg {...common}><path d="M5 4l14 16M19 4L5 20"/></svg>
  if (type === 'youtube') return <svg {...common}><rect x="3" y="6" width="18" height="12" rx="3"/><path d="M10 9l5 3-5 3z" fill="currentColor" stroke="none"/></svg>
  return <svg {...common}><path d="M7 9v8M7 6v.1M11 17v-5a3 3 0 0 1 6 0v5M11 12V9"/><rect x="3" y="3" width="18" height="18" rx="2" opacity=".001" stroke="none"/></svg>
}

function LineIcon({ kind }: { kind: 'honey'|'ghee'|'flower'|'stone'|'leaf'|'grain'|'globe'|'mail'|'phone'|'pin' }) {
  const base = { width: 28, height: 28, viewBox: '0 0 28 28', fill: 'none', stroke: gold, strokeWidth: 1.35, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  const paths: Record<string, React.ReactNode> = {
    honey: <><path d="M8 9h12l2 4v9H6v-9z"/><path d="M9 9V6h10v3M9 15h10"/></>,
    ghee: <><path d="M6 13h16v9H6z"/><path d="M8 13c.8-5 3-7 6-7s5.2 2 6 7M10 17h8"/></>,
    flower: <><circle cx="14" cy="14" r="3"/><circle cx="14" cy="7" r="3"/><circle cx="21" cy="14" r="3"/><circle cx="14" cy="21" r="3"/><circle cx="7" cy="14" r="3"/></>,
    stone: <><path d="M7 21l2-11 6-5 6 5 1 11z"/><path d="M11 13l3-3 3 3-3 4z"/></>,
    leaf: <><path d="M22 6C12 6 6 11 6 20c7 0 13-4 16-14z"/><path d="M7 21c4-4 7-7 13-11"/></>,
    grain: <><path d="M14 24V5"/><path d="M14 9c-4 0-6-2-6-4 4 0 6 2 6 4zM14 14c4 0 6-2 6-4-4 0-6 2-6 4zM14 19c-4 0-6-2-6-4 4 0 6 2 6 4z"/></>,
    globe: <><circle cx="14" cy="14" r="10"/><path d="M4 14h20M14 4c3 3 4 6 4 10s-1 7-4 10c-3-3-4-6-4-10s1-7 4-10z"/></>,
    mail: <><rect x="4" y="7" width="20" height="14" rx="2"/><path d="M5 9l9 7 9-7"/></>,
    phone: <path d="M9 5l3 3-2 3c1 2 3 4 5 5l3-2 3 3-2 4c-8 1-14-5-14-13z"/>,
    pin: <><path d="M14 24s7-7 7-12a7 7 0 1 0-14 0c0 5 7 12 7 12z"/><circle cx="14" cy="12" r="2.5"/></>,
  }
  return <svg {...base}>{paths[kind]}</svg>
}

function LeafMark() {
  return (
    <svg width="44" height="52" viewBox="0 0 44 52" aria-hidden="true">
      <path d="M22 45C21 30 19 18 13 7" stroke={gold} strokeWidth="1.6" fill="none"/>
      <path d="M21 25C14 22 9 17 9 11c7 1 11 5 12 10" fill="none" stroke={gold} strokeWidth="1.6"/>
      <path d="M20 31C27 28 33 23 34 16c-7 1-12 5-14 11" fill="none" stroke={gold} strokeWidth="1.6"/>
      <path d="M22 19C26 15 30 10 29 4c-6 2-9 7-9 12" fill={gold} opacity=".95"/>
    </svg>
  )
}

function Botanical({ side }: { side: 'left'|'right' }) {
  return (
    <svg className={`footer-c-botanical footer-c-${side}`} viewBox="0 0 180 300" aria-hidden="true">
      <g fill="none" stroke={gold} strokeWidth="1.1" opacity=".55" strokeLinecap="round" strokeLinejoin="round">
        <path d={side === 'left' ? 'M20 300C34 235 54 180 83 120C103 78 123 45 151 12' : 'M160 300C146 235 126 180 97 120C77 78 57 45 29 12'} />
        <path d={side === 'left' ? 'M51 211C31 201 18 184 17 166C36 168 51 183 58 199' : 'M129 211C149 201 162 184 163 166C144 168 129 183 122 199'} />
        <path d={side === 'left' ? 'M73 169C52 158 43 143 45 127C62 132 75 144 79 158' : 'M107 169C128 158 137 143 135 127C118 132 105 144 101 158'} />
        <path d={side === 'left' ? 'M98 120C82 108 78 93 83 80C98 86 105 99 103 111' : 'M82 120C98 108 102 93 97 80C82 86 75 99 77 111'} />
        <path d={side === 'left' ? 'M31 247C56 245 71 234 77 218C57 218 40 228 31 247' : 'M149 247C124 245 109 234 103 218C123 218 140 228 149 247'} />
        <circle cx={side === 'left' ? 149 : 31} cy="52" r="8"/>
        <circle cx={side === 'left' ? 149 : 31} cy="52" r="3"/>
      </g>
    </svg>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div style={{ color: gold, textTransform: 'uppercase', letterSpacing: 3, fontSize: 12, fontWeight: 800, paddingBottom: 11, marginBottom: 20, borderBottom: '1px solid rgba(215,166,58,.38)' }}>{children}</div>
}

function ContactRow({ icon, text, href }: { icon: 'globe'|'mail'|'phone'|'pin'; text: string; href?: string }) {
  const body = <div style={{ display:'flex', alignItems:'flex-start', gap:14, marginBottom:18, color:muted, fontSize:15, lineHeight:1.55 }}><LineIcon kind={icon}/><span>{text}</span></div>
  return href ? <a href={href} style={{ textDecoration:'none' }}>{body}</a> : body
}

export default function FooterC({ settings }: Props) {
  const instagram = settings.social_instagram || 'https://www.instagram.com/5pahadiroots/?hl=en'
  const facebook = settings.social_facebook || 'https://www.facebook.com/HimVedaByPahadiRoots'
  const x = settings.social_twitter || 'https://twitter.com/pahadiroots'
  const youtube = settings.social_youtube || 'https://www.youtube.com/@pahadiroots'
  const linkedin = settings.social_linkedin || settings.linkedin_url || 'https://www.linkedin.com/company/pahadiroots/about/?viewAsMember=true'
  const email = settings.contact_email || 'hello@pahadiroots.com'
  const phone = settings.contact_phone || '+919899984895'
  const address = settings.contact_address || 'Village Sakoh, PO Sakoh, Distt Kangra, Himachal Pradesh 176082'

  const products = [
    ['honey','Wild Honey','/products?category=wild-honey'],
    ['ghee','A2 Bilona Ghee','/products?category=ghee'],
    ['flower','Kashmiri Saffron','/products?category=saffron'],
    ['stone','Ladakhi Shilajit','/collections/shilajit'],
    ['leaf','Himalayan Teas','/collections/himalayan-teas'],
    ['grain','Ancient Grains','/collections/heritage-rice'],
  ] as const

  const company = [
    ['Our Story','/our-stories'],
    ['By Region','/regions'],
    ['Returns & Refunds','/policies/returns'],
    ['Shipping Policy','/policies/shipping'],
    ['Privacy Policy','/policies/privacy'],
    ['Terms & Conditions','/policies/terms'],
  ]

  return (
    <footer className="footer-c" style={{ background: greenDark, color: cream, fontFamily:'Lato,sans-serif', overflow:'hidden' }}>
      <section className="footer-c-hero" style={{
        position:'relative', minHeight:360,
        backgroundImage:'linear-gradient(90deg, rgba(3,42,25,.98) 0%, rgba(3,42,25,.88) 38%, rgba(3,42,25,.30) 70%, rgba(3,42,25,.08) 100%), url(/footer-himalaya.jpg)',
        backgroundSize:'cover', backgroundPosition:'center',
      }}>
        <div style={{ position:'absolute', inset:0, background:'linear-gradient(180deg, rgba(3,42,25,.02) 40%, rgba(5,45,27,.96) 100%)' }} />
        <Botanical side="left" />
        <Botanical side="right" />
        <div className="footer-c-hero-inner" style={{ position:'relative', zIndex:2, maxWidth:1320, minHeight:360, margin:'0 auto', padding:'52px 56px 48px', display:'flex', alignItems:'center' }}>
          <div style={{ maxWidth:650 }}>
            <LeafMark />
            <h2 style={{ fontFamily:'var(--font-playfair),Georgia,serif', fontSize:'clamp(34px,4.1vw,56px)', lineHeight:1.05, margin:'-2px 0 0', fontWeight:700, letterSpacing:'-.8px', color:'#fff' }}>HimVeda by Pahadi Roots</h2>
            <div style={{ display:'flex', alignItems:'center', gap:14, margin:'18px 0 24px', color:gold, fontSize:13, letterSpacing:4, fontWeight:800 }}>
              <span style={{ height:1, width:78, background:gold }}/><span>HIMALAYAN NATURAL STORE</span><span style={{ height:1, width:78, background:gold }}/>
            </div>
            <p style={{ maxWidth:640, margin:0, color:cream, fontSize:18, lineHeight:1.65 }}>Born in the mountains, delivered to your doorstep. Pure Himalayan natural products, sourced with love from farming communities across 10 Himalayan states.</p>
          </div>
        </div>

        <div className="footer-c-mountain-divider" aria-hidden="true">
          <svg viewBox="0 0 1200 46" preserveAspectRatio="none">
            <path d="M0 31H548L575 7l25 24 27-25 28 25h545" fill="none" stroke={gold} strokeWidth="1.2"/>
            <path d="M575 31l25-25 27 25" fill="none" stroke={gold} strokeWidth="1"/>
            <path d="M591 31l9-9 9 9" fill="none" stroke={gold} strokeWidth=".8"/>
          </svg>
        </div>
      </section>

      <section className="footer-c-columns" style={{ maxWidth:1320, margin:'0 auto', padding:'42px 56px 34px', display:'grid', gridTemplateColumns:'1fr 1fr 1.15fr', gap:48, borderBottom:'1px solid rgba(215,166,58,.38)', position:'relative' }}>
        <Botanical side="left" />
        <Botanical side="right" />

        <div className="footer-c-col">
          <SectionTitle>Quick Selects</SectionTitle>
          {products.map(([icon,label,href]) => <Link key={label} href={href} className="footer-c-link" style={{ display:'flex', alignItems:'center', gap:14, color:muted, textDecoration:'none', marginBottom:15, fontSize:16 }}><LineIcon kind={icon}/><span>{label}</span></Link>)}
        </div>

        <div className="footer-c-col footer-c-middle">
          <SectionTitle>Company</SectionTitle>
          {company.filter(([label]) => label !== 'Our Story' || settings.about_page_enabled !== 'false').map(([label,href]) => (
            <Link key={label} href={href} className="footer-c-link" style={{ display:'flex', justifyContent:'space-between', color:muted, textDecoration:'none', marginBottom:16, fontSize:16 }}>
              <span>{label}</span><span style={{ color:cream, fontSize:21, lineHeight:1 }}>›</span>
            </Link>
          ))}
        </div>

        <div className="footer-c-col footer-c-middle">
          <SectionTitle>Connect With Us</SectionTitle>
          <ContactRow icon="globe" text="pahadiroots.com" href="https://www.pahadiroots.com"/>
          <ContactRow icon="mail" text={email} href={`mailto:${email}`}/>
          <ContactRow icon="phone" text={phone} href={`tel:${phone.replace(/\s/g,'')}`}/>
          <ContactRow icon="pin" text={address}/>
        </div>
      </section>

      <section className="footer-c-bottom" style={{ maxWidth:1320, margin:'0 auto', padding:'26px 56px 18px', display:'flex', alignItems:'center', gap:28, flexWrap:'wrap', position:'relative' }}>
        <div style={{ display:'flex', gap:12, flexWrap:'wrap' }}>
          <a href={instagram} target="_blank" rel="noopener noreferrer" aria-label="Instagram" className="footer-c-social"><SocialIcon type="instagram"/></a>
          <a href={facebook} target="_blank" rel="noopener noreferrer" aria-label="Facebook" className="footer-c-social"><SocialIcon type="facebook"/></a>
          <a href={x} target="_blank" rel="noopener noreferrer" aria-label="X" className="footer-c-social"><SocialIcon type="x"/></a>
          <a href={youtube} target="_blank" rel="noopener noreferrer" aria-label="YouTube" className="footer-c-social"><SocialIcon type="youtube"/></a>
          <a href={linkedin} target="_blank" rel="noopener noreferrer" aria-label="LinkedIn" className="footer-c-social"><SocialIcon type="linkedin"/></a>
        </div>

        {settings.fssai_license ? (
          <div className="footer-c-fssai" style={{ background:'#fff', color:'#173b25', borderRadius:10, padding:'8px 14px', display:'flex', alignItems:'center', gap:10, minWidth:230 }}>
            <Image src="/fssai-logo.png" alt="FSSAI" width={52} height={40} style={{ objectFit:'contain' }}/>
            <div style={{ borderLeft:'1px solid #ddd', paddingLeft:10 }}>
              <strong style={{ fontSize:12 }}>FSSAI Licensed</strong>
              <div style={{ fontSize:10, marginTop:2 }}>Lic. No. {settings.fssai_license}</div>
            </div>
          </div>
        ) : null}

        <div className="footer-c-credits" style={{ marginLeft:'auto', color:'rgba(245,240,229,.55)', fontSize:12, lineHeight:1.7 }}>
          © {new Date().getFullYear()} <strong style={{ color:cream }}>HimVeda by Pahadi Roots</strong> · Himachal Pradesh, India
        </div>
      </section>

      <div className="footer-c-botanical-bottom" aria-hidden="true">
        <Botanical side="right" />
      </div>

      <style>{`
        .footer-c { position:relative; }
        .footer-c-hero { isolation:isolate; }
        .footer-c-hero > .footer-c-left,
        .footer-c-hero > .footer-c-right { position:absolute; top:0; bottom:0; z-index:1; }
        .footer-c-hero .footer-c-left { left:0; width:190px; }
        .footer-c-hero .footer-c-right { right:0; width:190px; }
        .footer-c-botanical { position:absolute; width:190px; height:315px; pointer-events:none; z-index:1; }
        .footer-c-left { left:-8px; bottom:-8px; }
        .footer-c-right { right:-8px; bottom:-8px; transform:scaleX(-1); }
        .footer-c-columns > .footer-c-left { left:-10px; bottom:-38px; opacity:.28; }
        .footer-c-columns > .footer-c-right { right:-10px; bottom:-38px; opacity:.28; }
        .footer-c-middle { border-left:1px solid rgba(215,166,58,.34); padding-left:48px; }
        .footer-c-link { transition: color .2s ease, transform .2s ease; }
        .footer-c-link:hover { color:#fff!important; transform:translateX(2px); }
        .footer-c-social { width:52px; height:52px; border:1px solid ${gold}; border-radius:50%; display:inline-flex; align-items:center; justify-content:center; color:${cream}; text-decoration:none; transition:all .2s ease; }
        .footer-c-social:hover { background:${gold}; color:${greenDark}; }
        .footer-c-mountain-divider { position:absolute; left:0; right:0; bottom:-1px; height:46px; z-index:3; }
        .footer-c-mountain-divider svg { display:block; width:100%; height:100%; }
        .footer-c-botanical-bottom { min-height:55px; position:relative; overflow:hidden; border-top:1px solid rgba(215,166,58,.25); }
        .footer-c-botanical-bottom .footer-c-right { position:absolute; right:-8px; bottom:-205px; opacity:.38; }
        @media(max-width:960px){
          .footer-c-hero-inner { padding:48px 28px!important; }
          .footer-c-columns { grid-template-columns:1fr 1fr!important; padding:36px 28px 30px!important; gap:28px!important; }
          .footer-c-middle { border-left:0; padding-left:0; }
          .footer-c-bottom { padding:24px 28px 18px!important; }
          .footer-c-credits { width:100%; margin-left:0!important; }
        }
        @media(max-width:640px){
          .footer-c-hero { min-height:430px!important; background-position:center!important; }
          .footer-c-hero-inner { min-height:430px!important; align-items:flex-end!important; padding:40px 20px 62px!important; }
          .footer-c-hero h2 { font-size:35px!important; }
          .footer-c-hero p { font-size:15px!important; }
          .footer-c-hero .footer-c-botanical { opacity:.35; width:130px; }
          .footer-c-columns { grid-template-columns:1fr!important; padding:30px 20px!important; }
          .footer-c-columns > .footer-c-botanical { display:none; }
          .footer-c-bottom { padding:22px 20px 18px!important; }
          .footer-c-social { width:46px; height:46px; }
          .footer-c-fssai { min-width:0!important; }
          .footer-c-mountain-divider { height:34px; }
          .footer-c-botanical-bottom { display:none; }
        }
      `}</style>
    </footer>
  )
}
