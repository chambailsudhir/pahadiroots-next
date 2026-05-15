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
    <div className="ps-wrap">
      <div className="ps-opts">
        {/* Online payment */}
        {razorpayEnabled && (
          <label className={`ps-opt${payMethod === 'razorpay' ? ' active' : ''}`}>
            <input type="radio" name="ps-pay" value="razorpay"
              checked={payMethod === 'razorpay'}
              onChange={() => onChange('razorpay')}
            />
            <div className="ps-body">
              <div className="ps-title">
                Online Payment
                {prepaidPct > 0 && <span className="ps-badge">Save {prepaidPct}%</span>}
              </div>
              <div className="ps-logos">
                {/* UPI */}
                <svg className="ps-svg" viewBox="0 0 52 22" xmlns="http://www.w3.org/2000/svg">
                  <rect width="52" height="22" rx="4" fill="#6a1b9a"/>
                  <text x="6" y="15" fontSize="10" fontWeight="800" fill="#fff" fontFamily="sans-serif">UPI</text>
                </svg>
                {/* Visa */}
                <svg className="ps-svg" viewBox="0 0 52 22" xmlns="http://www.w3.org/2000/svg">
                  <rect width="52" height="22" rx="4" fill="#1a1f71"/>
                  <text x="6" y="16" fontSize="12" fontWeight="800" fill="#fff" fontStyle="italic" fontFamily="sans-serif">VISA</text>
                </svg>
                {/* Mastercard */}
                <svg className="ps-svg" viewBox="0 0 42 22" xmlns="http://www.w3.org/2000/svg">
                  <rect width="42" height="22" rx="4" fill="#fff" stroke="#e8e8e8"/>
                  <circle cx="16" cy="11" r="8" fill="#eb001b"/>
                  <circle cx="26" cy="11" r="8" fill="#f79e1b"/>
                  <path d="M21 5.5a8 8 0 0 1 0 11A8 8 0 0 1 21 5.5z" fill="#ff5f00"/>
                </svg>
                {/* RuPay */}
                <svg className="ps-svg" viewBox="0 0 52 22" xmlns="http://www.w3.org/2000/svg">
                  <rect width="52" height="22" rx="4" fill="#008c44"/>
                  <text x="5" y="15" fontSize="9" fontWeight="800" fill="#fff" fontFamily="sans-serif">RuPay</text>
                </svg>
                {/* GPay */}
                <svg className="ps-svg" viewBox="0 0 52 22" xmlns="http://www.w3.org/2000/svg">
                  <rect width="52" height="22" rx="4" fill="#fff" stroke="#e8e8e8"/>
                  <text x="5" y="15" fontSize="11" fontWeight="700" fill="#4285f4" fontFamily="sans-serif">G</text>
                  <text x="17" y="15" fontSize="10" fontWeight="600" fill="#333" fontFamily="sans-serif">Pay</text>
                </svg>
                {/* PhonePe */}
                <svg className="ps-svg" viewBox="0 0 52 22" xmlns="http://www.w3.org/2000/svg">
                  <rect width="52" height="22" rx="4" fill="#5f259f"/>
                  <text x="4" y="15" fontSize="8" fontWeight="700" fill="#fff" fontFamily="sans-serif">PhonePe</text>
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
          <label className={`ps-opt${payMethod === 'cod' ? ' active' : ''}`}>
            <input type="radio" name="ps-pay" value="cod"
              checked={payMethod === 'cod'}
              onChange={() => onChange('cod')}
            />
            <div className="ps-body">
              <div className="ps-title">💵 Cash on Delivery</div>
              <div className="ps-sub">Pay in cash when your order arrives at your doorstep</div>
            </div>
          </label>
        ) : (
          <div className="ps-cod-off">
            <span>💵 Cash on Delivery</span>
            <span className="ps-cod-reason">
              {!codEnabled
                ? 'Currently unavailable'
                : total > codMax
                  ? `Not available for orders above ₹${codMax}`
                  : 'Unavailable for this order'}
            </span>
          </div>
        )}
      </div>

      {/* Trust seals */}
      <div className="ps-seals">
        <span>🔒 SSL Encrypted</span>
        <span>🏦 Razorpay Secured</span>
        <span>✅ PCI-DSS</span>
        <span>🇮🇳 Made for India</span>
      </div>

      <style>{`
        .ps-wrap{}
        .ps-opts{padding:14px 20px;display:flex;flex-direction:column;gap:10px;}
        .ps-opt{display:flex;align-items:flex-start;gap:12px;padding:13px 15px;
          border:1.5px solid #e2dbd0;border-radius:12px;cursor:pointer;
          transition:all .2s;background:#fafaf8;}
        .ps-opt:hover{border-color:#1a3a1e;background:#e8f5e9;
          transform:translateY(-1px);box-shadow:0 3px 10px rgba(0,0,0,.06);}
        .ps-opt.active{border-color:#1a3a1e;background:#e8f5e9;}
        .ps-opt input[type=radio]{accent-color:#1a3a1e;width:16px;height:16px;
          flex-shrink:0;margin-top:2px;cursor:pointer;}
        .ps-body{flex:1;}
        .ps-title{font-size:14px;font-weight:700;color:#1a1a1a;
          display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:7px;
          font-family:inherit;}
        .ps-badge{background:#1a3a1e;color:#fff;font-size:10px;font-weight:700;
          padding:2px 8px;border-radius:10px;}
        .ps-logos{display:flex;gap:5px;flex-wrap:wrap;align-items:center;}
        .ps-svg{height:22px;border-radius:4px;flex-shrink:0;}
        .ps-sub{font-size:12px;color:#7a7565;margin-top:4px;font-family:inherit;}
        .ps-disc{font-size:12px;color:#2d6a4f;font-weight:700;
          background:#e8f5e9;padding:4px 10px;border-radius:6px;
          margin-top:7px;display:inline-block;font-family:inherit;}
        .ps-cod-off{padding:13px 15px;background:#f5f5f5;border:1px solid #e8e8e8;
          border-radius:12px;font-size:13px;color:#bbb;
          display:flex;align-items:center;justify-content:space-between;
          flex-wrap:wrap;gap:6px;font-family:inherit;}
        .ps-cod-reason{font-size:11px;color:#c0392b;font-weight:600;}
        .ps-seals{display:flex;gap:10px;flex-wrap:wrap;padding:10px 20px;
          background:#f5f0e8;border-top:1px solid #ede8df;
          font-size:11px;color:#7a7565;font-family:inherit;}
      `}</style>
    </div>
  )
}
