import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getSiteSettings, isEnabled } from '@/lib/getSiteSettings'
import Reveal from '@/components/story/Reveal'
import StoryVideo from '@/components/story/StoryVideo'
import { MountainMark } from '@/components/brand/BrandMotifs'
import s from '@/components/story/mountainPage.module.css'

const TITLE = 'Mountain Stories — HimVeda by Pahadi Roots'
const DESC  = 'The dham feast, the Gaddi shepherds and the forests above the villages: three living Himalayan traditions behind HimVeda by Pahadi Roots.'

export const metadata: Metadata = {
  title:       TITLE,
  description: DESC,
  alternates:  { canonical: '/mountain-stories' },
  openGraph: {
    title:       TITLE,
    description: DESC,
    url:         'https://www.pahadiroots.com/mountain-stories',
    type:        'website',
    images:      [{ url: '/story/life-kitchen.webp', width: 900, height: 405, alt: 'A traditional Himalayan kitchen with a wood fire' }],
  },
}

export const revalidate = 3600

interface Story {
  id: string; num: string; img: string; alt: string; cap: string; kick: string; title: string
  video?: { src: string; poster: string }            // silent looping clip shown instead of the still `img`
  shot?: { img: string; alt: string; cap: string }   // optional wide photo shown in the text, after paras[1]
  flip?: boolean
  paras: string[]      // paras[0] gets the drop cap; `pull` is shown after paras[1]
  pull?: string
  facts: [string, string][]
  note: string
  pos?: string
}

// COPY NOTE: written in a plain, spoken voice on purpose. Cultural facts are general public
// knowledge (please have a Kangra local read them once). The "From us" notes are the brand tie-in:
// replace or extend them with the founder's own memories, which will always beat anything drafted.
const STORIES: Story[] = [
  {
    id: 'dham', num: 'I', img: '/story/dham-poster.webp', pos: '55% 50%',
    video: { src: '/story/dham.mp4', poster: '/story/dham-poster.webp' },
    shot: { img: '/story/dham-kitchen.webp', alt: 'A man crouching beside a large iron kadhai over a wood fire, steam rising, brass vessels around him', cap: 'The fire, the steam, the brass' },
    alt: 'Men cooking a dham in a large iron kadhai over a wood fire, steam rising, brass vessels around them',
    cap: 'Himachali Dham', kick: 'Himachali Dham',
    title: 'Nobody eats alone at a dham.',
    paras: [
      'Ask anyone from Himachal about the best meal they ever had, and there is a good chance they will describe a dham. Not a restaurant. Not a party hall. A courtyard or an open field, a fire, and the whole village sitting down together.',
      'The cooks are called botis, and they start long before the guests are awake. Rice and pulses go into big brass vessels over wood fire, and the smoke gets into everything: the food, the tents, your clothes. You carry the smell home with you.',
      'Then the guests sit in a long row on the ground, and leaf plates are laid out in front of them. Rice comes first, then the dals, then madra, a slow yoghurt gravy, then the sour khatta. Somebody comes along the row with another spoonful before your plate is empty. Somebody always does. Something sweet closes the meal.',
      'It looks simple, and it is not. Nobody times it. The food is ready when it is ready, and the fire decides.',
    ],
    pull: 'Everyone eats the same food, on the same ground, at the same time.',
    facts: [
      ['Cooked by', 'Botis, over wood fire'],
      ['Served', 'In rows, on leaf plates'],
      ['On the leaf', 'Rice, dals, madra, khatta, something sweet'],
      ['When', 'Weddings, festivals, big family days'],
    ],
    note: 'This is the kind of food we keep in mind when we make ours. Slow, shared, and never rushed.',
  },
  {
    id: 'gaddi', num: 'II', img: '/story/gaddi-shepherd.webp', pos: '50% 40%', flip: true,
    alt: 'A Gaddi shepherd holding two lambs on a mountain path, his flock of sheep and goats behind him',
    cap: 'Gaddi Community', kick: 'Gaddi Community',
    title: 'The road is part of the family.',
    paras: [
      'The Gaddis of Himachal have been walking with their flocks for longer than anyone can say. In summer they climb to the high meadows, where the snow has just left and the grass is soft. When the cold comes back, they walk down again: weeks on the road with sheep and goats, over passes, along rivers, through villages that know them by now.',
      'It is not an easy life. The weather does not ask permission. A family can be away from home for months, and the animals always come first.',
      'If you have ever seen a Gaddi shepherd carrying a tired lamb in his arms, or tucked into the fold of his woollen chola, you already understand the whole arrangement. Nobody is in a hurry. Everybody gets home.',
      'The meadows they graze are the same ones the bees visit when the flowers open. Good grass, good milk, good honey. It all begins with the same few weeks of mountain summer.',
    ],
    pull: 'A lamb that is too tired to walk gets carried.',
    facts: [
      ['Who', 'Shepherds of the Dhauladhar and Pir Panjal ranges'],
      ['The rhythm', 'Up to the meadows in summer, down to the valleys in winter'],
      ['With them', 'Sheep, goats and big dogs that guard the flock'],
      ['Wear', 'The woollen chola, tied at the waist with a dora'],
    ],
    note: 'We work with food that comes from these hills. It seemed only fair to tell you about the people who keep them going.',
  },
  {
    id: 'forests', num: 'III', img: '/story/mountain-village.webp', pos: '58% 50%',
    alt: 'A Himalayan village among pine forest and green meadows, snow peaks behind',
    cap: 'Forests that shape the seasons', kick: 'Forests that shape the seasons',
    title: 'The forest was here first.',
    paras: [
      'Above every village there is a forest, and every village knows it. It is where the firewood comes from, and the fodder, and the cold clean water that turns up at the tap on its own schedule.',
      'Deodar and pine hold the snow all winter and let it go slowly in spring. Early in the morning, before the sun clears the ridge, everything is very quiet. You can hear the stream long before you see it.',
      'The year in the hills follows what happens up there. The snow melts, the meadows flower, the bees go to work, and then the berries ripen and somebody has to go and pick them by hand.',
      'Some things on our shelves are only there for part of the year. That is the mountain keeping its own calendar, and we would rather wait for it than argue.',
    ],
    pull: 'Nobody writes that calendar down. Children pick it up by watching.',
    facts: [
      ['It gives', 'Water, firewood, fodder, shade'],
      ['It keeps time with', 'Snowmelt, flowering, harvest'],
    ],
    note: 'Nothing here can be hurried. Honey, berries and ghee all arrive when the season is ready for them.',
  },
]

