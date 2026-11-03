import { describe, it, expect } from 'vitest'
import { clientIpKey } from '@/lib/api/clientIp'

describe('clientIpKey', () => {
  it('keeps IPv4 and unwraps IPv4-mapped IPv6', () => {
    expect(clientIpKey('203.0.113.9')).toBe('203.0.113.9')
    expect(clientIpKey('::ffff:203.0.113.9')).toBe('203.0.113.9')
  })
  it('collapses every address in one IPv6 /64 to the same bucket', () => {
    const a = clientIpKey('2401:4900:1234:5678:aaaa:bbbb:cccc:dddd')
    expect(a).toBe('2401:4900:1234:5678::/64')
    expect(clientIpKey('2401:4900:1234:5678::1')).toBe(a)
    expect(clientIpKey('2401:4900:1234:5678:0:0:0:2')).toBe(a)
    expect(clientIpKey('2401:4900:1234:5679::1')).not.toBe(a)
  })
  it('expands :: at the start and handles short forms', () => {
    expect(clientIpKey('::1')).toBe('0:0:0:0::/64')
    expect(clientIpKey('2001:db8::')).toBe('2001:db8:0:0::/64')
  })
  it('unwraps every spelling of an IPv4-mapped address and strips brackets / ports', () => {
    expect(clientIpKey('::ffff:0102:0304')).toBe('1.2.3.4')
    expect(clientIpKey('0:0:0:0:0:ffff:1.2.3.4')).toBe('1.2.3.4')
    expect(clientIpKey('[::1]:443')).toBe('0:0:0:0::/64')
    expect(clientIpKey('1.2.3.4:5678')).toBe('1.2.3.4')
    expect(clientIpKey('2001:db8::1.2.3.4')).toBe('2001:db8:0:0::/64')
  })
  it('never throws on junk; empty is "unknown"', () => {
    expect(clientIpKey('')).toBe('unknown')
    expect(clientIpKey(null)).toBe('unknown')
    expect(clientIpKey('not-an-ip:::x')).toBe('not-an-ip:::x')
  })
})
