/**
 * heroStats.test.ts
 *
 * Covers the fix for HeroBanner.tsx's stats bar being almost entirely
 * disconnected from the admin panel's "Hero Stats Bar" settings section
 * (confirmed directly against the pahadi-admin repo). Before this fix:
 * 3 of 4 stats were hardcoded plain strings reading from settings at
 * all, the 4th read a key (states_covered) the admin panel never
 * writes to, and none of the 4 hide-toggles were ever checked.
 */

import { describe, it, expect } from 'vitest'
import { getHeroStats, getStatesCovered } from '@/lib/heroStats'
import type { SiteSettings } from '@/types'

function settings(overrides: Record<string, string> = {}): SiteSettings {
  return { ...overrides } as unknown as SiteSettings
}

describe('getStatesCovered', () => {
  it('reads the real admin key (stat_himalayan_states), not the nonexistent states_covered', () => {
    expect(getStatesCovered(settings({ stat_himalayan_states: '15' }))).toBe('15')
  })

  it('defaults to 10, matching the admin panel default', () => {
    expect(getStatesCovered(settings())).toBe('10')
  })
})

describe('getHeroStats', () => {
  it('reads all 4 stats from their real admin-managed keys', () => {
    const stats = getHeroStats(settings({
      stat_farmer_families: '600',
      stat_himalayan_states: '12',
      stat_happy_customers: '25000',
      stat_avg_dispatch: '24',
    }))
    expect(stats.map(s => s.num)).toEqual(['600+', '12+', '25k+', '24hr'])
  })

  it('defaults to the same values as the admin panel', () => {
    const stats = getHeroStats(settings())
    expect(stats.map(s => s.num)).toEqual(['100+', '10+', '10k+', '48hr'])
  })

  it('uses custom labels when the admin has set them', () => {
    const stats = getHeroStats(settings({ stat_farmer_label: 'Growers' }))
    expect(stats[0].lbl).toBe('Growers')
  })

  it('respects each stat\'s hide toggle — this is the actual bug: previously none were ever checked', () => {
    const stats = getHeroStats(settings({ stat_hide_stat_farmer_families: 'true' }))
    expect(stats.find(s => s.key === 'farmers')).toBeUndefined()
    expect(stats.length).toBe(3)
  })

  it('can hide all 4 stats, leaving an empty array rather than crashing', () => {
    const stats = getHeroStats(settings({
      stat_hide_stat_farmer_families: 'true',
      stat_hide_stat_himalayan_states: 'true',
      stat_hide_stat_happy_customers: 'true',
      stat_hide_stat_avg_dispatch: 'true',
    }))
    expect(stats).toEqual([])
  })

  it('formats customer counts under 1000 without the "k" abbreviation', () => {
    const stats = getHeroStats(settings({ stat_happy_customers: '500' }))
    expect(stats.find(s => s.key === 'customers')?.num).toBe('500+')
  })
})
