import { describe, it, expect, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import { signEvidenceLinks, verifyEvidencePaths, evidenceReadLinks, isLegacyEvidenceLink, EVIDENCE_BUCKET, EVIDENCE_LINK_TTL_SECONDS } from '@/lib/server/returnEvidence'

const env = { url: 'https://proj.supabase.co', serviceKey: 'svc' }
const okSign = (path: string) => ({ ok: true, status: 200, json: async () => ({ signedURL: `/object/sign/${EVIDENCE_BUCKET}/${path}?token=abc` }) }) as unknown as Response
const signer = () => vi.fn(async (u: string | URL | Request) => okSign(String(u).split(`/sign/${EVIDENCE_BUCKET}/`)[1]))

describe('signEvidenceLinks (private return-evidence bucket)', () => {
  // VERIFY ROUND (L-8): links used to live for a YEAR; now one look's worth, minted on every read.
  it('signs each object for 15 minutes with the service key and returns full storage links', async () => {
    const f = signer()
    const links = await signEvidenceLinks(['returns/5/1-a.jpg', 'returns/5/2-b.png'], env, f as unknown as typeof fetch)
    expect(links).toEqual([
      `https://proj.supabase.co/storage/v1/object/sign/${EVIDENCE_BUCKET}/returns/5/1-a.jpg?token=abc`,
      `https://proj.supabase.co/storage/v1/object/sign/${EVIDENCE_BUCKET}/returns/5/2-b.png?token=abc`,
    ])
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(`https://proj.supabase.co/storage/v1/object/sign/${EVIDENCE_BUCKET}/returns/5/1-a.jpg`)
    expect(EVIDENCE_LINK_TTL_SECONDS).toBe(15 * 60)
    expect(JSON.parse(init.body as string)).toEqual({ expiresIn: 15 * 60 })
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer svc')
  })
  it('drops a missing object, a storage error, a timeout, and a response that points somewhere else', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({}) })                                            // missing object
      .mockRejectedValueOnce(new Error('timeout'))                                                                           // network
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ signedURL: 'https://evil.example/x?token=1' }) })  // wrong target
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ signedURL: `/object/sign/${EVIDENCE_BUCKET}/returns/5/OTHER.jpg?token=1` }) })  // different object
      .mockResolvedValueOnce(okSign('returns/5/5-ok.jpg'))
    const links = await signEvidenceLinks(['returns/5/1-a.jpg', 'returns/5/2-b.jpg', 'returns/5/3-c.jpg', 'returns/5/4-d.jpg', 'returns/5/5-ok.jpg'], env, f as unknown as typeof fetch)
    expect(links).toEqual([`https://proj.supabase.co/storage/v1/object/sign/${EVIDENCE_BUCKET}/returns/5/5-ok.jpg?token=abc`])
  })
  it('an empty list does no work', async () => {
    const f = vi.fn()
    expect(await signEvidenceLinks([], env, f as unknown as typeof fetch)).toEqual([])
    expect(f).not.toHaveBeenCalled()
  })
})

describe('verifyEvidencePaths — submission time stores bare object paths, never links (L-8)', () => {
  it('keeps only the paths whose object exists (proven by signing) and returns the PATHS, not the signed links', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(okSign('returns/5/1-a.jpg'))
      .mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({}) })   // missing object
      .mockResolvedValueOnce(okSign('returns/5/3-c.jpg'))
    const kept = await verifyEvidencePaths(['returns/5/1-a.jpg', 'returns/5/2-missing.jpg', 'returns/5/3-c.jpg'], env, f as unknown as typeof fetch)
    expect(kept).toEqual(['returns/5/1-a.jpg', 'returns/5/3-c.jpg'])
    for (const k of kept) expect(k).not.toMatch(/token=|https:/)
  })
})

describe('evidenceReadLinks — read time mints a fresh short-lived link per view; legacy rows keep working', () => {
  it('signs stored bare paths for 15 minutes', async () => {
    const f = signer()
    const links = await evidenceReadLinks(['returns/5/1-a.jpg'], env, f as unknown as typeof fetch)
    expect(links).toEqual([`https://proj.supabase.co/storage/v1/object/sign/${EVIDENCE_BUCKET}/returns/5/1-a.jpg?token=abc`])
    expect(JSON.parse((f.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)).toEqual({ expiresIn: 15 * 60 })
  })
  it('passes a legacy full signed link (row written before L-8) through unchanged without calling storage', async () => {
    const f = vi.fn()
    const legacy = `https://proj.supabase.co/storage/v1/object/sign/${EVIDENCE_BUCKET}/returns/4/1-old.jpg?token=year-long`
    expect(await evidenceReadLinks([legacy], env, f as unknown as typeof fetch)).toEqual([legacy])
    expect(f).not.toHaveBeenCalled()
    expect(isLegacyEvidenceLink(legacy)).toBe(true)
    expect(isLegacyEvidenceLink('returns/4/1-old.jpg')).toBe(false)
  })
  it('mixes both forms in stored order and drops junk (null column, non-strings, traversal, unsignable)', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(okSign('returns/5/1-a.jpg'))
      .mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({}) })
    const legacy = 'https://proj.supabase.co/storage/v1/object/sign/x?token=1'
    const links = await evidenceReadLinks(['returns/5/1-a.jpg', legacy, 42, '', '../etc/passwd', 'returns/5/9-gone.jpg'], env, f as unknown as typeof fetch)
    expect(links).toEqual([`https://proj.supabase.co/storage/v1/object/sign/${EVIDENCE_BUCKET}/returns/5/1-a.jpg?token=abc`, legacy])
    expect(f).toHaveBeenCalledTimes(2)
    expect(await evidenceReadLinks(null, env, f as unknown as typeof fetch)).toEqual([])
    expect(await evidenceReadLinks('returns/5/1-a.jpg', env, f as unknown as typeof fetch)).toEqual([])
  })
})
