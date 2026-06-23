'use client'
import ErrorBoundary from '@/components/ui/ErrorBoundary'
import { INDIA_STATES } from '@/lib/account/constants'
import type { Profile }    from '../hooks/useAuth'
import type { AuthUser }   from '../hooks/useAuth'
import type { useProfile } from '../hooks/useProfile'
import styles from '../styles/account.module.css'

type ProfileHook = ReturnType<typeof useProfile>

interface Props {
  authProfile: Profile | null
  authUser:    AuthUser | null
  profile:     ProfileHook
}

export default function ProfileSection({ authProfile, authUser, profile }: Props) {
  return (
    <ErrorBoundary section="Profile">
      <div className={styles.panelSection}>
        <div className={styles.panelHeader}>
          <div className={styles.panelTitle}>My Profile</div>
        </div>

        {/* Name */}
        <div className={styles.card}>
          <div className={styles.cardSectionTitle}>Personal Information</div>
          <div className={styles.formGrid}>
            <div>
              <label htmlFor="pf-fname" className={styles.fLbl}>First Name *</label>
              <input
                id="pf-fname"
                name="given-name"
                autoComplete="given-name"
                maxLength={100}
                className={`${styles.fInp}${profile.pfErr.fname ? ' ' + styles.fErr : ''}`}
                value={profile.pf.fname}
                onChange={e => { profile.setPf(p => ({ ...p, fname: e.target.value })); profile.setPfErr(er => ({ ...er, fname: '' })) }}
                placeholder="First name"
              />
              {profile.pfErr.fname && <div className={styles.errTxt}>{profile.pfErr.fname}</div>}
            </div>
            <div>
              <label htmlFor="pf-lname" className={styles.fLbl}>Last Name</label>
              <input
                id="pf-lname"
                name="family-name"
                autoComplete="family-name"
                maxLength={100}
                className={styles.fInp}
                value={profile.pf.lname}
                onChange={e => profile.setPf(p => ({ ...p, lname: e.target.value }))}
                placeholder="Last name"
              />
            </div>
          </div>
          <div className={styles.formActions}>
            <button type="button" className={styles.btnPrimary} onClick={profile.saveName} disabled={!!profile.busy.name}>
              {profile.busy.name ? 'Saving…' : 'Save Name'}
            </button>
            {profile.msg.name && <div className={styles.saveMsg}>{profile.msg.name}</div>}
          </div>
        </div>

        {/* Address */}
        <div className={styles.card}>
          <div className={styles.cardSectionTitle}>Default Delivery Address</div>
          <div className={styles.formGrid}>
            <div className={styles.formFull}>
              <label htmlFor="pf-addr" className={styles.fLbl}>Street / Flat / Colony *</label>
              <input
                id="pf-addr"
                name="address-line1"
                autoComplete="address-line1"
                maxLength={200}
                className={`${styles.fInp}${profile.pfErr.addr ? ' ' + styles.fErr : ''}`}
                value={profile.pf.addr}
                onChange={e => { profile.setPf(p => ({ ...p, addr: e.target.value })); profile.setPfErr(er => ({ ...er, addr: '' })) }}
                placeholder="House no., Street, Colony"
              />
              {profile.pfErr.addr && <div className={styles.errTxt}>{profile.pfErr.addr}</div>}
            </div>
            <div>
              <label htmlFor="pf-city" className={styles.fLbl}>City *</label>
              <input
                id="pf-city"
                name="address-level2"
                autoComplete="address-level2"
                maxLength={100}
                className={`${styles.fInp}${profile.pfErr.city ? ' ' + styles.fErr : ''}`}
                value={profile.pf.city}
                onChange={e => { profile.setPf(p => ({ ...p, city: e.target.value })); profile.setPfErr(er => ({ ...er, city: '' })) }}
                placeholder="City"
              />
              {profile.pfErr.city && <div className={styles.errTxt}>{profile.pfErr.city}</div>}
            </div>
            <div>
              <label htmlFor="pf-state" className={styles.fLbl}>State *</label>
              <select
                id="pf-state"
                name="address-level1"
                autoComplete="address-level1"
                className={`${styles.fInp}${profile.pfErr.state ? ' ' + styles.fErr : ''}`}
                value={profile.pf.state}
                onChange={e => { profile.setPf(p => ({ ...p, state: e.target.value })); profile.setPfErr(er => ({ ...er, state: '' })) }}
              >
                <option value="">Select State / UT</option>
                {INDIA_STATES.map(s => <option key={s}>{s}</option>)}
              </select>
              {profile.pfErr.state && <div className={styles.errTxt}>{profile.pfErr.state}</div>}
            </div>
            <div>
              <label htmlFor="pf-pin" className={styles.fLbl}>Pincode *</label>
              <input id="pf-pin" name="postal-code" autoComplete="postal-code" className={`${styles.fInp}${profile.pfErr.pin ? ' ' + styles.fErr : ''}`} value={profile.pf.pin} onChange={e => { profile.setPf(p => ({ ...p, pin: e.target.value.replace(/\D/g, '') })); profile.setPfErr(er => ({ ...er, pin: '' })) }} placeholder="110001" maxLength={6} inputMode="numeric" />
              {profile.pfErr.pin && <div className={styles.errTxt}>{profile.pfErr.pin}</div>}
            </div>
          </div>
          <div className={styles.formActions}>
            <button type="button" className={styles.btnPrimary} onClick={profile.saveAddress} disabled={!!profile.busy.addr}>
              {profile.busy.addr ? 'Saving…' : 'Save Address'}
            </button>
            {profile.msg.addr && <div className={styles.saveMsg}>{profile.msg.addr}</div>}
          </div>
        </div>

        {/* Contact */}
        <div className={styles.card}>
          <div className={styles.cardSectionTitle}>Contact Information</div>
          <div className={styles.formGrid}>
            <div>
              <label htmlFor="pf-phone" className={styles.fLbl}>Phone Number</label>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <span className={styles.phonePrefix}>+91</span>
                <input id="pf-phone" name="tel-national" autoComplete="tel-national" className={`${styles.fInp}${profile.pfErr.phone ? ' ' + styles.fErr : ''}`} style={{ flex: 1 }} value={profile.pf.phone} onChange={e => { profile.setPf(p => ({ ...p, phone: e.target.value.replace(/\D/g, '') })); profile.setPfErr(er => ({ ...er, phone: '' })) }} placeholder="10-digit mobile" maxLength={10} inputMode="numeric" />
              </div>
              {profile.pfErr.phone && <div className={styles.errTxt}>{profile.pfErr.phone}</div>}
            </div>
            <div>
              <label htmlFor="pf-email" className={styles.fLbl}>Email Address</label>
              <input id="pf-email" className={`${styles.fInp} ${styles.fDisabled}`} value={String(authUser?.email || authProfile?.email || '')} disabled aria-describedby="pf-email-hint" />
              <div id="pf-email-hint" className={styles.fHint}>
                Email cannot be changed here.{' '}
                <a
                  href={`https://wa.me/919899984895?text=${encodeURIComponent('Hi, I need help changing the email on my Pahadi Roots account.')}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.fHintLink}
                >
                  Contact support →
                </a>
              </div>
            </div>
          </div>
          <div className={styles.formActions}>
            <button type="button" className={styles.btnPrimary} onClick={profile.savePhone} disabled={!!profile.busy.phone}>
              {profile.busy.phone ? 'Saving…' : 'Save Phone'}
            </button>
            {profile.msg.phone && <div className={styles.saveMsg}>{profile.msg.phone}</div>}
          </div>
        </div>
      </div>
    </ErrorBoundary>
  )
}
