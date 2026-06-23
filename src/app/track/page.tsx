'use client'

import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { formatDate } from '@/lib/utils'
import type { OrderStatus } from '@/types'

const STATUS_STEPS: { status: OrderStatus; label: string; icon: string }[] = [
  { status: 'confirmed',        label: 'Order Confirmed',    icon: '✅' },
  { status: 'packed',           label: 'Packed',             icon: '📦' },
  { status: 'shipped',          label: 'Shipped',            icon: '🚛' },
  { status: 'out_for_delivery', label: 'Out for Delivery',   icon: '🏍️' },
  { status: 'delivered',        label: 'Delivered',          icon: '🎉' },
]

const STATUS_INDEX: Partial<Record<OrderStatus, number>> = {
  pending_payment:  -1,
  confirmed:         0,
  packed:            1,
  shipped:           2,
  out_for_delivery:  3,
  delivered:         4,
}

interface TrackResult {
  order_number: string
  order_status: string
  payment_method: string
  created_at:   string
  total_amount: number
}

export default function TrackPage() {
  const [orderNum, setOrderNum] = useState('')
  const [phone,    setPhone]    = useState('')
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState('')
  const [result,   setResult]   = useState<TrackResult | null>(null)

  async function handleTrack() {
    if (!orderNum.trim() || !phone.trim()) {
      setError('Please enter both order number and phone')
      return
    }
    setLoading(true)
    setError('')
    setResult(null)

    try {
      // Public query — returns only safe fields, no personal data
      const { data, error: qErr } = await supabase
        .from('orders')
        .select('order_number, order_status, payment_method, created_at, total_amount')
        .eq('order_number', orderNum.trim().toUpperCase())
        .eq('customer_phone', phone.replace(/\D/g, '').slice(-10))
        .single()

      if (qErr || !data) {
        setError('Order not found. Check your order number and phone number.')
        return
      }
      setResult(data as TrackResult)
    } catch (e: unknown) {
      // BUG FIX [ERROR HANDLING]: previously bare `catch {}` — no logging.
      console.error('[track] order lookup failed:', e)
      setError('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const currentStep = result ? (STATUS_INDEX[result.order_status as OrderStatus] ?? -1) : -1

  return (
    <div className="max-w-xl mx-auto px-4 py-12">
      <div className="text-center mb-8">
        <div className="text-4xl mb-3">📦</div>
        <h1 className="text-2xl font-bold text-stone-900 mb-1">Track Your Order</h1>
        <p className="text-stone-500 text-sm">Enter your order number and phone to see the latest status</p>
      </div>

      {/* Input form */}
      <div className="bg-white border border-stone-200 rounded-2xl p-6 mb-6 space-y-4">
        <div>
          <label className="block text-xs font-semibold text-stone-600 mb-1">Order Number</label>
          <input
            type="text"
            value={orderNum}
            onChange={e => setOrderNum(e.target.value.toUpperCase())}
            placeholder="e.g. PR-2024-0001"
            className="w-full border border-stone-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-forest-500 transition-colors font-mono"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-stone-600 mb-1">Mobile Number (used at checkout)</label>
          <input
            type="tel"
            value={phone}
            onChange={e => setPhone(e.target.value)}
            placeholder="98765 43210"
            maxLength={10}
            className="w-full border border-stone-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-forest-500 transition-colors"
          />
        </div>

        {error && (
          <div className="p-3 bg-red-50 border border-red-100 rounded-xl text-xs text-red-600 font-medium">
            {error}
          </div>
        )}

        <button
          onClick={handleTrack}
          disabled={loading}
          className="w-full bg-forest-700 hover:bg-forest-800 disabled:opacity-60 text-white font-bold py-3 rounded-xl text-sm transition-colors"
        >
          {loading ? 'Searching…' : 'Track Order'}
        </button>
      </div>

      {/* Result */}
      {result && (
        <div className="bg-white border border-stone-200 rounded-2xl p-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <div className="text-xs text-stone-400 mb-0.5">Order Number</div>
              <div className="font-bold text-stone-800 font-mono">{result.order_number}</div>
            </div>
            <div className="text-right">
              <div className="text-xs text-stone-400 mb-0.5">Placed on</div>
              <div className="text-sm font-medium text-stone-700">{formatDate(result.created_at)}</div>
            </div>
          </div>

          {/* Cancelled / special states */}
          {(result.order_status === 'cancelled' || result.order_status === 'returned' || result.order_status === 'refunded') ? (
            <div className="text-center py-4">
              <div className="text-3xl mb-2">
                {result.order_status === 'cancelled' ? '❌' : result.order_status === 'returned' ? '↩️' : '💰'}
              </div>
              <div className="font-semibold text-stone-700 capitalize">{result.order_status.replace('_', ' ')}</div>
            </div>
          ) : (
            /* Progress tracker */
            <div className="relative">
              {/* Track line */}
              <div className="absolute left-5 top-5 bottom-5 w-0.5 bg-stone-100" />
              <div
                className="absolute left-5 top-5 w-0.5 bg-forest-500 transition-all duration-500"
                style={{ height: currentStep >= 0 ? `${(currentStep / (STATUS_STEPS.length - 1)) * 100}%` : '0%' }}
              />

              <div className="space-y-5">
                {STATUS_STEPS.map((step, i) => {
                  const done    = i <= currentStep
                  const active  = i === currentStep
                  return (
                    <div key={step.status} className="flex items-center gap-4 relative">
                      <div className={`relative z-10 w-10 h-10 rounded-full flex items-center justify-center text-lg border-2 transition-all ${
                        done
                          ? 'border-forest-500 bg-forest-50'
                          : 'border-stone-200 bg-white'
                      } ${active ? 'ring-2 ring-forest-200 ring-offset-1' : ''}`}>
                        {step.icon}
                      </div>
                      <div>
                        <div className={`text-sm font-semibold ${done ? 'text-forest-800' : 'text-stone-400'}`}>
                          {step.label}
                        </div>
                        {active && (
                          <div className="text-[11px] text-forest-600 font-medium">Current status</div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Payment info */}
          <div className="mt-6 pt-4 border-t border-stone-100 flex justify-between text-sm">
            <span className="text-stone-500">Payment</span>
            <span className="font-medium text-stone-700 capitalize">
              {result.payment_method === 'cod' ? 'Cash on Delivery' : 'Online Payment'}
            </span>
          </div>
          <div className="flex justify-between text-sm mt-1">
            <span className="text-stone-500">Total</span>
            <span className="font-bold text-stone-900">₹{result.total_amount?.toLocaleString('en-IN')}</span>
          </div>

          <p className="text-[11px] text-stone-400 text-center mt-5">
            Need help? WhatsApp us with your order number.
          </p>
        </div>
      )}
    </div>
  )
}
