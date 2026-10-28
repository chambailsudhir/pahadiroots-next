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
import { getHeroStats, getStatesCovered, withLiveStateCount } from '@/lib/heroStats'
import type { SiteSettings } from '@/types'

function settings(overrides: Record<string, string> = {}): SiteSettings {
  return { ...overrides } as unknown as SiteSettings
}

describe('getStatesCovered', () => {
  it('reads the real admin key (stat_himalayan_states), not the nonexistent states_covered', () => {
    expect(getStatesCovered(settings({ stat_himalayan_states: '15' }))).toBe('15')
  })

  it('has NO invented default — a count that cannot be backed by the states table is blank', () => {
    expect(getStatesCovered(settings({ stat_himalayan_states: '' }))).toBe('')
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

  // AUDIT S3-005: an unset stat is hidden — there are no fabricated defaults any more.
  it('hides every unset stat, and shows the states stat only once a real count exists', () => {
    expect(getHeroStats(settings()).map(s => s.num)).toEqual([])
    // with a live count (withLiveStateCount) it appears, exact and without "+"
    expect(getHeroStats(withLiveStateCount(settings(), 4)).map(s => s.num)).toEqual(['4'])
  })

  it('uses custom labels when the admin has set them', () => {
    const stats = getHeroStats(settings({ stat_farmer_families: '80', stat_farmer_label: 'Growers' }))
    expect(stats[0].lbl).toBe('Growers')
  })

  it('respects each stat\'s hide toggle — this is the actual bug: previously none were ever checked', () => {
    const stats = getHeroStats(settings({
      stat_farmer_families: '80', stat_happy_customers: '1200', stat_avg_dispatch: '48',
      stat_hide_stat_farmer_families: 'true', stat_himalayan_states: '4',
    }))
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

describe('withLiveStateCount — "Himalayan States" follows the admin\'s active states', () => {
  it('overrides the hand-typed admin number with the real active-state count, shown exactly (no "+")', () => {
    const live = withLiveStateCount(settings({ stat_himalayan_states: '10' }), 4)
    expect(getStatesCovered(live)).toBe('4')
    expect(getHeroStats(live).find(s => s.key === 'states')?.num).toBe('4')
  })

  it('scales up automatically when more states are activated', () => {
    expect(getStatesCovered(withLiveStateCount(settings(), 10))).toBe('10')
  })

  it('never shows a hand-typed number when no states could be loaded (count 0) — the stat is hidden', () => {
    const s = settings({ stat_himalayan_states: '12' })
    const out = withLiveStateCount(s, 0)
    expect(getStatesCovered(out)).toBe('')
    expect(getHeroStats(out).find(x => x.key === 'states')).toBeUndefined()
  })
})
