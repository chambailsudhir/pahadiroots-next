// CategoryMotif — hand-drawn vector line-art per collection, in the same
// "vector botanical illustration" style already approved for the Sea
// Buckthorn / Honey label artwork (see product-label-design history).
//
// WHY THIS EXISTS: no AI image-generation tool is available in this
// environment, and the current categories.image_url assets are the flat
// brand logo mark (confirmed via live DB query), not lifestyle photography.
// Rather than ship an empty gradient while waiting on real photography,
// this renders a bespoke, on-brand, zero-dependency SVG line illustration
// per collection — crisp at any size, no hosting/upload step, swappable
// the moment real photography exists (see heroPhotoUrl in the page).
//
// Each motif is a single continuous line-art color (brand gold) at low
// opacity, so it reads as texture/craft rather than a literal photo
// substitute — the same restrained way the approved label art was used.

import React from 'react'

const GOLD = '#e8cf8a'

const STROKE_PROPS = {
  fill: 'none',
  stroke: GOLD,
  strokeWidth: 1.4,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

function NaturalOils() {
  return (
    <svg viewBox="0 0 420 420" fill="none">
      {/* bottle */}
      <path {...STROKE_PROPS} d="M195 60h30v28c22 10 34 30 34 56v170c0 14-11 26-26 26h-46c-15 0-26-12-26-26V144c0-26 12-46 34-56V60Z" />
      <path {...STROKE_PROPS} d="M188 60h44" />
      <path {...STROKE_PROPS} d="M167 220h86" />
      {/* pour arc + droplet */}
      <path {...STROKE_PROPS} d="M255 150c34 8 58 34 58 68" strokeDasharray="2 7" />
      <path {...STROKE_PROPS} d="M313 224c0 9-7 15-15 15s-15-6-15-15c0-9 15-26 15-26s15 17 15 26Z" />
      {/* olive sprig */}
      <path {...STROKE_PROPS} d="M70 300c30-18 58-14 74 6" />
      <ellipse {...STROKE_PROPS} cx="96" cy="292" rx="16" ry="9" transform="rotate(-24 96 292)" />
      <ellipse {...STROKE_PROPS} cx="126" cy="300" rx="16" ry="9" transform="rotate(-8 126 300)" />
      <ellipse {...STROKE_PROPS} cx="150" cy="312" rx="14" ry="15" />
    </svg>
  )
}

function HimalayanHoney() {
  const hex = (cx: number, cy: number, r: number) => {
    const pts = Array.from({ length: 6 }, (_, i) => {
      const a = (Math.PI / 180) * (60 * i - 30)
      return `${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`
    }).join(' ')
    return <polygon key={`${cx}-${cy}`} {...STROKE_PROPS} points={pts} />
  }
  const centers: [number, number][] = [
    [120, 120], [176, 120], [148, 168], [204, 168], [120, 216], [176, 216], [232, 216],
  ]
  return (
    <svg viewBox="0 0 420 420" fill="none">
      {centers.map(([cx, cy]) => hex(cx, cy, 32))}
      {/* dipper */}
      <path {...STROKE_PROPS} d="M300 90l40 250" />
      <path {...STROKE_PROPS} d="M300 90c10-14 30-14 30 4 0 16-24 22-30 20" />
      <path {...STROKE_PROPS} d="M336 250c8 10 8 22 4 32" strokeDasharray="2 6" />
      <path {...STROKE_PROPS} d="M336 250c-4-3-14-2-16 6-2 9 8 15 16 12" />
    </svg>
  )
}

function HimalayanTea() {
  return (
    <svg viewBox="0 0 420 420" fill="none">
      <path {...STROKE_PROPS} d="M210 340V120" />
      <path {...STROKE_PROPS} d="M210 150c-40-10-64-46-58-88 42 4 70 34 74 72" />
      <path {...STROKE_PROPS} d="M210 210c46-6 76-42 76-88-46 0-80 34-88 76" />
      <path {...STROKE_PROPS} d="M210 270c-38 4-70-24-78-62 40-6 74 16 88 50" />
      <path {...STROKE_PROPS} d="M182 62c-4 20 0 40 12 56" strokeDasharray="2 6" />
      <path {...STROKE_PROPS} d="M282 132c-16 12-34 18-52 20" strokeDasharray="2 6" />
      <path {...STROKE_PROPS} d="M136 218c14 16 32 26 52 30" strokeDasharray="2 6" />
    </svg>
  )
}

function HeritageRice() {
  const grain = (x: number, y: number, r: number) => (
    <ellipse key={`${x}-${y}`} {...STROKE_PROPS} cx={x} cy={y} rx="9" ry="15" transform={`rotate(${r} ${x} ${y})`} />
  )
  const stalk = Array.from({ length: 7 }, (_, i) => {
    const y = 80 + i * 26
    const off = i % 2 === 0 ? -22 : 22
    return grain(210 + off, y, i % 2 === 0 ? -30 : 30)
  })
  return (
    <svg viewBox="0 0 420 420" fill="none">
      <path {...STROKE_PROPS} d="M210 340c0-90 0-180 0-260" />
      {stalk}
    </svg>
  )
}

function HerbsAndSpices() {
  return (
    <svg viewBox="0 0 420 420" fill="none">
      <path {...STROKE_PROPS} d="M210 320V110" />
      <path {...STROKE_PROPS} d="M180 300h60" />
      {[0, 1, 2, 3, 4].map(i => {
        const y = 260 - i * 34
        const w = 60 - i * 6
        return (
          <g key={i}>
            <path {...STROKE_PROPS} d={`M210 ${y} q${-w} ${-16} ${-w * 0.6} ${-40}`} />
            <path {...STROKE_PROPS} d={`M210 ${y} q${w} ${-16} ${w * 0.6} ${-40}`} />
          </g>
        )
      })}
    </svg>
  )
}

function JamsAndPreserves() {
  return (
    <svg viewBox="0 0 420 420" fill="none">
      <path {...STROKE_PROPS} d="M150 140h120v160c0 18-14 32-32 32h-56c-18 0-32-14-32-32V140Z" />
      <path {...STROKE_PROPS} d="M144 140h132" />
      <path {...STROKE_PROPS} d="M168 116c0-14 10-24 42-24s42 10 42 24" />
      {[0, 1, 2].map(i => (
        <circle key={i} {...STROKE_PROPS} cx={188 + i * 22} cy={70 - (i % 2) * 14} r="12" />
      ))}
      <path {...STROKE_PROPS} d="M186 82c6-16 20-24 30-24" strokeDasharray="2 6" />
    </svg>
  )
}

function PulsesAndDal() {
  return (
    <svg viewBox="0 0 420 420" fill="none">
      <path {...STROKE_PROPS} d="M120 260c0-70 56-140 130-140s130 70 130 140-56 100-130 100-130-30-130-100Z" />
      {[[178, 210], [222, 190], [200, 250], [252, 240], [168, 280]].map(([x, y], i) => (
        <ellipse key={i} {...STROKE_PROPS} cx={x} cy={y} rx="13" ry="17" transform={`rotate(${i * 22} ${x} ${y})`} />
      ))}
    </svg>
  )
}

function Shilajit() {
  return (
    <svg viewBox="0 0 420 420" fill="none">
      <path {...STROKE_PROPS} d="M60 320 150 160l50 60 40-90 120 190Z" />
      <path {...STROKE_PROPS} d="M150 160 190 210" strokeDasharray="2 6" />
      <path {...STROKE_PROPS} d="M240 130 320 250" strokeDasharray="2 6" />
      <path {...STROKE_PROPS} d="M90 300c60-30 100 10 150-10s70-20 120 0" />
    </svg>
  )
}

function MountainJuices() {
  return (
    <svg viewBox="0 0 420 420" fill="none">
      <path {...STROKE_PROPS} d="M160 100h100l16 40-14 18v130c0 22-18 40-40 40h-24c-22 0-40-18-40-40V158l-14-18 16-40Z" />
      <path {...STROKE_PROPS} d="M160 100h100" />
      <path {...STROKE_PROPS} d="M150 220h120" />
      <path {...STROKE_PROPS} d="M210 250c0 40 0 40 0 70" strokeDasharray="2 6" />
      {[[210, 300], [186, 280], [234, 280]].map(([x, y], i) => (
        <circle key={i} {...STROKE_PROPS} cx={x} cy={y} r="9" />
      ))}
    </svg>
  )
}

const MOTIFS: Record<string, () => React.JSX.Element> = {
  'natural-oils':        NaturalOils,
  'himalayan-honey':     HimalayanHoney,
  'himalayan-tea':       HimalayanTea,
  'heritage-rice':       HeritageRice,
  'herbs-and-spices':    HerbsAndSpices,
  'jams-and-preserves':  JamsAndPreserves,
  'pulses-and-dal':      PulsesAndDal,
  'shilajit':            Shilajit,
  'mountain-juices':     MountainJuices,
}

export default function CategoryMotif({ slug, className, style }: {
  slug: string
  className?: string
  style?: React.CSSProperties
}) {
  const Motif = MOTIFS[slug] || MountainJuices
  return (
    <div className={className} style={{ opacity: 0.16, pointerEvents: 'none', ...style }}>
      <Motif />
    </div>
  )
}
