'use client'

import { useState } from 'react'
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
  const [activeId, setActiveId] = useState(states[0]?.id ?? '')
  if (!states.length) return null

  const activeIndex = Math.max(0, states.findIndex(s => s.id === activeId))
  const activeState = states[activeIndex] ?? states[0]
  const meta = getRegionMeta(activeState.id)
  const nextState = states.length > 1 ? states[(activeIndex + 1) % states.length] : null
  const nextMeta = nextState ? getRegionMeta(nextState.id) : null

  const serif = 'var(--font-playfair,"Playfair Display",Georgia,serif)'
  const sans = 'var(--font-lato,Lato,sans-serif)'

  return (
    <section className="pr-region" aria-labelledby="discover-himalayas-title">
      <div className="pr-region-intro">
        <div className="pr-region-heading">
          <div className="pr-region-eyebrow">Explore by region</div>
          <h2 id="discover-himalayas-title" style={{ fontFamily: serif }}>Discover the Himalayas</h2>
          <p style={{ fontFamily: sans }}>
            Every mountain region carries its own landscape, traditions and flavours — shaped by altitude, people and place.
          </p>
        </div>
        <Link href="/regions" className="pr-region-all" style={{ fontFamily: sans }}>
          View all regions <span aria-hidden="true">→</span>
        </Link>
      </div>

      <div
        role="tablist"
        aria-label="Explore by region"
        className="pr-region-tabs"
      >
        {states.map((state) => {
          const isActive = state.id === activeState.id
          const stateMeta = getRegionMeta(state.id)
          return (
            <button
              key={state.id}
              id={`region-tab-${state.id}`}
              role="tab"
              type="button"
              aria-selected={isActive}
              aria-controls="region-panel"
              onClick={() => setActiveId(state.id)}
              className={`pr-region-tab${isActive ? ' is-active' : ''}`}
              style={{ fontFamily: sans }}
            >
              <span>{state.name}</span>
              <small>{stateMeta?.tagline ?? state.region ?? ''}</small>
            </button>
          )
        })}
      </div>

      <div
        key={activeState.id}
        id="region-panel"
        role="tabpanel"
        aria-labelledby={`region-tab-${activeState.id}`}
        className="pr-region-panel pr-panel-anim"
      >
        <div className="pr-region-hero">
          <div className="pr-region-hero-image">
            {activeState.image_url ? (
              <Image
                src={activeState.image_url}
                alt={`${activeState.name} Himalayan landscape and culture`}
                fill
                sizes="(max-width: 900px) 100vw, 72vw"
                style={{ objectFit: 'cover', objectPosition: 'center' }}
                priority
              />
            ) : (
              <div className="pr-region-image-fallback" aria-hidden="true" />
            )}
            <div className="pr-region-image-vignette" aria-hidden="true" />
          </div>

          <div className="pr-region-story">
            <div className="pr-region-story-inner">
              <div className="pr-region-kicker">{activeState.name}</div>
              <h3 style={{ fontFamily: serif }}>{meta?.tagline ?? 'Mountain country'}</h3>
              <p style={{ fontFamily: sans }}>
                {meta?.description || activeState.description || 'Discover the people, ingredients and traditions that shape this mountain region.'}
              </p>

              {meta?.pills?.length ? (
                <div className="pr-region-pills" aria-label={`${activeState.name} highlights`}>
                  {meta.pills.map((pill) => {
                    const cleanPill = pill.replace(/^[^\p{L}\p{N}]+/u, '')
                    return <span key={pill}>{cleanPill}</span>
                  })}
                </div>
              ) : null}

              <Link href={`/regions/${activeState.id}`} className="pr-region-cta" style={{ fontFamily: sans }}>
                Explore {activeState.name} <span aria-hidden="true">→</span>
              </Link>
            </div>
          </div>
        </div>

        <div className="pr-region-products">
          <div className="pr-region-products-intro">
            <div>
              <div className="pr-region-eyebrow">From this region</div>
              <h3 style={{ fontFamily: serif }}>Flavours of {activeState.name.replace(' Pradesh', '')}</h3>
              <p style={{ fontFamily: sans }}>
                Ingredients and foods shaped by the land, people and traditions of the mountains.
              </p>
            </div>
            {activeState.products.length > 0 && (
              <Link href={`/regions/${activeState.id}`} className="pr-region-products-link" style={{ fontFamily: sans }}>
                View all products <span aria-hidden="true">→</span>
              </Link>
            )}
          </div>

          {activeState.products.length > 0 ? (
            <div className="pr-region-product-grid">
              {activeState.products.slice(0, 4).map((product, index) => (
                <ProductCard key={product.id} product={product} priority={index < 2} />
              ))}
            </div>
          ) : (
            <div className="pr-region-empty" style={{ fontFamily: serif }}>
              Products coming soon from {activeState.name}…
            </div>
          )}
        </div>

        {nextState && nextState.id !== activeState.id && (
          <button
            type="button"
            className="pr-region-next"
            onClick={() => setActiveId(nextState.id)}
            aria-label={`Explore ${nextState.name}`}
          >
            <div className="pr-region-next-image">
              {nextState.image_url ? (
                <Image
                  src={nextState.image_url}
                  alt=""
                  fill
                  sizes="(max-width: 640px) 100vw, 55vw"
                  style={{ objectFit: 'cover' }}
                />
              ) : <div className="pr-region-image-fallback" aria-hidden="true" />}
            </div>
            <div className="pr-region-next-copy">
              <div className="pr-region-eyebrow">Next region</div>
              <h3 style={{ fontFamily: serif }}>{nextState.name}</h3>
              <em style={{ fontFamily: serif }}>{nextMeta?.tagline ?? 'Discover another mountain story'}</em>
              <span style={{ fontFamily: sans }}>Explore {nextState.name} <span aria-hidden="true">→</span></span>
            </div>
          </button>
        )}
      </div>
    </section>
  )
}
