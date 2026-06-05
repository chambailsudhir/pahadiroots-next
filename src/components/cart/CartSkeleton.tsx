'use client'

import styles from './CartSkeleton.module.css'

// Uses .skeleton class from globals.css (shimmer animation already defined)
export default function CartSkeleton() {
  const PRICE_WIDTHS = [120, 100, 80]

  return (
    <div className={styles.wrap}>
      {/* Ship bar */}
      <div className={styles.shipBar} />

      {/* Steps */}
      <div className={styles.stepsBar}>
        {[0, 1, 2].map(i => (
          <div key={i} className={styles.stepGroup}>
            <div className={`skeleton ${styles.circle}`} />
            <div className={`skeleton ${styles.stepTxt}`} />
            {i < 2 && <div className={styles.stepDash} />}
          </div>
        ))}
      </div>

      <div className={styles.layout}>
        {/* Left */}
        <div className={styles.left}>

          {/* Items card */}
          <div className={styles.card}>
            <div className={styles.cardHead}>
              <div className={`skeleton ${styles.headTxt}`} />
            </div>
            {[0, 1].map(i => (
              <div key={i} className={styles.itemRow}>
                <div className={`skeleton ${styles.itemImg}`} />
                <div className={styles.itemBody}>
                  <div className={`skeleton ${styles.itemName}`} />
                  <div className={`skeleton ${styles.itemSize}`} />
                  <div className={styles.badgesRow}>
                    <div className={`skeleton ${styles.badge}`} />
                    <div className={`skeleton ${styles.badge}`} />
                  </div>
                  <div className={styles.itemFoot}>
                    <div className={`skeleton ${styles.qtyCtrl}`} />
                    <div className={`skeleton ${styles.priceCol}`} />
                    <div className={`skeleton ${styles.delBtn}`} />
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Upsell card */}
          <div className={styles.card}>
            <div className={styles.cardHead}>
              <div className={`skeleton ${styles.headTxt} ${styles.w60}`} />
            </div>
            <div className={styles.upsellGrid}>
              {[0, 1, 2, 3].map(i => (
                <div key={i} className={styles.upsellItem}>
                  <div className={`skeleton ${styles.upsellImg}`} />
                  <div className={styles.upsellInfo}>
                    <div className={`skeleton ${styles.upsellBadge}`} />
                    <div className={`skeleton ${styles.upsellName}`} />
                    <div className={`skeleton ${styles.upsellPrice}`} />
                  </div>
                  <div className={`skeleton ${styles.upsellBtn}`} />
                </div>
              ))}
            </div>
          </div>

          {/* Trust card */}
          <div className={`${styles.card} ${styles.trustCard}`}>
            {[0, 1, 2, 3].map(i => (
              <div key={i} className={styles.trustItem}>
                <div className={`skeleton ${styles.trustIcon}`} />
                <div className={`skeleton ${styles.trustTxt}`} />
              </div>
            ))}
          </div>
        </div>

        {/* Right */}
        <div className={styles.right}>
          <div className={styles.card}>
            <div className={styles.pad}>
              {/* Coupon */}
              <div className={styles.couponRow}>
                <div className={`skeleton ${styles.couponInput}`} />
                <div className={`skeleton ${styles.couponBtn}`} />
              </div>
              {/* Prices */}
              <div className={styles.prices}>
                {PRICE_WIDTHS.map((w, i) => (
                  <div key={i} className={styles.priceRow}>
                    <div className={`skeleton ${styles.priceSkelLeft}`} style={{ width: w }} />
                    <div className={`skeleton ${styles.priceSkelRight}`} />
                  </div>
                ))}
                <div className={styles.divider} />
                <div className={styles.priceRow}>
                  <div className={`skeleton ${styles.totalLeft}`} />
                  <div className={`skeleton ${styles.totalRight}`} />
                </div>
              </div>
              {/* CTA */}
              <div className={`skeleton ${styles.cta}`} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
