import Image from 'next/image'
import Link from 'next/link'
import Reveal from './Reveal'
import s from './story.module.css'

interface Chapter {
  place: string; title: string; paras: string[]
  facts: [string, string][]; cta: string; href: string
  main: { src: string; alt: string }; inset: { src: string; alt: string; cap: string }
  flip?: boolean
}

const CHAPTERS: Chapter[] = [
  {
    place: 'Manali & Spiti Valley · Himachal Pradesh',
    title: 'Honey that follows the flowers of one valley.',
    paras: [
      'Above Manali, alpine meadows come into bloom for a short summer. In Spiti, the flowers grow across high, dry valleys. Bees work both, and what they gather depends on where they are.',
      'We bring the honey raw and unfiltered, and we keep each valley’s honey separate, so you know which mountain you are tasting.',
    ],
    facts: [['Place', 'Manali and Spiti Valley'], ['Source', 'Mountain multiflora blooms'], ['Made', 'Raw and unfiltered']],
    cta: 'Meet the two honeys', href: '/collections/himalayan-honey',
    main:  { src: '/story/honey-meadow.webp',     alt: 'A wide alpine meadow of white wildflowers below snow-capped mountains' },
    inset: { src: '/story/honey-beekeeper.webp', alt: 'A beekeeper holding up a honeycomb frame dripping with honey', cap: 'The beekeeper' },
  },
  {
    flip: true,
    place: 'Himachal Pradesh',
    title: 'Ghee that begins with a cow on a hillside.',
    paras: [
      'In the highland homes of Himachal, Pahari cows graze the forests and mountain meadows. Their milk is set into curd, and the curd is churned by hand in the Bilona way.',
      'The butter is then simmered slowly into ghee. It is a slow method, and we keep it that way.',
    ],
    facts: [['Place', 'Himachal Pradesh'], ['Milk', 'Local Himachali Pahari cows'], ['Method', 'Bilona: curd first, churned by hand']],
    cta: 'See the ghee', href: '/collections/himalayan-ghee',
    main:  { src: '/story/ghee-pasture.webp', alt: 'Himachali Pahari cows grazing in a Himalayan mountain pasture' },
    inset: { src: '/story/ghee-churn.webp',   alt: 'Traditional Bilona method — curd being churned by hand in a wooden pot', cap: 'The Bilona churn' },
  },
  {
    place: 'Ladakh',
    title: 'A berry that grows where little else does.',
    paras: [
      'In the cold, high valleys of Ladakh, sea buckthorn grows wild in harsh mountain conditions. The berries are small, bright orange and sharply tart.',
      'They are picked by hand, and their taste changes a little with each season and harvest. We would rather tell you that than hide it.',
    ],
    facts: [['Place', 'Ladakh'], ['Character', 'Bright, tart, seasonal'], ['Harvest', 'Picked by hand']],
    cta: 'Discover sea buckthorn', href: '/collections/mountain-juices',
    main:  { src: '/story/sbt-valley.webp',   alt: 'Wild sea buckthorn berries on the branch above a glacial river valley' },
    inset: { src: '/story/sbt-harvest.webp',  alt: 'Women harvesters hand-picking sea buckthorn berries into woven baskets', cap: 'The harvest' },
  },
]

/** Homepage · three product origin stories (honey, ghee, sea buckthorn). */
export default function WhereTheyBegin() {
  return (
    <section className={`${s.root} ${s.tr}`} aria-labelledby="where-begin-h">
      <div className={s.trHead}>
        <Reveal>
          <p className={s.eyebrow}>Where they begin</p>
          <h2 className={s.h2} id="where-begin-h">Every product starts somewhere specific.</h2>
        </Reveal>
        <Reveal delay={0.15}>
          <p className={s.lead}>A honey is shaped by the flowers of its valley. A ghee by the animals and the hands that make it. A berry by the cold and the altitude it survives. Here is where each one begins.</p>
        </Reveal>
      </div>

      {CHAPTERS.map(c => (
        <article key={c.title} className={`${s.ch} ${c.flip ? s.chFlip : ''}`}>
          <Reveal className={s.chVis}>
            <div className={s.chMain}>
              <Image src={c.main.src} alt={c.main.alt} fill sizes="(max-width:900px) 100vw, 600px" />
            </div>
            <figure className={s.chIn} style={{ margin: 0 }}>
              <Image src={c.inset.src} alt={c.inset.alt} fill sizes="(max-width:900px) 40vw, 240px" />
              <figcaption className={s.chInCap}>{c.inset.cap}</figcaption>
            </figure>
          </Reveal>
          <Reveal delay={0.15}>
            <p className={s.chPlace}>{c.place}</p>
            <h3>{c.title}</h3>
            {c.paras.map(p => <p key={p} className={s.chTxt}>{p}</p>)}
            <dl className={s.facts}>
              {c.facts.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
            </dl>
            <Link href={c.href} className={s.cta}>{c.cta} <span aria-hidden="true">→</span></Link>
          </Reveal>
        </article>
      ))}
    </section>
  )
}
