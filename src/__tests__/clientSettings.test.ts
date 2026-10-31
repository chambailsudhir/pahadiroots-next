import { describe, it, expect } from 'vitest'
import { settingsForShell, settingsForHero } from '@/lib/clientSettings'

const all: any = {
  site_name: 'X', logo_url: '/l.png', whatsapp_number: '1', show_wishlist: 'true', about_page_enabled: 'true', show_blog: 'true',
  cod_enabled: 'true', free_shipping_min: '999', prepaid_discount_pct: '5',
  blog_autopilot_day: 'mon', about_hero_eyebrow: 'e', coll_img_honey: 'u', coll_hidden_tea: 'x', catalogue_health_snapshot: '{}',
  stat_bg_color: '#000', stat_number_color: '#fff', hero_mobile_layout: 'full', hero_images: '[]', social_instagram: 'i', meta_title: 't',
}

describe('settingsForShell', () => {
  it('keeps everything the Header / bottom nav / cart / menu read', () => {
    const out: any = settingsForShell(all)
    for (const k of ['site_name', 'logo_url', 'whatsapp_number', 'show_wishlist', 'about_page_enabled', 'show_blog', 'cod_enabled', 'free_shipping_min', 'prepaid_discount_pct']) expect(out).toHaveProperty(k)
  })
  it('drops admin-only groups the shell never reads', () => {
    const out: any = settingsForShell(all)
    for (const k of ['blog_autopilot_day', 'about_hero_eyebrow', 'coll_img_honey', 'coll_hidden_tea', 'catalogue_health_snapshot', 'stat_bg_color', 'hero_images', 'social_instagram', 'meta_title']) expect(out).not.toHaveProperty(k)
  })
})

describe('settingsForHero', () => {
  it('keeps only the stat strip and the mobile layout switch', () => {
    expect(Object.keys(settingsForHero(all)).sort()).toEqual(['hero_mobile_layout', 'stat_bg_color', 'stat_number_color'])
  })
})
