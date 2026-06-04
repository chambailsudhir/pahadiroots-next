'use client'

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

export default function PaymentSection({
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
                <div className={styles.disc}>🎉 Extra {formatPrice(prepaidDiscount)} off applied!</div>
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
                <span className={styles.codIcon}>💵</span>
              </div>
              <p className={styles.optSub}>Pay in cash when your order arrives</p>
            </div>
          </label>
        ) : (
          <div className={styles.codDisabled} aria-disabled="true" aria-label={`Cash on Delivery: ${!codEnabled ? 'Unavailable' : total > codMax ? `Maximum order ₹${codMax}` : 'Unavailable'}`}>
            <div className={styles.codDisabledLeft}>
              <span className={styles.codIcon}>💵</span>
              <span className={`${styles.optTitle} ${styles.optTitleOff}`}>Cash on Delivery</span>
            </div>
            <span className={styles.codReason}>
              {!codEnabled ? 'Unavailable' : total > codMax ? `Max ₹${codMax}` : 'Unavailable'}
            </span>
          </div>
        )}
      </div>

      {/* Security strip */}
      <div className={styles.seals}>
        <div className={styles.seal}>🔒 SSL Encrypted</div>
        <div className={styles.seal}>🏦 Razorpay Secured</div>
        <div className={styles.seal}>✅ PCI-DSS</div>
        <div className={styles.seal}>🇮🇳 Made for India</div>
      </div>
    </div>
  )
}
