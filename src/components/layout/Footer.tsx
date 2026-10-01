'use client'

import type { SiteSettings } from '@/types'
import FooterA from './FooterA'
import FooterB from './FooterB'

interface Props { settings: SiteSettings }

/**
 * Footer switcher. Admin controls `footer_variant` in site_settings.
 * Unset/unknown values intentionally fall back to Footer A for safety.
 */
export default function Footer({ settings }: Props) {
  return settings.footer_variant === 'B'
    ? <FooterB settings={settings} />
    : <FooterA settings={settings} />
}
