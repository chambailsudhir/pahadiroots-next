'use client'

import Link from 'next/link'
import { memo, useEffect, useRef, useState } from 'react'
import { formatPrice } from '@/lib/utils'
import styles from './CartUIComponents.module.css'

// ─── Sticky mobile CTA ────────────────────────────────────────────────────────
interface StickyProps {
  total: number
  /**
   * Pre-shipping subtotal — used exclusively for the min-order gate.
   *
   * Bug fixed (prior round): the original component used `total` (post-shipping)
   * for both the displayed amount AND the min-order comparison, causing a logical
   * inconsistency with CartSummary. With orderSubtotal, both components compare
   * the same value. Optional so existing usages outside CartPage still work.
   */
  orderSubtotal?: number
  totalQty: number
  minOrderAmt?: number
}

export const StickyCartCTA = memo(function StickyCartCTA({
  total,
  orderSubtotal,
  totalQty,
  minOrderAmt = 0,
}: StickyProps) {
  const belowMinOrder = minOrderAmt > 0 && (orderSubtotal ?? total) < minOrderAmt

  const [isMobile, setIsMobile] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 960px)')
    const update = (e: MediaQueryListEvent | MediaQueryList) => setIsMobile(e.matches)
    update(mq)
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])

  // Apply inert + aria-hidden imperatively — React 18 doesn't support inert as a JSX prop.
  // aria-hidden ensures VoiceOver on older Safari (where inert isn't fully supported)
  // doesn't announce the duplicate "Checkout" button to screen reader users on desktop.
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    if (isMobile) {
      el.removeAttribute('inert')
      el.removeAttribute('aria-hidden')
    } else {
      el.setAttribute('inert', '')
      el.setAttribute('aria-hidden', 'true')
    }
  }, [isMobile])

  return (
    <div ref={wrapRef} className={styles.sccWrap}>
      <div>
        <div className={styles.sccTotal}>{formatPrice(total)}</div>
        <div className={styles.sccSub}>{totalQty} item{totalQty > 1 ? 's' : ''} · Incl. taxes</div>
      </div>
      {belowMinOrder ? (
        <>
          {/* sr-only text tells screen readers *why* checkout is blocked */}
          <span id="scc-min-warn" className="sr-only">
            Minimum order is ₹{minOrderAmt}. Add more items to proceed.
          </span>
          {/*
           * A1 (accessibility fix): type="button" added.
           *    Without an explicit type attribute, <button> defaults to
           *    type="submit" inside a <form>. While no <form> wraps this
           *    component today, the omission is inconsistent with the rest of
           *    the codebase and risks accidental form submission in future.
           *
           * A2 (accessibility fix): aria-hidden on 🔒 emoji.
           *    The emoji is decorative — "Checkout" is the meaningful label.
           *    Without aria-hidden, screen readers announce "lock emoji Checkout"
           *    instead of just "Checkout, dimmed button".
           */}
          <button
            type="button"
            className={`${styles.sccBtn} ${styles.sccBtnDisabled}`}
            disabled
            aria-describedby="scc-min-warn"
          >
            <span aria-hidden="true">🔒</span> Checkout
          </button>
        </>
      ) : (
        <Link href="/checkout" className={styles.sccBtn}>
          <span aria-hidden="true">🔒</span> Checkout
        </Link>
      )}
    </div>
  )
})

// ─── Empty cart state ─────────────────────────────────────────────────────────
export const EmptyCart = memo(function EmptyCart() {
  return (
    <div className={styles.ecEmpty}>
      {/*
       * A3 (accessibility fix): aria-hidden on 🛒 decorative icon.
       *    The heading "Your cart is empty" immediately below already communicates
       *    the page state. The large cart emoji is purely visual decoration —
       *    having SR announce "shopping cart emoji" before the heading adds noise.
       */}
      <div className={styles.ecIcon} aria-hidden="true">🛒</div>
      <h1 className={styles.ecTitle}>Your cart is empty</h1>
      <p className={styles.ecSub}>
        Discover natural Himalayan goodness crafted by mountain farmers.
      </p>
      <p className={styles.ecTagline}>
        &quot;From high-altitude farms, with care.&quot;
      </p>
      <Link href="/products" className={styles.ecBtn}>Browse Products →</Link>
    </div>
  )
})
