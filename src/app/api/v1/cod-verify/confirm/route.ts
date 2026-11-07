// POST /api/v1/cod-verify/confirm — check the 6-digit code and hand back a 30-minute token for this phone (Nov 2026).
// Body: { phone, email, code }. At most COD_MAX_ATTEMPTS wrong codes per sent code; the token goes with the COD order.
import { NextRequest } from 'next/server'
import { checkCsrf, sbAdmin } from '@/lib/api/serverUtils'
import { checkRateLimitKv } from '@/lib/api/rateLimitKv'
import { clientIpKey } from '@/lib/api/clientIp'
import { privateJson } from '@/lib/api/privateJson'
import { COD_MAX_ATTEMPTS, hashCodCode, hashCodToken, newCodToken, sameHash } from '@/lib/server/codVerification'
import { confirmSchema, phone10 } from '@/lib/server/codVerifyRequest'
import { captureError } from '@/lib/logger'

interface Row { id: number; code_hash: string; attempts: number; expires_at: string; verified_at: string | null }

export async function POST(req: NextRequest) {
  const csrf = checkCsrf(req)
  if (csrf) return csrf

  let body: unknown
  try { body = await req.json() } catch { return privateJson({ error: 'Invalid request' }, { status: 400 }) }
  const parsed = confirmSchema.safeParse(body)
  const phone = parsed.success ? phone10(parsed.data.phone) : null
  if (!parsed.success || !phone) return privateJson({ error: 'Please enter the 6-digit code from the e-mail.' }, { status: 400 })
  const email = parsed.data.email.toLowerCase()

  const ip = clientIpKey(req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip'))
  // R4A-4: also per phone, so a distributed client cannot try codes from many addresses.
  if (!await checkRateLimitKv(`mw:rl:codconfirm:ip:${ip}`, 30, 3600) || !await checkRateLimitKv(`mw:rl:codconfirm:phone:${phone}`, 10, 900)) {
    return privateJson({ error: 'Too many attempts. Please wait a few minutes.' }, { status: 429, headers: { 'Retry-After': '900' } })
  }

  try {
    const rows = await sbAdmin('GET',
      `/rest/v1/cod_verifications?phone10=eq.${phone}&email=eq.${encodeURIComponent(email)}&verified_at=is.null` +
      `&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&select=id,code_hash,attempts,expires_at,verified_at&order=created_at.desc&limit=1`,
    ) as Row[] | null
    const row = Array.isArray(rows) ? rows[0] : undefined
    if (!row) return privateJson({ error: 'This code has expired. Please request a new one.', code: 'CODE_EXPIRED' }, { status: 400 })
    if (row.attempts >= COD_MAX_ATTEMPTS) {
      return privateJson({ error: 'Too many wrong codes. Please request a new one.', code: 'CODE_LOCKED' }, { status: 429 })
    }
    // R4A-4 (Nov 2026): every guess must first WIN the counter increment (compare-and-set on the value just read). The old
    // code compared first and incremented after, so N parallel guesses that all read the same count were all checked. A
    // guess that loses the race is refused without being compared, so at most COD_MAX_ATTEMPTS guesses are ever checked.
    const counted = await sbAdmin('PATCH', `/rest/v1/cod_verifications?id=eq.${row.id}&attempts=eq.${row.attempts}&verified_at=is.null`,
      { attempts: row.attempts + 1 }) as unknown[] | null
    if (!Array.isArray(counted) || counted.length === 0) {
      return privateJson({ error: 'Please wait a moment and try the code again.', code: 'CODE_BUSY' }, { status: 429, headers: { 'Retry-After': '2' } })
    }
    if (!sameHash(row.code_hash, hashCodCode(parsed.data.code, phone, email))) {
      const left = Math.max(0, COD_MAX_ATTEMPTS - row.attempts - 1)
      return privateJson({ error: left > 0 ? `That code is not right. ${left} attempt${left === 1 ? '' : 's'} left.` : 'Too many wrong codes. Please request a new one.', code: 'CODE_WRONG', attempts_left: left }, { status: 400 })
    }
    const token = newCodToken()
    const won = await sbAdmin('PATCH', `/rest/v1/cod_verifications?id=eq.${row.id}&verified_at=is.null`,
      { verified_at: new Date().toISOString(), token_hash: hashCodToken(token) }) as unknown[] | null
    if (!Array.isArray(won) || won.length === 0) return privateJson({ error: 'This code was already used. Please request a new one.', code: 'CODE_EXPIRED' }, { status: 400 })
    return privateJson({ verified: true, token })
  } catch (e) {
    captureError(e, { action: 'cod_verify.confirm', alert: true })
    return privateJson({ error: 'Could not check the code right now. Please try again.' }, { status: 503 })
  }
}
