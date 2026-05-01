'use client';
import { useEffect } from 'react';

export default function Modal({ title, onClose, children, width = '700px', fullscreen = false }) {
  // Prevent body scroll when modal open
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.8)' }}
      // Only close on backdrop click if NOT fullscreen (fullscreen = product edit)
      onClick={e => { if (!fullscreen && e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="rounded-xl flex flex-col overflow-hidden"
        style={{
          background: 'var(--bg2,#161b22)',
          border: '1px solid var(--bd,#1a5c2a)',
          width: fullscreen ? 'calc(100vw - 32px)' : width,
          maxWidth: fullscreen ? '1400px' : undefined,
          height: fullscreen ? 'calc(100vh - 32px)' : undefined,
          maxHeight: fullscreen ? undefined : '90vh',
          boxShadow: '0 25px 60px rgba(0,0,0,0.6)',
          // Prevent any pointer events on the backdrop leaking through
          position: 'relative',
        }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3.5 flex-shrink-0"
          style={{ background: 'var(--bg,#0d1117)', borderBottom: '1px solid var(--bd,#1a5c2a)' }}>
          <h2 className="text-[14px] font-bold" style={{ color: 'var(--tx,#ffffff)' }}>{title}</h2>
          <button
            onClick={onClose}
            className="text-2xl leading-none w-7 h-7 flex items-center justify-center rounded transition hover:bg-red-900/30"
            style={{ color: 'var(--tx2,#6e7681)' }}
          >×</button>
        </div>
        <div className="overflow-y-auto p-5 flex-1" style={{ background: 'var(--bg2,#161b22)' }}>
          {children}
        </div>
      </div>
    </div>
  );
}
