import Image from 'next/image'
import Reveal from './Reveal'
import s from './story.module.css'

/**
 * Homepage · the illustrated Himalayan range.
 * Renders directly above <ExploreByRegion/> on the SAME background (#f4eed6)
 * with feathered edges, so the illustration reads as part of that section
 * rather than a separate card.
 */
export default function HimalayanRange() {
  return (
    <section className={`${s.root} ${s.range}`} aria-label="The Himalayan range and the regions we source from">
      <Reveal className={s.rangeIn}>
        <div className={s.rangeScroll}>
          <Image
            className={s.rangeImg}
            src="/story/himalayan-range.webp"
            alt="Illustrated map of the Himalayan range from Jammu & Kashmir in the west to Arunachal Pradesh in the east, with a peak marked for each region"
            width={1975} height={796} sizes="(max-width:900px) 900px, 1240px"
          />
          {/* invisible scroll-snap anchors, one per region, so a swipe always settles
             on a full pin/label instead of stopping mid-card. Percentages are an
             approximation of each region's position in the artwork — nudge them to
             match the real pin positions if they land off. */}
          {[5, 15, 27, 42, 58, 74, 90].map(pct => (
            <span key={pct} className={s.rangeSnap} style={{ left: `${pct}%` }} aria-hidden="true" />
          ))}
        </div>
        <p className={s.rangeHint}>Swipe to follow the range →</p>
      </Reveal>
    </section>
  )
}
