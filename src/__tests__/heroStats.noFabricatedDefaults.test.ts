/** AUDIT S3-005: a blank stat is hidden, never replaced by a marketing number. */
import { describe, it, expect } from 'vitest'
import { getHeroStats } from '@/lib/heroStats'
import type { SiteSettings } from '@/types'

describe('getHeroStats with unset values', () => {
  it('renders nothing for farmers / customers / dispatch when the admin left them blank', () => {
    const stats = getHeroStats({ stat_himalayan_states: '4', stat_states_live: 'true' } as unknown as SiteSettings)
    expect(stats.map(s => s.key)).toEqual(['states'])
  })
  it('renders the admin value when set', () => {
    const stats = getHeroStats({ stat_farmer_families: '37', stat_happy_customers: '1200', stat_avg_dispatch: '48' } as unknown as SiteSettings)
    expect(stats.map(s => s.num)).toEqual(['37+', '1k+', '48hr'])
  })
})
