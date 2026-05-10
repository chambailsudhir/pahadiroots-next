'use client'
import ErrorBoundary from '@/components/ui/ErrorBoundary'
import { INDIA_STATES, ADDRESS_LABELS } from '@/lib/account/constants'
import type { Profile }      from '../hooks/useAuth'
import type { SavedAddress } from '../hooks/useProfile'
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
                <button className={styles.addrBtn} onClick={onEditAddress}>✏️ Edit Address</button>
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
                <button className={`${styles.addrBtn} ${styles.addrDel}`} onClick={() => profile.deleteAddress(a.id)}>
                  🗑 Remove
                </button>
              </div>
            </div>
          ))}

          {/* Empty state */}
          {!authProfile?.address_line1 && savedAddrs.length === 0 && !profile.showAddAddr && (
            <div className={styles.emptyState}>
              <div className={styles.emptyIcon}>📍</div>
              <div className={styles.emptyTitle}>No addresses saved</div>
              <p className={styles.emptySub}>Add a delivery address to checkout faster.</p>
            </div>
          )}

          {/* Add form / button */}
          {profile.showAddAddr ? (
            <div className={styles.addrAddForm}>
              <div className={styles.addrAddTitle}>Add New Address</div>
              <div className={styles.formGrid}>
                <div>
                  <div className={styles.fLbl}>Label *</div>
                  <select
                    className={`${styles.fInp}${profile.newAddrErr.label ? ' ' + styles.fErr : ''}`}
                    value={profile.newAddr.label}
                    onChange={e => { profile.setNewAddr(a => ({ ...a, label: e.target.value })); profile.setNewAddrErr(er => ({ ...er, label: '' })) }}
                  >
                    <option value="">Select label…</option>
                    {ADDRESS_LABELS.map(l => <option key={l} value={l}>{l}</option>)}
                  </select>
                  {profile.newAddrErr.label && <div className={styles.errTxt}>{profile.newAddrErr.label}</div>}
                </div>
                <div>
                  <div className={styles.fLbl}>Contact Name</div>
                  <input className={styles.fInp} value={profile.newAddr.name} onChange={e => profile.setNewAddr(a => ({ ...a, name: e.target.value }))} placeholder="Full name" />
                </div>
                <div className={styles.formFull}>
                  <div className={styles.fLbl}>Street / Flat / Colony *</div>
                  <input className={`${styles.fInp}${profile.newAddrErr.flat ? ' ' + styles.fErr : ''}`} value={profile.newAddr.flat} onChange={e => { profile.setNewAddr(a => ({ ...a, flat: e.target.value })); profile.setNewAddrErr(er => ({ ...er, flat: '' })) }} placeholder="House no., Street, Colony" />
                  {profile.newAddrErr.flat && <div className={styles.errTxt}>{profile.newAddrErr.flat}</div>}
                </div>
                <div>
                  <div className={styles.fLbl}>City *</div>
                  <input className={`${styles.fInp}${profile.newAddrErr.city ? ' ' + styles.fErr : ''}`} value={profile.newAddr.city} onChange={e => { profile.setNewAddr(a => ({ ...a, city: e.target.value })); profile.setNewAddrErr(er => ({ ...er, city: '' })) }} placeholder="City" />
                  {profile.newAddrErr.city && <div className={styles.errTxt}>{profile.newAddrErr.city}</div>}
                </div>
                <div>
                  <div className={styles.fLbl}>State *</div>
                  <select className={`${styles.fInp}${profile.newAddrErr.state ? ' ' + styles.fErr : ''}`} value={profile.newAddr.state} onChange={e => { profile.setNewAddr(a => ({ ...a, state: e.target.value })); profile.setNewAddrErr(er => ({ ...er, state: '' })) }}>
                    <option value="">Select State / UT</option>
                    {INDIA_STATES.map(s => <option key={s}>{s}</option>)}
                  </select>
                  {profile.newAddrErr.state && <div className={styles.errTxt}>{profile.newAddrErr.state}</div>}
                </div>
                <div>
                  <div className={styles.fLbl}>Pincode</div>
                  <input className={`${styles.fInp}${profile.newAddrErr.pin ? ' ' + styles.fErr : ''}`} value={profile.newAddr.pin} onChange={e => { profile.setNewAddr(a => ({ ...a, pin: e.target.value.replace(/\D/g, '') })); profile.setNewAddrErr(er => ({ ...er, pin: '' })) }} placeholder="110001" maxLength={6} inputMode="numeric" />
                  {profile.newAddrErr.pin && <div className={styles.errTxt}>{profile.newAddrErr.pin}</div>}
                </div>
              </div>
              <div className={styles.formActions}>
                <button className={styles.btnPrimary} onClick={profile.saveNewAddress} disabled={!!profile.busy.newAddr}>
                  {profile.busy.newAddr ? 'Saving…' : 'Save Address'}
                </button>
                <button className={styles.btnSecondary} onClick={() => { profile.setShowAddAddr(false); profile.setNewAddrErr({}) }}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button className={styles.addAddrBtn} onClick={() => profile.setShowAddAddr(true)}>
              <span style={{ fontSize: '18px', lineHeight: 1 }}>+</span> Add New Address
            </button>
          )}
        </div>
      </div>
    </ErrorBoundary>
  )
}
