'use client'

import { memo } from 'react'
import styles from './PahadiStoryCard.module.css'

// Issue 11 — Product storytelling: farmer story, sourcing journey, certifications
// These values can later be driven from site_settings keys like:
//   story_headline, story_body, certifications_list
// For now uses the brand story — swap strings via admin settings when ready.

// Static arrays outside component — not recreated on every render
const CERTS = [
  { icon:'✅', label:'100% Natural',      sub:'No pesticides'       },
  { icon:'🏔', label:'Himalayan Source',  sub:'High altitude farms' },
  { icon:'🤝', label:'Farmer Direct',     sub:'No middlemen'        },
  { icon:'🧪', label:'No Chemicals',      sub:'Traditional methods' },
  { icon:'📦', label:'Small Batch',       sub:'Limited, fresh stock'},
  { icon:'💚', label:'Eco Packaged',      sub:'Minimal plastic'     },
] as const

const STEPS = [
  { icon:'🌱', step:'Grown',     desc:'High altitude farms'  },
  { icon:'🧺', step:'Harvested', desc:'Traditional methods'  },
  { icon:'🔍', step:'Inspected', desc:'Quality checked'      },
  { icon:'📦', step:'Packed',    desc:'Small batch'          },
  { icon:'🚚', step:'Delivered', desc:'To your door'         },
] as const

interface Props {
  headline?: string
  body?: string
}

const PahadiStoryCard = memo(function PahadiStoryCard({
  headline = 'From Himalayan Farms to Your Doorstep',
  body = 'Every product you order supports small-batch Pahadi farmers practicing traditional, chemical-free agriculture. We source directly — no middlemen, fair prices, and the freshest possible produce.',
}: Props) {
  return (
    <div className={styles.card}>
      <div className={styles.header}>
        <span className={styles.leaf}>🌿</span>
        <div className={styles.headline}>{headline}</div>
      </div>

      <p className={styles.body}>{body}</p>

      {/* Certifications */}
      <div className={styles.certs}>
        {CERTS.map(c => (
          <div key={c.label} className={styles.cert}>
            <span className={styles.certIcon}>{c.icon}</span>
            <div>
              <div className={styles.certLabel}>{c.label}</div>
              <div className={styles.certSub}>{c.sub}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Sourcing journey */}
      <div className={styles.journey}>
        <div className={styles.journeyTitle}>Our Sourcing Journey</div>
        <div className={styles.steps}>
          {STEPS.map((s, i) => (
            <div key={s.step} className={styles.stepWrap}>
              <div className={styles.step}>
                <div className={styles.stepIcon}>{s.icon}</div>
                <div className={styles.stepLabel}>{s.step}</div>
                <div className={styles.stepDesc}>{s.desc}</div>
              </div>
              {i < 4 && <div className={styles.stepArrow}>→</div>}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
})

export default PahadiStoryCard
