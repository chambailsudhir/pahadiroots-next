'use client'

import Link from 'next/link'
import { useState, useEffect, useRef } from 'react'
import { catSlug } from '@/lib/utils'
import type { Category, State } from '@/types'

interface Props { categories: Category[]; states: State[] }

const CURATED = [
  { label: 'Best Sellers',    href: '/collections/best-sellers' },
  { label: 'New Arrivals',    href: '/collections/new-arrivals' },
  { label: 'Gift Sets',       href: '/collections/gift-sets' },
  { label: 'Pahadi Wellness', href: '/collections/wellness' },
  { label: 'Natural Honey',   href: '/collections/honey' },
  { label: 'Pure Spices',     href: '/collections/spices' },
]

export default function MegaMenu({ categories, states }: Props) {
  const [open, setOpen]       = useState(false)
  const [megaTop, setMegaTop] = useState(64)
  const [hov, setHov]         = useState<string | null>(null)
  const liRef                 = useRef<HTMLLIElement>(null)

  const cats   = categories.filter(c => c.is_active).slice(0, 12)
  const sts    = states.slice(0, 10)

  useEffect(() => {
    function update() {
      const nav = document.querySelector('nav.old-nav') as HTMLElement | null
      if (nav) setMegaTop(nav.getBoundingClientRect().bottom)
    }
    update()
    window.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update, { passive: true })
    return () => { window.removeEventListener('scroll', update); window.removeEventListener('resize', update) }
  }, [])

  useEffect(() => {
    if (!open) return
    const onOut = (e: MouseEvent) => { if (liRef.current && !liRef.current.contains(e.target as Node)) setOpen(false) }
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('click', onOut)
    document.addEventListener('keydown', onEsc)
    return () => { document.removeEventListener('click', onOut); document.removeEventListener('keydown', onEsc) }
  }, [open])

  // The ONE link style — copied verbatim from pahadiroots-main/index.html line 212-219
  // padding:7px 10px | font-size:13.5px | line-height:1 forces row = 7+13.5+7 = 27.5px
  const linkSt = (id: string): React.CSSProperties => ({
    display:        'block',
    width:          '100%',
    padding:        '7px 10px',
    borderRadius:   '8px',
    fontSize:       '13.5px',
    fontWeight:     500,
    lineHeight:     '1',        // ← CRITICAL: stop body line-height:1.5 inheritance
    fontFamily:     'Lato, sans-serif',
    color:          hov === id ? '#1a3a1e' : '#2c2c2c',
    background:     hov === id ? 'rgba(26,58,30,.08)' : 'transparent',
    textDecoration: 'none',
    cursor:         'pointer',
    whiteSpace:     'nowrap',
    letterSpacing:  '0.1px',
    margin:         '0',
    border:         'none',
    boxSizing:      'border-box',
    transition:     'background .15s, color .15s',
  })

  const boldLinkSt = (id: string): React.CSSProperties => ({
    ...linkSt(id),
    fontWeight: 600,
  })

  return (
    <li
      ref={liRef}
      style={{ listStyle:'none', margin:0, padding:0, display:'flex', alignItems:'center', height:'64px', position:'static' }}
    >
      {/* ── Trigger ── */}
      <button
        onClick={() => setOpen(v => !v)}
        onMouseEnter={e => { e.currentTarget.style.color='#1a3a1e'; e.currentTarget.style.background='rgba(26,58,30,.04)' }}
        onMouseLeave={e => { if (!open) { e.currentTarget.style.color='#2a2a2a'; e.currentTarget.style.background='none' } }}
        style={{
          background:   open ? 'rgba(26,58,30,.04)' : 'none',
          border:       'none',
          outline:      'none',
          cursor:       'pointer',
          display:      'flex',
          alignItems:   'center',
          gap:          '3px',
          color:        open ? '#1a3a1e' : '#2a2a2a',
          fontSize:     '13.5px',
          fontWeight:   600,
          lineHeight:   '1',
          fontFamily:   'Lato, sans-serif',
          padding:      '0 14px',
          height:       '64px',
          margin:       0,
          whiteSpace:   'nowrap',
          letterSpacing:'0',
          transition:   'color .2s, background .2s',
          borderRadius: 0,
          userSelect:   'none',
        }}
      >
        Shop
        <span style={{ fontSize:'10px', lineHeight:'1', display:'inline-block', marginLeft:'2px', transition:'transform .25s', transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }}>▾</span>
      </button>

      {/* ── Backdrop ── */}
      {open && <div onClick={() => setOpen(false)} style={{ position:'fixed', inset:0, zIndex:500 }} />}

      {/* ── Panel ── */}
      {open && (
        <div style={{
          position:     'fixed',
          top:          megaTop,
          left:         '50%',
          transform:    'translateX(-50%)',
          width:        'min(960px, 92vw)',
          background:   '#fff',
          borderRadius: '0 0 20px 20px',
          boxShadow:    '0 20px 60px rgba(0,0,0,.14), 0 4px 16px rgba(0,0,0,.06)',
          zIndex:       501,
          display:      'flex',
          alignItems:   'stretch',
          overflow:     'hidden',
          // Reset any inherited line-height from body at panel root
          lineHeight:   '1',
          fontSize:     '13.5px',
          fontFamily:   'Lato, sans-serif',
        }}>

          {/* ── Col 1: All Collections ── */}
          <div style={{ flex:1, padding:'20px 20px 16px', display:'flex', flexDirection:'column', background:'#fff' }}>
            <span style={{ display:'block', fontSize:'9px', fontWeight:800, letterSpacing:'2.4px', textTransform:'uppercase', color:'#a89f92', marginBottom:'12px', lineHeight:'1' }}>
              ALL COLLECTIONS
            </span>
            {/* ul: no list-style, no margin, no padding, no gap */}
            <ul style={{ listStyle:'none', margin:0, padding:0 }}>
              {cats.map(cat => (
                <li key={cat.id} style={{ margin:0, padding:0, display:'block', lineHeight:'1' }}>
                  <Link href={`/collections/${catSlug(cat)}`} style={linkSt(`c${cat.id}`)} onMouseEnter={() => setHov(`c${cat.id}`)} onMouseLeave={() => setHov(null)} onClick={() => setOpen(false)}>
                    {cat.name}
                  </Link>
                </li>
              ))}
            </ul>
            <Link href="/products" onClick={() => setOpen(false)} style={{ display:'inline-flex', alignItems:'center', gap:'5px', marginTop:'14px', paddingTop:'12px', fontSize:'13px', fontWeight:600, color:'#1a3a1e', textDecoration:'none', borderTop:'1px solid #edeae2', lineHeight:'1', fontFamily:'Lato, sans-serif' }}>
              View All Products →
            </Link>
          </div>

          {/* ── Col 2: Shop by Region ── */}
          <div style={{ flex:1.5, padding:'20px 20px 16px', display:'flex', flexDirection:'column', background:'#fff', borderLeft:'1px solid #f0ede6', borderRight:'1px solid #f0ede6' }}>
            <span style={{ display:'block', fontSize:'9px', fontWeight:800, letterSpacing:'2.4px', textTransform:'uppercase', color:'#a89f92', marginBottom:'12px', lineHeight:'1' }}>
              SHOP BY REGION
            </span>
            <ul style={{ listStyle:'none', margin:0, padding:0, display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0 4px' }}>
              {sts.map(s => (
                <li key={s.id} style={{ margin:0, padding:0, display:'block', lineHeight:'1' }}>
                  <Link href={`/regions/${s.slug}`} style={linkSt(`s${s.id}`)} onMouseEnter={() => setHov(`s${s.id}`)} onMouseLeave={() => setHov(null)} onClick={() => setOpen(false)}>
                    {s.name}
                  </Link>
                </li>
              ))}
            </ul>
            <Link href="/regions" onClick={() => setOpen(false)} style={{ display:'inline-flex', alignItems:'center', gap:'5px', marginTop:'14px', paddingTop:'12px', fontSize:'13px', fontWeight:600, color:'#1a3a1e', textDecoration:'none', borderTop:'1px solid #edeae2', lineHeight:'1', fontFamily:'Lato, sans-serif' }}>
              View All Regions →
            </Link>
          </div>

          {/* ── Col 3: Curated Picks ── */}
          <div style={{ flex:1, padding:'20px 20px 16px', display:'flex', flexDirection:'column', background:'#f7f4ee' }}>
            <span style={{ display:'block', fontSize:'9px', fontWeight:800, letterSpacing:'2.4px', textTransform:'uppercase', color:'#a89f92', marginBottom:'12px', lineHeight:'1' }}>
              CURATED PICKS
            </span>
            <ul style={{ listStyle:'none', margin:0, padding:0 }}>
              {CURATED.map(l => (
                <li key={l.href} style={{ margin:0, padding:0, display:'block', lineHeight:'1' }}>
                  <Link href={l.href} style={boldLinkSt(`r${l.href}`)} onMouseEnter={() => setHov(`r${l.href}`)} onMouseLeave={() => setHov(null)} onClick={() => setOpen(false)}>
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

        </div>
      )}
    </li>
  )
}
