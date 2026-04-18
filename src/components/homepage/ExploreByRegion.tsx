'use client'

import { useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import ProductCard from '@/components/product/ProductCard'
import type { Product } from '@/types'

// ── Static region metadata ────────────────────────────────────────────────────
const REGION_META: Record<string, {
  emoji: string; tagline: string; panelBg: string; pills: string[]
  snippet: string; description: string
}> = {
  hp: {
    emoji: '🏔️', tagline: 'Dev Bhoomi',
    panelBg: 'linear-gradient(135deg,#1a3a1e,#2d5233)',
    pills: ['🍎 Apple & ACV','🍯 Pine Honey','🍵 Kangra Tea','🥛 Bilona Ghee','🌰 Chilgoza Nuts'],
    snippet: 'Dev Bhoomi — Deodar forests hide cliff-hive honey & Kangra tea perfumes alpine air.',
    description: 'Himachal Pradesh — Dev Bhoomi, the Land of Gods. Ancient Shiva temples cling to cliff faces above apple orchards that bloom white every spring. The Kangra valley, cradle of a 5,000-year-old civilisation, produces an orthodox tea so delicate it was once reserved for royalty. From Kinnaur\'s snowbound heights come the rare Chilgoza pine nuts — hand-gathered from ancient forests above 2,500 metres.',
  },
  uk: {
    emoji: '🏔️', tagline: 'Dev Bhoomi',
    panelBg: 'linear-gradient(135deg,#1a3a1e,#2d5233)',
    pills: ['🍯 Wild Honey','🌾 Pahadi Rajma','🌸 Buransh Juice','🥛 Badri Ghee','🌿 Jakhiya'],
    snippet: 'Sacred rivers, ancient temples & meadows above 3,000m yielding wild honey and Badri ghee.',
    description: 'Kumaon and Garhwal — sacred Himalayan land of ancient temples, dense forests, and glacial rivers. The vibrant Garhwali dance tradition is part of a living culture that also produces wild multifloral honey, deep-red Pahadi rajma, and precious Badri cow ghee from meadows above 3,000 metres.',
  },
  jk: {
    emoji: '🌷', tagline: 'Paradise on Earth',
    panelBg: 'linear-gradient(135deg,#1e3a8a,#2d4fa3)',
    pills: ['🌸 Kashmiri Kesar','🌰 Kagzi Walnuts','🍵 Kahwa Tea','🌶️ Kashmiri Mirchi','🥜 Almonds'],
    snippet: 'Saffron fields turn violet each October. The world\'s finest spice, harvested before sunrise.',
    description: 'Kashmir — Jannat, as the Mughals called it — where saffron fields turn the Pampore plains a deep violet every October, harvested flower by flower before sunrise. Mongra saffron — Grade A, thread by thread — is the world\'s most precious spice.',
  },
  la: {
    emoji: '❄️', tagline: 'Land of High Passes',
    panelBg: 'linear-gradient(135deg,#4a2c10,#6b3a18)',
    pills: ['🫐 Seabuckthorn','🪨 Shilajit','🍑 Wild Apricots','⚡ Black Buckwheat','🧂 Rock Salt'],
    snippet: 'Roof of the world. Shilajit oozes from granite at 3,500m. Seabuckthorn lines the Indus.',
    description: 'Ladakh — the roof of the world, where the sky is impossibly blue and every living thing that survives here does so with extraordinary potency. At 3,500 metres, Seabuckthorn berries ripen on thorny bushes along the Indus river — loaded with Vitamin C, Omega-7, and antioxidants.',
  },
  sk: {
    emoji: '🌺', tagline: 'India\'s First Organic State',
    panelBg: 'linear-gradient(135deg,#1a3a1e,#2a5230)',
    pills: ['🫚 Large Cardamom','🌿 Organic Turmeric','🍵 Temi Tea','🌱 Organic Ginger','🥬 Gundruk'],
    snippet: 'India\'s only fully organic state. Cardamom groves under forest shade, Temi tea above clouds.',
    description: 'Sikkim — India\'s first and only fully organic state, where no synthetic fertiliser has touched the soil since 2016. Large cardamom, smoky and complex, grows under forest canopy in the steep Dzongu valley. Temi Tea Estate, perched at 1,600 metres, produces one of India\'s most prized orthodox teas.',
  },
  as: {
    emoji: '🌊', tagline: 'Land of the Red River',
    panelBg: 'linear-gradient(135deg,#1a2a3a,#2d4053)',
    pills: ['🍵 Assam CTC Tea','🍯 Wild Forest Honey','🌶️ Bhut Jolokia','🫚 Mustard Oil','🌿 Black Pepper'],
    snippet: 'The world\'s largest river island. Assam tea — 70% of India\'s total production — brewed since 1823.',
    description: 'Assam — the land of the Brahmaputra, one-horned rhinoceroses, and the tea that woke the world. Assam produces 70% of India\'s total tea output — the bold, malty CTC that fuels a billion cups every morning.',
  },
  ml: {
    emoji: '🌧️', tagline: 'Abode of Clouds',
    panelBg: 'linear-gradient(135deg,#1e3a8a,#2d4fa3)',
    pills: ['🌿 Lakadong Turmeric','🌑 Wild Black Pepper','🍯 Wild Honey','🍃 Bay Leaf','🫚 Hill Ginger'],
    snippet: 'Wettest land on earth. Lakadong turmeric with 7.5% curcumin — highest on the planet.',
    description: 'Meghalaya — Abode of Clouds, the wettest land on earth. Lakadong turmeric carries up to 7.5% curcumin — the highest of any turmeric variety on earth. The same 12,000mm of annual rainfall nurtures the legendary living root bridges.',
  },
  nl: {
    emoji: '🌶️', tagline: 'Land of Festivals & Fire',
    panelBg: 'linear-gradient(135deg,#3a0a0a,#5c1a1a)',
    pills: ['🌶️ Bhut Jolokia','🍯 Wild Hill Honey','🫙 Axone (Fermented)','🌿 Wild Herbs','🧂 Tribal Salt'],
    snippet: 'Ghost Pepper country. Hornbill Festival, 16 tribes, and fermented Axone — fierce & proud.',
    description: 'Nagaland — Land of the Hornbill, where 16 distinct tribes gather each December. Bhut Jolokia, the Ghost Pepper — once the world\'s hottest chilli, still ranked among the top five — grows wild in Naga villages.',
  },
  mn: {
    emoji: '💃', tagline: 'Land of Dance & Heritage',
    panelBg: 'linear-gradient(135deg,#1a1e3a,#2d3353)',
    pills: ['🌾 Black Rice','🎋 Bamboo Shoots','🌿 Wild Herbs','🍯 Wild Honey','🧵 Handloom'],
    snippet: 'Purple Chakhao rice, Loktak Lake, and a matrilineal society where women rule the market.',
    description: 'Manipur — the Jewelled Land. Chakhao, the black rice of Manipur — this purple-grain heirloom rice, cooked for royal feasts and Buddhist ceremonies — is now recognised as one of India\'s most antioxidant-rich foods.',
  },
  tr: {
    emoji: '🏛️', tagline: 'Land of Fourteen Tribes',
    panelBg: 'linear-gradient(135deg,#0d3320,#1a5c3a)',
    pills: ['🍍 Queen Pineapple','🍯 Wild Forest Honey','🎋 Bamboo Shoots','🌿 Matai Peas','🫙 Berma (Fermented Fish)'],
    snippet: 'Queen pineapple so sweet it needs no sugar. Wild honey from ancient Chakma bark hives.',
    description: 'Tripura — where Culture Meets Nature. The queen pineapple here is so sweet it needs no sugar. Wild forest honey is gathered by Chakma & Tripuri tribes using centuries-old bark hives.',
  },
}

// ── Types ─────────────────────────────────────────────────────────────────────
export interface RichState {
  id: string; name: string; slug: string
  image_url: string | null; description: string | null; region: string | null
  products: Product[]
}
interface Props { states: RichState[] }

// ── Component ─────────────────────────────────────────────────────────────────
export default function ExploreByRegion({ states }: Props) {
  const [activeId, setActiveId] = useState(states[0]?.id ?? '')
  if (!states.length) return null

  const activeState = states.find(s => s.id === activeId) ?? states[0]
  const meta = REGION_META[activeId] ?? {
    emoji: '🏔️', tagline: '', panelBg: 'linear-gradient(135deg,#1a3a1e,#2d5233)',
    pills: [], snippet: '', description: activeState?.description ?? '',
  }

  return (
    /* old site: .state-sec { background:#f4eed6; padding:40px 40px 0 } */
    <section style={{ background: '#f4eed6', padding: '40px 40px 0' }}>

      {/* Header — old site: text-align:left */}
      <div id="regions" style={{ marginBottom: '20px' }}>
        <div style={{
          display: 'inline-block', fontSize: '11px', fontWeight: 800,
          textTransform: 'uppercase', letterSpacing: '2px', color: '#c8920a',
          background: 'rgba(200,146,10,.1)', border: '1px solid rgba(200,146,10,.25)',
          padding: '4px 14px', borderRadius: '20px', marginBottom: '10px',
          fontFamily: 'var(--font-lato,Lato,sans-serif)',
        }}>Explore by Region</div>
        <h2 style={{
          fontFamily: 'var(--font-playfair,"Playfair Display",Georgia,serif)',
          fontSize: 'clamp(28px,4vw,52px)', fontWeight: 700, color: '#1a3a1e',
          marginBottom: '8px', lineHeight: 1.2,
        }}>Discover the Himalayas</h2>
        <p style={{ fontSize: '14px', color: '#4a4a4a', marginBottom: '24px', maxWidth: '600px', lineHeight: 1.7 }}>
          Each state carries its own story — ancient forests, sacred rivers, and flavours shaped by altitude. Click to explore.
        </p>
      </div>

      {/* Story Cards horizontal scroll — old site: #storyCards */}
      <div style={{ display: 'flex', gap: '14px', overflowX: 'auto', padding: '0 0 18px', scrollbarWidth: 'none', marginBottom: '8px' }}>
        {states.map(s => {
          const m = REGION_META[s.id]
          const isActive = s.id === activeId
          return (
            <button
              key={s.id}
              onClick={() => setActiveId(s.id)}
              style={{
                flexShrink: 0, width: '200px', borderRadius: '14px', overflow: 'hidden',
                position: 'relative', cursor: 'pointer', border: 'none', padding: 0,
                boxShadow: isActive ? '0 12px 32px rgba(0,0,0,.22)' : '0 3px 14px rgba(0,0,0,.1)',
                transform: isActive ? 'translateY(-5px)' : 'translateY(0)',
                transition: 'transform .3s, box-shadow .3s',
              }}
            >
              {/* Image */}
              <div style={{ width: '100%', height: '130px', overflow: 'hidden', background: m?.panelBg ?? '#1a3a1e', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '52px' }}>
                {s.image_url
                  ? <Image src={s.image_url} alt={s.name} fill sizes="200px" style={{ objectFit: 'cover', objectPosition: 'center top' }} />
                  : <span>{m?.emoji ?? '🏔️'}</span>
                }
              </div>
              {/* Body */}
              <div style={{
                padding: '12px 14px 14px',
                background: isActive ? '#1a3a1e' : '#fff',
                transition: 'background .22s',
              }}>
                <div style={{
                  fontFamily: 'var(--font-playfair,"Playfair Display",Georgia,serif)',
                  fontSize: '13px', fontWeight: 700,
                  color: isActive ? '#fff' : '#1a3a1e',
                  marginBottom: '3px',
                }}>{s.name}</div>
                <div style={{ fontSize: '10px', color: isActive ? '#e8b84b' : '#c8920a', fontWeight: 700, letterSpacing: '.5px', marginBottom: '5px' }}>
                  {m?.tagline ?? s.region ?? ''}
                </div>
                <div style={{ fontSize: '11px', color: isActive ? 'rgba(255,255,255,.65)' : '#7a7a7a', lineHeight: 1.5, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                  {m?.snippet ?? s.description ?? ''}
                </div>
              </div>
            </button>
          )
        })}
      </div>

      {/* Tab bar — old site: .stabs */}
      <div style={{ display: 'flex', flexWrap: 'wrap', background: '#f0e8d4', border: 'none', padding: '8px 8px 0', gap: '6px', overflowX: 'visible', scrollbarWidth: 'none' }}>
        {states.map(s => {
          const m = REGION_META[s.id]
          const isActive = s.id === activeId
          return (
            <button
              key={s.id}
              onClick={() => setActiveId(s.id)}
              style={{
                flexShrink: 0, width: '140px', border: 'none', borderRadius: '8px 8px 0 0',
                background: isActive ? '#1a3a1e' : '#fff', cursor: 'pointer',
                display: 'flex', flexDirection: 'column', alignItems: 'stretch',
                transition: 'all .22s', fontFamily: 'var(--font-lato,Lato,sans-serif)',
                boxShadow: isActive ? '0 4px 18px rgba(26,58,30,.3)' : '0 1px 4px rgba(0,0,0,.08)',
                transform: isActive ? 'translateY(-2px)' : 'translateY(0)',
                overflow: 'hidden', padding: 0,
              }}
            >
              {/* Thumb */}
              <div style={{ width: '100%', height: '90px', overflow: 'hidden', background: m?.panelBg ?? 'linear-gradient(135deg,#1a3a1e,#2d5233)', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '38px', position: 'relative' }}>
                {s.image_url
                  ? <Image src={s.image_url} alt={s.name} fill sizes="140px" style={{ objectFit: 'cover', objectPosition: '55% 15%' }} />
                  : <span>{m?.emoji ?? '🏔️'}</span>
                }
              </div>
              {/* Label */}
              <div style={{ padding: '8px 10px 10px', display: 'flex', flexDirection: 'column', gap: '3px', textAlign: 'center' }}>
                <div style={{ fontSize: '8.5px', fontWeight: 800, letterSpacing: '.9px', textTransform: 'uppercase', color: isActive ? '#fff' : '#1a1a1a', lineHeight: 1.3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {s.name}
                </div>
                <div style={{ fontSize: '7.5px', color: isActive ? 'rgba(255,255,255,.6)' : '#7a7a7a', fontStyle: 'italic', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'block', marginTop: '1px' }}>
                  {m?.tagline ?? s.region ?? ''}
                </div>
              </div>
            </button>
          )
        })}
      </div>

      {/* Panel — old site: .spnl, .shdr */}
      <div key={activeId} style={{ animation: 'pr-spIn .35s ease' }}>

        {/* Split header — old site: .shdr = grid 54%/46%, height 450px */}
        <div style={{ display: 'grid', gridTemplateColumns: '54% 46%', height: '450px', overflow: 'hidden' }} className="pr-shdr">

          {/* Image col */}
          <div style={{ position: 'relative', overflow: 'hidden', background: '#1a3a1e' }}>
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '90px', opacity: .18, zIndex: 0 }}>
              {meta.emoji}
            </div>
            {activeState.image_url && (
              <Image
                src={activeState.image_url} alt={activeState.name}
                fill sizes="(max-width:640px) 100vw, 54vw"
                style={{ objectFit: 'cover', objectPosition: 'center 20%', filter: 'brightness(.85) saturate(1.15)', transition: 'transform 10s' }}
                priority
              />
            )}
            {/* right fade overlay */}
            <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(90deg,transparent 55%,rgba(0,0,0,.45))', pointerEvents: 'none' }} />
          </div>

          {/* Info col */}
          <div style={{ padding: '36px 32px', display: 'flex', flexDirection: 'column', justifyContent: 'center', color: '#fff', overflow: 'hidden', position: 'relative', background: meta.panelBg }}>
            {/* dark overlay */}
            <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(135deg,rgba(0,0,0,.52),rgba(0,0,0,.22))', zIndex: 0 }} />
            <div style={{ position: 'relative', zIndex: 1 }}>
              <h3 style={{
                fontFamily: 'var(--font-playfair,"Playfair Display",Georgia,serif)',
                fontSize: 'clamp(18px,2vw,28px)', fontWeight: 700, color: '#fff',
                marginBottom: '10px', lineHeight: 1.2,
              }}>{meta.emoji} {activeState.name}</h3>
              <p style={{ fontSize: '13px', color: 'rgba(255,255,255,.78)', lineHeight: 1.75, marginBottom: '16px', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 5, WebkitBoxOrient: 'vertical' }}>
                {meta.description || activeState.description || ''}
              </p>
              {/* Pills */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {meta.pills.map(pill => (
                  <span key={pill} style={{ background: 'rgba(255,255,255,.12)', border: '1px solid rgba(255,255,255,.22)', color: 'rgba(255,255,255,.9)', fontSize: '10px', fontWeight: 700, letterSpacing: '.5px', padding: '4px 12px', borderRadius: '20px' }}>
                    {pill}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Products grid — old site: .spgrid dark background */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(240px,1fr))', gap: '24px', padding: '24px 40px', background: '#0d1f0e' }} className="pr-spgrid">
          {activeState.products.length > 0
            ? activeState.products.map((p, i) => (
                <ProductCard key={p.id} product={p} priority={i < 2} />
              ))
            : (
              <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: '48px 20px', color: 'rgba(255,255,255,.4)', fontFamily: 'var(--font-playfair,"Playfair Display",Georgia,serif)', fontStyle: 'italic', fontSize: '15px' }}>
                🏔️ Products coming soon from {activeState.name}…
              </div>
            )
          }
        </div>

        {/* View all link */}
        {activeState.products.length > 0 && (
          <div style={{ background: '#0d1f0e', textAlign: 'center', paddingBottom: '24px' }}>
            <Link href={`/products?state=${activeState.slug}`} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '13px', fontWeight: 700, color: '#e8b84b', textDecoration: 'none', border: '1px solid rgba(232,184,75,.3)', borderRadius: '24px', padding: '8px 20px', transition: 'all .2s' }}>
              View all {activeState.name} products →
            </Link>
          </div>
        )}
      </div>

      <style>{`
        @keyframes pr-spIn { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:translateY(0)} }
        @media(max-width:640px) {
          .pr-shdr { grid-template-columns:1fr !important; height:auto !important; }
          .pr-spgrid { grid-template-columns:1fr 1fr !important; padding:16px 20px !important; }
        }
      `}</style>
    </section>
  )
}
