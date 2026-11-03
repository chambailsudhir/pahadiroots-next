/**
 * Rate-limit bucket for a client address.
 *
 * - IPv4 is used as is; an IPv4-mapped IPv6 address (::ffff:1.2.3.4) is unwrapped to the IPv4 address.
 * - IPv6 is collapsed to its /64 prefix: a single host or home connection owns a whole /64, so keying on the full address lets
 *   one machine rotate through billions of "different" clients and never hit a per-IP limit.
 * - Anything unrecognisable falls back to the raw string (lower-cased) so it still buckets deterministically.
 */
export function clientIpKey(raw: string | null | undefined): string {
  const ip = (raw ?? '').trim().toLowerCase()
  if (!ip) return 'unknown'
  const mapped = ip.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/)
  if (mapped) return mapped[1]
  if (!ip.includes(':')) return ip                       // IPv4 (or a hostname-like oddity)
  const noZone = ip.split('%')[0]
  const halves = noZone.split('::')
  if (halves.length > 2) return noZone
  const head = halves[0] ? halves[0].split(':') : []
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : []
  const missing = 8 - head.length - tail.length
  if (halves.length === 1 ? head.length !== 8 : missing < 0) return noZone
  const groups = halves.length === 1 ? head : [...head, ...Array(missing).fill('0'), ...tail]
  if (groups.some(g => !/^[0-9a-f]{1,4}$/.test(g))) return noZone
  return groups.slice(0, 4).map(g => g.replace(/^0+(?=.)/, '')).join(':') + '::/64'
}
