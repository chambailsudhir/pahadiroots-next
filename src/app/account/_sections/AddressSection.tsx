'use client'
import ErrorBoundary from '@/components/ui/ErrorBoundary'
import { INDIA_STATES, ADDRESS_LABELS } from '@/lib/account/constants'
import type { Profile }      from '../hooks/useAuth'
import type { SavedAddress } from '@/lib/account/utils'
import type { useProfile }   from '../hooks/useProfile'
import styles from '../styles/account.module.css'

type ProfileHook = ReturnType<typeof useProfile>

interface Props {
  authProfile:  Profile | null
  profile:      ProfileHook
  savedAddrs:   SavedAddress[]
  onEditAddress: () => void  // switch to profile tab
}

export default function AddressSection({ authProfile, profile, savedAddrs, onEditAddress }: Props) {
  // All address form/CRUD state now lives in profile.addresses (useAddresses hook).
  // confirmDeleteId, deletingId, showForm, form, formErr, saving are all from there.
  const { addresses } = profile
  const savedAddrsList = savedAddrs.filter(a => a.label !== 'Default')

  return (
    <ErrorBoundary section="Addresses">
      <div className={styles.panelSection}>
        <div className={styles.panelHeader}>
          <div className={styles.panelTitle}>Delivery Addresses</div>
        </div>
        <div className={styles.card}>

          {/* Default address from profile */}
          {authProfile?.address_line1 && (
            <div className={`${styles.addrCard} ${styles.addrDefault}`}>
              <div className={styles.addrHeader}>
                <div className={styles.addrLabel}>🏠 Default Address</div>
                <div className={styles.addrTag}>Primary</div>
              </div>
              <div className={styles.addrLine}>
                <strong>{[authProfile.first_name, authProfile.last_name].filter(Boolean).join(' ')}</strong><br />
                {[authProfile.address_line1, authProfile.city, authProfile.state, authProfile.postal_code].filter(Boolean).join(', ')}
                {authProfile.phone && <><br /><span style={{ color: '#888' }}>{String(authProfile.phone)}</span></>}
              </div>
              <div className={styles.addrActions}>
                {/* aria-label gives screen readers a descriptive action name beyond the emoji */}
                <button className={styles.addrBtn} onClick={onEditAddress} aria-label="Edit default address">✏️ Edit Address</button>
              </div>
            </div>
          )}

          {/* Saved addresses */}
          {savedAddrsList.map((a: SavedAddress) => (
            <div key={a.id} className={styles.addrCard}>
              <div className={styles.addrHeader}>
                <div className={styles.addrLabel}>📍 {a.label || 'Saved Address'}</div>
              </div>
              <div className={styles.addrLine}>
                {a.name && <><strong>{a.name}</strong><br /></>}
                {[a.addr, a.city, a.state, a.pin].filter(Boolean).join(', ')}
              </div>
              <div className={styles.addrActions}>
                {addresses.confirmDeleteId === a.id ? (
                  <>
                    <span style={{ fontSize: '12px', color: '#b91c1c', marginRight: '6px' }}>Remove this address?</span>
                    <button
                      className={`${styles.addrBtn} ${styles.addrDel}`}
                      onClick={() => addresses.remove(a.id)}
                      aria-label={`Confirm remove ${a.label || 'saved'} address`}
                      disabled={addresses.deletingId === a.id}
                    >
                      {addresses.deletingId === a.id ? 'Removing…' : 'Yes, Remove'}
                    </button>
                    <button
                      className={styles.addrBtn}
                      onClick={() => addresses.setConfirmDeleteId(null)}
                      style={{ marginLeft: '6px' }}
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      className={styles.addrBtn}
                      onClick={() => addresses.startEdit(a)}
                      aria-label={`Edit ${a.label || 'saved'} address`}
                      disabled={!!addresses.deletingId}
                    >
                      ✏️ Edit
                    </button>
                    <button
                      className={`${styles.addrBtn} ${styles.addrDel}`}
                      onClick={() => addresses.setConfirmDeleteId(a.id)}
                      aria-label={`Remove ${a.label || 'saved'} address`}
                      disabled={addresses.deletingId === a.id}
                      style={{ marginLeft: '6px' }}
                    >
                      🗑 Remove
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}

          {/* Empty state */}
          {!authProfile?.address_line1 && savedAddrs.length === 0 && !addresses.showForm && (
            <div className={styles.emptyState}>
              <div className={styles.emptyIcon}>📍</div>
              <div className={styles.emptyTitle}>No addresses saved</div>
              <p className={styles.emptySub}>Add a delivery address to checkout faster.</p>
            </div>
          )}

          {/* Add form / button */}
          {addresses.showForm ? (
            <div className={styles.addrAddForm}>
              <div className={styles.addrAddTitle}>{addresses.editId ? 'Edit Address' : 'Add New Address'}</div>
              <div className={styles.formGrid}>
                <div>
                  <label htmlFor="addr-label" className={styles.fLbl}>Label *</label>
                  <select
                    id="addr-label"
                    className={`${styles.fInp}${addresses.formErr.label ? ' ' + styles.fErr : ''}`}
                    value={addresses.form.label}
                    onChange={e => addresses.setField('label', e.target.value)}
                    aria-describedby={addresses.formErr.label ? 'addr-label-err' : undefined}
                  >
                    <option value="">Select label…</option>
                    {ADDRESS_LABELS.map(l => <option key={l} value={l}>{l}</option>)}
                  </select>
                  {addresses.formErr.label && <div id="addr-label-err" className={styles.errTxt}>{addresses.formErr.label}</div>}
                </div>
                <div>
                  <label htmlFor="addr-name" className={styles.fLbl}>Contact Name</label>
                  <input
                    id="addr-name"
                    className={styles.fInp}
                    value={addresses.form.name}
                    onChange={e => addresses.setField('name', e.target.value)}
                    placeholder="Full name"
                    autoComplete="name"
                  />
                </div>
                <div className={styles.formFull}>
                  <label htmlFor="addr-street" className={styles.fLbl}>Street / Flat / Colony *</label>
                  <input
                    id="addr-street"
                    className={`${styles.fInp}${addresses.formErr.addr ? ' ' + styles.fErr : ''}`}
                    value={addresses.form.addr}
                    onChange={e => addresses.setField('addr', e.target.value)}
                    placeholder="House no., Street, Colony"
                    autoComplete="address-line1"
                    aria-describedby={addresses.formErr.addr ? 'addr-street-err' : undefined}
                  />
                  {addresses.formErr.addr && <div id="addr-street-err" className={styles.errTxt}>{addresses.formErr.addr}</div>}
                </div>
                <div>
                  <label htmlFor="addr-city" className={styles.fLbl}>City *</label>
                  <input
                    id="addr-city"
                    className={`${styles.fInp}${addresses.formErr.city ? ' ' + styles.fErr : ''}`}
                    value={addresses.form.city}
                    onChange={e => addresses.setField('city', e.target.value)}
                    placeholder="City"
                    autoComplete="address-level2"
                    aria-describedby={addresses.formErr.city ? 'addr-city-err' : undefined}
                  />
                  {addresses.formErr.city && <div id="addr-city-err" className={styles.errTxt}>{addresses.formErr.city}</div>}
                </div>
                <div>
                  <label htmlFor="addr-state" className={styles.fLbl}>State *</label>
                  <select
                    id="addr-state"
                    className={`${styles.fInp}${addresses.formErr.state ? ' ' + styles.fErr : ''}`}
                    value={addresses.form.state}
                    onChange={e => addresses.setField('state', e.target.value)}
                    autoComplete="address-level1"
                    aria-describedby={addresses.formErr.state ? 'addr-state-err' : undefined}
                  >
                    <option value="">Select State / UT</option>
                    {INDIA_STATES.map(s => <option key={s}>{s}</option>)}
                  </select>
                  {addresses.formErr.state && <div id="addr-state-err" className={styles.errTxt}>{addresses.formErr.state}</div>}
                </div>
                <div>
                  <label htmlFor="addr-pin" className={styles.fLbl}>Pincode</label>
                  <input
                    id="addr-pin"
                    className={`${styles.fInp}${addresses.formErr.pin ? ' ' + styles.fErr : ''}`}
                    value={addresses.form.pin}
                    onChange={e => addresses.setField('pin', e.target.value.replace(/\D/g, ''))}
                    placeholder="110001"
                    maxLength={6}
                    inputMode="numeric"
                    autoComplete="postal-code"
                    aria-describedby={addresses.formErr.pin ? 'addr-pin-err' : undefined}
                  />
                  {addresses.formErr.pin && <div id="addr-pin-err" className={styles.errTxt}>{addresses.formErr.pin}</div>}
                </div>
              </div>
              <div className={styles.formActions}>
                <button
                  className={styles.btnPrimary}
                  onClick={addresses.save}
                  disabled={addresses.saving}
                >
                  {addresses.saving ? 'Saving…' : 'Save Address'}
                </button>
                <button className={styles.btnSecondary} onClick={addresses.cancelForm}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button className={styles.addAddrBtn} onClick={addresses.startAdd}>
              <span style={{ fontSize: '18px', lineHeight: 1 }}>+</span> Add New Address
            </button>
          )}
        </div>
      </div>
    </ErrorBoundary>
  )
}
