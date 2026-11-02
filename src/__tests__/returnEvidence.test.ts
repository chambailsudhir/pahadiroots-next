import { describe, it, expect, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import { signEvidenceLinks, EVIDENCE_BUCKET, EVIDENCE_LINK_TTL_SECONDS } from '@/lib/server/returnEvidence'

const env = { url: 'https://proj.supabase.co', serviceKey: 'svc' }
const okSign = (path: string) => ({ ok: true, status: 200, json: async () => ({ signedURL: `/object/sign/${EVIDENCE_BUCKET}/${path}?token=abc` }) }) as unknown as Response

describe('signEvidenceLinks (private return-evidence bucket)', () => {
  it('signs each object for a year with the service key and returns full storage links', async () => {
    const f = vi.fn(async (u: string | URL | Request) => okSign(String(u).split(`/sign/${EVIDENCE_BUCKET}/`)[1]))
    const links = await signEvidenceLinks(['returns/5/1-a.jpg', 'returns/5/2-b.png'], env, f as unknown as typeof fetch)
    expect(links).toEqual([
      `https://proj.supabase.co/storage/v1/object/sign/${EVIDENCE_BUCKET}/returns/5/1-a.jpg?token=abc`,
      `https://proj.supabase.co/storage/v1/object/sign/${EVIDENCE_BUCKET}/returns/5/2-b.png?token=abc`,
    ])
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(`https://proj.supabase.co/storage/v1/object/sign/${EVIDENCE_BUCKET}/returns/5/1-a.jpg`)
    expect(JSON.parse(init.body as string)).toEqual({ expiresIn: EVIDENCE_LINK_TTL_SECONDS })
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
