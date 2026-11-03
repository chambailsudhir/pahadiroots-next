// "Verified purchase" - rendered ONLY for a review row whose is_verified_purchase === true (the property is absent before
// db_migration_v23, and on every legacy review, which must never claim verification).
import { isVerifiedReview } from '@/lib/reviews'

export default function VerifiedBadge({ review }: { review: unknown }) {
  if (!isVerifiedReview(review)) return null
  return (
    <span
      data-testid="verified-purchase"
      style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 700, color: '#166534' }}
    >
      <svg aria-hidden="true" width="12" height="12" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M16.7 5.3a1 1 0 010 1.4l-7.5 7.5a1 1 0 01-1.4 0L3.3 9.7a1 1 0 111.4-1.4l3.8 3.8 6.8-6.8a1 1 0 011.4 0z" clipRule="evenodd" /></svg>
      Verified purchase
    </span>
  )
}
