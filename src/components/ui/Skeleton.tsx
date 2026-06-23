export function ProductCardSkeleton() {
  return (
    <div className="flex flex-col rounded-2xl border border-stone-100 overflow-hidden">
      <div className="aspect-square skeleton" />
      <div className="p-3 space-y-2">
        <div className="skeleton h-3 w-16 rounded" />
        <div className="skeleton h-4 w-full rounded" />
        <div className="skeleton h-4 w-3/4 rounded" />
        <div className="skeleton h-5 w-20 rounded mt-2" />
      </div>
    </div>
  )
}

export function ProductGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-5">
      {Array.from({ length: count }).map((_, i) => (
        <ProductCardSkeleton key={i} />
      ))}
    </div>
  )
}

// BUG FIX (CLS): PDPSkeleton previously used max-w-7xl (Tailwind ≈ 1280px),
// grid-cols-2 (equal 1fr/1fr), and aspect-square for the image placeholder.
// The real page uses max-width:1320px, a 1fr/1.15fr grid, and a 4/5 image
// ratio. The instant real content streamed in, both width and image height
// visibly jumped — directly hurting Cumulative Layout Shift.
// Fixed: skeleton now mirrors the exact same layout constraints as the page.
export function PDPSkeleton() {
  return (
    <div style={{ maxWidth: '1320px', margin: '0 auto', padding: '24px 32px 80px' }}>
      {/* Breadcrumb row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <div className="skeleton" style={{ height: '16px', width: '220px', borderRadius: '8px' }} />
        <div className="skeleton" style={{ height: '34px', width: '120px', borderRadius: '30px' }} />
      </div>

      {/* Two-column grid matching pdp-wrap: 1fr 1.15fr */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.15fr', gap: '44px', alignItems: 'start' }}>

        {/* LEFT: Gallery — 4:5 aspect ratio, matching ProductGallery */}
        <div>
          <div className="skeleton" style={{ aspectRatio: '4/5', borderRadius: '20px', width: '100%' }} />
          {/* Thumbnails row */}
          <div style={{ display: 'flex', gap: '10px', marginTop: '14px' }}>
            {[1, 2, 3].map(i => (
              <div key={i} className="skeleton" style={{ width: '80px', height: '80px', borderRadius: '12px', flexShrink: 0 }} />
            ))}
          </div>
        </div>

        {/* RIGHT: Info column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', paddingTop: '8px' }}>
          {/* Region label */}
          <div className="skeleton" style={{ height: '13px', width: '140px', borderRadius: '6px' }} />
          {/* Title */}
          <div className="skeleton" style={{ height: '38px', width: '85%', borderRadius: '8px' }} />
          <div className="skeleton" style={{ height: '38px', width: '60%', borderRadius: '8px' }} />
          {/* Rating */}
          <div className="skeleton" style={{ height: '18px', width: '180px', borderRadius: '6px' }} />
          {/* Price */}
          <div className="skeleton" style={{ height: '44px', width: '160px', borderRadius: '8px' }} />
          <div className="skeleton" style={{ height: '13px', width: '200px', borderRadius: '6px' }} />
          {/* Benefits card */}
          <div className="skeleton" style={{ height: '160px', width: '100%', borderRadius: '16px' }} />
          {/* Variant pills */}
          <div style={{ display: 'flex', gap: '10px' }}>
            {[1, 2, 3].map(i => (
              <div key={i} className="skeleton" style={{ height: '44px', width: '80px', borderRadius: '12px' }} />
            ))}
          </div>
          {/* ATC button */}
          <div className="skeleton" style={{ height: '52px', width: '100%', borderRadius: '12px' }} />
          {/* Stock + pincode rows */}
          <div className="skeleton" style={{ height: '20px', width: '120px', borderRadius: '6px' }} />
          <div className="skeleton" style={{ height: '40px', width: '100%', borderRadius: '10px' }} />
        </div>
      </div>
    </div>
  )
}

export function InlineSkeleton({ className }: { className?: string }) {
  return <div className={`skeleton ${className || 'h-4 w-full rounded'}`} />
}
