'use client'

import React, { useMemo, useRef, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { Source_Serif_4, Montserrat } from 'next/font/google'
import RegionProductCard from './RegionProductCard'
import type { Product } from '@/types'
import { getRegionMeta, type RegionMeta } from '@/lib/regionMeta'
import styles from './ExploreByRegion.module.css'

// Section-scoped faces that match the approved design (serif headings + clean geometric sans).
const regionSerif = Source_Serif_4({ variable: '--font-region-serif', subsets: ['latin'], weight: ['400', '500', '600', '700'], style: ['normal', 'italic'], display: 'swap' })
const regionSans  = Montserrat({ variable: '--font-region-sans', subsets: ['latin'], weight: ['400', '500', '600', '700'], display: 'swap' })

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
  const meta: Partial<RegionMeta> & Pick<RegionMeta, 'tagline' | 'panelBg' | 'pills' | 'snippet'> = getRegionMeta(activeState.id) ?? {
    tagline: activeState.name,
    panelBg: '#0f3219',
    pills: [],
    snippet: activeState.description ?? '',
  }

  const displayRegion = activeState.name.replace(/\s+Pradesh$/i, '')

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

  return (
    <section ref={sectionRef} className={`${styles.section} ${regionSerif.variable} ${regionSans.variable}`} id="regions">
      <div className={styles.inner}>
        <header className={styles.header}>
          <div>
            <div className={styles.eyebrow}><b>Explore</b> By Region <span /></div>
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
                <span>{state.name}</span>
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
          {/* HERO: full-width photo with the green story panel laid over its right side. */}
          <div className={styles.hero}>
            <div className={styles.heroPhoto} style={{ ['--fp' as string]: meta.heroFocus || 'center 25%', ['--fpm' as string]: meta.mobileFocus || meta.heroFocus || 'center' } as React.CSSProperties}>
              {(meta.homeHeroImage || activeState.image_url) ? (
                <Image
                  src={(meta.homeHeroImage || activeState.image_url) as string}
                  alt={`${activeState.name} — Himalayan landscape and culture`}
                  fill
                  priority
                  sizes="(max-width: 700px) 840px, (max-width: 1000px) 1020px, 1312px"
                  quality={90}
                  style={{ objectFit: 'cover', objectPosition: 'var(--fp)' }}
                />
              ) : <div className={styles.fallback}>🏔️</div>}
            </div>

            <div className={styles.story} style={{ background: meta.homePanelBg || meta.panelBg || '#15281c' }}>
              <img className={styles.storyMountain} src="/explore-region-art/story-mountain.png" alt="" aria-hidden="true" />
              <img className={styles.storyPine} src="/explore-region-art/story-pine.png" alt="" aria-hidden="true" />

              <div className={styles.storyInner}>
                <div className={styles.storyKicker}>{activeState.name}<span /></div>
                <h3>{meta.tagline || activeState.name}</h3>
                {(meta.subtitle || (meta.tagline && meta.tagline !== activeState.name)) && (
                  <div className={styles.storySubtitle}>{meta.subtitle || activeState.name}</div>
                )}
                <p>{meta.homeCopy || meta.snippet || activeState.description || ''}</p>

                {meta.pills?.length > 0 && (
                  <div className={styles.pills}>
                    {meta.pills.map(pill => <span key={pill}>{pill.replace(/^\S+\s/, '')}</span>)}
                  </div>
                )}

                <Link href={`/regions/${activeState.id}`} className={styles.exploreButton}>
                  Explore {displayRegion} <span>→</span>
                </Link>
              </div>
            </div>
          </div>

          {/* PRODUCT ROW: editorial copy + four equal cards, engraving anchored bottom left. */}
          <div className={styles.productsRow}>
            <img className={styles.productMountains} src="/explore-region-art/product-mountains.png" alt="" aria-hidden="true" />
            <div className={styles.productsCopy}>
              <div className={styles.eyebrow}><b>F</b>rom This Region <span /></div>
              <h3>Flavours<br />of {displayRegion}</h3>
              <p>Pure ingredients. Real people. Timeless traditions. Bring home the tastes of {displayRegion}.</p>
              {activeState.products.length > 0 && (
                <Link href={`/regions/${activeState.id}`} className={styles.productsLink}>
                  View All {displayRegion} Products <span>→</span>
                </Link>
              )}
            </div>

            {activeState.products.length > 0 ? (
              <div className={styles.productGrid}>
                {activeState.products.slice(0, 4).map((product, index) => (
                  <RegionProductCard key={product.id} product={product} priority={index < 2} />
                ))}
              </div>
            ) : (
              <div className={styles.empty}>Products coming soon from {activeState.name}.</div>
            )}
          </div>

        </div>
      </div>
    </section>
  )
}
