'use client'
import ErrorBoundary from '@/components/ui/ErrorBoundary'
import { validate }  from '@/lib/account/validation'
import type { useProfile } from '../hooks/useProfile'
import styles from '../styles/account.module.css'

type ProfileHook = ReturnType<typeof useProfile>

export default function PasswordSection({ profile }: { profile: ProfileHook }) {
  return (
    <ErrorBoundary section="Password">
      <div className={styles.panelSection}>
        <div className={styles.panelHeader}>
          <div className={styles.panelTitle}>Change Password</div>
        </div>
        <div className={styles.card}>
          <div className={styles.cardSectionTitle}>Set New Password</div>
          <div className={styles.formGrid} style={{ maxWidth: '480px' }}>
            <div className={styles.formFull}>
              <div className={styles.fLbl}>Current Password *</div>
              <div className={styles.pwWrap}>
                <input className={`${styles.fInp}${profile.pfErr.curp ? ' ' + styles.fErr : ''}`} type={profile.pw.showCur ? 'text' : 'password'} value={profile.pw.curp} onChange={e => { profile.setPw(p => ({ ...p, curp: e.target.value })); profile.setPfErr(er => ({ ...er, curp: '' })) }} placeholder="Your current password" />
                <button type="button" className={styles.pwEye} aria-label={profile.pw.showCur ? 'Hide current password' : 'Show current password'} onClick={() => profile.setPw(p => ({ ...p, showCur: !p.showCur }))}>{profile.pw.showCur ? '🙈' : '👁'}</button>
              </div>
              {profile.pfErr.curp && <div className={styles.errTxt}>{profile.pfErr.curp}</div>}
            </div>
            <div className={styles.formFull}>
              <div className={styles.fLbl}>New Password *</div>
              <div className={styles.pwWrap}>
                <input className={`${styles.fInp}${profile.pfErr.newp ? ' ' + styles.fErr : ''}`} type={profile.pw.showNew ? 'text' : 'password'} value={profile.pw.newp} onChange={e => { profile.setPw(p => ({ ...p, newp: e.target.value })); profile.setPfErr(er => ({ ...er, newp: '' })) }} placeholder="Min 8 chars, uppercase, number, symbol" />
                <button type="button" className={styles.pwEye} aria-label={profile.pw.showNew ? 'Hide new password' : 'Show new password'} onClick={() => profile.setPw(p => ({ ...p, showNew: !p.showNew }))}>{profile.pw.showNew ? '🙈' : '👁'}</button>
              </div>
              {profile.pfErr.newp && <div className={styles.errTxt}>{profile.pfErr.newp}</div>}
              {profile.pw.newp.length > 0 && (
                <div className={styles.pwStrength}>
                  {(() => {
                    const score = validate.password.score(profile.pw.newp)
                    const label = score <= 1 ? 'Weak' : score <= 2 ? 'Fair' : score === 3 ? 'Good' : 'Strong'
                    const cls   = score <= 1 ? styles.pwWeak : score <= 2 ? styles.pwFair : score === 3 ? styles.pwMedium : styles.pwStrong
                    return <><div className={`${styles.pwBar} ${cls}`} style={{ width: `${score * 25}%` }} /><span className={styles.pwStrengthLbl}>{label}</span></>
                  })()}
                </div>
              )}
            </div>
            <div className={styles.formFull}>
              <div className={styles.fLbl}>Confirm Password *</div>
              <div className={styles.pwWrap}>
                <input className={`${styles.fInp}${profile.pfErr.conf ? ' ' + styles.fErr : ''}`} type={profile.pw.showConf ? 'text' : 'password'} value={profile.pw.conf} onChange={e => { profile.setPw(p => ({ ...p, conf: e.target.value })); profile.setPfErr(er => ({ ...er, conf: '' })) }} placeholder="Repeat new password" />
                <button type="button" className={styles.pwEye} aria-label={profile.pw.showConf ? 'Hide confirm password' : 'Show confirm password'} onClick={() => profile.setPw(p => ({ ...p, showConf: !p.showConf }))}>{profile.pw.showConf ? '🙈' : '👁'}</button>
              </div>
              {profile.pfErr.conf && <div className={styles.errTxt}>{profile.pfErr.conf}</div>}
              {profile.pw.conf.length > 0 && profile.pw.newp === profile.pw.conf && (
                <div className={styles.matchMsg}>✅ Passwords match</div>
              )}
            </div>
          </div>
          <div className={styles.formActions}>
            <button className={styles.btnPrimary} onClick={profile.changePassword} disabled={!!profile.busy.pw}>
              {profile.busy.pw ? 'Updating…' : 'Update Password'}
            </button>
          </div>
        </div>
      </div>
    </ErrorBoundary>
  )
}
