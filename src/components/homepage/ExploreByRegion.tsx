'use client'

import { useState, useRef } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import ProductCard from '@/components/product/ProductCard'
import type { Product } from '@/types'

// ── Static region metadata (mirrors old site FALLBACK_STATES) ────────────────
const REGION_META: Record<string, {
  emoji: string
  tagline: string
  panelBg: string
  pills: string[]
  snippet: string
  description: string
}> = {
  hp: {
    emoji: '🏔️', tagline: 'Dev Bhoomi',
    panelBg: 'linear-gradient(135deg,#1a3a1e,#2d5233)',
    pills: ['🍎 Apple & ACV', '🍯 Pine Honey', '🍵 Kangra Tea', '🥛 Bilona Ghee', '🌰 Chilgoza Nuts'],
    snippet: 'Dev Bhoomi — Deodar forests hide cliff-hive honey & Kangra tea perfumes alpine air.',
    description: 'Himachal Pradesh — Dev Bhoomi, the Land of Gods. Ancient Shiva temples cling to cliff faces above apple orchards that bloom white every spring. The Kangra valley, cradle of a 5,000-year-old civilisation, produces an orthodox tea so delicate it was once reserved for royalty. From Kinnaur\'s snowbound heights come the rare Chilgoza pine nuts — hand-gathered from ancient forests above 2,500 metres. And wild Himalayan honey, harvested from cliffside rock hives by fearless Gaddi tribesmen, carries the nectar of a hundred mountain wildflowers.',
  },
  uk: {
    emoji: '🏔️', tagline: 'Dev Bhoomi',
    panelBg: 'linear-gradient(135deg,#1a3a1e,#2d5233)',
    pills: ['🍯 Wild Honey', '🌾 Pahadi Rajma', '🌸 Buransh Juice', '🥛 Badri Ghee', '🌿 Jakhiya'],
    snippet: 'Sacred rivers, ancient temples & meadows above 3,000m yielding wild honey and Badri ghee.',
    description: 'Kumaon and Garhwal — sacred Himalayan land of ancient temples, dense forests, and glacial rivers. The vibrant Garhwali dance tradition in colourful tartan costumes is part of a living culture that also produces wild multifloral honey, deep-red Pahadi rajma, and precious Badri cow ghee from meadows above 3,000 metres.',
  },
  jk: {
    emoji: '🌷', tagline: 'Paradise on Earth',
    panelBg: 'linear-gradient(135deg,#1e3a8a,#2d4fa3)',
    pills: ['🌸 Kashmiri Kesar', '🌰 Kagzi Walnuts', '🍵 Kahwa Tea', '🌶️ Kashmiri Mirchi', '🥜 Almonds'],
    snippet: 'Saffron fields turn violet each October. The world\'s finest spice, harvested before sunrise.',
    description: 'Kashmir — Jannat, as the Mughals called it — where saffron fields turn the Pampore plains a deep violet every October, harvested flower by flower before sunrise. Mongra saffron — Grade A, thread by thread — is the world\'s most precious spice. Kagzi walnuts, with paper-thin shells and a sweet, oily kernel, are prized by pastry chefs from Paris to Mumbai.',
  },
  la: {
    emoji: '❄️', tagline: 'Land of High Passes',
    panelBg: 'linear-gradient(135deg,#4a2c10,#6b3a18)',
    pills: ['🫐 Seabuckthorn', '🪨 Shilajit', '🍑 Wild Apricots', '⚡ Black Buckwheat', '🧂 Rock Salt'],
    snippet: 'Roof of the world. Shilajit oozes from granite at 3,500m. Seabuckthorn lines the Indus.',
    description: 'Ladakh — the roof of the world, where the sky is impossibly blue and every living thing that survives here does so with extraordinary potency. At 3,500 metres, Seabuckthorn berries ripen on thorny bushes along the Indus river — loaded with Vitamin C, Omega-7, and antioxidants that Tibetan monks have used medicinally for centuries. Shilajit, the ancient \'destroyer of weakness\', oozes from granite rocks during summer thaw.',
  },
  sk: {
    emoji: '🌺', tagline: 'India\'s First Organic State',
    panelBg: 'linear-gradient(135deg,#1a3a1e,#2a5230)',
    pills: ['🫚 Large Cardamom', '🌿 Organic Turmeric', '🍵 Temi Tea', '🌱 Organic Ginger', '🥬 Gundruk'],
    snippet: 'India\'s only fully organic state. Cardamom groves under forest shade, Temi tea above clouds.',
    description: 'Sikkim — India\'s first and only fully organic state, where chemical fertilisers have been completely banned since 2016. On mist-covered hillsides at 1,500 metres, Lepcha and Bhutia women tend cardamom groves under the shade of forest trees — a centuries-old agroforestry system. The Temi Tea Estate — the only government-run tea garden in the Himalayas — yields a delicate, floral orthodox tea from bushes grown at altitude above the clouds.',
  },
  as: {
    emoji: '🍵', tagline: 'Tea Capital of the World',
    panelBg: 'linear-gradient(135deg,#1a3a1e,#2d5233)',
    pills: ['🍵 Orthodox Tea', '⚡ Black Joha Rice', '🫙 Bamboo Pickle', '🍯 Forest Honey', '🍍 Queen Pineapple'],
    snippet: 'Brahmaputra valley — world-famous malty black tea & Black Joha rice with a pandan scent.',
    description: 'Assam — where the Brahmaputra runs wide and golden, and every April, the Bihu harvest festival turns the valley into a river of colour, dance, and feast. The same red-clay floodplain soil that grows the world\'s most recognised black tea — full-bodied, malty, brisk — also nurtures Black Joha rice, an aromatic short-grain heirloom variety with a scent like pandan leaf, cooked only on festival days.',
  },
  ml: {
    emoji: '🌧️', tagline: 'Abode of Clouds',
    panelBg: 'linear-gradient(135deg,#1e3a8a,#2d4fa3)',
    pills: ['🌿 Lakadong Turmeric', '🌑 Wild Black Pepper', '🍯 Wild Honey', '🍃 Bay Leaf', '🫚 Hill Ginger'],
    snippet: 'Wettest land on earth. Lakadong turmeric with 7.5% curcumin — highest on the planet.',
    description: 'Meghalaya — Abode of Clouds, the wettest land on earth. Khasi women in flowing orange Jainsem dresses own land, run markets, and carry family surnames — one of the last matrilineal societies on the planet. The same 12,000mm of annual rainfall that feeds the legendary living root bridges of Nongriat also nurtures Lakadong turmeric — a small, stubby rhizome carrying up to 7.5% curcumin, the highest of any turmeric variety on earth.',
  },
  nl: {
    emoji: '🌶️', tagline: 'Land of Festivals & Fire',
    panelBg: 'linear-gradient(135deg,#3a0a0a,#5c1a1a)',
    pills: ['🌶️ Bhut Jolokia', '🍯 Wild Hill Honey', '🫙 Axone (Fermented)', '🌿 Wild Herbs', '🧂 Tribal Salt'],
    snippet: 'Ghost Pepper country. Hornbill Festival, 16 tribes, and fermented Axone — fierce & proud.',
    description: 'Nagaland — Land of the Hornbill, where 16 distinct tribes gather each December in a festival of war dances, tribal cuisine, and living tradition. The same fierce spirit lives in the food: Bhut Jolokia, the Ghost Pepper — once the world\'s hottest chilli, still ranked among the top five — grows wild in Naga villages. Axone, fermented soybean wrapped in banana leaf, is a condiment so complex that Northeast chefs now serve it in fine dining restaurants.',
  },
  mn: {
    emoji: '💃', tagline: 'Land of Dance & Heritage',
    panelBg: 'linear-gradient(135deg,#1a1e3a,#2d3353)',
    pills: ['🌾 Black Rice', '🎋 Bamboo Shoots', '🌿 Wild Herbs', '🍯 Wild Honey', '🧵 Handloom'],
    snippet: 'Purple Chakhao rice, Loktak Lake, and a matrilineal society where women rule the market.',
    description: 'Manipur — the Jewelled Land, where the Ras Lila dance form is so sacred it is performed only in temples, and the floating islands of Loktak Lake are home to the last Sangai deer on earth. Chakhao, the black rice of Manipur — this purple-grain heirloom rice, cooked for royal feasts and Buddhist ceremonies for centuries, is now recognised as one of India\'s most antioxidant-rich foods.',
  },
  tr: {
    emoji: '🏛️', tagline: 'Land of Fourteen Tribes',
    panelBg: 'linear-gradient(135deg,#0d3320,#1a5c3a)',
    pills: ['🍍 Queen Pineapple', '🍯 Wild Forest Honey', '🎋 Bamboo Shoots', '🌿 Matai Peas', '🫙 Berma (Fermented Fish)'],
    snippet: 'Queen pineapple so sweet it needs no sugar. Wild honey from ancient Chakma bark hives.',
    description: 'Tripura — where Culture Meets Nature. The queen pineapple here is so sweet it needs no sugar. Wild forest honey is gathered by Chakma & Tripuri tribes using centuries-old bark hives. And Berma — fermented fish paste — is the Northeast\'s best-kept culinary secret.',
  },
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface RichState {
  id: string
  name: string
  slug: string
  image_url: string | null
  description: string | null
  region: string | null
  products: Product[]
}

interface Props {
  states: RichState[]
}

// ── Component ────────────────────────────────────────────────────────────────

export default function ExploreByRegion({ states }: Props) {
  const [activeId, setActiveId] = useState(states[0]?.id ?? '')
  const tabsRef = useRef<HTMLDivElement>(null)

  if (!states.length) return null

  const activeState = states.find(s => s.id === activeId) ?? states[0]
  const meta = REGION_META[activeId] ?? {
    emoji: '🏔️', tagline: '', panelBg: 'linear-gradient(135deg,#1a3a1e,#2d5233)',
    pills: [], snippet: '', description: activeState?.description ?? '',
  }

  function selectState(id: string) {
    setActiveId(id)
    // Scroll the clicked tab into view inside the tabs container
    setTimeout(() => {
      const tab = document.getElementById(`stab-${id}`)
      tab?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
    }, 0)
  }

  return (
    <section className="py-12 sm:py-16 bg-stone-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">

        {/* ── Section header ── */}
        <div className="mb-8">
          <div className="inline-block text-xs font-bold uppercase tracking-widest text-earth-600 bg-earth-50 border border-earth-100 px-3 py-1 rounded-full mb-3">
            Explore by Region
          </div>
          <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2">
            <div>
              <h2 className="text-2xl sm:text-3xl font-bold text-stone-900 mb-1">
                Discover the Himalayas
              </h2>
              <p className="text-stone-500 text-sm max-w-lg">
                Each state carries its own story — ancient forests, sacred rivers, and flavours shaped by altitude. Click to explore.
              </p>
            </div>
          </div>
        </div>

        {/* ── Story Cards horizontal scroll ── */}
        <div
          ref={tabsRef}
          className="flex gap-3 overflow-x-auto pb-4 mb-6"
          style={{ scrollbarWidth: 'none' }}
        >
          {states.map(s => {
            const m = REGION_META[s.id]
            const isActive = s.id === activeId
            return (
              <button
                key={s.id}
                id={`stab-${s.id}`}
                onClick={() => selectState(s.id)}
                className={`group relative flex-shrink-0 w-28 sm:w-32 rounded-2xl overflow-hidden border-2 transition-all duration-200 focus:outline-none ${
                  isActive
                    ? 'border-forest-600 shadow-lg scale-105'
                    : 'border-stone-200 hover:border-forest-400 hover:shadow-md'
                }`}
              >
                {/* Thumbnail */}
                <div className="aspect-[3/4] relative">
                  {s.image_url ? (
                    <Image
                      src={s.image_url}
                      alt={s.name}
                      fill
                      sizes="128px"
                      className="object-cover object-top"
                    />
                  ) : (
                    <div
                      className="absolute inset-0 flex items-center justify-center text-4xl"
                      style={{ background: m?.panelBg ?? 'linear-gradient(135deg,#1a3a1e,#2d5233)' }}
                    >
                      {m?.emoji ?? '🏔️'}
                    </div>
                  )}
                  {/* Gradient overlay */}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent" />
                  {/* Label */}
                  <div className="absolute bottom-0 left-0 right-0 p-2 text-left">
                    <div className="text-white font-bold text-[11px] leading-tight">{s.name}</div>
                    {m?.tagline && (
                      <div className="text-white/60 text-[10px] leading-tight italic mt-0.5 hidden sm:block">{m.tagline}</div>
                    )}
                  </div>
                  {/* Active indicator */}
                  {isActive && (
                    <div className="absolute top-2 right-2 w-2 h-2 rounded-full bg-earth-400 shadow-sm" />
                  )}
                </div>
              </button>
            )
          })}
        </div>

        {/* ── Active State Panel ── */}
        <div className="rounded-3xl overflow-hidden shadow-xl border border-stone-100">

          {/* Header: image + info side-by-side */}
          <div className="grid grid-cols-1 sm:grid-cols-2">

            {/* Cover image */}
            <div
              className="relative min-h-[220px] sm:min-h-[300px]"
              style={{ background: meta.panelBg }}
            >
              {/* Emoji fallback behind image */}
              <div className="absolute inset-0 flex items-center justify-center text-[100px] opacity-20 select-none">
                {meta.emoji}
              </div>
              {activeState.image_url && (
                <Image
                  key={activeState.image_url}
                  src={activeState.image_url}
                  alt={activeState.name}
                  fill
                  sizes="(max-width: 640px) 100vw, 50vw"
                  className="object-cover object-top"
                  priority
                />
              )}
              <div className="absolute inset-0 bg-gradient-to-r from-black/20 to-transparent" />
            </div>

            {/* Info panel */}
            <div
              className="p-6 sm:p-8 flex flex-col justify-center text-white"
              style={{ background: meta.panelBg }}
            >
              {/* State title */}
              <div className="text-2xl sm:text-3xl font-bold mb-1">
                {meta.emoji} {activeState.name}
              </div>
              {meta.tagline && (
                <div className="text-white/60 text-sm italic mb-4">{meta.tagline}</div>
              )}

              {/* Description */}
              <p className="text-white/80 text-sm leading-relaxed mb-5 line-clamp-5">
                {meta.description || activeState.description || ''}
              </p>

              {/* Pills */}
              {meta.pills.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {meta.pills.map(pill => (
                    <span
                      key={pill}
                      className="text-[11px] font-semibold px-3 py-1 rounded-full bg-white/10 border border-white/20 text-white/90 backdrop-blur-sm"
                    >
                      {pill}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Products grid */}
          <div className="bg-white p-5 sm:p-6">
            {activeState.products.length > 0 ? (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
                  {activeState.products.map((p, i) => (
                    <ProductCard key={p.id} product={p} priority={i < 2} />
                  ))}
                </div>
                {/* View all link */}
                <div className="mt-5 text-center">
                  <Link
                    href={`/products?state=${activeState.slug}`}
                    className="inline-flex items-center gap-2 text-sm font-semibold text-forest-700 hover:text-forest-900 underline underline-offset-4 transition-colors"
                  >
                    View all {activeState.name} products
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                    </svg>
                  </Link>
                </div>
              </>
            ) : (
              <div className="text-center py-10 text-stone-400 font-serif italic text-base">
                🏔️ Products coming soon from {activeState.name}…
              </div>
            )}
          </div>
        </div>

      </div>

      {/* Hide scrollbar cross-browser */}
      <style jsx>{`
        div::-webkit-scrollbar { display: none; }
      `}</style>
    </section>
  )
}
