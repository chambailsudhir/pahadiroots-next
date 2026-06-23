import { getSiteSettings } from '@/lib/getSiteSettings'
import { CheckoutClient } from './CheckoutClient'

// Fetches settings server-side (revalidated every 5 min via root layout config).
// This eliminates the duplicate SWR client-side fetch (P3 audit finding).
export default async function CheckoutPage() {
  const settings = await getSiteSettings()
  return <CheckoutClient settings={settings} />
}
