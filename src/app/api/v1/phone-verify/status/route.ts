import { NextRequest, NextResponse } from 'next/server'
import { fail, sbAdmin } from '@/lib/api/serverUtils'
import { isPhoneVerificationEnabled, notFound, authCustomer, authedJson } from '@/lib/server/phoneVerification'

// GET /api/v1/phone-verify/status -> { verified, phone, pending }   (404 when the feature is off)
export async function GET(req: NextRequest) {
  if (!(await isPhoneVerificationEnabled())) return notFound()

  const a = await authCustomer(req)
  if (a instanceof NextResponse) return a

  try {
    const rows = await sbAdmin('GET',
      `/rest/v1/phone_verifications?customer_id=eq.${a.profile.id}&consumed_at=is.null&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&select=id&limit=1`)
    const phone = typeof a.profile.phone === 'string' && a.profile.phone ? a.profile.phone : null
    return authedJson({
      verified: !!phone && !!a.profile.phone_verified_at,
      phone,
      pending:  Array.isArray(rows) && rows.length > 0,
    }, a)
  } catch (e) {
    console.error('[phone-verify/status]', (e as { message?: string })?.message ?? 'error')
    return fail(500, 'Could not read verification status')
  }
}
