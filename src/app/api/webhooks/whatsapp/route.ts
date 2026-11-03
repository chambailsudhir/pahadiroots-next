import { NextRequest, NextResponse } from 'next/server'
import { sbAdmin } from '@/lib/api/serverUtils'
import {
  isPhoneVerificationEnabled, phoneVerifyEnv, notFound, hashCode, safeEqual, verifyMetaSignature, MAX_ATTEMPTS,
} from '@/lib/server/phoneVerification'

/**
 * WhatsApp Cloud API webhook (Meta). Server-to-server, so it is NOT behind checkCsrf; it is authenticated by Meta's HMAC
 * signature instead. /api/webhooks/* is not matched by the /api/v1 rate-limit branch of src/proxy.ts, is exempt from the
 * maintenance gate (/api) and sets no HTML, so the CSP does not apply.
 *
 * Inbound only: we never send a message back (no outbound cost, nothing to leak). Always 200 for an authentic POST so Meta
 * does not retry; replays are harmless because a code is consumed atomically.
 */

const VERIFY_RE = /^\s*VERIFY\s+(\d{6})\s*$/i

interface WaMessage { from?: unknown; type?: unknown; text?: { body?: unknown } }
interface WaPayload { entry?: Array<{ changes?: Array<{ value?: { messages?: WaMessage[] } }> }> }

const EMPTY_OK = () => new NextResponse(null, { status: 200 })

// GET: Meta's one-time subscription handshake.
export async function GET(req: NextRequest) {
  const env = phoneVerifyEnv()
  if (!env || !(await isPhoneVerificationEnabled())) return notFound()
  const p = req.nextUrl.searchParams
  const token = p.get('hub.verify_token') ?? ''
  const challenge = p.get('hub.challenge')
  if (p.get('hub.mode') === 'subscribe' && challenge !== null && safeEqual(token, env.verifyToken)) {
    return new NextResponse(challenge, { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
  }
  return new NextResponse('Forbidden', { status: 403 })
}

// POST: message notifications.
export async function POST(req: NextRequest) {
  const env = phoneVerifyEnv()
  if (!env || !(await isPhoneVerificationEnabled())) return notFound()

  // Signature over the RAW body, before any parsing.
  const raw = await req.text()
  if (!verifyMetaSignature(raw, req.headers.get('x-hub-signature-256'), env.appSecret)) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  let payload: WaPayload
  try { payload = JSON.parse(raw) as WaPayload } catch { return EMPTY_OK() }

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      for (const msg of change.value?.messages ?? []) {
        if (msg?.type !== 'text' || typeof msg.from !== 'string' || typeof msg.text?.body !== 'string') continue
        try {
          await handleVerifyMessage(msg.from, msg.text.body)
        } catch (e) {
          // No phone number, code or body in the log line.
          console.error('[whatsapp webhook] processing failed:', (e as { message?: string })?.message?.slice(0, 120) ?? 'error')
        }
      }
    }
  }
  return EMPTY_OK()
}

interface OpenVerification { id: number; customer_id: number; code_hash: string; attempts: number }

async function handleVerifyMessage(from: string, body: string): Promise<void> {
  const m = VERIFY_RE.exec(body)
  if (!m) return
  const code = m[1]

  // Indian mobiles only: country code 91 + 10 digits starting 6-9. A foreign number that merely ends in the same ten digits
  // must never count as proof.
  const digits = from.replace(/\D/g, '')
  if (!/^91[6-9]\d{9}$/.test(digits)) return
  const phone10 = digits.slice(-10)

  const nowIso = new Date().toISOString()
  // Look the code up BY ITS HASH (bound to this sender's number) instead of scanning the newest 5 open rows: a squatter holding open codes
  // for the victim's number from several accounts could push the victim's own row out of a "newest 5" window and make their correct
  // message never match (round-5 audit).
  const expected = hashCode(code, phone10)
  const matches: OpenVerification[] = await sbAdmin('GET',
    `/rest/v1/phone_verifications?phone10=eq.${phone10}&consumed_at=is.null&expires_at=gt.${encodeURIComponent(nowIso)}`
    + `&code_hash=eq.${encodeURIComponent(expected)}&order=created_at.desc&limit=3&select=id,customer_id,code_hash,attempts`) ?? []
  const hit = Array.isArray(matches) ? matches.find(v => v.attempts < MAX_ATTEMPTS && safeEqual(v.code_hash, expected)) : undefined

  if (!hit) {
    // Wrong code from a number that has a pending verification: count it against the newest one; burn it at the cap.
    const open: OpenVerification[] = await sbAdmin('GET',
      `/rest/v1/phone_verifications?phone10=eq.${phone10}&consumed_at=is.null&expires_at=gt.${encodeURIComponent(nowIso)}`
      + `&order=created_at.desc&limit=1&select=id,customer_id,code_hash,attempts`) ?? []
    if (!Array.isArray(open) || open.length === 0) return   // nothing pending for this sender (or a replay): ignore
    const v = open[0]
    const next = v.attempts + 1
    await sbAdmin('PATCH',
      `/rest/v1/phone_verifications?id=eq.${v.id}&consumed_at=is.null&attempts=eq.${v.attempts}`,
      next >= MAX_ATTEMPTS ? { attempts: next, consumed_at: nowIso } : { attempts: next },
      'return=minimal')
    return
  }

  // Consume first, atomically: a replayed webhook (or two racing deliveries) finds nothing to consume and stops here.
  const consumed = await sbAdmin('PATCH',
    `/rest/v1/phone_verifications?id=eq.${hit.id}&consumed_at=is.null`, { consumed_at: nowIso })
  if (!Array.isArray(consumed) || consumed.length === 0) return

  try {
    const res = await sbAdmin('POST', '/rest/v1/rpc/claim_verified_phone', { p_customer_id: hit.customer_id, p_phone10: phone10 })
    if (!res || res.ok !== true) {
      console.warn('[whatsapp webhook] claim refused:', res?.reason ?? 'unknown')
    }
  } catch (e) {
    // Transient failure: give the code back so the customer's next send (or Meta's retry) can succeed.
    await sbAdmin('PATCH', `/rest/v1/phone_verifications?id=eq.${hit.id}`, { consumed_at: null }, 'return=minimal').catch(() => {})
    throw e
  }
}
