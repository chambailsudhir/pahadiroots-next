'use client'

import { formatPrice } from '@/lib/utils'

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
    <div className="ps-root">
      <div className="ps-opts">

        {/* Online payment */}
        {razorpayEnabled && (
          <label className={`ps-opt${payMethod === 'razorpay' ? ' ps-opt--on' : ''}`}>
            <input type="radio" name="ps-pay" value="razorpay"
              checked={payMethod === 'razorpay'}
              onChange={() => onChange('razorpay')}
              className="ps-radio"
            />
            <div className="ps-opt-inner">
              <div className="ps-opt-head">
                <span className="ps-opt-title">Pay Online</span>
                {prepaidPct > 0 && <span className="ps-save-badge">Save {prepaidPct}%</span>}
              </div>
              <div className="ps-logos">
                {/* UPI */}
                <svg className="ps-logo" viewBox="0 0 52 22" xmlns="http://www.w3.org/2000/svg">
                  <rect width="52" height="22" rx="4" fill="#5A1589"/>
                  <text x="8" y="15.5" fontSize="11" fontWeight="800" fill="#fff" fontFamily="sans-serif">UPI</text>
                </svg>
                {/* Visa */}
                <svg className="ps-logo" viewBox="0 0 52 22" xmlns="http://www.w3.org/2000/svg">
                  <rect width="52" height="22" rx="4" fill="#1A1F71"/>
                  <text x="6" y="16" fontSize="12" fontWeight="800" fill="#fff" fontStyle="italic" fontFamily="sans-serif">VISA</text>
                </svg>
                {/* Mastercard */}
                <svg className="ps-logo" viewBox="0 0 42 22" xmlns="http://www.w3.org/2000/svg">
                  <rect width="42" height="22" rx="4" fill="#fff" stroke="#E8E0D5"/>
                  <circle cx="16" cy="11" r="8" fill="#EB001B"/>
                  <circle cx="26" cy="11" r="8" fill="#F79E1B"/>
                  <path d="M21 5.5a8 8 0 0 1 0 11A8 8 0 0 1 21 5.5z" fill="#FF5F00"/>
                </svg>
                {/* RuPay */}
                <svg className="ps-logo" viewBox="0 0 52 22" xmlns="http://www.w3.org/2000/svg">
                  <rect width="52" height="22" rx="4" fill="#007B40"/>
                  <text x="5" y="15" fontSize="9.5" fontWeight="800" fill="#fff" fontFamily="sans-serif">RuPay</text>
                </svg>
                {/* GPay */}
                <svg className="ps-logo" viewBox="0 0 52 22" xmlns="http://www.w3.org/2000/svg">
                  <rect width="52" height="22" rx="4" fill="#fff" stroke="#E8E0D5"/>
                  <text x="5" y="15.5" fontSize="12" fontWeight="700" fill="#4285F4" fontFamily="sans-serif">G</text>
                  <text x="17" y="15.5" fontSize="10" fontWeight="600" fill="#333" fontFamily="sans-serif">Pay</text>
                </svg>
              </div>
              {payMethod === 'razorpay' && prepaidDiscount > 0 && (
                <div className="ps-disc">🎉 Extra {formatPrice(prepaidDiscount)} off applied!</div>
              )}
            </div>
          </label>
        )}

        {/* COD */}
        {codOk ? (
          <label className={`ps-opt${payMethod === 'cod' ? ' ps-opt--on' : ''}`}>
            <input type="radio" name="ps-pay" value="cod"
              checked={payMethod === 'cod'}
              onChange={() => onChange('cod')}
              className="ps-radio"
            />
            <div className="ps-opt-inner">
              <div className="ps-opt-head">
                <span className="ps-opt-title">Cash on Delivery</span>
                <span className="ps-cod-icon">💵</span>
              </div>
              <p className="ps-opt-sub">Pay in cash when your order arrives</p>
            </div>
          </label>
        ) : (
          <div className="ps-cod-disabled">
            <div className="ps-cod-disabled-left">
              <span className="ps-cod-icon">💵</span>
              <span className="ps-opt-title ps-opt-title--off">Cash on Delivery</span>
            </div>
            <span className="ps-cod-reason">
              {!codEnabled ? 'Unavailable' : total > codMax ? `Max ₹${codMax}` : 'Unavailable'}
            </span>
          </div>
        )}
      </div>

      {/* Security strip */}
      <div className="ps-seals">
        <div className="ps-seal">🔒 SSL Encrypted</div>
        <div className="ps-seal">🏦 Razorpay Secured</div>
        <div className="ps-seal">✅ PCI-DSS</div>
        <div className="ps-seal">🇮🇳 Made for India</div>
      </div>

      <style>{`
        .ps-root {}
        .ps-opts {
          padding: 20px 28px;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        @media (max-width: 640px) { .ps-opts { padding: 16px 20px; } }

        .ps-opt {
          display: flex;
          align-items: flex-start;
          gap: 14px;
          padding: 16px 18px;
          border: 1.5px solid #E0D8CE;
          border-radius: 16px;
          cursor: pointer;
          background: #FDFAF6;
          transition: all .22s ease;
        }
        .ps-opt:hover {
          border-color: #2C4A2E;
          background: #F5FAF3;
          box-shadow: 0 3px 12px rgba(44,74,46,.08);
        }
        .ps-opt--on {
          border-color: #2C4A2E;
          background: #EEF6EC;
          box-shadow: 0 0 0 1px #2C4A2E inset, 0 4px 16px rgba(44,74,46,.1);
        }

        .ps-radio {
          accent-color: #2C4A2E;
          width: 18px;
          height: 18px;
          flex-shrink: 0;
          margin-top: 2px;
          cursor: pointer;
        }

        .ps-opt-inner { flex: 1; }
        .ps-opt-head {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-bottom: 10px;
          flex-wrap: wrap;
        }
        .ps-opt-title {
          font-family: 'DM Sans', sans-serif;
          font-size: 14px;
          font-weight: 600;
          color: #1C2B1E;
          letter-spacing: -0.1px;
        }
        .ps-opt-title--off { color: #B0A898; }
        .ps-save-badge {
          font-family: 'DM Sans', sans-serif;
          font-size: 10px;
          font-weight: 700;
          color: #2C4A2E;
          background: #C8E8B8;
          padding: 3px 8px;
          border-radius: 20px;
          letter-spacing: 0.02em;
        }
        .ps-cod-icon { font-size: 18px; }

        .ps-logos { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
        .ps-logo {
          height: 22px;
          border-radius: 4px;
          flex-shrink: 0;
          box-shadow: 0 1px 3px rgba(0,0,0,.08);
        }

        .ps-opt-sub {
          font-family: 'DM Sans', sans-serif;
          font-size: 12px;
          color: #7A7060;
          margin: 0;
        }
        .ps-disc {
          display: inline-block;
          font-family: 'DM Sans', sans-serif;
          font-size: 12px;
          font-weight: 600;
          color: #2C6030;
          background: #D8F0C8;
          padding: 4px 10px;
          border-radius: 8px;
          margin-top: 8px;
        }

        .ps-cod-disabled {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 14px 18px;
          border: 1.5px dashed #E0D8CE;
          border-radius: 16px;
          background: #F8F6F2;
          opacity: 0.7;
        }
        .ps-cod-disabled-left {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .ps-cod-reason {
          font-family: 'DM Sans', sans-serif;
          font-size: 11px;
          color: #C04030;
          font-weight: 600;
          background: #FEECEA;
          padding: 3px 8px;
          border-radius: 8px;
        }

        .ps-seals {
          display: flex;
          gap: 0;
          padding: 12px 28px;
          background: #F7F2EB;
          border-top: 1px solid #EDE5D8;
          flex-wrap: wrap;
          gap: 6px;
        }
        @media (max-width: 640px) { .ps-seals { padding: 12px 20px; } }
        .ps-seal {
          font-family: 'DM Sans', sans-serif;
          font-size: 11px;
          color: #7A7060;
          font-weight: 500;
          padding: 4px 10px;
          background: #FFFFFF;
          border-radius: 20px;
          border: 1px solid #E0D8CE;
          white-space: nowrap;
        }
      `}</style>
    </div>
  )
}
