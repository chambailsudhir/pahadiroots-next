'use client'
// ─────────────────────────────────────────────────────────────
// /account/addresses — standalone addresses page
//  ✅ Uses /api/profile (cookie auth)
//  ✅ All address CRUD delegated to shared useAddresses hook
//     (form state, validation, duplicate detection, busy flags)
//  ✅ Edit capability retained
//  ✅ Migrated from Tailwind to account.module.css
// ─────────────────────────────────────────────────────────────
import { useEffect, useState } from 'react'
import { INDIA_STATES, ADDRESS_LABELS, CHECKOUT_PROFILE_CACHE_KEY } from '@/lib/account/constants'
import { updateProfile } from '@/lib/services/profileService'
import { useAddresses } from '@/app/account/hooks/useAddresses'
import { safeLocalStorage } from '@/lib/account/utils'
import type { SavedAddress } from '@/lib/account/utils'
import styles from '../styles/account.module.css'

export default function AddressesPage() {
  const [addresses, setAddresses] = useState<SavedAddress[]>([])
  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState('')
  const [toastMsg,  setToastMsg]  = useState('')

  function showToast(msg: string) {
    setToastMsg(msg)
    setTimeout(() => setToastMsg(''), 3000)
  }

  useEffect(() => {
    const ctrl = new AbortController()
    fetch('/api/profile', { signal: ctrl.signal })
      .then(async r => {
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

  const addrs = useAddresses({
    getCurrentAddresses: () => addresses,
    persist: async (updated) => {
      await updateProfile({ saved_addresses: JSON.stringify(updated) })
      safeLocalStorage.remove(CHECKOUT_PROFILE_CACHE_KEY)
      setAddresses(updated)
    },
    showToast: (msg, _type) => showToast(msg),
  })

  if (loading) return (
    <div className={styles.saLoading}>
      {[1, 2].map(i => <div key={i} className={styles.saSkRow} />)}
    </div>
  )

  if (error === '401' || error?.includes('Unauthorized') || error?.includes('Not logged in')) return (
    <div className={styles.saAuthWall}>
      <div className={styles.saAuthIcon}>🔒</div>
      <p className={styles.saAuthMsg}>Please sign in to view your addresses</p>
      <a href="/account" className={styles.saAuthLink}>Sign In</a>
    </div>
  )

  if (error) return (
    <div className={styles.saError}>{error}</div>
  )

  return (
    <div className={styles.saRoot}>
      <div className={styles.saHeader}>
        <h1 className={styles.saTitle}>Saved Addresses</h1>
        {!addrs.showForm && addresses.length < 10 && (
          <button type="button" onClick={addrs.startAdd} className={styles.saAddBtn}>
            <svg className={styles.saAddBtnIcon} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Add New
          </button>
        )}
      </div>

      {addrs.showForm && (
        <div className={styles.saForm}>
          <h2 className={styles.saFormTitle}>
            {addrs.editId ? 'Edit Address' : 'New Address'}
          </h2>
          <div className={styles.saFormGrid}>
            {/* Label */}
            <div className={styles.saFormSpan2}>
              <label className={styles.saFLbl}>Label *</label>
              <select
                value={addrs.form.label}
                onChange={e => addrs.setField('label', e.target.value)}
                className={`${styles.saFInp}${addrs.formErr.label ? ' ' + styles.saFErr : ''}`}
              >
                <option value="">Select label…</option>
                {ADDRESS_LABELS.map(l => <option key={l} value={l}>{l}</option>)}
              </select>
              {addrs.formErr.label && <p className={styles.saFErrMsg}>{addrs.formErr.label}</p>}
            </div>
            {/* Contact name */}
            <div className={styles.saFormSpan2}>
              <label className={styles.saFLbl}>Contact Name</label>
              <input
                type="text"
                value={addrs.form.name}
                onChange={e => addrs.setField('name', e.target.value)}
                placeholder="Full name at this address"
                className={styles.saFInp}
              />
            </div>
            {/* Phone */}
            <div className={styles.saFormSpan2}>
              <label className={styles.saFLbl}>Phone Number *</label>
              <input
                type="text"
                inputMode="numeric"
                value={addrs.form.phone}
                onChange={e => addrs.setField('phone', e.target.value.replace(/\D/g, '').slice(0, 10))}
                placeholder="10-digit mobile number"
                maxLength={10}
                autoComplete="tel"
                className={`${styles.saFInp}${addrs.formErr.phone ? ' ' + styles.saFErr : ''}`}
              />
              {addrs.formErr.phone && <p className={styles.saFErrMsg}>{addrs.formErr.phone}</p>}
            </div>
            {/* Street */}
            <div className={styles.saFormSpan2}>
              <label className={styles.saFLbl}>Street / Flat / Colony *</label>
              <input
                type="text"
                value={addrs.form.addr}
                onChange={e => addrs.setField('addr', e.target.value)}
                placeholder="House no., Street, Colony"
                className={`${styles.saFInp}${addrs.formErr.addr ? ' ' + styles.saFErr : ''}`}
              />
              {addrs.formErr.addr && <p className={styles.saFErrMsg}>{addrs.formErr.addr}</p>}
            </div>
            {/* City */}
            <div>
              <label className={styles.saFLbl}>City *</label>
              <input
                type="text"
                value={addrs.form.city}
                onChange={e => addrs.setField('city', e.target.value)}
                placeholder="Dehradun"
                className={`${styles.saFInp}${addrs.formErr.city ? ' ' + styles.saFErr : ''}`}
              />
              {addrs.formErr.city && <p className={styles.saFErrMsg}>{addrs.formErr.city}</p>}
            </div>
            {/* Pincode */}
            <div>
              <label className={styles.saFLbl}>Pincode</label>
              <input
                type="text"
                inputMode="numeric"
                value={addrs.form.pin}
                onChange={e => addrs.setField('pin', e.target.value.replace(/\D/g, ''))}
                placeholder="248001"
                maxLength={6}
                className={`${styles.saFInp}${addrs.formErr.pin ? ' ' + styles.saFErr : ''}`}
              />
              {addrs.formErr.pin && <p className={styles.saFErrMsg}>{addrs.formErr.pin}</p>}
            </div>
            {/* State */}
            <div className={styles.saFormSpan2}>
              <label className={styles.saFLbl}>State *</label>
              <select
                value={addrs.form.state}
                onChange={e => addrs.setField('state', e.target.value)}
                className={`${styles.saFInp}${addrs.formErr.state ? ' ' + styles.saFErr : ''}`}
              >
                <option value="">Select State / UT</option>
                {INDIA_STATES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              {addrs.formErr.state && <p className={styles.saFErrMsg}>{addrs.formErr.state}</p>}
            </div>
          </div>
          <div className={styles.saFormActions}>
            <button
              type="button"
              onClick={addrs.save}
              disabled={addrs.saving}
              className={styles.saSaveBtn}
            >
              {addrs.saving ? 'Saving…' : addrs.editId ? 'Update Address' : 'Save Address'}
            </button>
            <button
              type="button"
              onClick={addrs.cancelForm}
              className={styles.saCancelBtn}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {addresses.length === 0 && !addrs.showForm ? (
        <div className={styles.saEmpty}>
          <div className={styles.saEmptyIcon}>📍</div>
          <p className={styles.saEmptyMsg}>No saved addresses yet</p>
          <button type="button" onClick={addrs.startAdd} className={styles.saEmptyBtn}>
            Add your first address
          </button>
        </div>
      ) : (
        <div className={styles.saList}>
          {addresses.map(addr => (
            <div key={addr.id} className={styles.saCard}>
              <div className={styles.saCardBody}>
                <span className={styles.saCardTag}>{addr.label || 'Home'}</span>
                {addr.name && <div className={styles.saCardName}>{addr.name}</div>}
                <div className={styles.saCardLine}>{addr.addr}</div>
                <div className={styles.saCardSub}>{[addr.city, addr.state, addr.pin].filter(Boolean).join(', ')}</div>
                {addr.phone && <div className={styles.saCardSub}>{addr.phone}</div>}
              </div>
              <div className={styles.saCardActions}>
                <button
                  type="button"
                  onClick={() => addrs.startEdit(addr)}
                  className={styles.saActBtn}
                  aria-label={`Edit ${addr.label || 'saved'} address`}
                >
                  Edit
                </button>
                {addrs.confirmDeleteId === addr.id ? (
                  <>
                    <span className={styles.saDelConfirmTxt}>Sure?</span>
                    <button
                      type="button"
                      onClick={() => addrs.remove(addr.id)}
                      disabled={addrs.deletingId === addr.id}
                      className={styles.saDelConfirmBtn}
                      aria-label={`Confirm remove ${addr.label || 'saved'} address`}
                    >
                      {addrs.deletingId === addr.id ? '…' : 'Yes'}
                    </button>
                    <button
                      type="button"
                      onClick={() => addrs.setConfirmDeleteId(null)}
                      className={styles.saDelCancelBtn}
                    >
                      No
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => addrs.setConfirmDeleteId(addr.id)}
                    disabled={!!addrs.deletingId}
                    className={styles.saActBtn}
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

      {/* Toast — always in DOM for aria-live */}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className={toastMsg ? styles.saToast : 'sr-only'}
      >
        {toastMsg || ''}
      </div>
    </div>
  )
}
