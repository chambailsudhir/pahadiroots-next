// ─────────────────────────────────────────────────────────────
// Shared utility functions for account module
// ─────────────────────────────────────────────────────────────

export function getSavedAddresses(profile: any): any[] {
  try { return JSON.parse(profile?.saved_addresses || '[]') } catch { return [] }
}

export function formatPhone(raw: string): string {
  return raw.replace(/^\+91/, '')
}

export function formatCurrency(amount: number): string {
  return '₹' + amount.toLocaleString('en-IN')
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric',
  })
}

export function getInitials(name: string): string {
  return (name?.[0] || '?').toUpperCase()
}

export function getOrderStatusMessage(o: any): string {
  const ds = o._displayStatus || o.order_status || ''
  if (ds === 'delivered')           return '✅ Delivered! Enjoy your Himalayan goodness 🌿'
  if (ds === 'shipped' && o.shipped_at) {
    const est = new Date(o.shipped_at)
    est.setDate(est.getDate() + 5)
    return `🚚 Shipped · Est. delivery by ${est.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`
  }
  if (ds === 'packed')              return '📦 Order packed, ready for dispatch'
  if (ds === 'processing')          return '⚙️ Processing your order'
  if (ds === 'confirmed')           return '✅ Order confirmed'
  if (ds === 'return_requested')    return '⏳ Return request under review · 24–48 hrs'
  if (ds === 'return_approved')     return '✅ Return approved — pickup being arranged'
  if (ds === 'refund_completed')    return '💚 Refund credited to your account!'
  if (ds === 'cancelled')           return '❌ Order cancelled'
  return ''
}

export function getPaymentLabel(method: string | undefined | null): { label: string; cls: string } {
  if (!method || method.trim() === '') return { label: '', cls: '' }
  const m = method.toLowerCase().trim()
  if (m === 'cod' || m === 'cash_on_delivery' || m === 'cash on delivery') {
    return { label: '💵 COD', cls: 'oc-pay-cod' }
  }
  if (m === 'razorpay' || m === 'razorpay_online' || m === 'upi' || m === 'card' || m === 'online') {
    return { label: '💳 Online', cls: 'oc-pay-online' }
  }
  // Unknown value — show nothing rather than wrong label
  return { label: '', cls: '' }
}
