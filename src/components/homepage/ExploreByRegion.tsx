'use client'

import { useMemo, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import ProductCard from '@/components/product/ProductCard'
import type { Product } from '@/types'
import { getRegionMeta } from '@/lib/regionMeta'

export interface RichState {
  id: string
  name: string
  slug: string
  image_url: string | null
  description: string | null
  region: string | null
  products: Product[]
}

interface Props { states: RichState[] }

/* These are deliberately inline SVGs so the botanical / mountain engraving details
   are part of the page design and do not depend on generated raster artwork. */
function MountainEngraving({ className = '' }: { className?: string }) {
  return (
    <svg className={`pr-line-art ${className}`} viewBox="0 0 260 150" aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
        <path d="M7 126 55 79 78 103 111 58 145 104 178 35 221 96 252 71" strokeWidth="2.2" />
        <path d="m55 79 18 17 12-13M111 58l18 26 15-18M178 35l16 31 13-12M221 96l14-10" strokeWidth="1.2" />
        <path d="M20 132c35-12 69-8 103 0 42-10 76-9 116 0" strokeWidth="1" />
        <path d="M35 117 54 98M42 122 64 101M98 119l14-23M105 125l18-27M164 115l17-27M171 121l18-31" strokeWidth=".8" />
      </g>
    </svg>
  )
}

function PineEngraving({ className = '' }: { className?: string }) {
  return (
    <svg className={`pr-line-art ${className}`} viewBox="0 0 190 190" aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
        <path d="M102 171c-2-31 4-60 15-90 8-22 14-39 15-59" strokeWidth="1.6" />
        <path d="M113 117c-17-4-31-12-42-24M118 101c18-3 31-10 42-21M123 82c-12-5-23-12-31-23M127 66c14-4 24-10 33-20M131 49c-9-5-16-11-21-19M136 37c10-4 17-9 23-17" strokeWidth="1.35" />
        <path d="M84 94c-5 9-8 18-9 27M75 123c-6 6-12 12-18 15M149 79c6 7 11 13 18 17M155 111c7 4 14 9 19 15" strokeWidth=".9" />
        <path d="M104 168c-9 5-18 8-28 9M105 168c12 3 23 3 35 1" strokeWidth="1" />
      </g>
    </svg>
  )
}

function BotanicalEngraving({ className = '' }: { className?: string }) {
  return (
    <svg className={`pr-line-art ${className}`} viewBox="0 0 230 250" aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
        <path d="M28 231c34-48 58-89 70-126 8-24 13-49 15-76" strokeWidth="1.45" />
        <path d="M86 142c-19-5-35-14-48-28M96 119c20-2 36-9 50-22M104 94c-14-5-26-14-36-27M111 72c18-4 31-12 41-25M115 48c-9-5-17-13-23-23" strokeWidth="1.15" />
        <path d="M49 201c-5-12-12-21-22-29M64 179c15-3 27-10 38-20M73 159c-12-4-22-11-30-21" strokeWidth=".85" />
        <ellipse cx="38" cy="200" rx="17" ry="9" transform="rotate(-34 38 200)" strokeWidth="1" />
        <ellipse cx="118" cy="153" rx="16" ry="8" transform="rotate(28 118 153)" strokeWidth="1" />
        <ellipse cx="143" cy="96" rx="14" ry="7" transform="rotate(-26 143 96)" strokeWidth="1" />
        <ellipse cx="61" cy="126" rx="15" ry="7" transform="rotate(35 61 126)" strokeWidth="1" />
        <path d="M39 191c-1 7-1 13-1 19M113 147c5 5 9 9 13 13M139 90c-1 6-1 11-1 16M62 119c-5 5-8 10-11 15" strokeWidth=".7" />
      </g>
    </svg>
  )
}

export default function ExploreByRegion({ states }: Props) {
  const initialId = useMemo(() => {
    const himachal = states.find(s => s.id.toLowerCase() === 'hp' || s.name.toLowerCase().includes('himachal'))
    return himachal?.id ?? states[0]?.id ?? ''
  }, [states])
  const [activeId, setActiveId] = useState(initialId)

  if (!states.length) return null

  const activeIndex = Math.max(0, states.findIndex(s => s.id === activeId))
  const activeState = states[activeIndex] ?? states[0]
  const meta = getRegionMeta(activeState.id) ?? {
    emoji: '🏔️',
    tagline: '',
    panelBg: '#17371d',
    pills: [],
    snippet: '',
    description: activeState.description ?? '',
  }

  const nextState = states[(activeIndex + 1) % states.length]
  const nextMeta = getRegionMeta(nextState?.id)

  return (
    <section className="pr-explore" id="regions">
      <div className="pr-explore-inner">
        <header className="pr-explore-head">
          <div className="pr-explore-copy">
            <div className="pr-eyebrow">Explore by Region</div>
            <h2>Discover the Himalayas</h2>
            <p>Every mountain region carries its own landscape, traditions and flavours — shaped by altitude, people and place.</p>
          </div>
          <Link href="/regions" className="pr-view-all">View All Regions <span>→</span></Link>
        </header>

        <nav className="pr-region-nav" role="tablist" aria-label="Explore by region">
          {states.map(state => {
            const isActive = state.id === activeState.id
            return (
              <button
                key={state.id}
                id={`region-tab-${state.id}`}
                role="tab"
                aria-selected={isActive}
                aria-controls="region-panel"
                className={`pr-region-tab${isActive ? ' is-active' : ''}`}
                onClick={() => setActiveId(state.id)}
              >
                {state.name}
              </button>
            )
          })}
        </nav>

        <div
          key={activeState.id}
          id="region-panel"
          role="tabpanel"
          aria-labelledby={`region-tab-${activeState.id}`}
          className="pr-region-content pr-panel-anim"
        >
          {/* Exact demo composition: the image runs full width and the green story panel overlaps it. */}
          <div className="pr-region-hero">
            <div className="pr-region-photo">
              {activeState.image_url ? (
                <Image
                  src={activeState.image_url}
                  alt={`${activeState.name} — Himalayan landscape and culture`}
                  fill
                  priority
                  sizes="(max-width: 720px) 100vw, 1280px"
                  style={{ objectFit: 'cover', objectPosition: 'center' }}
                />
              ) : (
                <div className="pr-region-photo-fallback">{meta.emoji}</div>
              )}
            </div>

            <div className="pr-region-story" style={{ background: meta.panelBg || '#17371d' }}>
              <MountainEngraving className="pr-art-story-mountains" />
              <PineEngraving className="pr-art-story-pine" />
              <div className="pr-story-kicker">{activeState.name}</div>
              <h3>{meta.tagline || activeState.name}</h3>
              {meta.tagline && meta.tagline !== activeState.name && (
                <div className="pr-story-subtitle">{activeState.name}</div>
              )}
              <p>{meta.snippet || activeState.description || meta.description}</p>
              <div className="pr-region-pills">
                {meta.pills.map(pill => <span key={pill}>{pill.replace(/^\S+\s/, '')}</span>)}
              </div>
              <Link href={`/regions/${activeState.id}`} className="pr-explore-btn">Explore {activeState.name} <span>→</span></Link>
            </div>
          </div>

          {/* Product intro and products are one continuous editorial row, exactly like the demo. */}
          <div className="pr-products-row">
            <div className="pr-products-copy">
              <div className="pr-eyebrow">From This Region</div>
              <h3>Flavours of {activeState.name.replace(' Pradesh', '')}</h3>
              <p>Pure ingredients. Real people. Timeless traditions. Bring home the tastes of the mountains.</p>
              {activeState.products.length > 0 && (
                <Link href={`/regions/${activeState.id}`} className="pr-products-link">View All {activeState.name.replace(' Pradesh', '')} Products <span>→</span></Link>
              )}
              <MountainEngraving className="pr-art-products-mountains" />
            </div>

            {activeState.products.length > 0 ? (
              <div className="pr-products-grid">
                {activeState.products.slice(0, 4).map((product, i) => (
                  <ProductCard key={product.id} product={product} priority={i < 2} />
                ))}
              </div>
            ) : (
              <div className="pr-empty-products">Products coming soon from {activeState.name}.</div>
            )}
          </div>

          {nextState && nextState.id !== activeState.id && (
            <div className="pr-next-region">
              <div className="pr-next-photo">
                {nextState.image_url ? (
                  <Image
                    src={nextState.image_url}
                    alt={`${nextState.name} Himalayan region`}
                    fill
                    sizes="(max-width: 900px) 100vw, 70vw"
                    style={{ objectFit: 'cover', objectPosition: 'center' }}
                  />
                ) : <div className="pr-region-photo-fallback">{nextMeta?.emoji ?? '🏔️'}</div>}
              </div>
              <div className="pr-next-copy">
                <BotanicalEngraving className="pr-art-next-botanical" />
                <div className="pr-eyebrow">Next Region</div>
                <h3>{nextState.name}</h3>
                <div className="pr-next-tagline">{nextMeta?.tagline ?? 'The mountains continue'}</div>
                <p>{nextMeta?.snippet ?? nextState.description ?? ''}</p>
                <button className="pr-next-link" onClick={() => setActiveId(nextState.id)}>Explore {nextState.name} <span>→</span></button>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
