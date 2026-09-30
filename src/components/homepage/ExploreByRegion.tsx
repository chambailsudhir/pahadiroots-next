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
    panelBg: 'linear-gradient(135deg,#17371d,#234f2c)',
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
          <div className="pr-region-hero">
            <div className="pr-region-photo">
              {activeState.image_url ? (
                <Image
                  src={activeState.image_url}
                  alt={`${activeState.name} — Himalayan landscape and culture`}
                  fill
                  priority
                  sizes="(max-width: 900px) 100vw, 72vw"
                  style={{ objectFit: 'cover', objectPosition: 'center' }}
                />
              ) : (
                <div className="pr-region-photo-fallback">{meta.emoji}</div>
              )}
            </div>

            <div className="pr-region-story" style={{ background: meta.panelBg }}>
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

          <div className="pr-products-head">
            <div>
              <div className="pr-eyebrow">From This Region</div>
              <h3>Flavours of {activeState.name.replace(' Pradesh', '')}</h3>
              <p>Pure ingredients. Real people. Timeless traditions. Bring home the tastes of the mountains.</p>
            </div>
            {activeState.products.length > 0 && (
              <Link href={`/regions/${activeState.id}`} className="pr-products-link">View all products <span>→</span></Link>
            )}
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

          {nextState && nextState.id !== activeState.id && (
            <div className="pr-next-region">
              <div className="pr-next-photo">
                {nextState.image_url ? (
                  <Image
                    src={nextState.image_url}
                    alt={`${nextState.name} Himalayan region`}
                    fill
                    sizes="(max-width: 900px) 100vw, 60vw"
                    style={{ objectFit: 'cover', objectPosition: 'center' }}
                  />
                ) : <div className="pr-region-photo-fallback">{nextMeta?.emoji ?? '🏔️'}</div>}
              </div>
              <div className="pr-next-copy">
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
