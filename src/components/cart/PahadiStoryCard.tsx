'use client'

/**
 * PahadiStoryCard — brand story, certifications, and sourcing journey.
 *
 * Accessibility fixes applied (this round):
 *
 *   A1. Card headline was a plain <div>, not a semantic heading (WCAG 1.3.1).
 *       Screen reader users navigating by headings (a primary AT pattern) would
 *       skip this card entirely — it had no heading in the document outline.
 *       Fix: changed to <h3> to fit the page hierarchy (page h1 → section h2s
 *       → card-level h3). Visual appearance unchanged — styles remain the same.
 *
 *   A2. Decorative emoji icons in CERTS and STEPS announced by screen readers.
 *       Each cert/step has an icon emoji followed immediately by a text label
 *       (e.g. ✅ "100% Natural", 🌱 "Grown"). The emoji names add noise without
 *       adding meaning. aria-hidden="true" added to all cert and step icon spans.
 *
 *   A3. Sourcing journey arrows (→) were read aloud as "right-pointing arrow"
 *       or "greater-than sign" by some screen readers. They are purely
 *       decorative separators between steps.
 *       Fix: aria-hidden="true" on the stepArrow element.
 *
 *   A4. Decorative 🌿 leaf icon in the card header announced by screen readers.
 *       The headline text immediately follows and carries all meaning.
 *       Fix: aria-hidden="true" on the leaf span.
 *
 *   A5. "Our Sourcing Journey" section title was a plain <div>.
 *       Changed to <h4> for correct heading hierarchy under the h3 headline (A1).
 */

import { memo } from 'react'
import styles from './PahadiStoryCard.module.css'

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
        {/* A4: aria-hidden — decorative leaf; headline text carries the meaning */}
        <span className={styles.leaf} aria-hidden="true">🌿</span>
        {/* A1: semantic <h3> for correct document outline and SR heading navigation */}
        <h3 className={styles.headline}>{headline}</h3>
      </div>

      <p className={styles.body}>{body}</p>

      {/* Certifications */}
      <div className={styles.certs}>
        {CERTS.map(c => (
          <div key={c.label} className={styles.cert}>
            {/* A2: aria-hidden — icon emoji is decorative; label text follows */}
            <span className={styles.certIcon} aria-hidden="true">{c.icon}</span>
            <div>
              <div className={styles.certLabel}>{c.label}</div>
              <div className={styles.certSub}>{c.sub}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Sourcing journey */}
      <div className={styles.journey}>
        {/* A5: semantic <h4> for correct heading hierarchy under the h3 above */}
        <h4 className={styles.journeyTitle}>Our Sourcing Journey</h4>
        <div className={styles.steps}>
          {STEPS.map((s, i) => (
            <div key={s.step} className={styles.stepWrap}>
              <div className={styles.step}>
                {/* A2: aria-hidden — icon emoji is decorative; step label follows */}
                <div className={styles.stepIcon} aria-hidden="true">{s.icon}</div>
                <div className={styles.stepLabel}>{s.step}</div>
                <div className={styles.stepDesc}>{s.desc}</div>
              </div>
              {/* A3: aria-hidden — arrow is a decorative separator between steps */}
              {i < 4 && <div className={styles.stepArrow} aria-hidden="true">→</div>}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
})

export default PahadiStoryCard
