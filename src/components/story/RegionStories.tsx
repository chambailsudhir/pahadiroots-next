'use client'

import { useState, type KeyboardEvent } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import Reveal from './Reveal'
import s from './story.module.css'

interface Panel {
  id: string; tab: string; soon?: boolean
  title: string; tag: string; paras: string[]
  facts?: [string, string][]; made?: [string, string][]
  img?: { src: string; alt: string }; href?: string; cta?: string
}

const PANELS: Panel[] = [
  {
    id: 'hp', tab: 'Himachal Pradesh', title: 'Himachal Pradesh', tag: 'Home region · three valleys, three altitudes',
    paras: [
      'Himachal is where we are based and where most of what we sell begins. Within one state you get the lower tea slopes of Kangra, the alpine meadows above Manali, and the high, dry valleys of Spiti.',
      'What grows in each is different, so we keep the valleys apart instead of blending them into one story.',
    ],
    facts: [['Valleys', 'Kangra · Manali · Spiti'], ['Altitude', '~1,200 m to ~3,800 m'], ['Season', 'Honey follows the summer blooms']],
    made: [['Himachali Pahari Cow Ghee', 'Bilona method'], ['Wild Manali Honey', 'Manali'], ['Spiti Valley Multiflora Honey', 'Spiti'], ['Kangra Tea & Kangra Honey', 'Kangra'], ['Shilajit', 'High altitude']],
    img: { src: '/story/honey-meadow.webp', alt: 'Alpine meadow above Manali, Himachal Pradesh' },
    href: '/regions/hp', cta: 'Explore Himachal',
  },
  {
    id: 'la', tab: 'Ladakh', title: 'Ladakh', tag: 'Cold desert · wild berries by the river',
    paras: [
      'In Ladakh’s high, dry valleys, sea buckthorn grows wild along the rivers. It is a hardy shrub with small, bright orange, sharply tart berries.',
      'The berries are picked by hand when they ripen in autumn, and the taste shifts a little with each season.',
    ],
    facts: [['Reference altitude', '~3,500 m (Leh)'], ['Season', 'Berries ripen in autumn'], ['Character', 'Bright, tart, seasonal']],
    made: [['Sea buckthorn', 'Wild, hand-picked']],
    img: { src: '/story/sbt-valley.webp', alt: 'Sea buckthorn shrubs above a glacial river valley, Ladakh' },
    href: '/regions/la', cta: 'Explore Ladakh',
  },
  {
    id: 'uk', tab: 'Uttarakhand', title: 'Uttarakhand', tag: 'Forest and foothills',
    paras: ['In spring the hill forests of Uttarakhand turn red with buransh, the rhododendron flower. In the villages below, hill farmers grow rajma and press mustard oil.'],
    facts: [['Forest range', '~1,500–3,500 m'], ['Season', 'Buransh flowers in spring'], ['Character', 'Hill-grown, cold pressed']],
    made: [['Buransh juice', 'Rhododendron flower'], ['Pahadi rajma', 'Hill-grown'], ['Cold pressed mustard oil', 'Cold pressed']],
    // TODO(content): swap for an Uttarakhand-specific photo (buransh forest / hill village) when available.
    img: { src: '/story/life-forest.webp', alt: 'Pine forest on a Himalayan hillside' },
    href: '/regions/uk', cta: 'Explore Uttarakhand',
  },
  {
    id: 'more', tab: 'More regions', soon: true, title: 'More Himalayan regions are coming soon.', tag: 'Growing one region at a time',
    paras: ['We are adding regions slowly, and only when we can describe them honestly. When a new region is ready, it will appear here with its own story and products.'],
  },
]

/** Homepage · "Shop by region": range illustration + tabbed region stories. */
function listNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

