import Image from 'next/image'
import Link from 'next/link'
import Reveal from './Reveal'
import s from './story.module.css'

/** Homepage · life in the mountains photo strip, links to the Our Stories page. */
export default function LifeInMountains() {
  return (
    <section className={`${s.root} ${s.lm}`} aria-labelledby="life-h">
      <div className={s.lmIn}>
        <Reveal className={s.lmHead}>
          <div>
            <p className={s.eyebrow}>Life in the mountains</p>
            <h2 className={s.h2} id="life-h">Some traditions are still lived, not remembered.</h2>
          </div>
          <div className={s.lmSide}>
            <p className={s.lead}>Behind every jar is a fire-lit kitchen, a pasture, a forest and someone who knows them well.</p>
            <p style={{ margin: '18px 0 0' }}><Link href="/our-stories#mountain-stories" className={s.cta}>Read the mountain stories <span aria-hidden="true">→</span></Link></p>
          </div>
        </Reveal>
        <div className={s.lmGrid}>
          <Reveal as="figure" className={`${s.fig} ${s.figA}`}>
            <Image src="/story/life-kitchen.webp" alt="A producer stirring a large pan over a wood fire in a traditional mountain kitchen" fill sizes="(max-width:900px) 100vw, 700px" />
            <figcaption className={s.figCap}>Fire-lit kitchens</figcaption>
          </Reveal>
          <Reveal as="figure" className={s.fig} delay={0.15}>
            <Image src="/story/life-pasture.webp" alt="Sheep and goats resting in a forest pasture" fill sizes="(max-width:900px) 100vw, 500px" />
            <figcaption className={s.figCap}>High pastures</figcaption>
          </Reveal>
          <Reveal as="figure" className={s.fig} delay={0.3}>
            <Image src="/story/life-forest.webp" alt="Pine forest on a Himalayan mountainside" fill sizes="(max-width:900px) 100vw, 500px" />
            <figcaption className={s.figCap}>Forests that shape the seasons</figcaption>
          </Reveal>
        </div>
      </div>
    </section>
  )
}
