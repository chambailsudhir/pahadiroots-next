import { getSiteSettings } from '@/lib/getSiteSettings'

// BUG FIX: was static hardcoded copy, ignoring settings.maintenance_message —
// the one field an admin can actually edit for this exact page — so the
// admin-configured message had no effect even after the store-closed gate
// (see proxy.ts) was wired up to route here.
export default async function MaintenancePage() {
  const settings = await getSiteSettings()
  return (
    <div className="min-h-screen bg-forest-950 flex items-center justify-center px-4">
      <div className="text-center max-w-md">
        <div className="text-6xl mb-6">🏔️</div>
        <h1 className="text-2xl font-bold text-white mb-3">We&apos;ll be back soon</h1>
        <p className="text-forest-400 text-sm mb-6">
          {settings.maintenance_message || "Pahadi Roots is currently undergoing maintenance. We're working hard to bring you the freshest mountain products."}
        </p>
        <div className="text-forest-500 text-xs">
          For urgent queries, WhatsApp us at {settings.whatsapp_number ? `+${settings.whatsapp_number}` : '+91 98999 84895'}
        </div>
      </div>
    </div>
  )
}
