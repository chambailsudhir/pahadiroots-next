'use client'
// ─────────────────────────────────────────────────────────────
// /account/orders/[id]/review — rate & review the products of a DELIVERED order (verified purchase).
// Data: GET /api/v1/reviews/eligible?order_id=  ·  Submit: POST /api/v1/actions {action:'submit_review'}.
// The server derives the reviewer (customer, display name) from the session; nothing identifying is sent from here.
// ─────────────────────────────────────────────────────────────
import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import styles from '../../../styles/account.module.css'

const MAX = 1000

interface Item { product_id: number; name: string; variant?: string | null; image: string | null; emoji?: string | null; already_reviewed: boolean }
interface Eligible { order_id: number; order_number: string; delivered: boolean; items: Item[] }

type LoadState =
  | { kind: 'loading' }
  | { kind: 'error'; status: number; message: string }
  | { kind: 'ready'; data: Eligible }

function ReviewForm({ orderId, item }: { orderId: string; item: Item }) {
  const [rating, setRating]   = useState(0)
  const [comment, setComment] = useState('')
  const [busy, setBusy]       = useState(false)
  const [done, setDone]       = useState(item.already_reviewed ? 'already' : '')
  const [err, setErr]         = useState('')
  const [needLogin, setNeedLogin] = useState(false)
  const group = `rating-${item.product_id}`

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    if (rating < 1) { setErr('Please choose a star rating.'); return }
    setBusy(true); setErr(''); setNeedLogin(false)
    try {
      const res = await fetch('/api/v1/actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'submit_review', product_id: item.product_id, order_id: Number(orderId), rating, comment: comment.trim() || undefined }),
      })
      const json = await res.json().catch(() => ({} as { error?: string; code?: string }))
      if (res.ok && json.success) { setDone('submitted'); return }
      if (res.status === 401) { setNeedLogin(true); setErr('Please sign in again to submit your review.'); return }
      if (res.status === 409 && json.code === 'already_reviewed') { setDone('already'); return }
      setErr(json.error || 'Could not submit your review. Please try again.')
    } catch {
      setErr('Network problem — please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className={styles.odCard} aria-label={`Review for ${item.name}`}>
      <div className={styles.rvItemHead}>
        {/* Always show WHICH product this is: photo (or a tile when it has none), name and size. */}
        <div className={styles.odItemImg} aria-hidden="true">
          {item.image
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={item.image} alt="" loading="lazy" />
            : <span style={{ fontSize: 22 }}>{item.emoji || '🌿'}</span>}
        </div>
        <div>
          <div className={styles.rvItemName}>{item.name}</div>
          {item.variant && <div className={styles.rvNote} style={{ margin: 0 }}>{item.variant}</div>}
        </div>
      </div>

      {done === 'submitted' && <p role="status" className={styles.rvOk}>Thanks — your review will appear after moderation.</p>}
      {done === 'already' && <p role="status" className={styles.rvNote}>You have already reviewed this product. Thank you!</p>}

      {!done && (
        <form onSubmit={submit} noValidate>
          <fieldset className={styles.rvFieldset}>
            <legend className={styles.rvLegend}>Your rating</legend>
            <div className={styles.rvStars}>
              {[1, 2, 3, 4, 5].map(n => (
                <label key={n} className={styles.rvStarLbl}>
                  <input
                    type="radio" name={group} value={n} className={styles.rvRadio}
                    checked={rating === n} onChange={() => { setRating(n); setErr('') }}
                    aria-label={`${n} star${n > 1 ? 's' : ''}`}
                  />
                  <span aria-hidden="true" className={`${styles.rvStarIcon} ${n <= rating ? styles.rvStarOn : ''}`}>{n <= rating ? '★' : '☆'}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <label className={styles.rvTextLbl} htmlFor={`${group}-text`}>Your review (optional)</label>
          <textarea
            id={`${group}-text`} className={styles.rvText} value={comment} maxLength={MAX}
            onChange={e => setComment(e.target.value)}
            aria-describedby={`${group}-count`} placeholder="What did you like? How was the taste, quality and packing?"
          />
          <div id={`${group}-count`} className={styles.rvCount}>{comment.length}/{MAX}</div>

          <div className={styles.rvActions}>
            <button type="submit" className={styles.rvSubmit} disabled={busy}>{busy ? 'Submitting…' : 'Submit review'}</button>
            {err && <span role="alert" className={styles.rvErr}>{err}</span>}
            {needLogin && <Link prefetch={false} href="/account" className={styles.odBackLink} style={{ fontWeight: 700 }}>Sign in</Link>}
          </div>
        </form>
      )}
    </section>
  )
}

export default function OrderReviewPage() {
  const { id } = useParams<{ id: string }>()
  const [state, setState] = useState<LoadState>({ kind: 'loading' })

  useEffect(() => {
    if (!id) return
    const ctrl = new AbortController()
    fetch(`/api/v1/reviews/eligible?order_id=${encodeURIComponent(id)}`, { signal: ctrl.signal })
      .then(async res => {
        const json = await res.json().catch(() => ({}))
        if (ctrl.signal.aborted) return
        if (!res.ok) setState({ kind: 'error', status: res.status, message: json.error || `Error ${res.status}` })
        else setState({ kind: 'ready', data: json as Eligible })
      })
      .catch(() => {
        if (!ctrl.signal.aborted) setState({ kind: 'error', status: 0, message: 'Could not load your order. Please try again.' })
      })
    return () => ctrl.abort()
  }, [id])

  const back = (
    <Link prefetch={false} href={`/account/orders/${id}`} className={styles.odBackLink}>← Back to order</Link>
  )

  if (state.kind === 'loading') {
    return <div className={`${styles.odSkWrap} ${styles.odSkBlock}`} aria-busy="true"><div className={styles.odSkTitle} /><div className={styles.odSkCard} /></div>
  }

  if (state.kind === 'error') {
    return (
      <div className={styles.odError}>
        <p className={styles.odErrorMsg} role="alert">
          {state.status === 401 ? 'Please sign in to review the products you bought.' : state.status === 404 ? 'We could not find that order.' : state.message}
        </p>
        {state.status === 401 && <Link prefetch={false} href="/account" className={styles.odBackLink} style={{ fontWeight: 700, marginRight: 16 }}>Sign in</Link>}
        <Link prefetch={false} href="/account" className={styles.odBackLink}>← Back to Account</Link>
      </div>
    )
  }

  const { data } = state
  const allDone = data.items.length > 0 && data.items.every(i => i.already_reviewed)

  return (
    <div className={styles.odRoot}>
      <div>
        {back}
        <div className={styles.odOrderNum} role="heading" aria-level={1}>Rate &amp; review</div>
        <div className={styles.odOrderDate}>Order {data.order_number}</div>
      </div>

      {!data.delivered && (
        <div className={styles.odCard}>
          <p className={styles.rvNote}>You can review the products in this order once it has been delivered. We will e-mail you a few days after it arrives.</p>
        </div>
      )}

      {data.delivered && allDone && (
        <div className={styles.odCard}>
          <p className={styles.rvNote} role="status">You have already reviewed every product in this order. Thank you for helping other customers!</p>
        </div>
      )}

      {data.delivered && !allDone && (
        <p className={styles.rvNote}>Your review is marked <strong>Verified purchase</strong> and appears on the product page after a quick check by our team.</p>
      )}

      {data.delivered && !allDone && (
        <div className={styles.rvList}>
          {data.items.map(item => <ReviewForm key={item.product_id} orderId={id} item={item} />)}
        </div>
      )}
    </div>
  )
}