export default function RegionStories({ regionNames = [] }: { regionNames?: string[] }) {
  // The intro line used to hard-code "Himachal Pradesh, Ladakh and Uttarakhand",
  // which contradicted the live "Himalayan States" figure whenever the admin
  // activated or deactivated a state. It now lists whatever states are active.
  const names = regionNames.filter(Boolean)
  const sourcing = names.length === 0
    ? 'Himachal Pradesh, Ladakh and Uttarakhand'
    : names.length > 6
      ? `${names.length} Himalayan regions, including ${listNames(names.slice(0, 3))}`
      : listNames(names)
  const [active, setActive] = useState(PANELS[0].id)

  const onKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
    e.preventDefault()
    const next = PANELS[(i + (e.key === 'ArrowRight' ? 1 : PANELS.length - 1)) % PANELS.length].id
    setActive(next)
    document.getElementById(`rs-tab-${next}`)?.focus()
  }

  return (
    <section id="shop-by-region" className={`${s.root} ${s.rx}`} aria-labelledby="rs-h">
      <div className={s.rxIn}>
        <Reveal as="figure" className={s.rangeFig}>
          <div className={s.rangeScroll}>
            {/* the track is the full-width image box (min-width 1400px on mobile),
               so the snap anchors are positioned as a % of the IMAGE, not the phone screen */}
            <div className={s.rangeTrack}>
              <Image
                className={s.rangeImg}
                src="/story/himalayan-range.webp"
                alt="Illustrated map of the Himalayan range from Jammu & Kashmir in the west to Arunachal Pradesh in the east, with a peak marked for each region"
                width={1975} height={796} sizes="(max-width:900px) 1400px, 1240px"
              />
              {/* invisible scroll snap anchors, just left of the real pins:
                 J&K, Ladakh, Himachal pair, Uttarakhand, Sikkim + Assam, Arunachal */}
              {[0, 16.5, 27.5, 47, 66, 73].map(pct => (
                <span key={pct} className={s.rangeSnap} style={{ left: `${pct}%` }} aria-hidden="true" />
              ))}
            </div>
          </div>
          <p className={s.rangeHint}>Swipe to follow the range →</p>
        </Reveal>

        <Reveal className={s.rxHead}>
          <div>
            <p className={s.eyebrow}>Shop by region</p>
            <h2 className={s.h2} id="rs-h">The same range. Very different valleys.</h2>
          </div>
          <p className={s.lead}>Altitude, soil and seasons change what grows in each valley. Today we source from {sourcing}, and we add more regions one at a time, only when we can describe them honestly.</p>
        </Reveal>

        <div className={s.tabs} role="tablist" aria-label="Regions">
          {PANELS.map((p, i) => (
            <button key={p.id} id={`rs-tab-${p.id}`} role="tab" type="button" className={s.tab}
              aria-selected={active === p.id} aria-controls={`rs-panel-${p.id}`} tabIndex={active === p.id ? 0 : -1}
              onClick={() => setActive(p.id)} onKeyDown={e => onKey(e, i)}>
              {p.tab}{p.soon && <small>Soon</small>}
            </button>
          ))}
        </div>

        {PANELS.map(p => (
          <div key={p.id} id={`rs-panel-${p.id}`} role="tabpanel" aria-labelledby={`rs-tab-${p.id}`} tabIndex={0}
            hidden={active !== p.id} className={`${s.pn} ${p.soon ? s.pnSoon : ''}`}>
            {p.img && (
              <figure className={s.pnImg}>
                <div className={s.pnBox}><Image src={p.img.src} alt={p.img.alt} fill sizes="(max-width:900px) 100vw, 560px" /></div>
                <figcaption>{p.img.alt}</figcaption>
              </figure>
            )}
            <div>
              <h3>{p.title}</h3>
              <p className={s.pnTag}>{p.tag}</p>
              {p.paras.map(t => <p key={t} className={s.pnT}>{t}</p>)}
              {p.facts && <dl className={s.pnDl}>{p.facts.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>}
              {p.made && (
                <>
                  <h4>Made here</h4>
                  <ul>{p.made.map(([n, m]) => <li key={n}><Link href={p.href!}><span>{n}</span><small>{m}</small></Link></li>)}</ul>
                </>
              )}
              {p.href && <Link href={p.href} className={s.cta}>{p.cta} <span aria-hidden="true">→</span></Link>}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
