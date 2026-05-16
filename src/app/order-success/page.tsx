'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Suspense } from 'react'

function SuccessContent() {
  const params      = useSearchParams()
  const orderNumber = params.get('id') || ''
  const total       = params.get('total') || ''
  const method      = params.get('method') || ''
  const isCOD       = method === 'cod'

  return (
    <div className="min-h-[80vh] flex items-center justify-center px-4">
      <div className="max-w-md w-full text-center">
        <div className="w-20 h-20 bg-forest-100 rounded-full flex items-center justify-center mx-auto mb-6">
          <svg className="w-10 h-10 text-forest-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
          </svg>
        </div>

        <h1 className="text-2xl font-bold text-stone-900 mb-2">Order Placed! 🎉</h1>
        <p className="text-stone-500 mb-1">{isCOD ? 'WhatsApp pe confirm karein — order process ho raha hai.' : 'Your order has been confirmed.'}</p>
        {orderNumber && (
          <p className="text-sm font-semibold text-stone-700 mb-2">
            Order #{orderNumber}
          </p>
        )}
        {total && (
          <p className="text-sm text-stone-500 mb-6">
            Total Paid: ₹{total}
          </p>
        )}

        <div className="bg-stone-50 rounded-2xl p-5 text-left mb-7 space-y-3">
          {[
            { icon: '📦', title: 'Processing', desc: 'Your order is being packed' },
            { icon: '🚚', title: 'Delivery',   desc: 'Expected in 3–5 business days' },
            { icon: '💬', title: 'Updates',    desc: 'We\'ll WhatsApp you tracking details' },
          ].map(item => (
            <div key={item.title} className="flex items-center gap-3">
              <span className="text-xl">{item.icon}</span>
              <div>
                <div className="text-xs font-bold text-stone-700">{item.title}</div>
                <div className="text-xs text-stone-400">{item.desc}</div>
              </div>
            </div>
          ))}
        </div>

        <div className="flex gap-3">
          <Link href="/products" className="flex-1 py-3 rounded-xl border-2 border-forest-600 text-forest-700 font-bold text-sm hover:bg-forest-50 transition-colors text-center">
            Continue Shopping
          </Link>
          {orderNumber && (
            <Link href={`/track?id=${orderNumber}`} className="flex-1 py-3 rounded-xl bg-forest-700 hover:bg-forest-800 text-white font-bold text-sm transition-colors text-center">
              Track Order
            </Link>
          )}
        </div>
      </div>
    </div>
  )
}

export default function OrderSuccessPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><div className="skeleton w-80 h-96 rounded-2xl" /></div>}>
      <SuccessContent />
    </Suspense>
  )
}
