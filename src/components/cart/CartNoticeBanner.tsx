'use client'

/** C1 — tells the customer their cart was refreshed with live prices / stock. */
export default function CartNoticeBanner({ messages, onDismiss }: { messages: string[]; onDismiss: () => void }) {
  if (messages.length === 0) return null
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="cart-notice-banner"
      style={{
        background: '#fff8e6', border: '1.5px solid #e8c940', borderRadius: 12,
        padding: '12px 16px', margin: '12px auto', maxWidth: 1100, color: '#5a4300', fontSize: 14,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
        <div>
          <strong>Your cart was updated</strong>
          <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
            {messages.map((m, i) => <li key={i}>{m}</li>)}
          </ul>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss cart update notice"
          style={{ background: 'none', border: 0, fontSize: 20, lineHeight: 1, cursor: 'pointer', color: '#5a4300' }}
        >×</button>
      </div>
    </div>
  )
}
