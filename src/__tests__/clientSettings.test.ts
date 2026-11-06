import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { settingsForShell, settingsForHero, SHELL_SETTING_KEYS, SHELL_SETTING_PREFIXES } from '@/lib/clientSettings'

const all: any = {
  site_name: 'X', logo_url: '/l.png', whatsapp_number: '1', show_wishlist: 'true', about_page_enabled: 'true', show_blog: 'true',
  show_track_order_page: 'true', cod_enabled: 'true', free_shipping_min: '999', prepaid_discount_pct: '5', flat_shipping_charge: '49',
  cod_surcharge_amount: '20', cod_max_value: '3000', upi_enabled: 'true',
  ann_hide: 'false', ann_text: 'hi', ann_bg_color: '#000', ann_text_color: '#fff', stat_himalayan_states: '7', stat_hide_stat_himalayan_states: 'false',
  ticker_hide: 'false', ticker_bg_color: '#c8920a', ticker_text_color: '#111', ticker_1_text: 't', ticker_1_hide: 'false', ticker_5_text: 'u',
  blog_autopilot_day: 'mon', about_hero_eyebrow: 'e', coll_img_honey: 'u', coll_hidden_tea: 'x', catalogue_health_snapshot: '{}',
  stat_bg_color: '#000', stat_number_color: '#fff', hero_mobile_layout: 'full', hero_images: '[]', social_instagram: 'i', meta_title: 't',
  // keys that did NOT exist when the old deny-list was written: must not reach the shell
  some_new_admin_key: 'secret', internal_margin_pct: '40', supplier_notes: 'x',
}

/** Every `settings.<key>` / `settings['<key>']` read in the client shell tree, so the allow-list cannot drift from the code. */
const SHELL_FILES = [
  'src/components/layout/Header.tsx', 'src/components/layout/MegaMenu.tsx', 'src/components/layout/AnnouncementBar.tsx',
  'src/components/layout/TickerBar.tsx', 'src/components/layout/MobileBottomNav.tsx', 'src/components/layout/MobileMenu.tsx',
  'src/components/cart/CartDrawer.tsx', 'src/components/search/SearchOverlay.tsx', 'src/components/auth/AuthModal.tsx',
]

describe('settingsForShell (L4: explicit allow-list)', () => {
  it('returns exactly the allow-listed keys that are present, in the input order', () => {
    const out = settingsForShell(all)
    expect(Object.keys(out).sort()).toEqual([
      'about_page_enabled', 'ann_bg_color', 'ann_hide', 'ann_text', 'ann_text_color', 'cod_enabled', 'cod_max_value',
      'cod_surcharge_amount', 'flat_shipping_charge', 'free_shipping_min', 'logo_url', 'prepaid_discount_pct', 'show_blog',
      'show_track_order_page', 'show_wishlist', 'site_name', 'stat_hide_stat_himalayan_states', 'stat_himalayan_states',
      'ticker_1_hide', 'ticker_1_text', 'ticker_5_text', 'ticker_bg_color', 'ticker_hide', 'ticker_text_color', 'upi_enabled',
      'whatsapp_number',
    ])
  })
  it('a brand-new admin key is NOT forwarded to visitors (the old deny-list leaked it)', () => {
    const out: any = settingsForShell(all)
    for (const k of ['some_new_admin_key', 'internal_margin_pct', 'supplier_notes', 'blog_autopilot_day', 'about_hero_eyebrow',
      'coll_img_honey', 'coll_hidden_tea', 'catalogue_health_snapshot', 'stat_bg_color', 'hero_images', 'social_instagram', 'meta_title']) {
      expect(out, k).not.toHaveProperty(k)
    }
  })
  it('every static settings.<key> read in the shell components is on the allow-list', () => {
    const read = new Set<string>()
    for (const f of SHELL_FILES) {
      const src = readFileSync(join(process.cwd(), f), 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
      for (const m of src.matchAll(/\bsettings\??\.([a-zA-Z_]\w*)/g)) read.add(m[1])
      for (const m of src.matchAll(/\bsettings\[`([a-z_]+)\$\{/g)) read.add(m[1] + '*')
    }
    expect(read.size).toBeGreaterThan(5)
    for (const k of read) {
      const ok = k.endsWith('*') ? SHELL_SETTING_PREFIXES.includes(k.slice(0, -1)) : SHELL_SETTING_KEYS.includes(k) || SHELL_SETTING_PREFIXES.some(p => k.startsWith(p))
      expect(ok, `shell reads settings.${k} but it is not allow-listed in clientSettings.ts`).toBe(true)
    }
  })
  it('keeps the keys the cart pricing helpers read (calcPriceSummary / likelyPaymentMethod)', () => {
    for (const k of ['free_shipping_min', 'flat_shipping_charge', 'prepaid_discount_pct', 'cod_surcharge_amount', 'cod_max_value', 'cod_enabled', 'upi_enabled']) {
      expect(SHELL_SETTING_KEYS).toContain(k)
    }
  })
})

describe('settingsForHero', () => {
  it('keeps only the stat strip and the mobile layout switch', () => {
    expect(Object.keys(settingsForHero(all)).sort()).toEqual(['hero_mobile_layout', 'stat_bg_color', 'stat_hide_stat_himalayan_states', 'stat_himalayan_states', 'stat_number_color'])
  })
})
