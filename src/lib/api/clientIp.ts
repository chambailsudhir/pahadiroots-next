/**
 * Rate-limit bucket for a client address.
 *
 * - IPv4 is used as is (a ":port" suffix is dropped); IPv4-mapped IPv6 in any spelling (::ffff:1.2.3.4, ::ffff:0102:0304,
 *   0:0:0:0:0:ffff:1.2.3.4) is unwrapped to the IPv4 address.
 * - IPv6 is collapsed to its /64 prefix: a single host or home connection owns a whole /64, so keying on the full address lets
 *   one machine rotate through billions of "different" clients and never hit a per-IP limit.
 * - Brackets / ports ([::1]:443) and zone ids (%eth0) are stripped. Anything unrecognisable falls back to the lower-cased raw
 *   string so it still buckets deterministically; an empty value is the shared 'unknown' bucket.
 */
function hexPairToIpv4(hi: string, lo: string): string {
  const h = parseInt(hi, 16), l = parseInt(lo, 16)
  return `${h >> 8}.${h & 255}.${l >> 8}.${l & 255}`
}

export function clientIpKey(raw: string | null | undefined): string {
  let ip = (raw ?? '').trim().toLowerCase()
  if (!ip) return 'unknown'
  const bracket = ip.match(/^\[([^\]]+)\](?::\d+)?$/)
  if (bracket) ip = bracket[1]
  ip = ip.split('%')[0]
  const v4port = ip.match(/^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/)
  if (v4port) return v4port[1]
  if (!ip.includes(':')) return ip                       // IPv4 (or a hostname-like oddity)

  // a dotted-quad tail is two hex groups
  const dotted = ip.match(/^(.*:)(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (dotted) {
    const [a, b, c, d] = [dotted[2], dotted[3], dotted[4], dotted[5]].map(Number)
    if ([a, b, c, d].some(n => n > 255)) return ip
    ip = dotted[1] + ((a << 8) | b).toString(16) + ':' + ((c << 8) | d).toString(16)
  }
  const halves = ip.split('::')
  if (halves.length > 2) return ip
  const head = halves[0] ? halves[0].split(':') : []
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : []
  const missing = 8 - head.length - tail.length
  if (halves.length === 1 ? head.length !== 8 : missing < 1) return ip
  const groups = halves.length === 1 ? head : [...head, ...Array(missing).fill('0'), ...tail]
  if (groups.some(g => !/^[0-9a-f]{1,4}$/.test(g))) return ip
  // IPv4-mapped (::ffff:a.b.c.d): the client is the IPv4 address
  if (groups.slice(0, 5).every(g => parseInt(g, 16) === 0) && parseInt(groups[5], 16) === 0xffff) return hexPairToIpv4(groups[6], groups[7])
  return groups.slice(0, 4).map(g => g.replace(/^0+(?=.)/, '')).join(':') + '::/64'
}

/**
 * The /48 site prefix ("2001:db8:1::/48") for an IPv6 key produced by clientIpKey(), else null (IPv4 / unknown / unparsable).
 * Nov 2026 audit: an ISP typically hands a customer a whole /48 (65 536 /64s), so per-/64 limits alone let one site act as tens of
 * thousands of "networks". Used as an extra bucket alongside the /64 one where that matters (customer login).
 */
export function ipv6Slash48Key(ipKey: string): string | null {
  const m = ipKey.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4}):([0-9a-f]{1,4}):[0-9a-f]{1,4}::\/64$/)
  return m ? `${m[1]}:${m[2]}:${m[3]}::/48` : null
}
