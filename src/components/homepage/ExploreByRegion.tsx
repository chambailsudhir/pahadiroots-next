'use client'

import { useMemo, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import ProductCard from '@/components/product/ProductCard'
import type { Product } from '@/types'
import { getRegionMeta } from '@/lib/regionMeta'
import styles from './ExploreByRegion.module.css'

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
    const himachal = states.find(s =>
      s.id.toLowerCase() === 'hp' ||
      s.name.toLowerCase().includes('himachal')
    )
    return himachal?.id ?? states[0]?.id ?? ''
  }, [states])

  const [activeId, setActiveId] = useState(initialId)
  if (!states.length) return null

  const activeIndex = Math.max(0, states.findIndex(s => s.id === activeId))
  const activeState = states[activeIndex] ?? states[0]
  const meta = getRegionMeta(activeState.id) ?? {
    tagline: activeState.name,
    panelBg: '#0f3219',
    pills: [],
    snippet: activeState.description ?? '',
  }

  const nextState = states[(activeIndex + 1) % states.length]
  const nextMeta = getRegionMeta(nextState?.id)
  const displayRegion = activeState.name.replace(/\s+Pradesh$/i, '')

  return (
    <section className={styles.section} id="regions">
      <div className={styles.inner}>
        <header className={styles.header}>
          <div>
            <div className={styles.eyebrow}>Explore by Region <span /></div>
            <h2>Discover the Himalayas</h2>
            <p>Every mountain region carries its own landscape, traditions and flavours — shaped by altitude, people and place.</p>
          </div>
          <Link href="/regions" className={styles.viewAll}>View All Regions <span>→</span></Link>
        </header>

        <nav className={styles.regionNav} aria-label="Explore by region">
          {states.map(state => {
            const active = state.id === activeState.id
            return (
              <button
                key={state.id}
                type="button"
                className={`${styles.regionTab} ${active ? styles.active : ''}`}
                aria-pressed={active}
                onClick={() => setActiveId(state.id)}
              >
                {state.name}
              </button>
            )
          })}
        </nav>

        <div key={activeState.id} className={styles.content}>
          {/* DEMO HERO: exact side-by-side image / green editorial panel composition. */}
          <div className={styles.hero}>
            <div className={styles.heroPhoto}>
              {activeState.image_url ? (
                <Image
                  src={activeState.image_url}
                  alt={`${activeState.name} — Himalayan landscape and culture`}
                  fill
                  priority
                  sizes="(max-width: 900px) 100vw, 65vw"
                  style={{ objectFit: 'cover', objectPosition: 'center' }}
                />
              ) : <div className={styles.fallback}>🏔️</div>}
            </div>

            <div className={styles.story} style={{ background: meta.panelBg || '#0f3219' }}>
              <img className={styles.storyMountain} src="/explore-region-art/story-mountain.png" alt="" aria-hidden="true" />
              <img className={styles.storyPine} src="/explore-region-art/story-pine.png" alt="" aria-hidden="true" />

              <div className={styles.storyInner}>
                <div className={styles.storyKicker}>{activeState.name}</div>
                <h3>{meta.tagline || activeState.name}</h3>
                {meta.tagline && meta.tagline !== activeState.name && (
                  <div className={styles.storySubtitle}>{activeState.name}</div>
                )}
                <p>{meta.snippet || activeState.description || ''}</p>

                {meta.pills?.length > 0 && (
                  <div className={styles.pills}>
                    {meta.pills.map(pill => <span key={pill}>{pill.replace(/^\S+\s/, '')}</span>)}
                  </div>
                )}

                <Link href={`/regions/${activeState.id}`} className={styles.exploreButton}>
                  Explore {activeState.name} <span>→</span>
                </Link>
              </div>
            </div>
          </div>

          {/* DEMO PRODUCT ROW: editorial copy + four equal cards. */}
          <div className={styles.productsRow}>
            <div className={styles.productsCopy}>
              <div className={styles.eyebrow}>From This Region <span /></div>
              <h3>Flavours<br />of {displayRegion}</h3>
              <p>Pure ingredients. Real people. Timeless traditions. Bring home the tastes of the mountains.</p>
              {activeState.products.length > 0 && (
                <Link href={`/regions/${activeState.id}`} className={styles.productsLink}>
                  View All {displayRegion} Products <span>→</span>
                </Link>
              )}
              <img className={styles.productMountains} src="/explore-region-art/product-mountains.png" alt="" aria-hidden="true" />
            </div>

            {activeState.products.length > 0 ? (
              <div className={styles.productGrid}>
                {activeState.products.slice(0, 4).map((product, index) => (
                  <ProductCard key={product.id} product={product} priority={index < 2} />
                ))}
              </div>
            ) : (
              <div className={styles.empty}>Products coming soon from {activeState.name}.</div>
            )}
          </div>

          {/* DEMO NEXT REGION: same 65/35 panoramic composition. */}
          {nextState && nextState.id !== activeState.id && (
            <div className={styles.nextRegion}>
              <div className={styles.nextPhoto}>
                {nextState.image_url ? (
                  <Image
                    src={nextState.image_url}
                    alt={`${nextState.name} Himalayan region`}
                    fill
                    sizes="(max-width: 900px) 100vw, 65vw"
                    style={{ objectFit: 'contain', objectPosition: 'left center' }}
                  />
                ) : <div className={styles.fallback}>🏔️</div>}
              </div>
              <div className={styles.nextCopy}>
                <img className={styles.nextBotanical} src="/explore-region-art/next-botanical.png" alt="" aria-hidden="true" />
                <div className={styles.eyebrow}>Next Region <span /></div>
                <h3>{nextState.name}</h3>
                <div className={styles.nextTagline}>{nextMeta?.tagline ?? 'The mountains continue'}</div>
                <p>{nextMeta?.snippet ?? nextState.description ?? ''}</p>
                <button type="button" className={styles.nextLink} onClick={() => setActiveId(nextState.id)}>
                  Explore {nextState.name} <span>→</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
