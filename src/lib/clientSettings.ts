import type { SiteSettings } from '@/types'

/**
 * Settings are serialised into the page for every client component that receives them, and the whole document has to
 * arrive before the browser can ask for the hero image. The full object has ~150 keys; the interactive shell
 * (Header, bottom nav, cart/search/menu/login panels) reads only the keys below, so only those are sent to it. The
 * server-rendered footer and sections still get the complete object.
 *
 * L4 (Nov 2026 audit): this used to be a DENY-list of admin-only groups, so every new admin key leaked to visitors by
 * default (and `/^stat_/` silently dropped `stat_himalayan_states`, which AnnouncementBar reads). It is now an
 * ALLOW-list: a key reaches the shell only if a shell component is known to read it. Add a key here when you add a read.
 */
export const SHELL_SETTING_KEYS: readonly string[] = [
  // Header / MobileMenu / MegaMenu
  'site_name', 'logo_url', 'show_wishlist', 'show_blog', 'show_track_order_page', 'about_page_enabled',
  // MobileBottomNav / MobileMenu (WhatsApp link)
  'whatsapp_number',
  // AnnouncementBar (getStatesCovered reads stat_himalayan_states)
  'ann_hide', 'ann_text', 'ann_bg_color', 'ann_text_color', 'stat_himalayan_states', 'stat_hide_stat_himalayan_states',
  // TickerBar (ticker_hide, ticker_bg_color, ticker_text_color, ticker_N_text, ticker_N_hide) — see SHELL_SETTING_PREFIXES
  // CartDrawer -> calcPriceSummary / likelyPaymentMethod
  'free_shipping_min', 'flat_shipping_charge', 'prepaid_discount_pct', 'cod_surcharge_amount', 'cod_max_value',
  'cod_enabled', 'upi_enabled',
]
export const SHELL_SETTING_PREFIXES: readonly string[] = ['ticker_']

export function isShellSettingKey(key: string): boolean {
  return SHELL_SETTING_KEYS.includes(key) || SHELL_SETTING_PREFIXES.some(p => key.startsWith(p))
}

export function settingsForShell(settings: SiteSettings): SiteSettings {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(settings as Record<string, unknown>)) {
    if (isShellSettingKey(k)) out[k] = v
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
