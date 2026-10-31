// PERF FIX (audit C-5): this switcher used to be 'use client', which pulled FooterA, FooterB and FooterC (hundreds of
// lines, including the two that are pure markup) into the client JS bundle for no reason — it holds no state and
// uses no browser API. As a server component only the chosen variant is rendered, and only FooterA (which has its
// own 'use client' for the newsletter form) ships JS.
import type { SiteSettings } from '@/types'
import FooterA from './FooterA'
import FooterB from './FooterB'
import FooterC from './FooterC'
import type { FooterCategory } from '@/lib/footerQuickSelects'

interface Props { settings: SiteSettings; categories?: FooterCategory[] }

/**
 * Footer switcher.
 * Admin controls `footer_variant` in site_settings:
 * A = existing footer, B = Mountain Edge, C = Himalayan Landscape.
 * Unset/unknown values intentionally fall back to Footer A for safety.
 *
 * The value is normalised (trimmed, upper-cased, stray quotes removed) so a
 * row saved as ' b ' or '"C"' still selects the right design instead of
 * silently falling back to A. The wrapper carries `data-footer-variant` so
 * the live variant can be verified in DevTools (Elements → search
 * "data-footer-variant").
 */
export default function Footer({ settings, categories }: Props) {
  const raw = String(settings.footer_variant ?? '').replace(/["'\s]/g, '').toUpperCase()
  const variant: 'A' | 'B' | 'C' = raw === 'C' ? 'C' : raw === 'B' ? 'B' : 'A'
  return (
    <div data-footer-variant={variant} style={{ display: 'contents' }}>
      {variant === 'C' ? <FooterC settings={settings} categories={categories} />
        : variant === 'B' ? <FooterB settings={settings} categories={categories} />
        : <FooterA settings={settings} categories={categories} />}
    </div>
  )
}
