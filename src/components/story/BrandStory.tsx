import Image from 'next/image'
import Link from 'next/link'
import Reveal from './Reveal'
import s from './story.module.css'

const POINTS = [
  { n: '01', l: 'Place',     t: 'The Himalayas',        d: 'High-altitude valleys, forests and mountain communities shape the character of what we source.' },
  { n: '02', l: 'People',    t: 'The People Behind It', d: 'We work to bring the knowledge, care and traditions of Himalayan communities closer to you.' },
  { n: '03', l: 'Tradition', t: 'Made With Tradition',  d: 'From harvesting to preparation, we value traditional practices and the natural character of each ingredient.' },
]

/** Homepage · short brand story. Sits directly under the trust bar. */
export default function BrandStory() {
  return (
    <section className={`${s.root} ${s.bs}`} aria-labelledby="brand-story-h">
      <div className={s.bsIn}>
        <Reveal as="figure" className={s.bsFig}>
          <div className={s.bsImg}>
            <Image src="/story/origin-himalaya.webp" alt="Snow-capped Himalayan peaks above forested valleys, the origin of HimVeda by Pahadi Roots"
              fill sizes="(max-width:900px) 100vw, 560px" />
          </div>
          <figcaption className={s.bsCap}>The Himalayas · India</figcaption>
        </Reveal>
        <div>
          <Reveal as="p" className={s.eyebrow}>Rooted in the Himalayas</Reveal>
          <Reveal as="h2" delay={0.1}><span id="brand-story-h">From the mountains, naturally.</span></Reveal>
          <Reveal delay={0.2}>
            <p className={s.bsLead}>The Himalayas are more than where we come from — they are where our story begins.</p>
            <p className={s.bsBody}>Across high mountain valleys, forests and villages, generations have worked with nature, harvesting ingredients shaped by altitude, seasons and tradition.</p>
            <p className={s.bsBody}>HimVeda by Pahadi Roots brings these authentic Himalayan ingredients closer to you — working with local communities and preserving the traditional character of what they make and grow.</p>
          </Reveal>
          <ol className={s.pts}>
            {POINTS.map((p, i) => (
              <Reveal as="li" key={p.n} className={s.pt} delay={0.3 + i * 0.15}>
                <span className={s.ptLab}><em>{p.n}</em>{p.l}</span>
                <h3>{p.t}</h3>
                <p>{p.d}</p>
              </Reveal>
            ))}
          </ol>
          <Reveal delay={0.7}><Link href="/our-stories" className={s.cta}>Discover Our Story <span aria-hidden="true">→</span></Link></Reveal>
        </div>
      </div>
    </section>
  )
}
