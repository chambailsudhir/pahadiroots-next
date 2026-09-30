'use client'

import React, { useMemo, useRef, useState } from 'react'
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
  const sectionRef = useRef<HTMLElement>(null)
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([])
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

  // "Next Region" CTA: switch tab AND bring the top of the widget back into
  // view, otherwise the visitor stays parked at the bottom of the old panel.
  const goToNext = () => {
    if (!nextState) return
    setActiveId(nextState.id)
    sectionRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
  }
  const domId = (id: string) => id.toLowerCase().replace(/[^a-z0-9_-]/g, '-')
  const tabId = (id: string) => `region-tab-${domId(id)}`
  const panelId = (id: string) => `region-panel-${domId(id)}`

  // WAI-ARIA tabs pattern: arrow keys / Home / End move between regions.
  const onTabKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const last = states.length - 1
    let target = -1
    if (e.key === 'ArrowRight') target = activeIndex >= last ? 0 : activeIndex + 1
    else if (e.key === 'ArrowLeft') target = activeIndex <= 0 ? last : activeIndex - 1
    else if (e.key === 'Home') target = 0
    else if (e.key === 'End') target = last
    if (target < 0) return
    e.preventDefault()
    setActiveId(states[target].id)
    tabRefs.current[target]?.focus()
  }
  const nextPosition = String(((activeIndex + 1) % states.length) + 1).padStart(2, '0')
  const totalRegions = String(states.length).padStart(2, '0')

  return (
    <section ref={sectionRef} className={styles.section} id="regions">
      <div className={styles.inner}>
        <header className={styles.header}>
          <div>
            <div className={styles.eyebrow}>Explore by Region <span /></div>
            <h2>Discover the Himalayas</h2>
            <p>Every mountain region carries its own landscape, traditions and flavours — shaped by altitude, people and place.</p>
          </div>
          <Link href="/regions" className={styles.viewAll}>View All Regions <span>→</span></Link>
        </header>

        <div
          className={styles.regionNav}
          role="tablist"
          aria-label="Explore by region"
          onKeyDown={onTabKeyDown}
        >
          {states.map((state, index) => {
            const active = state.id === activeState.id
            return (
              <button
                key={state.id}
                ref={el => { tabRefs.current[index] = el }}
                type="button"
                role="tab"
                id={tabId(state.id)}
                aria-selected={active}
                aria-controls={active ? panelId(state.id) : undefined}
                tabIndex={active ? 0 : -1}
                className={`${styles.regionTab} ${active ? styles.active : ''}`}
                onClick={() => setActiveId(state.id)}
              >
                {state.name}
              </button>
            )
          })}
        </div>

        <div
          key={activeState.id}
          className={styles.content}
          role="tabpanel"
          id={panelId(activeState.id)}
          aria-labelledby={tabId(activeState.id)}
        >
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

          {/* NEXT REGION: blur-filled photo stage (never leaves empty space, whatever the photo's aspect ratio) + editorial copy panel. */}
          {nextState && nextState.id !== activeState.id && (
            <div className={styles.nextRegion}>
              <div className={styles.nextPhoto}>
                {nextState.image_url ? (
                  <>
                    <Image
                      src={nextState.image_url}
                      alt=""
                      aria-hidden="true"
                      fill
                      sizes="(max-width: 1000px) 100vw, 40vw"
                      className={styles.nextPhotoBackdrop}
                    />
                    <Image
                      src={nextState.image_url}
                      alt={`${nextState.name} Himalayan region`}
                      fill
                      sizes="(max-width: 1000px) 100vw, 65vw"
                      className={styles.nextPhotoMain}
                    />
                  </>
                ) : <div className={styles.fallback}>🏔️</div>}
                <span className={styles.nextCounter}>{nextPosition} <i>/</i> {totalRegions}</span>
              </div>

              <div className={styles.nextCopy}>
                <img className={styles.nextBotanical} src="/explore-region-art/next-botanical.png" alt="" aria-hidden="true" />
                <div className={styles.eyebrow}>Next Region <span /></div>
                <h3>{nextState.name}</h3>
                <div className={styles.nextTagline}>{nextMeta?.tagline ?? 'The mountains continue'}</div>
                <p>{nextMeta?.snippet ?? nextState.description ?? ''}</p>

                {nextMeta && nextMeta.pills.length > 0 && (
                  <div className={styles.nextPills}>
                    {nextMeta.pills.slice(0, 4).map(pill => <span key={pill}>{pill.replace(/^\S+\s/, '')}</span>)}
                  </div>
                )}

                <button type="button" className={styles.nextLink} onClick={goToNext}>
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
