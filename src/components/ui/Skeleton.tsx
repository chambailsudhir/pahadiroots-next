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

export function PDPSkeleton() {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
        <div className="aspect-square skeleton rounded-2xl" />
        <div className="space-y-4">
          <div className="skeleton h-4 w-24 rounded" />
          <div className="skeleton h-8 w-3/4 rounded" />
          <div className="skeleton h-6 w-32 rounded" />
          <div className="skeleton h-20 w-full rounded" />
          <div className="flex gap-2">
            {[1,2,3].map(i => <div key={i} className="skeleton h-10 w-20 rounded-xl" />)}
          </div>
          <div className="skeleton h-14 w-full rounded-xl" />
        </div>
      </div>
    </div>
  )
}

export function InlineSkeleton({ className }: { className?: string }) {
  return <div className={`skeleton ${className || 'h-4 w-full rounded'}`} />
}
