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
    description: 'Kumaon and Garhwal — sacred Himalayan land of ancient temples, dense forests, and glacial rivers. Wild multifloral honey, deep-red Pahadi rajma, and precious Badri cow ghee from meadows above 3,000 metres.',
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
    description: 'Ladakh — the roof of the world, where the sky is impossibly blue. Seabuckthorn berries ripen on thorny bushes along the Indus river — loaded with Vitamin C, Omega-7, and antioxidants. Shilajit oozes from granite rocks during summer thaw.',
  },
  sk: {
    emoji: '🌺', tagline: "India's First Organic State",
    panelBg: 'linear-gradient(135deg,#1a3a1e,#2a5230)',
    pills: ['🫚 Large Cardamom','🌿 Organic Turmeric','🍵 Temi Tea','🌱 Organic Ginger','🥬 Gundruk'],
    snippet: "India's only fully organic state. Cardamom groves under forest shade, Temi tea above clouds.",
    description: "Sikkim — India's first and only fully organic state. Large cardamom, smoky and complex, grows under forest canopy in the steep Dzongu valley. Temi Tea Estate, perched at 1,600 metres, produces one of India's most prized orthodox teas.",
  },
  as: {
    emoji: '🌊', tagline: 'Land of the Red River',
    panelBg: 'linear-gradient(135deg,#1a2a3a,#2d4053)',
    pills: ['🍵 Assam CTC Tea','🍯 Wild Forest Honey','🌶️ Bhut Jolokia','🫚 Mustard Oil','🌿 Black Pepper'],
    snippet: "The world's largest river island. Assam tea — 70% of India's total production.",
    description: "Assam — the land of the Brahmaputra and the tea that woke the world. Assam produces 70% of India's total tea output — the bold, malty CTC that fuels a billion cups every morning.",
  },
  ml: {
    emoji: '🌧️', tagline: 'Abode of Clouds',
    panelBg: 'linear-gradient(135deg,#1e3a8a,#2d4fa3)',
    pills: ['🌿 Lakadong Turmeric','🌑 Wild Black Pepper','🍯 Wild Honey','🍃 Bay Leaf','🫚 Hill Ginger'],
    snippet: 'Wettest land on earth. Lakadong turmeric with 7.5% curcumin — highest on the planet.',
    description: 'Meghalaya — Abode of Clouds, the wettest land on earth. Lakadong turmeric carries up to 7.5% curcumin — the highest of any turmeric variety on earth.',
  },
  nl: {
    emoji: '🌶️', tagline: 'Land of Festivals & Fire',
    panelBg: 'linear-gradient(135deg,#3a0a0a,#5c1a1a)',
    pills: ['🌶️ Bhut Jolokia','🍯 Wild Hill Honey','🫙 Axone (Fermented)','🌿 Wild Herbs','🧂 Tribal Salt'],
    snippet: 'Ghost Pepper country. Hornbill Festival, 16 tribes, and fermented Axone — fierce & proud.',
    description: 'Nagaland — Land of the Hornbill, where 16 distinct tribes gather each December. Bhut Jolokia, the Ghost Pepper — once the world\'s hottest chilli — grows wild in Naga villages.',
  },
  mn: {
    emoji: '💃', tagline: 'Land of Dance & Heritage',
    panelBg: 'linear-gradient(135deg,#1a1e3a,#2d3353)',
    pills: ['🌾 Black Rice','🎋 Bamboo Shoots','🌿 Wild Herbs','🍯 Wild Honey','🧵 Handloom'],
    snippet: 'Purple Chakhao rice, Loktak Lake, and a matrilineal society where women rule the market.',
    description: "Manipur — the Jewelled Land. Chakhao, the black rice of Manipur — this purple-grain heirloom rice cooked for royal feasts — is now one of India's most antioxidant-rich foods.",
  },
  tr: {
    emoji: '🏛️', tagline: 'Land of Fourteen Tribes',
    panelBg: 'linear-gradient(135deg,#0d3320,#1a5c3a)',
    pills: ['🍍 Queen Pineapple','🍯 Wild Forest Honey','🎋 Bamboo Shoots','🌿 Matai Peas','🫙 Berma'],
    snippet: 'Queen pineapple so sweet it needs no sugar. Wild honey from ancient Chakma bark hives.',
    description: 'Tripura — where Culture Meets Nature. The queen pineapple here is so sweet it needs no sugar. Wild forest honey is gathered by Chakma & Tripuri tribes using centuries-old bark hives.',
  },
  ar: {
    emoji: '🌿', tagline: 'Land of the Dawn-Lit Mountains',
    panelBg: 'linear-gradient(135deg,#1a3a1e,#2d5233)',
    pills: ['🍊 Kiwi & Citrus','🍯 Wild Honey','🌿 Adi Herbs','🫚 Mustard Oil','🌾 Rice Wine'],
    snippet: 'Sunrise state. Wild honey from the oldest forest. Tribal herbs unchanged for millennia.',
    description: 'Arunachal Pradesh — the Land of the Dawn-Lit Mountains, where the sun rises first in India. Dense, untouched forests yield some of the most potent wild honey on earth.',
  },
  mz: {
    emoji: '🌸', tagline: 'The Blue Mountain State',
    panelBg: 'linear-gradient(135deg,#1a1e3a,#2d3a6b)',
    pills: ['🌶️ Bird Eye Chilli','🍯 Wild Honey','🫙 Dawl Ku','🌿 Wild Herbs','🎋 Bamboo'],
    snippet: 'Land of the Lushai Hills. Bird eye chilli so fierce it lights you up from the inside.',
    description: 'Mizoram — the Blue Mountain State, where gentle rolling hills hide some of the most fiery and unique ingredients in Northeast India.',
  },
}

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
  const meta = REGION_META[activeId] ?? {
    emoji: '🏔️', tagline: '', panelBg: 'linear-gradient(135deg,#1a3a1e,#2d5233)',
    pills: [], snippet: '', description: activeState?.description ?? '',
  }

  // Serif font shorthand
  const serif = 'var(--font-playfair,"Playfair Display",Georgia,serif)'
  const sans  = 'var(--font-lato,Lato,sans-serif)'

  return (
    <section style={{ background: '#f4eed6', padding: '40px 40px 0' }}>

      {/* ── Header ── */}
      <div id="regions" style={{ marginBottom: '20px' }}>
        <div style={{ display: 'inline-block', fontSize: '11px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '2px', color: '#c8920a', background: 'rgba(200,146,10,.1)', border: '1px solid rgba(200,146,10,.25)', padding: '4px 14px', borderRadius: '20px', marginBottom: '10px', fontFamily: sans }}>
          Explore by Region
        </div>
        <h2 style={{ fontFamily: serif, fontSize: 'clamp(28px,4vw,52px)', fontWeight: 700, color: '#1a3a1e', marginBottom: '8px', lineHeight: 1.2 }}>
          Discover the Himalayas
        </h2>
        <p style={{ fontSize: '14px', color: '#4a4a4a', marginBottom: '24px', maxWidth: '600px', lineHeight: 1.7, fontFamily: sans }}>
          Each state carries its own story — ancient forests, sacred rivers, and flavours shaped by altitude. Click to explore.
        </p>
      </div>

      {/* ── Story Cards Row (horizontal scroll) ── */}
      <div style={{ display: 'flex', gap: '14px', overflowX: 'auto', paddingBottom: '18px', scrollbarWidth: 'none', marginBottom: '8px', msOverflowStyle: 'none' } as React.CSSProperties}>
        {states.map(s => {
          const m = REGION_META[s.id]
          const isActive = s.id === activeId
          return (
            <button key={s.id} onClick={() => setActiveId(s.id)} style={{ flexShrink: 0, width: '200px', borderRadius: '14px', overflow: 'hidden', position: 'relative', cursor: 'pointer', border: 'none', padding: 0, background: 'none', boxShadow: isActive ? '0 12px 32px rgba(0,0,0,.22)' : '0 3px 14px rgba(0,0,0,.1)', transform: isActive ? 'translateY(-5px)' : 'translateY(0)', transition: 'transform .3s, box-shadow .3s' }}>
              {/* Image */}
              <div style={{ width: '100%', height: '130px', overflow: 'hidden', background: m?.panelBg ?? '#1a3a1e', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '52px' }}>
                {s.image_url
                  ? <Image src={s.image_url} alt={s.name} fill sizes="200px" style={{ objectFit: 'cover', objectPosition: 'center top' }} />
                  : <span>{m?.emoji ?? '🏔️'}</span>}
              </div>
              {/* Body */}
              <div style={{ padding: '12px 14px 14px', background: isActive ? '#1a3a1e' : '#fff', transition: 'background .22s' }}>
                <div style={{ fontFamily: serif, fontSize: '13px', fontWeight: 700, color: isActive ? '#fff' : '#1a3a1e', marginBottom: '3px' }}>
                  {s.name}
                </div>
                <div style={{ fontSize: '10px', color: isActive ? '#e8b84b' : '#c8920a', fontWeight: 700, letterSpacing: '.5px', marginBottom: '5px', fontFamily: sans }}>
                  {m?.tagline ?? s.region ?? ''}
                </div>
                <div style={{ fontSize: '11px', color: isActive ? 'rgba(255,255,255,.65)' : '#7a7a7a', lineHeight: 1.5, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', fontFamily: sans } as React.CSSProperties}>
                  {m?.snippet ?? s.description ?? ''}
                </div>
              </div>
            </button>
          )
        })}
      </div>

      {/* ── Active Panel ── */}
      <div key={activeId} className="pr-panel-anim">

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
              <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: '48px 20px', color: 'rgba(255,255,255,.35)', fontFamily: serif, fontStyle: 'italic', fontSize: '15px' }}>
                🏔️ Products coming soon from {activeState.name}…
              </div>
            )
          }
        </div>

        {/* View all */}
        {activeState.products.length > 0 && (
          <div style={{ background: '#0d1f0e', textAlign: 'center', padding: '0 0 28px' }}>
            <Link href={`/products?state=${activeState.slug}`} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '13px', fontWeight: 700, color: '#e8b84b', textDecoration: 'none', border: '1px solid rgba(232,184,75,.3)', borderRadius: '24px', padding: '9px 22px', fontFamily: sans }}>
              View all {activeState.name} products →
            </Link>
          </div>
        )}
      </div>

    </section>
  )
}
