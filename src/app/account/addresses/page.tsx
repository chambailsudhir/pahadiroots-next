'use client'
// ─────────────────────────────────────────────────────────────
// /account/addresses — standalone addresses page
//  ✅ Uses /api/profile (cookie auth)
//  ✅ All address CRUD delegated to shared useAddresses hook
//     (form state, validation, duplicate detection, busy flags)
//  ✅ Edit capability retained
// ─────────────────────────────────────────────────────────────
import { useEffect, useState } from 'react'
import { INDIA_STATES, ADDRESS_LABELS, CHECKOUT_PROFILE_CACHE_KEY } from '@/lib/account/constants'
import { updateProfile } from '@/lib/services/profileService'
import { useAddresses } from '@/app/account/hooks/useAddresses'
import { safeLocalStorage } from '@/lib/account/utils'
import type { SavedAddress } from '@/app/account/hooks/useProfile'

export default function AddressesPage() {
  const [addresses, setAddresses] = useState<SavedAddress[]>([])
  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState('')
  const [toastMsg,  setToastMsg]  = useState('')

  function showToast(msg: string) {
    setToastMsg(msg)
    setTimeout(() => setToastMsg(''), 3000)
  }

  // Load addresses from profile API on mount
  useEffect(() => {
    const ctrl = new AbortController()
    fetch('/api/profile', { signal: ctrl.signal })
      .then(async r => {
        // Distinguish auth failure (401) from other errors so we can show a
        // helpful sign-in prompt instead of a generic red error string.
        if (r.status === 401) throw new Error('401')
        if (!r.ok) throw new Error('Could not load addresses')
        const data = await r.json()
        const raw  = data.profile?.saved_addresses
        try { setAddresses(raw ? JSON.parse(raw) : []) } catch { setAddresses([]) }
      })
      .catch(e => { if (!ctrl.signal.aborted) setError(e?.message || 'Failed to load') })
      .finally(() => { if (!ctrl.signal.aborted) setLoading(false) })
    return () => ctrl.abort()
  }, [])

  // Wire the shared hook.
  // persist() handles the API call AND updates local state so the page
  // re-renders immediately on success (no optimistic update needed here).
  const addrs = useAddresses({
    getCurrentAddresses: () => addresses,
    persist: async (updated) => {
      await updateProfile({ saved_addresses: JSON.stringify(updated) })
      safeLocalStorage.remove(CHECKOUT_PROFILE_CACHE_KEY)  // invalidate checkout cache
      setAddresses(updated)
    },
    showToast: (msg, _type) => showToast(msg),
  })

  if (loading) return (
    <div className="space-y-3">
      {[1, 2].map(i => <div key={i} className="h-24 bg-stone-100 animate-pulse rounded-xl" />)}
    </div>
  )

  if (error === '401' || error?.includes('Unauthorized') || error?.includes('Not logged in')) return (
    <div className="text-center py-16">
      <div className="text-3xl mb-3">🔒</div>
      <p className="text-stone-500 text-sm mb-4">Please sign in to view your addresses</p>
      <a href="/account" className="inline-block bg-green-900 text-white text-sm font-bold px-5 py-2.5 rounded-xl hover:bg-green-800 transition-colors">
        Sign In
      </a>
    </div>
  )

  if (error) return (
    <div className="text-center py-16 text-red-500 text-sm">{error}</div>
  )

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-lg font-bold text-stone-900">Saved Addresses</h1>
        {!addrs.showForm && addresses.length < 10 && (
          <button
            onClick={addrs.startAdd}
            className="text-sm font-semibold text-green-700 hover:text-green-900 flex items-center gap-1"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Add New
          </button>
        )}
      </div>

      {/* Add / Edit form */}
      {addrs.showForm && (
        <div className="bg-white border border-stone-200 rounded-2xl p-5 mb-5">
          <h2 className="text-sm font-bold text-stone-800 mb-4">
            {addrs.editId ? 'Edit Address' : 'New Address'}
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Label */}
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-stone-600 mb-1">Label *</label>
              <select
                value={addrs.form.label}
                onChange={e => addrs.setField('label', e.target.value)}
                className="w-full border border-stone-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-green-500 bg-white"
              >
                <option value="">Select label…</option>
                {ADDRESS_LABELS.map(l => <option key={l} value={l}>{l}</option>)}
              </select>
              {addrs.formErr.label && <p className="text-xs text-red-500 mt-1">{addrs.formErr.label}</p>}
            </div>
            {/* Contact name */}
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-stone-600 mb-1">Contact Name</label>
              <input
                type="text"
                value={addrs.form.name}
                onChange={e => addrs.setField('name', e.target.value)}
                placeholder="Full name at this address"
                className="w-full border border-stone-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-green-500"
              />
            </div>
            {/* Street */}
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-stone-600 mb-1">Street / Flat / Colony *</label>
              <input
                type="text"
                value={addrs.form.addr}
                onChange={e => addrs.setField('addr', e.target.value)}
                placeholder="House no., Street, Colony"
                className={`w-full border rounded-xl px-3 py-2.5 text-sm outline-none focus:border-green-500 ${addrs.formErr.addr ? 'border-red-400' : 'border-stone-200'}`}
              />
              {addrs.formErr.addr && <p className="text-xs text-red-500 mt-1">{addrs.formErr.addr}</p>}
            </div>
            {/* City */}
            <div>
              <label className="block text-xs font-semibold text-stone-600 mb-1">City *</label>
              <input
                type="text"
                value={addrs.form.city}
                onChange={e => addrs.setField('city', e.target.value)}
                placeholder="Dehradun"
                className={`w-full border rounded-xl px-3 py-2.5 text-sm outline-none focus:border-green-500 ${addrs.formErr.city ? 'border-red-400' : 'border-stone-200'}`}
              />
              {addrs.formErr.city && <p className="text-xs text-red-500 mt-1">{addrs.formErr.city}</p>}
            </div>
            {/* Pincode */}
            <div>
              <label className="block text-xs font-semibold text-stone-600 mb-1">Pincode</label>
              <input
                type="text"
                inputMode="numeric"
                value={addrs.form.pin}
                onChange={e => addrs.setField('pin', e.target.value.replace(/\D/g, ''))}
                placeholder="248001"
                maxLength={6}
                className={`w-full border rounded-xl px-3 py-2.5 text-sm outline-none focus:border-green-500 ${addrs.formErr.pin ? 'border-red-400' : 'border-stone-200'}`}
              />
              {addrs.formErr.pin && <p className="text-xs text-red-500 mt-1">{addrs.formErr.pin}</p>}
            </div>
            {/* State */}
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-stone-600 mb-1">State *</label>
              <select
                value={addrs.form.state}
                onChange={e => addrs.setField('state', e.target.value)}
                className={`w-full border rounded-xl px-3 py-2.5 text-sm outline-none focus:border-green-500 bg-white ${addrs.formErr.state ? 'border-red-400' : 'border-stone-200'}`}
              >
                <option value="">Select State / UT</option>
                {INDIA_STATES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              {addrs.formErr.state && <p className="text-xs text-red-500 mt-1">{addrs.formErr.state}</p>}
            </div>
          </div>
          <div className="flex gap-3 mt-4">
            <button
              onClick={addrs.save}
              disabled={addrs.saving}
              className="flex-1 bg-green-900 hover:bg-green-800 text-white font-bold py-2.5 rounded-xl text-sm disabled:opacity-60 transition-colors"
            >
              {addrs.saving ? 'Saving…' : addrs.editId ? 'Update Address' : 'Save Address'}
            </button>
            <button
              onClick={addrs.cancelForm}
              className="px-5 py-2.5 border border-stone-200 text-stone-600 rounded-xl text-sm hover:bg-stone-50 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* List */}
      {addresses.length === 0 && !addrs.showForm ? (
        <div className="text-center py-12 border border-dashed border-stone-200 rounded-2xl">
          <div className="text-3xl mb-3">📍</div>
          <p className="text-stone-400 text-sm mb-3">No saved addresses yet</p>
          <button
            onClick={addrs.startAdd}
            className="text-green-700 text-sm font-semibold hover:underline"
          >
            Add your first address
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {addresses.map(addr => (
            <div key={addr.id} className="bg-white border border-stone-200 rounded-xl p-4 flex items-start justify-between gap-4">
              <div>
                <span className="text-xs font-bold text-green-700 bg-green-50 px-2 py-0.5 rounded-full inline-block mb-1">
                  {addr.label || 'Home'}
                </span>
                {addr.name && <div className="text-sm font-semibold text-stone-800">{addr.name}</div>}
                <div className="text-sm text-stone-600">{addr.addr}</div>
                <div className="text-sm text-stone-500">{[addr.city, addr.state, addr.pin].filter(Boolean).join(', ')}</div>
              </div>
              <div className="flex gap-3 shrink-0 items-center">
                <button
                  onClick={() => addrs.startEdit(addr)}
                  className="text-xs font-semibold text-stone-500 hover:text-green-700 transition-colors"
                  aria-label={`Edit ${addr.label || 'saved'} address`}
                >
                  Edit
                </button>
                {addrs.confirmDeleteId === addr.id ? (
                  <>
                    <span className="text-xs text-red-600 font-medium">Sure?</span>
                    <button
                      onClick={() => addrs.remove(addr.id)}
                      disabled={addrs.deletingId === addr.id}
                      className="text-xs font-semibold text-red-600 hover:text-red-700 transition-colors disabled:opacity-50"
                      aria-label={`Confirm remove ${addr.label || 'saved'} address`}
                    >
                      {addrs.deletingId === addr.id ? '…' : 'Yes'}
                    </button>
                    <button
                      onClick={() => addrs.setConfirmDeleteId(null)}
                      className="text-xs font-semibold text-stone-500 hover:text-stone-700 transition-colors"
                    >
                      No
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => addrs.setConfirmDeleteId(addr.id)}
                    disabled={!!addrs.deletingId}
                    className="text-xs font-semibold text-stone-500 hover:text-red-500 transition-colors disabled:opacity-50"
                    aria-label={`Remove ${addr.label || 'saved'} address`}
                  >
                    Delete
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Toast — always in DOM for aria-live; className-toggled hidden state avoids the
          simultaneous style+text mutation that causes some screen readers to miss the
          first announcement (same pattern as account/page.tsx). */}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className={toastMsg
          ? 'fixed bottom-20 left-1/2 -translate-x-1/2 bg-green-900 text-white text-sm font-semibold px-5 py-3 rounded-xl shadow-lg z-50 whitespace-nowrap'
          : 'sr-only'}
      >
        {toastMsg || ''}
      </div>
    </div>
  )
}
