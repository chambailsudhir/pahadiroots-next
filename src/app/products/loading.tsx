import { ProductGridSkeleton } from '@/components/ui/Skeleton'

export default function Loading() {
  return (
    <div style={{ background: '#f9f4ec', minHeight: '100vh' }}>
      <div style={{ background: 'linear-gradient(135deg,#1a3a1e 0%,#2d5a35 60%,#3a7042 100%)',
        padding: '40px 40px 36px' }}>
        <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
          <div className="skeleton" style={{ height: '14px', width: '160px', marginBottom: '16px', borderRadius: '4px' }} />
          <div className="skeleton" style={{ height: '38px', width: '240px', marginBottom: '8px', borderRadius: '6px' }} />
          <div className="skeleton" style={{ height: '14px', width: '320px', borderRadius: '4px' }} />
        </div>
      </div>
      <div style={{ maxWidth: '1400px', margin: '0 auto', padding: '24px 40px 60px' }}>
        <ProductGridSkeleton count={12} />
      </div>
    </div>
  )
}
