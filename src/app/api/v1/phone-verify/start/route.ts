import { randomInt } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { fail, sbAdmin, checkCsrf, checkRateLimitShared } from '@/lib/api/serverUtils'
import {
  isPhoneVerificationEnabled, phoneVerifyEnv, notFound, authCustomer, authedJson,
  hashCode, MOBILE_RE, CODE_TTL_SECONDS,
} from '@/lib/server/phoneVerification'

// POST /api/v1/phone-verify/start  { phone }  ->  { whatsappUrl, code, expiresInSeconds }
// The customer opens whatsappUrl; WhatsApp pre-fills "VERIFY <code>" to the shop number. The Meta webhook does the rest.
export async function POST(req: NextRequest) {
  if (!(await isPhoneVerificationEnabled())) return notFound()
  const env = phoneVerifyEnv()!

  const csrf = checkCsrf(req)
  if (csrf) return csrf

  const a = await authCustomer(req)
  if (a instanceof NextResponse) return a
  const customerId = a.profile.id

  // 5 codes per hour per customer, shared across instances (each code also invalidates the previous one).
  if (!(await checkRateLimitShared(`phone_verify_start:${customerId}`, 5, 60 * 60_000))) {
    return NextResponse.json(
      { error: 'Too many verification attempts — please try again in an hour.' },
      { status: 429, headers: { 'Retry-After': '3600' } },
    )
  }

  let body: { phone?: unknown } = {}
  try { body = await req.json() } catch { return fail(400, 'Invalid JSON') }
  const phone = typeof body.phone === 'string' ? body.phone.replace(/\D/g, '').slice(-10) : ''
  if (!MOBILE_RE.test(phone)) return fail(400, 'Enter a valid 10-digit mobile number (starts with 6–9)')

  try {
    const now = new Date()
    // One open code per customer: burn any older ones.
    await sbAdmin('PATCH', `/rest/v1/phone_verifications?customer_id=eq.${customerId}&consumed_at=is.null`,
      { consumed_at: now.toISOString() }, 'return=minimal')

    const code = String(randomInt(0, 1_000_000)).padStart(6, '0')
    await sbAdmin('POST', '/rest/v1/phone_verifications', {
      customer_id: customerId,
      phone10:     phone,
      code_hash:   hashCode(code, phone),
      expires_at:  new Date(now.getTime() + CODE_TTL_SECONDS * 1000).toISOString(),
    }, 'return=minimal')

    return authedJson({
      whatsappUrl:      `https://wa.me/${env.number}?text=${encodeURIComponent('VERIFY ' + code)}`,
      code,
      expiresInSeconds: CODE_TTL_SECONDS,
    }, a)
  } catch (e) {
    console.error('[phone-verify/start]', (e as { message?: string })?.message ?? 'error')
    return fail(500, 'Could not start verification')
  }
}
