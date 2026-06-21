'use client'

/**
 * UpsellSection — "Customers Also Buy" grid of product suggestions.
 *
 * Accessibility fixes applied (this round):
 *
 *   A1. Loading state not communicated to screen readers (WCAG 4.1.3).
 *       While the grid displayed shimmer placeholders, there was no indication
 *       to AT that content was being loaded. A screen reader navigating the page
 *       during load would hit the grid and hear nothing meaningful.
 *       Fix: aria-busy={loading} on the grid container. When true, AT is
 *       signaled to wait before reading the region's content. When loading
 *       completes (false), AT can announce the updated content normally.
 *
 *   A2. Shimmer placeholder elements were exposed to screen readers.
 *       The UpsellShimmer component renders purely visual skeleton shapes.
 *       Exposing these to AT produces meaningless announcements (empty divs).
 *       Fix: aria-hidden="true" on each shimmer wrapper so AT skips them
 *       entirely, relying instead on aria-busy (A1) to communicate loading.
 *
 *   A3. Grid has no accessible name (WCAG 1.3.1).
 *       The <h2> heading is a sibling of the grid, not a label for it. A screen
 *       reader user navigating directly to the grid region had no landmark label.
 *       Fix: aria-label="Customer suggestions" on the grid div gives it a
 *       programmatically determinable name independent of the heading.
 *
 * Prior bug-fixes already present (kept for reference):
 *
 *   1. items.slice(0,4) called twice in one ternary — derived to visibleItems once.
 *   2. Add-to-cart button missing type="button".
 */

import { memo, useMemo, useState } from 'react'
import Image from 'next/image'
import { formatPrice } from '@/lib/utils'
import type { UpsellItem } from '@/types'
import styles from './UpsellSection.module.css'

interface Props {
  items: UpsellItem[]
  loading: boolean
  error?: boolean
  addedIds: string[]
  remainingForFreeShip: number
  isFreeShipping: boolean
  freeShipMin: number
  onAdd: (item: UpsellItem) => void
}

// A2: UpsellShimmer is a purely visual skeleton — aria-hidden="true" ensures
// AT skips it entirely. The parent grid's aria-busy={loading} communicates
// the loading state instead.
function UpsellShimmer() {
  return (
    <div className={styles.shimmer} aria-hidden="true">
      <div className={styles.shImg} />
      <div className={styles.shBody}>
        <div className={`${styles.shLine} ${styles.short}`} />
        <div className={styles.shLine} />
        <div className={`${styles.shLine} ${styles.medium}`} />
      </div>
      <div className={styles.shBtn} />
    </div>
  )
}

