import Image from 'next/image'
import type { SiteSettings } from '@/types'

export const GOLD = '#d7a63a'
export const CREAM = '#f1ebdb'

export type FooterData = ReturnType<typeof getFooterData>

/**
 * Single source of truth for everything footers B and C read from
 * site_settings, so both stay in sync with the admin panel.
 *
 * BUG FIX: the admin Social tab saves LinkedIn as `social_linkedin`, but the
 * old footers read `linkedin_url` (a key nothing writes) — so the admin's
 * LinkedIn field never reached the live footer. `social_linkedin` wins now,
 * `linkedin_url` is kept as a legacy fallback.
 */
export function getFooterData(settings: SiteSettings) {
  const s = settings as unknown as Record<string, string | undefined>
  return {
    instagram: s.social_instagram || 'https://www.instagram.com/5pahadiroots/?hl=en',
    facebook:  s.social_facebook  || 'https://www.facebook.com/HimVedaByPahadiRoots',
    x:         s.social_twitter   || 'https://twitter.com/pahadiroots',
    youtube:   s.social_youtube   || 'https://www.youtube.com/@pahadiroots',
    linkedin:  s.social_linkedin  || s.linkedin_url || 'https://www.linkedin.com/company/pahadiroots/about/?viewAsMember=true',
    email:     s.contact_email    || 'hello@pahadiroots.com',
    phone:     s.contact_phone    || '+919899984895',
    address:   s.contact_address  || 'Village Sakoh, PO Sakoh, Distt Kangra, Himachal Pradesh 176082',
    fssai:     s.fssai_license    || '',
    showOurStory: s.about_page_enabled !== 'false',
  }
}

export const PRODUCTS = [
  ['honey',  'Wild Honey',       '/products?category=wild-honey'],
  ['ghee',   'A2 Bilona Ghee',   '/products?category=ghee'],
  ['saffron','Kashmiri Saffron', '/products?category=saffron'],
  ['stone',  'Ladakhi Shilajit', '/collections/shilajit'],
  ['tea',    'Himalayan Teas',   '/collections/himalayan-teas'],
  ['grain',  'Ancient Grains',   '/collections/heritage-rice'],
] as const

export const COMPANY = [
  ['Our Story',          '/our-stories'],
  ['By Region',          '/regions'],
  ['Returns & Refunds',  '/policies/returns'],
  ['Shipping Policy',    '/policies/shipping'],
  ['Privacy Policy',     '/policies/privacy'],
  ['Terms & Conditions', '/policies/terms'],
] as const

const line = { fill: 'none', stroke: GOLD, strokeWidth: 1.4, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }

export function ProductIcon({ kind }: { kind: typeof PRODUCTS[number][0] }) {
  const p: Record<string, React.ReactNode> = {
    honey: <><path d="M10 5.5h12v3.5H10z"/><path d="M9 9h14c1 2.2 1.6 4.6 1.6 7.4v7.4a2 2 0 0 1-2 2H9.4a2 2 0 0 1-2-2v-7.4C7.4 13.6 8 11.2 9 9z"/><path d="M8 15.5h16M8 21.5h16"/></>,
    ghee:  <><path d="M4.5 15.5h23c0 6.2-4.8 10.5-11.5 10.5S4.5 21.7 4.5 15.5z"/><path d="M8.5 15.5c0-3.2 3.4-5.5 7.5-5.5s7.5 2.3 7.5 5.5"/><path d="M12 7.5c1-1.2 1-2.2 0-3.5M17 7.5c1-1.2 1-2.2 0-3.5"/></>,
    saffron:<><circle cx="16" cy="16" r="2.8"/>{[0,60,120,180,240,300].map(a => <ellipse key={a} cx="16" cy="8.6" rx="2.8" ry="4.8" transform={`rotate(${a} 16 16)`}/>)}</>,
    stone: <><path d="M5 22.5l3.5-11 7.5-6 8.5 6.5 3 10.5-9 4.5z"/><path d="M8.5 11.5L16 16l8.5-3M16 16v11"/></>,
    tea:   <><path d="M27 5.5C14.5 5.5 6.5 12 6.5 23c11 0 18.5-6.5 20.5-17.5z"/><path d="M5.5 28C11 20 17 14.5 25 9.5"/></>,
    grain: <><path d="M16 28.5V5"/><path d="M16 10c-4.5 0-7-2.5-7-5 4.5 0 7 2.5 7 5zM16 10c4.5 0 7-2.5 7-5-4.5 0-7 2.5-7 5zM16 16.5c-4.5 0-7-2.5-7-5 4.5 0 7 2.5 7 5zM16 16.5c4.5 0 7-2.5 7-5-4.5 0-7 2.5-7 5zM16 23c-4.5 0-7-2.5-7-5 4.5 0 7 2.5 7 5zM16 23c4.5 0 7-2.5 7-5-4.5 0-7 2.5-7 5z"/></>,
  }
  return <svg className="hv-ico" viewBox="0 0 32 32" aria-hidden="true" {...line}>{p[kind]}</svg>
}

