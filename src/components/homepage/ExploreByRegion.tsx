'use client'

import { useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import ProductCard from '@/components/product/ProductCard'
import type { Product } from '@/types'
// BUG FIX: this file used to define its own local copy of REGION_META,
// duplicated from src/app/regions/page.tsx and already drifted from it.
// Now imports the single shared copy from src/lib/regionMeta.ts.
import { getRegionMeta } from '@/lib/regionMeta'

// ── Types ─────────────────────────────────────────────────────────────────────
export interface RichState {
  id: string; name: string; slug: string
  image_url: string | null   // mapped from image_path in DB
  description: string | null
  region: string | null
  products: Product[]
}
interface Props { states: RichState[] }

// ── Component ─────────────────────────────────────────────────────────────────
export default function ExploreByRegion({ states }: Props) {
  const [activeId, setActiveId] = useState(states[0]?.id ?? '')
  if (!states.length) return null

  const activeState = states.find(s => s.id === activeId) ?? states[0]
  const meta = getRegionMeta(activeId) ?? {
    emoji: '🏔️', tagline: '', panelBg: 'linear-gradient(135deg,#1a3a1e,#2d5233)',
    pills: [], snippet: '', description: activeState?.description ?? '',
  }

  // Serif font shorthand
  const serif = 'var(--font-playfair,"Playfair Display",Georgia,serif)'
  const sans  = 'var(--font-lato,Lato,sans-serif)'

  return (
    <section style={{ background: '#f4eed6', padding: '40px 0 0', overflow: 'hidden' }}>

      {/* ── Header ── */}
      <div id="regions" style={{ marginBottom: '20px', padding: '0 40px', display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px' }}>
        <div style={{ maxWidth: '600px' }}>
          <div style={{ display: 'inline-block', fontSize: '11px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '2px', color: '#c8920a', background: 'rgba(200,146,10,.1)', border: '1px solid rgba(200,146,10,.25)', padding: '4px 14px', borderRadius: '20px', marginBottom: '10px', fontFamily: sans }}>
            Explore by Region
          </div>
          <h2 style={{ fontFamily: serif, fontSize: 'clamp(28px,4vw,52px)', fontWeight: 700, color: '#1a3a1e', marginBottom: '8px', lineHeight: 1.2 }}>
            Discover the Himalayas
          </h2>
          <p style={{ fontSize: '14px', color: '#4a4a4a', marginBottom: '24px', lineHeight: 1.7, fontFamily: sans }}>
            Each state carries its own story — ancient forests, sacred rivers, and flavours shaped by altitude. Click to explore.
          </p>
        </div>
        <Link
          href="/regions"
          style={{
            flexShrink: 0, marginBottom: '24px', fontSize: '13px', fontWeight: 700, color: '#1a3a1e',
            textDecoration: 'none', border: '1.5px solid #1a3a1e', borderRadius: '20px',
            padding: '9px 20px', whiteSpace: 'nowrap', fontFamily: sans,
          }}
        >
          View All Regions →
        </Link>
      </div>

      {/* ── State Cards Grid — wraps into 2 rows automatically ── */}
      <div role="tablist" aria-label="Explore by region" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '14px', padding: '0 40px 18px', marginBottom: '8px' }}>
        {states.map(s => {
          const m = getRegionMeta(s.id)
          const isActive = s.id === activeId
          return (
            <button
              key={s.id}
              id={`region-tab-${s.id}`}
              role="tab"
              aria-selected={isActive}
              aria-controls="region-panel"
              onClick={() => setActiveId(s.id)}
              style={{ borderRadius: '14px', overflow: 'hidden', position: 'relative', cursor: 'pointer', border: 'none', padding: 0, background: 'none', boxShadow: isActive ? '0 12px 32px rgba(0,0,0,.22)' : '0 3px 14px rgba(0,0,0,.1)', transform: isActive ? 'translateY(-5px)' : 'translateY(0)', transition: 'transform .3s, box-shadow .3s' }}
            >
              {/* Image */}
              <div style={{ width: '100%', height: '120px', overflow: 'hidden', background: m?.panelBg ?? '#1a3a1e', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '48px' }}>
                {s.image_url
                  ? <Image src={s.image_url} alt={s.name} fill sizes="(max-width:768px) 50vw, 200px" style={{ objectFit: 'cover', objectPosition: 'center top' }} />
                  : <span>{m?.emoji ?? '🏔️'}</span>}
              </div>
              {/* Body */}
              <div style={{ padding: '10px 12px 12px', background: isActive ? '#1a3a1e' : '#fff', transition: 'background .22s' }}>
                <div style={{ fontFamily: serif, fontSize: '12px', fontWeight: 700, color: isActive ? '#fff' : '#1a3a1e', marginBottom: '2px' }}>
                  {s.name}
                </div>
                <div style={{ fontSize: '9px', color: isActive ? '#e8b84b' : '#c8920a', fontWeight: 700, letterSpacing: '.5px', marginBottom: '4px', fontFamily: sans }}>
                  {m?.tagline ?? s.region ?? ''}
                </div>
                <div style={{ fontSize: '10px', color: isActive ? 'rgba(255,255,255,.65)' : '#7a7a7a', lineHeight: 1.5, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', fontFamily: sans } as React.CSSProperties}>
                  {m?.snippet ?? s.description ?? ''}
                </div>
              </div>
            </button>
          )
        })}
      </div>

      {/* ── Active Panel ── */}
      <div
        key={activeId}
        id="region-panel"
        role="tabpanel"
        aria-labelledby={`region-tab-${activeId}`}
        className="pr-panel-anim"
      >

        {/* Split header — .pr-shdr in globals.css */}
        <div className="pr-shdr">

          {/* Image column */}
          <div style={{ position: 'relative', overflow: 'hidden', background: '#1a3a1e' }}>
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '90px', opacity: .18, zIndex: 0, userSelect: 'none' }}>
              {meta.emoji}
            </div>
            {activeState.image_url && (
              <Image src={activeState.image_url} alt={activeState.name} fill
                sizes="(max-width:640px) 100vw, 54vw"
                style={{ objectFit: 'cover', objectPosition: 'center 20%', filter: 'brightness(.85) saturate(1.15)' }}
                priority
              />
            )}
            <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(90deg,transparent 55%,rgba(0,0,0,.45))', pointerEvents: 'none' }} />
          </div>

          {/* Info column */}
          <div style={{ padding: '36px 32px', display: 'flex', flexDirection: 'column', justifyContent: 'center', color: '#fff', overflow: 'hidden', position: 'relative', background: meta.panelBg }}>
            <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(135deg,rgba(0,0,0,.52),rgba(0,0,0,.22))', zIndex: 0 }} />
            <div style={{ position: 'relative', zIndex: 1 }}>
              <h3 style={{ fontFamily: serif, fontSize: 'clamp(18px,2vw,28px)', fontWeight: 700, color: '#fff', marginBottom: '10px', lineHeight: 1.2 }}>
                {meta.emoji} {activeState.name}
              </h3>
              <p style={{ fontSize: '13px', color: 'rgba(255,255,255,.78)', lineHeight: 1.75, marginBottom: '16px', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 5, WebkitBoxOrient: 'vertical', fontFamily: sans } as React.CSSProperties}>
                {meta.description || activeState.description || ''}
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {meta.pills.map(pill => (
                  <span key={pill} style={{ background: 'rgba(255,255,255,.12)', border: '1px solid rgba(255,255,255,.22)', color: 'rgba(255,255,255,.9)', fontSize: '10px', fontWeight: 700, letterSpacing: '.5px', padding: '4px 12px', borderRadius: '20px', fontFamily: sans }}>
                    {pill}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Products grid — .pr-spgrid in globals.css */}
        <div className="pr-spgrid">
          {activeState.products.length > 0
            ? activeState.products.map((p, i) => (
                <ProductCard key={p.id} product={p} priority={i < 2} />
              ))
            : (
              <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: '48px 20px', color: 'rgba(255,255,255,.6)', fontFamily: serif, fontStyle: 'italic', fontSize: '15px' }}>
                🏔️ Products coming soon from {activeState.name}…
              </div>
            )
          }
        </div>

        {/* View all */}
        {activeState.products.length > 0 && (
          <div style={{ background: '#0d1f0e', textAlign: 'center', padding: '0 0 28px' }}>
            <Link href={`/regions/${activeState.id}`} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '13px', fontWeight: 700, color: '#e8b84b', textDecoration: 'none', border: '1px solid rgba(232,184,75,.3)', borderRadius: '24px', padding: '9px 22px', fontFamily: sans }}>
              View all {activeState.name} products →
            </Link>
          </div>
        )}
      </div>

    </section>
  )
}
