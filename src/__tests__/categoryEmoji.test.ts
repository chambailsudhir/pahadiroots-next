/**
 * categoryEmoji.test.ts
 *
 * Covers the P2 audit fix: BestSellersClient.tsx's catEmoji() returned a
 * text label ("Honey", "Ghee") instead of an emoji, despite its name —
 * category filter buttons without a DB-set emoji rendered the category
 * name twice (e.g. "Honey Honey"). emojiForCategory() is the single
 * shared implementation CategoryTiles.tsx and BestSellersClient.tsx both
 * now use, based on CategoryTiles' original (correct) version.
 */

import { describe, it, expect } from 'vitest'
import { emojiForCategory } from '@/lib/categoryEmoji'

describe('emojiForCategory', () => {
  it('always returns an actual emoji character, never a text label', () => {
    // This is the literal bug: the old BestSellersClient implementation
    // returned the string "Honey" for a honey category, not an emoji.
    const result = emojiForCategory({ name: 'Wild Honey', slug: 'honey' })
    expect(result).toBe('🍯')
    expect(result).not.toMatch(/[a-zA-Z]/)
  })

  it('matches known slugs first', () => {
    expect(emojiForCategory({ slug: 'tea', name: 'Something Else' })).toBe('🍵')
  })

  it('falls back to name-based matching when slug is unknown', () => {
    expect(emojiForCategory({ slug: 'misc', name: 'A2 Bilona Ghee' })).toBe('🥛')
    expect(emojiForCategory({ slug: 'misc', name: 'Kashmiri Saffron' })).toBe('🌸')
  })

  it('falls back to a generic mountain emoji for unrecognized categories', () => {
    expect(emojiForCategory({ slug: 'unknown', name: 'Something Totally New' })).toBe('🏔️')
  })

  it('handles missing name/slug without throwing', () => {
    expect(emojiForCategory({})).toBe('🏔️')
  })
})
