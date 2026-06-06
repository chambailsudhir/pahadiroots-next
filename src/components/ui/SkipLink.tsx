'use client'

export default function SkipLink() {
  return (
    <a
      href="#main-content"
      style={{
        position: 'absolute', top: '-40px', left: 0, zIndex: 9999,
        background: '#1a3a1e', color: '#fff', padding: '8px 16px',
        borderRadius: '0 0 6px 0', fontSize: '14px', fontWeight: 700,
        transition: 'top .2s',
      }}
      onFocus={e => { e.currentTarget.style.top = '0' }}
      onBlur={e  => { e.currentTarget.style.top = '-40px' }}
    >
      Skip to main content
    </a>
  )
}
