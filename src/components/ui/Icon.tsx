import type { SVGProps } from 'react'

/**
 * Small inline SVG icon set (Lucide-style: 24x24 grid, 1.8 stroke, currentColor) used for UI chrome instead of emoji.
 * Emoji render differently on every OS/browser, cannot be recoloured, and can't match the brand; these inherit the text
 * colour, scale with font-size (1em) and are decorative (aria-hidden) — the surrounding control carries the accessible name.
 */
const PATHS = {
  search:  <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>,
  heart:   <path d="M12 20.5s-7.5-4.6-9.2-9.4C1.7 7.700 3.900 4.500 7.100 4.500c2 0 3.700 1.100 4.900 2.900 1.200-1.800 2.900-2.900 4.900-2.900 3.200 0 5.400 3.200 4.300 6.600-1.700 4.800-9.200 9.400-9.200 9.400Z" />,
  user:    <><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 3.600-6.500 8-6.500s8 2.500 8 6.500" /></>,
  sparkle: <><path d="M12 3l1.900 5.100L19 10l-5.100 1.900L12 17l-1.900-5.100L5 10l5.100-1.900L12 3Z" /><path d="M19 16l.7 1.800L21.500 18.500l-1.800.7L19 21l-.7-1.800-1.800-.7 1.800-.7L19 16Z" /></>,
  cart:    <><circle cx="9" cy="20" r="1.400" /><circle cx="18" cy="20" r="1.400" /><path d="M2.500 3.500h2.800l2.400 11.200a1.500 1.500 0 0 0 1.500 1.200h8.200a1.500 1.500 0 0 0 1.500-1.100l1.600-6.800H6.100" /></>,
  eye:     <><path d="M1.500 12S5.500 5 12 5s10.500 7 10.500 7-4 7-10.500 7S1.500 12 1.500 12Z" /><circle cx="12" cy="12" r="3" /></>,
  pin:     <><path d="M12 21.500s7-6.200 7-11.500a7 7 0 1 0-14 0c0 5.300 7 11.500 7 11.500Z" /><circle cx="12" cy="10" r="2.500" /></>,
  mail:    <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3.500 6.500 8.500 6.500 8.500-6.500" /></>,
  phone:   <path d="M5 4h4l2 5-2.500 1.500a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2Z" />,
  globe:   <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.500 2.600 3.800 5.600 3.800 9S14.500 18.400 12 21c-2.500-2.600-3.800-5.600-3.800-9S9.500 5.600 12 3Z" /></>,
  package: <><path d="M3.500 7.500 12 3l8.500 4.500v9L12 21l-8.500-4.500v-9Z" /><path d="M3.500 7.500 12 12l8.500-4.500M12 12v9" /></>,
  leaf:    <><path d="M20 4C10 4 4 9.500 4 16c0 1.500.4 2.800 1 4 1.300-3.500 4-6.500 8-8.500-3 2.500-5 5.500-6 9 7.500 1 13-4.500 13-12.500V4Z" /></>,
  mountain:<><path d="m2.500 20 6.500-11 4 6.500 2-3 6.500 7.500Z" /><path d="m9 9 1.800 2.800" /></>,
  users:   <><circle cx="9" cy="8" r="3.200" /><path d="M3 20c0-3.500 2.700-5.500 6-5.500s6 2 6 5.500" /><circle cx="17" cy="9" r="2.500" /><path d="M17.500 14.500c2.500.2 4.500 2 4.500 5" /></>,
  truck:   <><path d="M2 6.500h11v10H2z" /><path d="M13 10h4.500l3.500 3.500v3H13" /><circle cx="6.500" cy="17.500" r="1.800" /><circle cx="17" cy="17.500" r="1.800" /></>,
  shield:  <><path d="M12 3 4.500 6v5.500c0 4.500 3.200 8 7.500 9.500 4.300-1.500 7.500-5 7.500-9.500V6L12 3Z" /><path d="m8.800 12 2.400 2.400L15.500 10" /></>,
  gift:    <><rect x="3.500" y="9" width="17" height="11.500" rx="1.500" /><path d="M12 9v11.500M3.500 13h17" /><path d="M12 9C12 6.500 10.500 4.500 8.500 4.500S6 7 8.500 9H12Zm0 0c0-2.500 1.500-4.500 3.500-4.500S18 7 15.500 9H12Z" /></>,
  flask:   <><path d="M9 3h6M10 3v6.500L4.500 19a1.500 1.500 0 0 0 1.300 2.200h12.400A1.500 1.500 0 0 0 19.500 19L14 9.500V3" /><path d="M7.500 15h9" /></>,
  star:    <path d="m12 3 2.700 5.600 6.100.9-4.400 4.300 1 6.100L12 17l-5.400 2.900 1-6.100-4.400-4.300 6.100-.9L12 3Z" />,
  pause:   <><rect x="6.500" y="5" width="3.500" height="14" rx="1" /><rect x="14" y="5" width="3.500" height="14" rx="1" /></>,
  play:    <path d="M8 5.500v13l11-6.500-11-6.500Z" />,
  sun:     <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.900 4.900l1.400 1.400M17.700 17.700l1.400 1.400M2 12h2M20 12h2M4.900 19.100l1.400-1.400M17.700 6.300l1.400-1.400" /></>,
  moon:    <path d="M20.500 14.500A8.500 8.500 0 0 1 9.500 3.500a8.500 8.500 0 1 0 11 11Z" />,
} as const

export type IconName = keyof typeof PATHS

interface Props extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName
  /** Fill the shape (e.g. a saved/wishlisted heart). */
  filled?: boolean
  /** Size in em units (default 1.1em ≈ the surrounding text). */
  size?: number | string
}

export default function Icon({ name, filled = false, size = '1.1em', style, ...rest }: Props) {
  return (
    <svg
      viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" focusable="false"
      fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"
      style={{ display: 'inline-block', verticalAlign: '-0.15em', flexShrink: 0, ...style }}
      {...rest}
    >
      {PATHS[name]}
    </svg>
  )
}

/**
 * Owner-written text (trust bar, announcement ticker) often starts with an emoji. Known ones are drawn with the matching brand
 * icon so the strip looks the same on every device; anything unknown is left alone (`AdminIcon`) or dropped (`stripLeadingEmoji`).
 */
const EMOJI_ICON: Record<string, IconName> = {
  '🌿': 'leaf', '🍃': 'leaf', '🌱': 'leaf', '🏔': 'mountain', '⛰': 'mountain', '🤝': 'users', '👥': 'users',
  '🚚': 'truck', '📦': 'package', '🔒': 'shield', '🛡': 'shield', '🎁': 'gift', '🔬': 'flask', '🧪': 'flask', '⭐': 'star', '🌟': 'star',
}
const LEADING_EMOJI = /^\s*(\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic}|\p{Emoji_Modifier})*)\s*/u
const clean = (e: string) => e.replace(/\uFE0F/g, '')

export function leadingEmojiIcon(text: string): { icon: IconName | null; rest: string } {
  const m = LEADING_EMOJI.exec(text ?? '')
  if (!m) return { icon: null, rest: text ?? '' }
  return { icon: EMOJI_ICON[clean(m[1])] ?? null, rest: (text ?? '').slice(m[0].length) }
}

/** An owner-chosen icon value: a known emoji becomes the SVG, any other value (text, unknown emoji) is shown as written. */
export function AdminIcon({ value, size = '1em' }: { value: string; size?: number | string }) {
  const name = EMOJI_ICON[clean((value ?? '').trim())]
  return name ? <Icon name={name} size={size} /> : <>{value}</>
}
