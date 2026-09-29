import Image from 'next/image'
import Link from 'next/link'
import Reveal from './Reveal'
import s from './story.module.css'

const DAY = [
  { src: 'day-morning', tag: 'Morning', t: 'Before the light reaches the valley', d: 'Days begin with the animals. Cows are milked by hand, close to where they graze, while the mountains are still cold.', alt: 'A woman milking a cow beside a stone house in the mountains' },
  { src: 'day-hands',   tag: 'Hands',   t: 'Patience, turned by hand',            d: 'Curd is churned slowly until the butter comes. There is no shortcut, and we have not tried to hurry the method.', alt: 'A woman churning curd in a traditional mountain kitchen' },
  { src: 'day-fire',    tag: 'Fire',    t: 'A fire that sets the pace',           d: 'Butter simmers over a wood fire, and the kitchen fills with the smell of ghee. The fire decides when it is ready.', alt: 'Butter simmering into ghee over a wood fire' },
  { src: 'day-bloom',   tag: 'Bloom',   t: 'A short summer, all at once',         d: 'When the snow pulls back, the meadows flower in a rush. The bees have only a few months to work them.', alt: 'Wildflowers blooming on a Himalayan slope with peaks behind' },
  { src: 'day-bees',    tag: 'Bees',    t: 'Following the flowers',               d: 'Colonies work across the valley with the bloom. What they gather is the taste of that place and that season.', alt: 'Honeybees at wooden hives among mountain flowers' },
  { src: 'day-harvest', tag: 'Harvest', t: 'Picked by hand, berry by berry',      d: 'Sea buckthorn is thorny and its berries are small. Harvest is slow work, done by hand in a short season.', alt: 'A woman picking sea buckthorn berries by hand' },
]

/** About page · "A day in the hills, told slowly". Rendered after the founder story. */
export default function MountainStories() {
  return (
    <section id="mountain-stories" className={`${s.root} ${s.sl}`} aria-labelledby="mtn-stories-h">
      <div className={s.slIn}>
        <Reveal className={s.lmHead}>
          <p className={s.eyebrow}>Stories from the mountains</p>
          <h2 className={s.h2} id="mtn-stories-h">A day in the hills, told slowly.</h2>
          <p className={s.lead} style={{ marginTop: 14 }}>Nothing here is staged for a camera. This is the rhythm of the people, animals and seasons behind every jar.</p>
        </Reveal>
        <div className={s.slGrid}>
          {DAY.map((c, i) => (
            <Reveal as="article" key={c.src} className={s.slC} delay={0.08 * (i % 3)}>
              <div className={s.slImg}><Image src={`/story/${c.src}.webp`} alt={c.alt} fill sizes="(max-width:900px) 100vw, 400px" /></div>
              <p className={s.slN}><b>0{i + 1}</b>{c.tag}</p>
              <h3>{c.t}</h3>
              <p className={s.slTxt}>{c.d}</p>
            </Reveal>
          ))}
        </div>
        <Reveal className={s.slQ}>
          <p>In the mountains, food still keeps the pace of the season.</p>
          <Link href="/#regions" className={s.cta}>See where each one begins <span aria-hidden="true">→</span></Link>
        </Reveal>
      </div>
    </section>
  )
}
