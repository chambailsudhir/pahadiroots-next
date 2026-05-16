'use client'
import styles from '../styles/account.module.css'

export default function OrdersSkeleton() {
  return (
    <div className={styles.skWrap}>
      {[1, 2, 3].map(i => (
        <div key={i} className={styles.skCard}>
          <div className={styles.skStripe} />
          <div className={styles.skInner}>
            <div className={styles.skRow}>
              <div className={styles.skBlock} style={{ width: '140px', height: '16px' }} />
              <div className={styles.skBlock} style={{ width: '80px', height: '24px', borderRadius: '8px' }} />
            </div>
            <div className={styles.skRow} style={{ marginTop: '16px', gap: '8px', justifyContent: 'flex-start' }}>
              {[1, 2].map(j => <div key={j} className={styles.skImg} />)}
            </div>
            <div className={styles.skBlock} style={{ width: '60%', height: '14px', marginTop: '12px' }} />
            <div className={styles.skRow} style={{ marginTop: '16px', gap: '8px', justifyContent: 'flex-start' }}>
              {[1, 2, 3].map(j => (
                <div key={j} className={styles.skBlock} style={{ width: '90px', height: '32px', borderRadius: '9px' }} />
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
