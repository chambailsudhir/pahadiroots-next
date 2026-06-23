'use client'

import { memo } from 'react'
import { formatPrice } from '@/lib/utils'
import styles from './PaymentSection.module.css'

interface Props {
  payMethod: 'razorpay' | 'cod'
  onChange: (v: 'razorpay' | 'cod') => void
  razorpayEnabled: boolean
  codOk: boolean
  codEnabled: boolean
  prepaidPct: number
  prepaidDiscount: number
  codMax: number
  total: number
}

// PERF FIX: memo — PaymentSection only changes when payMethod, codOk, or pricing changes.
const PaymentSection = memo(function PaymentSection({
  payMethod, onChange, razorpayEnabled, codOk, codEnabled,
  prepaidPct, prepaidDiscount, codMax, total,
}: Props) {
  return (
    <div className={styles.root}>
      <div className={styles.opts}>

        {/* Online payment */}
        {razorpayEnabled && (
          <label className={`${styles.opt}${payMethod === 'razorpay' ? ` ${styles.optOn}` : ''}`}>
            <input type="radio" name="ps-pay" value="razorpay"
              checked={payMethod === 'razorpay'}
              onChange={() => onChange('razorpay')}
              className={styles.radio}
            />
            <div className={styles.optInner}>
              <div className={styles.optHead}>
                <span className={styles.optTitle}>Pay Online</span>
                {prepaidPct > 0 && <span className={styles.saveBadge}>Save {prepaidPct}%</span>}
              </div>
              <div className={styles.logos} aria-hidden="true">
                {/* UPI */}
                <svg className={styles.logo} viewBox="0 0 52 22" xmlns="http://www.w3.org/2000/svg">
                  <rect width="52" height="22" rx="4" fill="#5A1589"/>
                  <text x="8" y="15.5" fontSize="11" fontWeight="800" fill="#fff" fontFamily="sans-serif">UPI</text>
                </svg>
                {/* Visa */}
                <svg className={styles.logo} viewBox="0 0 52 22" xmlns="http://www.w3.org/2000/svg">
                  <rect width="52" height="22" rx="4" fill="#1A1F71"/>
                  <text x="6" y="16" fontSize="12" fontWeight="800" fill="#fff" fontStyle="italic" fontFamily="sans-serif">VISA</text>
                </svg>
                {/* Mastercard */}
                <svg className={styles.logo} viewBox="0 0 42 22" xmlns="http://www.w3.org/2000/svg">
                  <rect width="42" height="22" rx="4" fill="#fff" stroke="#E8E0D5"/>
                  <circle cx="16" cy="11" r="8" fill="#EB001B"/>
                  <circle cx="26" cy="11" r="8" fill="#F79E1B"/>
                  <path d="M21 5.5a8 8 0 0 1 0 11A8 8 0 0 1 21 5.5z" fill="#FF5F00"/>
                </svg>
                {/* RuPay */}
                <svg className={styles.logo} viewBox="0 0 52 22" xmlns="http://www.w3.org/2000/svg">
                  <rect width="52" height="22" rx="4" fill="#007B40"/>
                  <text x="5" y="15" fontSize="9.5" fontWeight="800" fill="#fff" fontFamily="sans-serif">RuPay</text>
                </svg>
                {/* GPay */}
                <svg className={styles.logo} viewBox="0 0 52 22" xmlns="http://www.w3.org/2000/svg">
                  <rect width="52" height="22" rx="4" fill="#fff" stroke="#E8E0D5"/>
                  <text x="5" y="15.5" fontSize="12" fontWeight="700" fill="#4285F4" fontFamily="sans-serif">G</text>
                  <text x="17" y="15.5" fontSize="10" fontWeight="600" fill="#333" fontFamily="sans-serif">Pay</text>
                </svg>
              </div>
              {payMethod === 'razorpay' && prepaidDiscount > 0 && (
                <div className={styles.disc}><span aria-hidden="true">🎉</span> Extra {formatPrice(prepaidDiscount)} off applied!</div>
              )}
            </div>
          </label>
        )}

        {/* COD */}
        {codOk ? (
          <label className={`${styles.opt}${payMethod === 'cod' ? ` ${styles.optOn}` : ''}`}>
            <input type="radio" name="ps-pay" value="cod"
              checked={payMethod === 'cod'}
              onChange={() => onChange('cod')}
              className={styles.radio}
            />
            <div className={styles.optInner}>
              <div className={styles.optHead}>
                <span className={styles.optTitle}>Cash on Delivery</span>
                {/* aria-hidden: icon is decorative alongside the text label */}
                <span className={styles.codIcon} aria-hidden="true">💵</span>
              </div>
              <p className={styles.optSub}>Pay in cash when your order arrives</p>
            </div>
          </label>
        ) : (
          /*
           * A11y fix: <div aria-disabled="true"> is non-focusable and aria-disabled
           * is meaningless on a non-interactive element — screen readers ignore it.
           * Fix: role="radio" makes it part of the radiogroup semantics;
           * aria-disabled="true" is now meaningful on an interactive role;
           * aria-checked="false" communicates it is an unselectable option;
           * tabIndex={-1} keeps it out of the tab order (it's disabled) but still
           * discoverable by screen readers navigating with arrow keys in a group.
           * The reason text is wired via aria-describedby.
           */
          <div
            className={styles.codDisabled}
            role="radio"
            aria-disabled="true"
            aria-checked={false}
            aria-describedby="cod-disabled-reason"
            tabIndex={-1}
          >
            <div className={styles.codDisabledLeft}>
              <span className={styles.codIcon} aria-hidden="true">💵</span>
              <span className={`${styles.optTitle} ${styles.optTitleOff}`}>Cash on Delivery</span>
            </div>
            <span className={styles.codReason} id="cod-disabled-reason">
              {!codEnabled ? 'Unavailable' : total > codMax ? `Max ₹${codMax}` : 'Unavailable'}
            </span>
          </div>
        )}
      </div>

      {/* Security strip — emojis are decorative; text carries the meaning */}
      <div className={styles.seals}>
        <div className={styles.seal}><span aria-hidden="true">🔒</span> SSL Encrypted</div>
        <div className={styles.seal}><span aria-hidden="true">🏦</span> Razorpay Secured</div>
        <div className={styles.seal}><span aria-hidden="true">✅</span> PCI-DSS</div>
        <div className={styles.seal}><span aria-hidden="true">🇮🇳</span> Made for India</div>
      </div>
    </div>
  )
})

export default PaymentSection
