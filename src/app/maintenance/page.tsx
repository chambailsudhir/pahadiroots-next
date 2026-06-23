import Link from 'next/link'

export default function MaintenancePage() {
  return (
    <div className="min-h-screen bg-forest-950 flex items-center justify-center px-4">
      <div className="text-center max-w-md">
        <div className="text-6xl mb-6">🏔️</div>
        <h1 className="text-2xl font-bold text-white mb-3">We&apos;ll be back soon</h1>
        <p className="text-forest-400 text-sm mb-6">
          Pahadi Roots is currently undergoing maintenance. We&apos;re working hard to bring you the freshest mountain products.
        </p>
        <div className="text-forest-500 text-xs">
          For urgent queries, WhatsApp us at +91 98999 84895
        </div>
      </div>
    </div>
  )
}
