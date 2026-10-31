import type { SiteSettings } from '@/types'

/**
 * Settings are serialised into the page for every client component that receives them, and the whole document has to
 * arrive before the browser can ask for the hero image. The full object has ~150 keys; the interactive shell
 * (Header, bottom nav, cart/search/menu/login panels) never reads the groups below, so they are left out of what those
 * components receive. The server-rendered footer and sections still get the complete object.
 */
const UNUSED_BY_SHELL = [
  /^blog_/, /^about_(?!page_enabled$)/, /^coll_(img|hidden)_/, /^catalogue_health/, /^stat_/, /^hero_/, /^founder_/, /^og_image$/,
  /^meta_/, /^email_footer_text$/, /^google_site_verification$/, /^seller_state$/, /^batch_tracking_enabled$/,
  /^return_photo_/, /^order_prefix$/, /^brand_disambiguation$/, /^maintenance_message$/, /^social_/, /^fssai_/,
]

export function settingsForShell(settings: SiteSettings): SiteSettings {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(settings as Record<string, unknown>)) {
    if (!UNUSED_BY_SHELL.some(re => re.test(k))) out[k] = v
  }
  return out as SiteSettings
}

/** HeroBanner (client) only reads the stat strip (stat_*) and the mobile layout switch. */
export function settingsForHero(settings: SiteSettings): SiteSettings {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(settings as Record<string, unknown>)) {
    if (k.startsWith('stat_') || k === 'hero_mobile_layout') out[k] = v
  }
  return out as SiteSettings
}
