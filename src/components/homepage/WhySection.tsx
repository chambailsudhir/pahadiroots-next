// "Our Promise" — replaces the old "Why HimVeda by Pahadi Roots" SVG pillars.
//
// Design notes:
//  • Illustrations are separate transparent WebP files (public/promise/*.webp);
//    ALL text lives in HTML so it is readable on mobile, indexable for SEO and
//    available to screen readers (the source artwork had text baked into it).
//  • Copy deliberately makes only claims we can always stand behind
//    ("where testing, sourcing or product information is available, we share
//    it"). Do NOT reintroduce hard claims like "every batch lab tested" or
//    farmer/state counts here unless they are true for every product.
//  • `settings` is still accepted (page.tsx passes it) but is no longer used —
//    the promise section no longer prints farmer/state statistics.
import Image from 'next/image'
import type { SiteSettings } from '@/types'

interface Props { settings?: SiteSettings }

const PROMISES = [
  {
    num: '01',
    label: 'Origin',
    title: ['Know Where', 'It Comes From'],
    body: 'Every product has a place behind it. We tell you the Himalayan region where the ingredient begins and what makes that place unique.',
    img: '/promise/origin.webp',
    w: 433, h: 321,
    alt: 'Illustration of a Himalayan valley village with a mountain stream',
  },
  {
    num: '02',
    label: 'Tradition',
    title: ['Made the', 'Pahadi Way'],
    body: 'We value traditional ways of preparing and handling food, while keeping the natural character of the ingredient at the centre.',
    img: '/promise/tradition.webp',
    w: 431, h: 315,
    alt: 'Illustration of ghee being churned by hand in a wooden vessel',
  },
  {
    num: '03',
    label: 'Transparency',
    title: ['See What', 'We Can Show'],
    body: 'Where testing, sourcing or product information is available, we share it clearly so you can make an informed choice.',
    img: '/promise/transparency.webp',
    w: 435, h: 294,
    alt: 'Illustration of a honey jar beside a microscope and lab glassware',
  },
  {
    num: '04',
    label: 'People',
    title: ['Meet the Story', 'Behind It'],
    body: 'Behind every ingredient are growers, makers and mountain communities. We want their work and their places to be part of the story.',
    img: '/promise/people.webp',
    w: 432, h: 303,
    alt: 'Illustration of a beekeeper holding a honeycomb frame',
  },
] as const

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export default function WhySection(_props: Props) {
  return (
    <section className="promise-bg" aria-labelledby="promise-heading">
      <div className="ct">
        <div className="chip">Our Promise</div>
        <h2 id="promise-heading" className="sh2 promise-h2">From the Himalayas. With Nothing to Hide.</h2>
        <p className="ssub promise-sub">What we believe should be clear about every product we bring to your table.</p>
      </div>

      <ol className="promise-grid">
        {PROMISES.map(p => (
          <li key={p.num} className="promise-card">
            <div className="promise-art">
              <Image
                src={p.img}
                alt={p.alt}
                width={p.w}
                height={p.h}
                sizes="(max-width: 600px) 80vw, (max-width: 960px) 45vw, 25vw"
              />
            </div>
            <div className="promise-num" aria-hidden="true"><span>{p.num}</span><i /></div>
            <div className="promise-label">{p.label}</div>
            <h3 className="promise-title">
              {p.title[0]}<br />{p.title[1]}
            </h3>
            <p className="promise-body">{p.body}</p>
          </li>
        ))}
      </ol>
    </section>
  )
}
