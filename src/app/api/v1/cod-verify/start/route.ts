// POST /api/v1/cod-verify/start — send a 6-digit code to confirm a RISKY cash-on-delivery order (Nov 2026).
// Body: { phone, email }. The code goes to the e-mail (WhatsApp once the Meta number is live) and is valid 10 minutes.
// Rate-limited per phone (3 / 15 min) and per network (10 / hour). Never reveals whether the phone or e-mail is known.
import { NextRequest } from 'next/server'
import { checkCsrf, sbAdmin } from '@/lib/api/serverUtils'
import { checkRateLimitKvStrict, RATE_LIMIT_UNAVAILABLE_RETRY_AFTER_SEC } from '@/lib/api/rateLimitKv'
import { createHash } from 'node:crypto'
import { clientIpKey } from '@/lib/api/clientIp'
import { privateJson } from '@/lib/api/privateJson'
import { sendTransactionalEmail } from '@/lib/server/email'
import { brandedEmail } from '@/lib/server/emailShell'
import { COD_CODE_TTL_MS, codVerificationEmailHtml, hashCodCode, newCodCode } from '@/lib/server/codVerification'
import { maskEmail, phone10, startSchema } from '@/lib/server/codVerifyRequest'
import { captureError } from '@/lib/logger'

export async function POST(req: NextRequest) {
  const csrf = checkCsrf(req)
  if (csrf) return csrf

  let body: unknown
  try { body = await req.json() } catch { return privateJson({ error: 'Invalid request' }, { status: 400 }) }
  const parsed = startSchema.safeParse(body)
  const phone = parsed.success ? phone10(parsed.data.phone) : null
  if (!parsed.success || !phone) return privateJson({ error: 'Please enter a valid mobile number and e-mail address.' }, { status: 400 })
  const email = parsed.data.email.toLowerCase()

  const ip = clientIpKey(req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip'))
  // R4A-5 (Nov 2026): also capped per RECIPIENT (phones are free to rotate, so the per-phone cap alone let anyone flood one
  // inbox), and the limiter fails CLOSED — every code is an e-mail (soon a paid WhatsApp message) sent from our domain.
  const mailKey = createHash('sha256').update(email).digest('hex').slice(0, 32)
  const checks = [
    [`mw:rl:codverify:ip:${ip}`, 10, 3600], [`mw:rl:codverify:phone:${phone}`, 3, 900],
    [`mw:rl:codverify:email:${mailKey}`, 3, 900], [`mw:rl:codverify:email_day:${mailKey}`, 10, 86400],
  ] as const
  for (const [k, limit, win] of checks) {
    const r = await checkRateLimitKvStrict(k, limit, win)
    if (r === 'unavailable') return privateJson({ error: 'Could not send the code right now. Please try again in a moment, or pay online.' }, { status: 503, headers: { 'Retry-After': String(RATE_LIMIT_UNAVAILABLE_RETRY_AFTER_SEC) } })
    if (r === 'blocked') return privateJson({ error: 'Too many codes requested. Please wait a few minutes and try again.' }, { status: 429, headers: { 'Retry-After': '900' } })
  }

  const code = newCodCode()
  try {
    await sbAdmin('POST', '/rest/v1/cod_verifications', {
      phone10: phone, email, channel: 'email', code_hash: hashCodCode(code, phone, email),
      expires_at: new Date(Date.now() + COD_CODE_TTL_MS).toISOString(),
    }, 'return=minimal')
  } catch (e) {
    captureError(e, { action: 'cod_verify.start.insert', alert: true })
    return privateJson({ error: 'Could not send the code right now. Please try again, or pay online.' }, { status: 503 })
  }

  const mail = codVerificationEmailHtml(code)
  const sent = await sendTransactionalEmail({
    type: 'cod_verification', to: email, subject: mail.subject,
    html: brandedEmail({ heading: mail.heading, bodyHtml: mail.bodyHtml }),
    context: { purpose: 'cod_verification' },
  })
  if (!sent.sent && !sent.deadLettered) {
    return privateJson({ error: 'Could not send the code right now. Please try again, or pay online.' }, { status: 503 })
  }
  return privateJson({ sent: true, channel: 'email', to: maskEmail(email), expires_in: COD_CODE_TTL_MS / 1000 })
}
