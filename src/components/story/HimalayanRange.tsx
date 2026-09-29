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
          {/* the track is the full-width image box, so the snap anchors below are
             positioned as a percentage of the IMAGE (not of the small phone screen) */}
          <div className={s.rangeTrack}>
            <Image
              className={s.rangeImg}
              src="/story/himalayan-range.webp"
              alt="Illustrated map of the Himalayan range from Jammu & Kashmir in the west to Arunachal Pradesh in the east, with a peak marked for each region"
              width={1975} height={796} sizes="(max-width:900px) 1400px, 1240px"
            />
            {/* invisible scroll snap anchors, placed just left of the real pins:
               J&K, Ladakh, Himachal pair, Uttarakhand, Sikkim + Assam, Arunachal */}
            {[0, 16.5, 27.5, 47, 66, 73].map(pct => (
              <span key={pct} className={s.rangeSnap} style={{ left: `${pct}%` }} aria-hidden="true" />
            ))}
          </div>
        </div>
        <p className={s.rangeHint}>Swipe to follow the range →</p>
      </Reveal>
    </section>
  )
}
