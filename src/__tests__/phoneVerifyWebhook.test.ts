/**
 * WhatsApp inbound phone verification — Meta webhook (src/app/api/webhooks/whatsapp/route.ts).
 * sbAdmin is replaced by a tiny in-memory phone_verifications table + a claim_verified_phone spy.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createHmac } from 'node:crypto'
import { NextRequest } from 'next/server'

interface Row { id: number; customer_id: number; phone10: string; code_hash: string; expires_at: string; consumed_at: string | null; attempts: number; created_at: string }
const db = vi.hoisted(() => ({ rows: [] as unknown[], claims: [] as Array<{ p_customer_id: number; p_phone10: string }>, claimResult: { ok: true, reason: 'claimed' } as unknown, claimThrows: false }))

vi.mock('@/lib/api/serverUtils', () => ({
  sbAdmin: async (method: string, path: string, body?: Record<string, unknown>) => {
    const rows = db.rows as Row[]
    if (path.startsWith('/rest/v1/rpc/claim_verified_phone')) {
      if (db.claimThrows) throw { status: 500, message: 'boom' }
      db.claims.push(body as never); return db.claimResult
    }
    if (path.startsWith('/rest/v1/site_settings')) return []
    const q = new URL('http://x' + path).searchParams
    const match = (r: Row) => {
      if (q.get('id') && r.id !== Number(q.get('id')!.replace('eq.', ''))) return false
      if (q.get('phone10') && r.phone10 !== q.get('phone10')!.replace('eq.', '')) return false
      if (q.get('consumed_at') === 'is.null' && r.consumed_at !== null) return false
      if (q.get('expires_at')?.startsWith('gt.') && !(new Date(r.expires_at) > new Date(q.get('expires_at')!.slice(3)))) return false
      if (q.get('attempts') && r.attempts !== Number(q.get('attempts')!.replace('eq.', ''))) return false
      return true
    }
    if (method === 'GET') return rows.filter(match).sort((a, b) => b.created_at.localeCompare(a.created_at))
    if (method === 'PATCH') { const hit = rows.filter(match); hit.forEach(r => Object.assign(r, body)); return hit }
    return null
  },
}))

const SECRET = 'app-secret', NUMBER = '919800000000', TOKEN = 'vt-123'
let route: typeof import('@/app/api/webhooks/whatsapp/route')
let lib: typeof import('@/lib/server/phoneVerification')

const sign = (raw: string, secret = SECRET) => 'sha256=' + createHmac('sha256', secret).update(raw).digest('hex')
const payload = (from: string, body: string, type = 'text') => JSON.stringify({
  object: 'whatsapp_business_account',
  entry: [{ id: 'WABA', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', messages: [{ from, id: 'wamid.X', timestamp: '1', type, text: { body } }] } }] }],
})
const post = (raw: string, sig: string | null = sign(raw)) => route.POST(new NextRequest('https://pahadiroots.com/api/webhooks/whatsapp', {
  method: 'POST', body: raw, headers: { 'content-type': 'application/json', ...(sig ? { 'x-hub-signature-256': sig } : {}) },
}))
let nextId = 1
const seed = (over: Partial<Row> = {}, code = '482913') => {
  const r: Row = { id: nextId++, customer_id: 7, phone10: '9876543210', code_hash: lib.hashCode(code, over.phone10 ?? '9876543210'),
    expires_at: new Date(Date.now() + 600_000).toISOString(), consumed_at: null, attempts: 0, created_at: new Date().toISOString(), ...over }
  db.rows.push(r); return r
}

beforeEach(async () => {
  vi.resetModules()
  process.env.WHATSAPP_VERIFY_NUMBER = NUMBER
  process.env.WHATSAPP_APP_SECRET = SECRET
  process.env.WHATSAPP_VERIFY_TOKEN = TOKEN
  db.rows = []; db.claims = []; db.claimResult = { ok: true, reason: 'claimed' }; db.claimThrows = false; nextId = 1
  lib = await import('@/lib/server/phoneVerification')
  lib._resetPhoneVerificationFlagCache()
  route = await import('@/app/api/webhooks/whatsapp/route')
})

describe('GET handshake', () => {
  const get = (qs: string) => route.GET(new NextRequest('https://pahadiroots.com/api/webhooks/whatsapp?' + qs))
  it('echoes hub.challenge as text for the right token', async () => {
    const res = await get(`hub.mode=subscribe&hub.verify_token=${TOKEN}&hub.challenge=1158201444`)
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('1158201444')
  })
  it('403 for a wrong token or mode', async () => {
    expect((await get('hub.mode=subscribe&hub.verify_token=nope&hub.challenge=1')).status).toBe(403)
    expect((await get(`hub.mode=unsubscribe&hub.verify_token=${TOKEN}&hub.challenge=1`)).status).toBe(403)
    expect((await get(`hub.mode=subscribe&hub.challenge=1`)).status).toBe(403)
  })
  it('404 when the env is not configured', async () => {
    delete process.env.WHATSAPP_VERIFY_TOKEN
    expect((await get(`hub.mode=subscribe&hub.verify_token=${TOKEN}&hub.challenge=1`)).status).toBe(404)
  })
})

describe('POST signature', () => {
  it('rejects missing, malformed and wrong signatures with 401 and does nothing', async () => {
    seed()
    const raw = payload('919876543210', 'VERIFY 482913')
    expect((await post(raw, null)).status).toBe(401)
    expect((await post(raw, 'sha256=zz')).status).toBe(401)
    expect((await post(raw, sign(raw, 'other-secret'))).status).toBe(401)
    expect((await post(raw, sign(raw).replace('sha256=', ''))).status).toBe(401)
    expect(db.claims).toHaveLength(0)
    expect((db.rows[0] as Row).consumed_at).toBeNull()
  })
  it('a signature over a different body is rejected (tamper)', async () => {
    const raw = payload('919876543210', 'VERIFY 482913')
    expect((await post(payload('919876543210', 'VERIFY 000000'), sign(raw))).status).toBe(401)
  })
  it('404 when the feature is off (env missing)', async () => {
    delete process.env.WHATSAPP_APP_SECRET
    const raw = payload('919876543210', 'VERIFY 482913')
    expect((await post(raw)).status).toBe(404)
  })
})

describe('POST verification', () => {
  it('correct code from the right number claims the phone, consumes the row, answers 200 with an empty body', async () => {
    const v = seed()
    const res = await post(payload('919876543210', 'VERIFY 482913'))
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('')
    expect(db.claims).toEqual([{ p_customer_id: 7, p_phone10: '9876543210' }])
    expect(v.consumed_at).not.toBeNull()
  })
  it('is case/space tolerant', async () => {
    seed()
    await post(payload('919876543210', '  verify   482913 \n'))
    expect(db.claims).toHaveLength(1)
  })
  it('the same code sent from a DIFFERENT number does nothing', async () => {
    const v = seed()
    await post(payload('919811111111', 'VERIFY 482913'))
    expect(db.claims).toHaveLength(0)
    expect(v.consumed_at).toBeNull()
    expect(v.attempts).toBe(0)
  })
  it('a foreign number ending in the same ten digits is not proof', async () => {
    seed()
    await post(payload('449876543210', 'VERIFY 482913'))
    expect(db.claims).toHaveLength(0)
  })
  it('wrong code from the right number counts an attempt, then burns the verification at 5', async () => {
    const v = seed()
    for (let i = 1; i <= 4; i++) { await post(payload('919876543210', 'VERIFY 111111')); expect(v.attempts).toBe(i); expect(v.consumed_at).toBeNull() }
    await post(payload('919876543210', 'VERIFY 111111'))
    expect(v.attempts).toBe(5)
    expect(v.consumed_at).not.toBeNull()
    await post(payload('919876543210', 'VERIFY 482913'))      // even the right code is dead now
    expect(db.claims).toHaveLength(0)
  })
  it('an expired code does not verify', async () => {
    seed({ expires_at: new Date(Date.now() - 1000).toISOString() })
    await post(payload('919876543210', 'VERIFY 482913'))
    expect(db.claims).toHaveLength(0)
  })
  it('a replay of the same webhook claims only once', async () => {
    seed()
    const raw = payload('919876543210', 'VERIFY 482913')
    await post(raw)
    const again = await post(raw)
    expect(again.status).toBe(200)
    expect(db.claims).toHaveLength(1)
  })
  it('ignores messages that are not a VERIFY command, non-text types, and malformed bodies', async () => {
    const v = seed()
    await post(payload('919876543210', 'hello'))
    await post(payload('919876543210', 'VERIFY 12345'))
    await post(payload('919876543210', 'VERIFY 482913', 'image'))
    expect(db.claims).toHaveLength(0)
    expect(v.attempts).toBe(0)
    expect((await post('not json', sign('not json'))).status).toBe(200)
    expect((await post(JSON.stringify({ entry: [] }))).status).toBe(200)
  })
  it('a refused claim (verified by someone else) still answers 200', async () => {
    seed(); db.claimResult = { ok: false, reason: 'phone_verified_by_other' }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect((await post(payload('919876543210', 'VERIFY 482913'))).status).toBe(200)
    warn.mockRestore()
  })
  it('a transient claim failure hands the code back, still answers 200, and logs no phone or code', async () => {
    const v = seed(); db.claimThrows = true
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect((await post(payload('919876543210', 'VERIFY 482913'))).status).toBe(200)
    expect(v.consumed_at).toBeNull()
    const logged = JSON.stringify(err.mock.calls)
    expect(logged).not.toContain('9876543210')
    expect(logged).not.toContain('482913')
    err.mockRestore()
  })
})
