import { getFreshSiteSettings } from '@/lib/getSiteSettings'
import { CheckoutClient } from './CheckoutClient'

// Checkout must never serve a cached page: payment-mode toggles (COD / Razorpay),
// COD charge, shipping and min-order values come from admin Settings and have to
// be live the moment they are saved. force-dynamic skips the 300s route cache
// inherited from the root layout; getFreshSiteSettings() skips the settings
// Data Cache for the payment-critical keys.
export const dynamic = 'force-dynamic'

export default async function CheckoutPage() {
  const settings = await getFreshSiteSettings()
  return <CheckoutClient settings={settings} />
}
