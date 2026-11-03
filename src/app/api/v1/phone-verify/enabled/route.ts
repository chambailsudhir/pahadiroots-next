import { NextResponse } from 'next/server'
import { isPhoneVerificationEnabled } from '@/lib/server/phoneVerification'

// GET /api/v1/phone-verify/enabled -> { enabled } . Public and secret-free: lets the account page decide whether to show the
// "Verify with WhatsApp" button. Always 200 (unlike /start and /status, which answer 404 when the feature is off).
export async function GET() {
  const enabled = await isPhoneVerificationEnabled()
  return NextResponse.json({ enabled }, { headers: { 'Cache-Control': 'no-store' } })
}
