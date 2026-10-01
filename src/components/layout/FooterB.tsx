'use client'

import Link from 'next/link'
import Image from 'next/image'
import type { SiteSettings } from '@/types'

interface Props { settings: SiteSettings }

const gold = '#d7a63a'
const cream = '#f5f0e5'
const green = '#063b22'
const green2 = '#052d1b'
const muted = 'rgba(245,240,229,.72)'

function SocialIcon({ type }: { type: 'instagram'|'facebook'|'x'|'youtube'|'linkedin' }) {
  const common = { width: 19, height: 19, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  if (type === 'instagram') return <svg {...common}><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r=".8" fill="currentColor" stroke="none"/></svg>
  if (type === 'facebook') return <svg {...common} fill="currentColor" stroke="none"><path d="M14.2 21v-8h2.7l.4-3h-3.1V8.1c0-.9.3-1.5 1.6-1.5h1.7V4a21 21 0 0 0-2.5-.1c-2.5 0-4.2 1.5-4.2 4.3V10H8v3h2.8v8z"/></svg>
  if (type === 'x') return <svg {...common}><path d="M5 4l14 16M19 4L5 20"/></svg>
  if (type === 'youtube') return <svg {...common}><rect x="3" y="6" width="18" height="12" rx="3"/><path d="M10 9l5 3-5 3z" fill="currentColor" stroke="none"/></svg>
  return <svg {...common}><path d="M7 9v8M7 6v.1M11 17v-5a3 3 0 0 1 6 0v5M11 12V9"/><rect x="3" y="3" width="18" height="18" rx="2" opacity=".001" stroke="none"/></svg>
}

function SocialButton({ href, type }: { href: string; type: 'instagram'|'facebook'|'x'|'youtube'|'linkedin' }) {
  return <a href={href} target="_blank" rel="noopener noreferrer" aria-label={type} style={{ width: 50, height: 50, borderRadius: '50%', border: `1px solid ${gold}`, color: cream, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', textDecoration: 'none', transition: 'all .2s' }} onMouseEnter={e => { e.currentTarget.style.background = gold; e.currentTarget.style.color = green2 }} onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = cream }}><SocialIcon type={type}/></a>
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

export default function FooterB({ settings }: Props) {
  const instagram = settings.social_instagram || 'https://www.instagram.com/5pahadiroots/?hl=en'
  const facebook = settings.social_facebook || 'https://www.facebook.com/HimVedaByPahadiRoots'
  const x = settings.social_twitter || 'https://twitter.com/pahadiroots'
  const youtube = settings.social_youtube || 'https://www.youtube.com/@pahadiroots'
  const linkedin = settings.social_linkedin || settings.linkedin_url || 'https://www.linkedin.com/company/pahadiroots/about/?viewAsMember=true'
  const email = settings.contact_email || 'hello@pahadiroots.com'
  const phone = settings.contact_phone || '+91 9899984895'
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
    ['Our Story','/our-stories'],['By Region','/regions'],['Returns & Refunds','/policies/returns'],['Shipping Policy','/policies/shipping'],['Privacy Policy','/policies/privacy'],['Terms & Conditions','/policies/terms'],
  ]

  return <footer className="hvb-footer" style={{ background: green2, color: cream, fontFamily: 'Lato,sans-serif', overflow: 'hidden' }}>
    <div className="hvb-hero" style={{ position:'relative', minHeight: 360, backgroundImage:'linear-gradient(90deg, rgba(3,42,25,.98) 0%, rgba(3,42,25,.93) 36%, rgba(3,42,25,.38) 68%, rgba(3,42,25,.12) 100%), url(/footer-himalaya.jpg)', backgroundSize:'cover', backgroundPosition:'center' }}>
      <div style={{ position:'absolute', inset:0, background:'linear-gradient(180deg, rgba(3,42,25,.08) 40%, rgba(3,42,25,.9) 100%)' }}/>
      <div className="hvb-hero-inner" style={{ position:'relative', maxWidth:1320, minHeight:360, margin:'0 auto', padding:'58px 56px 44px', display:'flex', alignItems:'center' }}>
        <div style={{ maxWidth:650 }}>
          <div style={{ color:gold, fontSize:48, lineHeight:1, marginBottom:8 }}>⌁</div>
          <h2 style={{ fontFamily:'var(--font-playfair),Georgia,serif', fontSize:'clamp(34px,4vw,54px)', lineHeight:1.05, margin:0, fontWeight:700, letterSpacing:'-.8px' }}>HimVeda by Pahadi Roots</h2>
          <div style={{ display:'flex', alignItems:'center', gap:14, margin:'18px 0 24px', color:gold, fontSize:13, letterSpacing:4, fontWeight:800 }}><span style={{ height:1, width:78, background:gold }}/><span>HIMALAYAN NATURAL STORE</span><span style={{ height:1, width:78, background:gold }}/></div>
          <p style={{ maxWidth:630, margin:0, color:cream, fontSize:18, lineHeight:1.7 }}>Born in the mountains, delivered to your doorstep. Pure Himalayan natural products, sourced with love from farming communities across 10 Himalayan states.</p>
        </div>
      </div>
      <div style={{ position:'absolute', left:0, right:0, bottom:-1, height:34, background:green2, clipPath:'polygon(0 55%, 6% 55%, 10% 35%, 15% 62%, 21% 42%, 28% 72%, 35% 40%, 42% 65%, 50% 35%, 58% 65%, 65% 42%, 72% 70%, 80% 40%, 87% 66%, 94% 35%, 100% 58%, 100% 100%, 0 100%)' }}/>
    </div>

    <div className="hvb-columns" style={{ maxWidth:1320, margin:'0 auto', padding:'42px 56px 34px', display:'grid', gridTemplateColumns:'1fr 1fr 1.18fr', gap:48, borderBottom:'1px solid rgba(215,166,58,.45)' }}>
      <div><SectionTitle>Quick Selects</SectionTitle>{products.map(([icon,label,href]) => <Link key={label} href={href} className="hvb-link" style={{ display:'flex', alignItems:'center', gap:14, color:muted, textDecoration:'none', marginBottom:15, fontSize:16 }}><LineIcon kind={icon}/><span>{label}</span></Link>)}</div>
      <div className="hvb-divider"><SectionTitle>Company</SectionTitle>{company.filter(([label]) => label !== 'Our Story' || settings.about_page_enabled !== 'false').map(([label,href]) => <Link key={label} href={href} className="hvb-link" style={{ display:'flex', justifyContent:'space-between', color:muted, textDecoration:'none', marginBottom:16, fontSize:16 }}>{label}<span style={{ color:cream }}>›</span></Link>)}</div>
      <div className="hvb-divider"><SectionTitle>Connect With Us</SectionTitle><ContactRow icon="globe" text="pahadiroots.com" href="https://www.pahadiroots.com"/><ContactRow icon="mail" text={email} href={`mailto:${email}`}/><ContactRow icon="phone" text={phone} href={`tel:${phone.replace(/\s/g,'')}`}/><ContactRow icon="pin" text={address}/></div>
    </div>

    <div className="hvb-bottom" style={{ maxWidth:1320, margin:'0 auto', padding:'22px 56px 28px', display:'grid', gridTemplateColumns:'1fr auto 1.5fr', gap:28, alignItems:'center' }}>
      <div style={{ display:'flex', gap:12, flexWrap:'wrap' }}><SocialButton href={instagram} type="instagram"/><SocialButton href={facebook} type="facebook"/><SocialButton href={x} type="x"/><SocialButton href={youtube} type="youtube"/><SocialButton href={linkedin} type="linkedin"/></div>
      {settings.fssai_license ? <div style={{ background:'#fff', color:'#173b25', borderRadius:10, padding:'8px 14px', display:'flex', alignItems:'center', gap:10, minWidth:230 }}><Image src="/fssai-logo.png" alt="FSSAI" width={52} height={40} style={{ objectFit:'contain' }}/><div style={{ borderLeft:'1px solid #ddd', paddingLeft:10 }}><strong style={{ fontSize:12 }}>FSSAI Licensed</strong><div style={{ fontSize:10, marginTop:2 }}>Lic. No. {settings.fssai_license}</div></div></div> : <div/>}
      <div className="hvb-trust" style={{ display:'flex', justifyContent:'flex-end', gap:24, flexWrap:'wrap' }}><Trust icon="leaf" title="Pure & Natural"/><Trust icon="mountain" title="Sourced from Himalayan Regions"/><Trust icon="hand" title="Supports Local Communities"/><Trust icon="leaf" title="Sustainable & Ethical"/></div>
    </div>
    <div style={{ maxWidth:1320, margin:'0 auto', padding:'0 56px 24px', color:'rgba(245,240,229,.55)', fontSize:12 }}>© {new Date().getFullYear()} <strong style={{ color:cream }}>HimVeda by Pahadi Roots</strong> · Himachal Pradesh, India</div>
    <style>{`@media(max-width:900px){.hvb-columns{grid-template-columns:1fr 1fr!important;padding:34px 28px!important}.hvb-bottom{grid-template-columns:1fr!important;padding:24px 28px!important}.hvb-trust{justify-content:flex-start!important}.hvb-divider{border-left:0!important;padding-left:0!important}.hvb-hero-inner{padding:48px 28px!important}}@media(max-width:620px){.hvb-columns{grid-template-columns:1fr!important}.hvb-hero{min-height:430px!important}.hvb-hero-inner{min-height:430px!important;align-items:flex-end!important;padding-bottom:62px!important}.hvb-hero-inner p{font-size:15px!important}.hvb-hero h2{font-size:35px!important}.hvb-bottom{padding:22px 20px!important}.hvb-trust{gap:14px!important}.hvb-footer .hvb-link{font-size:15px!important}}`}</style>
  </footer>
}

function SectionTitle({ children }: { children: React.ReactNode }) { return <div style={{ color:gold, textTransform:'uppercase', letterSpacing:3, fontSize:12, fontWeight:800, paddingBottom:11, marginBottom:19, borderBottom:'1px solid rgba(215,166,58,.35)' }}>{children}</div> }
function ContactRow({ icon, text, href }: { icon:'globe'|'mail'|'phone'|'pin'; text:string; href?:string }) { const body=<div style={{ display:'flex', alignItems:'flex-start', gap:14, marginBottom:17, color:muted, fontSize:15, lineHeight:1.55 }}><LineIcon kind={icon}/><span>{text}</span></div>; return href ? <a href={href} style={{ textDecoration:'none' }}>{body}</a> : body }
function Trust({ icon, title }: { icon:'leaf'|'mountain'|'hand'; title:string }) { return <div style={{ display:'flex', alignItems:'center', gap:9, color:muted, fontSize:13 }}><span style={{ color:gold, fontSize:23 }}>{icon==='mountain'?'⌁':icon==='hand'?'♧':'◈'}</span><span>{title}</span></div> }