export default async function MountainStoriesPage() {
  const settings = await getSiteSettings()
  // Same admin toggle that shows/hides "Life in the mountains" on the homepage. Off = 404, so a
  // hidden homepage section never leaves a live orphan page behind.
  if (!isEnabled(settings.show_life_in_mountains)) notFound()

  return (
    <div className={s.root}>
      <header className={s.hero}>
        <Reveal className={s.heroIn}>
          <p className={s.eyebrow}>Mountain stories</p>
          <h1 className={s.h1}>Some traditions are still <em>lived</em>, not remembered.</h1>
          <p className={s.sub}>
            Behind every jar there is a kitchen with a fire in it, a hillside with animals on it, and a forest
            that was there before any of us. Here are three of them, told the way we would tell you if you were sitting with us.
          </p>
          <ul className={s.jump} aria-label="Jump to a story">
            {STORIES.map(st => <li key={st.id}><a href={`#${st.id}`}>{st.cap}</a></li>)}
          </ul>
        </Reveal>
      </header>

      {STORIES.map(st => (
        <section key={st.id} id={st.id} className={s.story} aria-labelledby={`${st.id}-h`}>
          <div className={`${s.row} ${st.flip ? s.flip : ''}`}>
            <Reveal as="figure" className={s.vis}>
              <div className={s.main}>
                {st.video
                  ? <StoryVideo src={st.video.src} poster={st.video.poster} label={st.alt} style={{ objectPosition: st.pos }} />
                  : <Image src={st.img} alt={st.alt} fill sizes="(max-width:900px) 100vw, 600px" style={{ objectPosition: st.pos }} />}
                <figcaption className={s.cap}>{st.cap}</figcaption>
              </div>
              <span className={s.badge} aria-hidden="true">{st.num}</span>
            </Reveal>
            <div className={s.col}>
              <Reveal>
                <p className={s.kick}>{st.kick}</p>
                <h2 className={s.h2} id={`${st.id}-h`}>{st.title}</h2>
                <p className={`${s.p} ${s.drop}`}>{st.paras[0]}</p>
                <p className={s.p}>{st.paras[1]}</p>
              {st.shot && (
                <figure className={s.shot}>
                  <div className={s.shotFrame}>
                    <Image src={st.shot.img} alt={st.shot.alt} fill sizes="(max-width:900px) 100vw, 580px" style={{ objectPosition: '55% 50%' }} />
                  </div>
                  <figcaption>{st.shot.cap}</figcaption>
                </figure>
              )}
                {st.pull && <blockquote className={s.pull}><span>{st.pull}</span></blockquote>}
                {st.paras.slice(2).map((t, i) => <p key={i} className={s.p}>{t}</p>)}
                <dl className={s.facts}>
                  {st.facts.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
                </dl>
                <p className={s.note}><b><MountainMark /> From us</b>{st.note}</p>
              </Reveal>
            </div>
          </div>
        </section>
      ))}

      <section className={s.close}>
        <Reveal className={s.closeIn}>
          <p className={s.quote}>In the mountains, food still keeps the pace of the season.</p>
          <div className={s.ctas}>
            <Link href="/products" className={s.btn}>Shop the range <span aria-hidden="true">→</span></Link>
            <Link href="/our-stories" className={s.ghost}>Read our story <span aria-hidden="true">→</span></Link>
          </div>
        </Reveal>
      </section>
    </div>
  )
}
