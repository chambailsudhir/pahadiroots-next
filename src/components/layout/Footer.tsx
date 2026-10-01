'use client'

import type { SiteSettings } from '@/types'
import FooterA from './FooterA'
import FooterB from './FooterB'
import FooterC from './FooterC'

interface Props { settings: SiteSettings }

/**
 * Footer switcher.
 * Admin controls `footer_variant` in site_settings:
 * A = existing footer, B = Mountain Edge, C = Himalayan Landscape.
 * Unset/unknown values intentionally fall back to Footer A for safety.
 */
export default function Footer({ settings }: Props) {
  if (settings.footer_variant === 'C') return <FooterC settings={settings} />
  if (settings.footer_variant === 'B') return <FooterB settings={settings} />
  return <FooterA settings={settings} />
}
