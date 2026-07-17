/**
 * regionMeta.test.ts
 *
 * Covers src/lib/regionMeta.ts — the single source of truth extracted to fix
 * bug #2 (REGION_META duplicated across regions/page.tsx and
 * ExploreByRegion.tsx, already drifted — Nagaland's Axone pill differed
 * between the two copies) and bug #3 (regions/[slug]/page.tsx never
 * referenced curated region copy at all).
 *
 * Nothing here existed before — REGION_META had zero test coverage while it
 * was duplicated inline in two page/component files.
 */

import { describe, it, expect } from 'vitest'
import { REGION_META, getRegionMeta } from '@/lib/regionMeta'

const ALL_STATE_IDS = ['hp', 'uk', 'jk', 'la', 'sk', 'as', 'ml', 'nl', 'mn', 'tr', 'ar', 'mz']

describe('REGION_META — data completeness', () => {
  it('has an entry for all 12 states currently shown on /regions', () => {
    for (const id of ALL_STATE_IDS) {
      expect(REGION_META[id], `missing REGION_META entry for "${id}"`).toBeDefined()
    }
  })

  it('every entry has all required fields non-empty', () => {
    for (const [id, meta] of Object.entries(REGION_META)) {
      expect(meta.emoji, `${id}.emoji`).toBeTruthy()
      expect(meta.tagline, `${id}.tagline`).toBeTruthy()
      expect(meta.panelBg, `${id}.panelBg`).toBeTruthy()
      expect(meta.snippet, `${id}.snippet`).toBeTruthy()
      expect(meta.description, `${id}.description`).toBeTruthy()
      expect(meta.pills.length, `${id}.pills should not be empty`).toBeGreaterThan(0)
    }
  })

  it('panelBg is a valid CSS gradient string (used directly as inline style background)', () => {
    for (const [id, meta] of Object.entries(REGION_META)) {
      expect(meta.panelBg, id).toMatch(/^linear-gradient\(/)
    }
  })
})

describe('getRegionMeta — case-insensitive lookup', () => {
  it('finds a region by lowercase id', () => {
    expect(getRegionMeta('hp')?.tagline).toBe('Dev Bhoomi')
  })

  it('finds a region by uppercase id — this is the exact case-mismatch pattern that caused ' +
     'bug #1 elsewhere (product counts silently disagreeing); getRegionMeta must not repeat it', () => {
    expect(getRegionMeta('HP')?.tagline).toBe('Dev Bhoomi')
    expect(getRegionMeta('Hp')?.tagline).toBe('Dev Bhoomi')
  })

  it('returns undefined for an unknown id instead of throwing', () => {
    expect(getRegionMeta('xx')).toBeUndefined()
  })

  it('returns undefined for null/undefined/empty input without throwing', () => {
    expect(getRegionMeta(null)).toBeUndefined()
    expect(getRegionMeta(undefined)).toBeUndefined()
    expect(getRegionMeta('')).toBeUndefined()
  })
})

describe('REGION_META — the specific drift bug #2 caught', () => {
  it('Nagaland\'s Axone pill is the single canonical value (no drifted duplicate to disagree with)', () => {
    // Before the fix: regions/page.tsx said "🫙 Axone", ExploreByRegion.tsx said
    // "🫙 Axone (Fermented)". Now there is exactly one copy, so this is the only
    // value either surface can ever show.
    expect(REGION_META.nl.pills).toContain('🫙 Axone (Fermented)')
  })
})