export function ContactIcon({ kind, bg }: { kind: 'globe' | 'mail' | 'phone' | 'pin'; bg: string }) {
  if (kind === 'globe') return <svg className="hv-ico" viewBox="0 0 32 32" aria-hidden="true" {...line} strokeWidth={1.7}><circle cx="16" cy="16" r="11.5"/><ellipse cx="16" cy="16" rx="4.8" ry="11.5"/><path d="M4.5 16h23M6 10.5h20M6 21.5h20"/></svg>
  if (kind === 'mail') return <svg className="hv-ico" viewBox="0 0 32 32" aria-hidden="true"><rect x="3.5" y="7" width="25" height="18" rx="2" fill={GOLD}/><path d="M4.5 9l11.5 9 11.5-9" fill="none" stroke={bg} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
  if (kind === 'phone') return <svg className="hv-ico" viewBox="0 0 24 24" aria-hidden="true"><path fill={GOLD} d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C10.6 21 3 13.4 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1z"/></svg>
  return <svg className="hv-ico" viewBox="0 0 24 24" aria-hidden="true"><path fill={GOLD} fillRule="evenodd" d="M12 2C8.1 2 5 5.1 5 9c0 5.3 7 13 7 13s7-7.7 7-13c0-3.9-3.1-7-7-7zm0 9.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5z"/></svg>
}

export function SocialIcon({ type }: { type: 'instagram' | 'facebook' | 'x' | 'youtube' | 'linkedin' }) {
  const c = { viewBox: '0 0 24 24', 'aria-hidden': true as const, fill: CREAM }
  if (type === 'instagram') return <svg {...c} fill="none" stroke={CREAM} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4.1"/><circle cx="17.5" cy="6.5" r="1" fill={CREAM} stroke="none"/></svg>
  if (type === 'facebook') return <svg {...c}><path d="M13.5 21v-8h2.7l.4-3.2h-3.1V7.9c0-.9.3-1.5 1.6-1.5h1.7V3.6c-.3 0-1.3-.1-2.4-.1-2.4 0-4 1.5-4 4.1v2.2H7.5V13h2.9v8z"/></svg>
  if (type === 'x') return <svg {...c}><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
  if (type === 'youtube') return <svg {...c} fillRule="evenodd"><path d="M21.6 7.2a2.5 2.5 0 0 0-1.8-1.8C18.2 5 12 5 12 5s-6.2 0-7.8.4A2.5 2.5 0 0 0 2.4 7.2C2 8.8 2 12 2 12s0 3.2.4 4.8a2.5 2.5 0 0 0 1.8 1.8C5.8 19 12 19 12 19s6.2 0 7.8-.4a2.5 2.5 0 0 0 1.8-1.8c.4-1.6.4-4.8.4-4.8s0-3.2-.4-4.8zM10 15V9l5.2 3z"/></svg>
  return <svg {...c} fillRule="evenodd"><path d="M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM7.1 9.6v7.4h2.3V9.6zM8.25 6.4a1.35 1.35 0 1 0 0 2.7 1.35 1.35 0 0 0 0-2.7zM10.9 9.6V17h2.3v-3.9c0-.9.2-1.8 1.3-1.8s1.2.9 1.2 1.8V17h2.3v-4.2c0-2.1-.5-3.4-2.6-3.4-1.1 0-1.9.5-2.3 1.2v-1z"/></svg>
}

export function SocialRow({ d }: { d: FooterData }) {
  const items = [
    ['instagram', d.instagram, 'Instagram'], ['facebook', d.facebook, 'Facebook'], ['x', d.x, 'X'],
    ['youtube', d.youtube, 'YouTube'], ['linkedin', d.linkedin, 'LinkedIn'],
  ] as const
  return <>{items.map(([t, href, label]) =>
    <a key={t} className="hv-soc" href={href} target="_blank" rel="noopener noreferrer" aria-label={label} title={label}><SocialIcon type={t}/></a>
  )}</>
}