const UpsellSection = memo(function UpsellSection({
  items, loading, error, addedIds, remainingForFreeShip,
  isFreeShipping, freeShipMin, onAdd,
}: Props) {
  const visibleItems = items.slice(0, 4)

  // PERF FIX: useMemo — was `new Set(addedIds)` inline, recreating the Set on
  // every render even when addedIds didn't change. With useMemo the Set is only
  // rebuilt when the addedIds array reference changes (i.e. after an upsell add).
  // The original O(1) lookup benefit is preserved; the allocation cost is not.
  const addedSet = useMemo(() => new Set(addedIds), [addedIds])

  // UX FIX: match shimmer count to the real item count from the last successful load,
  // preventing the jarring jump from 4 shimmers → 1–3 real items.
  // On the very first load (no prior data) we default to 2 (the median expected
  // result) instead of always showing 4, avoiding unnecessary layout shift.
  //
  // BUG FIX (React 19 / react-hooks/refs lint rule): was a useRef mutated
  // directly during render (`prevCountRef.current = ...`). Refs can't be
  // safely read or written during render — React may call a render function
  // multiple times without committing in concurrent mode, so ref mutations
  // could leak across attempts.
  //
  // BUG FIX (regression from the first useState attempt): the first
  // rewrite called setPrevCount(visibleItems.length) unconditionally
  // whenever `!loading && !error && visibleItems.length > 0`, relying
  // purely on React's Object.is bailout to avoid extra renders. That
  // caused an actual "Too many re-renders" failure in this component
  // under test — calling a state setter during render without an explicit
  // transition-gate isn't safe to rely on for stabilization. Fixed using
  // the same explicit-transition-gate pattern used correctly everywhere
  // else in this codebase (SearchOverlay, AuthModal, useCartPage,
  // useCheckoutPage): track the previous visibleItems.length via its own
  // useState, and only ever touch prevCount inside the gated branch — so
  // on any render where the length hasn't changed, ZERO setState calls
  // happen at all, sidestepping any reliance on bailout behavior.
  const [prevVisibleCount, setPrevVisibleCount] = useState(0)
  const [prevCount, setPrevCount] = useState(2)
  if (visibleItems.length !== prevVisibleCount) {
    setPrevVisibleCount(visibleItems.length)
    if (!loading && !error && visibleItems.length > 0) {
      setPrevCount(visibleItems.length)
    }
  }
  const shimmerCount = loading ? Math.max(1, Math.min(4, prevCount)) : 0

  return (
    <div className={styles.card}>
      <div className={styles.head}>
        <h2 className={styles.title}><span aria-hidden="true">🛍</span> Customers Also Buy</h2>
        <span className={styles.sub}>
          {freeShipMin > 0 && !isFreeShipping
            ? `Add ${formatPrice(remainingForFreeShip)} more for free shipping`
            : 'Top picks for you'}
        </span>
      </div>

      {/*
       * A1: aria-busy={loading} signals to AT that this region is actively
       *     loading. Combined with A2 (shimmer aria-hidden), SR users hear
       *     nothing during load, then get the updated product list announced
       *     once aria-busy flips to false.
       * A3: aria-label provides an accessible name for the grid region.
       */}
      <div
        className={styles.grid}
        aria-busy={loading}
        aria-label="Customer suggestions"
      >
        {loading
          ? Array.from({ length: shimmerCount }, (_, i) => <UpsellShimmer key={i} />)
          : error
            ? <p className={styles.errorMsg}>Couldn&apos;t load suggestions right now.</p>
            : visibleItems.length === 0
              ? <p className={styles.emptyMsg}>You&apos;re all caught up — no more suggestions right now!</p>
              : visibleItems.map(p => (
                <div
                  key={p.id}
                  className={`${styles.item}${addedSet.has(p.id) ? ` ${styles.added}` : ''}`}
                >
                  <div className={styles.imgWrap}>
                    {p.image
                      ? <Image src={p.image} alt={p.name} fill sizes="50px"
                          style={{ objectFit: 'cover', borderRadius: '8px' }} />
                      : <span className={styles.imgEmoji} aria-hidden="true">{p.emoji || '🌿'}</span>
                    }
                  </div>
                  <div className={styles.info}>
                    {p.badge && <div className={styles.badge}>{p.badge}</div>}
                    <div className={styles.name}>{p.name}</div>
                    <div className={styles.size}>{p.size}</div>
                    <div className={styles.priceRow}>
                      {p.mrp > p.price && (
                        <s className={styles.mrp} aria-label={`Was ${formatPrice(p.mrp)}`}>
                          {formatPrice(p.mrp)}
                        </s>
                      )}
                      <span className={styles.price}>{formatPrice(p.price)}</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    className={`${styles.btn}${addedSet.has(p.id) ? ` ${styles.added}` : ''}`}
                    onClick={() => onAdd(p)}
                    aria-label={`Add ${p.name} to cart`}
                    disabled={addedSet.has(p.id)}
                  >
                    {addedSet.has(p.id) ? '✓' : '+ Add'}
                  </button>
                </div>
              ))}
      </div>
    </div>
  )
})

export default UpsellSection
