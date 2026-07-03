/**
 * profileCache.test.ts
 *
 * Regression tests for the checkout autofill "too slow" bug reported live:
 * readProfileCache() used to discard ANY cache entry older than 30 minutes
 * (PROFILE_CACHE_TTL), returning null and forcing a full live network wait
 * before checkout could show the customer's address at all — even though a
 * perfectly good last-known address was sitting right there in localStorage.
 * This is the Amazon/Myntra pattern: show what you know instantly, refresh
 * silently in the background, never make the customer wait on a network
 * round-trip for data you already had.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  readProfileCache, writeProfileCache, isProfileCacheStale,
  PROFILE_CACHE_KEY, PROFILE_CACHE_TTL,
  type CachedProfile,
} from '@/lib/profileCache'

function entry(ageMs: number): CachedProfile {
  return {
    ts: Date.now() - ageMs,
    profile: { first_name: 'Asha', last_name: 'Rana', phone: '9876543210', email: 'asha@example.com' } as never,
    addresses: [{
      id: 'default', is_default: true, label: 'Home',
      name: 'Asha Rana', flat: 'Flat 4', area: '',
      city: 'Dehradun', state: 'Uttarakhand', pincode: '248001', phone: '9876543210',
    }],
  }
}

describe('profileCache — stale-while-revalidate', () => {
  beforeEach(() => localStorage.clear())

  it('[BUG FIX] a cache entry older than PROFILE_CACHE_TTL is still returned by readProfileCache, not discarded', () => {
    writeProfileCache(entry(PROFILE_CACHE_TTL * 5)) // 5x past the old cutoff
    const cache = readProfileCache()
    expect(cache).not.toBeNull()
    expect(cache?.addresses[0].city).toBe('Dehradun')
  })

  it('a fresh cache entry is returned normally', () => {
    writeProfileCache(entry(1_000))
    expect(readProfileCache()).not.toBeNull()
  })

  it('missing cache still returns null (nothing to instantly show)', () => {
    expect(readProfileCache()).toBeNull()
  })

  it('corrupt localStorage value returns null rather than throwing', () => {
    localStorage.setItem(PROFILE_CACHE_KEY, '{not valid json')
    expect(readProfileCache()).toBeNull()
  })

  it('isProfileCacheStale is false for a fresh entry (no refresh needed yet)', () => {
    writeProfileCache(entry(1_000))
    expect(isProfileCacheStale()).toBe(false)
  })

  it('isProfileCacheStale is true for an old entry — signals "refresh this", not "discard this"', () => {
    writeProfileCache(entry(PROFILE_CACHE_TTL * 2))
    // Still readable...
    expect(readProfileCache()).not.toBeNull()
    // ...but flagged as worth refreshing in the background
    expect(isProfileCacheStale()).toBe(true)
  })

  it('isProfileCacheStale is true when there is no cache at all', () => {
    expect(isProfileCacheStale()).toBe(true)
  })
})