export function FssaiCard({ license }: { license: string }) {
  if (!license) return null
  return <div className="hv-fssai">
    <Image src="/fssai-logo.png" alt="FSSAI" width={77} height={59} style={{ objectFit: 'contain', width: '100%', height: 'auto' }}/>
    <div className="hv-fssai-txt"><strong>FSSAI Licensed</strong><span>Lic. No. {license}</span></div>
  </div>
}

export function LeafMark({ className }: { className?: string }) {
  return <svg className={className} viewBox="0 0 66 52" aria-hidden="true" fill="none">
    <path d="M30 50C30 38 27 26 20 16" stroke={GOLD} strokeWidth="1.8" strokeLinecap="round"/>
    <path d="M27 31C18 28 13 21 14 12c8 1 13 7 13 19z" fill={GOLD}/>
    <path d="M32 24C40 20 46 13 45 3c-9 2-14 9-13 21z" fill={GOLD}/>
    <path d="M34 36c7-2 13-8 15-16-8 1-14 7-15 16z" fill={GOLD} opacity=".9"/>
  </svg>
}

/** Faint botanical line-art used as background texture (left / right edges). */
export function Botanical({ side, className }: { side: 'left' | 'right'; className?: string }) {
  const L = side === 'left'
  return <svg className={className} viewBox="0 0 180 300" aria-hidden="true" fill="none" stroke={GOLD} strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round">
    <path d={L ? 'M20 300C34 235 54 180 83 120C103 78 123 45 151 12' : 'M160 300C146 235 126 180 97 120C77 78 57 45 29 12'} />
    <path d={L ? 'M51 211C31 201 18 184 17 166C36 168 51 183 58 199' : 'M129 211C149 201 162 184 163 166C144 168 129 183 122 199'} />
    <path d={L ? 'M73 169C52 158 43 143 45 127C62 132 75 144 79 158' : 'M107 169C128 158 137 143 135 127C118 132 105 144 101 158'} />
    <path d={L ? 'M98 120C82 108 78 93 83 80C98 86 105 99 103 111' : 'M82 120C98 108 102 93 97 80C82 86 75 99 77 111'} />
    <path d={L ? 'M31 247C56 245 71 234 77 218C57 218 40 228 31 247' : 'M149 247C124 245 109 234 103 218C123 218 140 228 149 247'} />
    <circle cx={L ? 149 : 31} cy="52" r="8"/><circle cx={L ? 149 : 31} cy="52" r="3"/>
  </svg>
}

/** Small sprig ornament that sits on the horizontal rule. */
export function Sprig({ className }: { className?: string }) {
  return <svg className={className} viewBox="0 0 48 22" aria-hidden="true" fill="none" stroke={GOLD} strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
    <path d="M24 18V9"/><path d="M24 12C17 12 10 9 7 3c8-1 14 2 17 9zM24 12c7 0 14-3 17-9-8-1-14 2-17 9z"/><path d="M3 11h8M37 11h8" opacity=".7"/>
  </svg>
}

export function TrustIcon({ kind }: { kind: 'leaf' | 'mountain' | 'hand' | 'sprout' }) {
  const p: Record<string, React.ReactNode> = {
    leaf: <><path d="M31 7C16 7 7 16.5 7 30.5c15 0 23-8.5 24-23.5z"/><path d="M6.5 34c6-9 13-15.5 21-20.5"/></>,
    mountain: <><path d="M2.5 32L14 13.5l7 10.5 5-7 11.5 15z"/><path d="M14 13.5l-3.5 5.5 3 1.5 2.5-2 3 3M26 17l-2.5 4 2.5 1.5 2-1.5"/></>,
    hand: <><path d="M20 24c-2.5-2-7-4.5-7-8.5 0-3.2 3.8-4.5 7-1 3.2-3.5 7-2.2 7 1 0 4-4.5 6.5-7 8.5z"/><path d="M3 31l6-3.5 8 .5 6-2.5 5.5 1.5-8 5.5-9.5 1.5z"/></>,
    sprout: <><path d="M20 35V18"/><path d="M20 22.5c-6.5 0-10.5-3.5-10.5-9.5 6.5 0 10.5 3.5 10.5 9.5zM20 26.5c6.5 0 10.5-3.5 10.5-9.5-6.5 0-10.5 3.5-10.5 9.5z"/></>,
  }
  return <svg className="hv-trust-ico" viewBox="0 0 40 40" aria-hidden="true" fill="none" stroke={GOLD} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">{p[kind]}</svg>
}
