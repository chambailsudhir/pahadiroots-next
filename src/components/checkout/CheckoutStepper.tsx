/**
 * CheckoutStepper — the single Cart → Checkout → Confirmation progress indicator (S1/S2).
 *
 * Before: the cart page and the checkout page each hand-wrote their own stepper with the
 * state baked into literal class names, so the two drifted (different semantics, different
 * a11y) and the confirmation page had none. Now every step's state is DERIVED from `current`.
 *
 * Each page keeps its own current look (this is not a redesign): `skin="cart"` renders the
 * cart page's uppercase/bordered-circle style, `skin="checkout"` the checkout page's
 * sentence-case/filled-dot style (also used on the confirmation page). Semantics are the
 * same for both: <nav aria-label> > <ol> > <li>, with aria-current="step" on the current step.
 *
 * Navigation (S3): only "Cart" is ever a link, and only while on Checkout. Confirmation is
 * never reachable through the stepper, and after an order is placed there is nothing to go
 * "back" to.
 */
import Link from 'next/link'
import type { ReactNode } from 'react'
import './checkout-stepper.css'

export type CheckoutStep = 'cart' | 'checkout' | 'confirmation'

const STEPS: ReadonlyArray<{ key: CheckoutStep; label: string }> = [
  { key: 'cart',         label: 'Cart' },
  { key: 'checkout',     label: 'Checkout' },
  { key: 'confirmation', label: 'Confirmation' },
]

type StepState = 'done' | 'active' | 'upcoming'

/** Exported for tests: the one rule that decides every step's state. */
export function stepStates(current: CheckoutStep): Record<CheckoutStep, StepState> {
  const cur = STEPS.findIndex(s => s.key === current)
  return Object.fromEntries(
    STEPS.map((s, i) => [s.key, i < cur ? 'done' : i === cur ? 'active' : 'upcoming']),
  ) as Record<CheckoutStep, StepState>
}

interface Props {
  current: CheckoutStep
  skin:    'cart' | 'checkout'
  /** Rendered before the steps inside the nav (each page's own "← back" link). */
  children?: ReactNode
}

export default function CheckoutStepper({ current, skin, children }: Props) {
  const state = stepStates(current)
  const cartIsLink = current === 'checkout'   // S3

  if (skin === 'cart') {
    return (
      <nav className="cp-steps" aria-label="Checkout progress">
        {children}
        <ol className="cp-steps-list">
          {STEPS.map((s, i) => (
            <StepItemCart key={s.key} index={i + 1} label={s.label} state={state[s.key]} />
          ))}
        </ol>
      </nav>
    )
  }

  return (
    <nav className="ck-nav" aria-label="Checkout progress">
      <div className={`ck-nav-inner${children ? '' : ' ck-nav-inner--solo'}`}>
        {children}
        <ol className="ck-nav-crumbs">
          {STEPS.map((s, i) => (
            <StepItemCheckout
              key={s.key}
              index={i + 1}
              label={s.label}
              state={state[s.key]}
              href={s.key === 'cart' && cartIsLink ? '/cart' : undefined}
              showLine={i > 0}
              lineDone={i > 0 && state[STEPS[i - 1].key] === 'done'}
            />
          ))}
        </ol>
      </div>
    </nav>
  )
}

function StepItemCart({ index, label, state }: { index: number; label: string; state: StepState }) {
  const cls = state === 'active' ? 'cp-step cp-step-active' : state === 'done' ? 'cp-step cp-step-done' : 'cp-step'
  return (
    <>
      {index > 1 && <li className="cp-step-line" aria-hidden="true" />}
      <li className={cls} aria-current={state === 'active' ? 'step' : undefined}>
        <span aria-hidden="true">{state === 'done' ? '✓' : index}</span> {label}
      </li>
    </>
  )
}

function StepItemCheckout({
  index, label, state, href, showLine, lineDone,
}: { index: number; label: string; state: StepState; href?: string; showLine: boolean; lineDone: boolean }) {
  const crumbCls = `ck-crumb${state === 'done' ? ' ck-crumb--done' : state === 'active' ? ' ck-crumb--active' : ''}${href ? ' ck-crumb--link' : ''}`
  const dotCls   = `ck-crumb-dot${state === 'done' ? ' ck-crumb-dot--done' : state === 'active' ? ' ck-crumb-dot--active' : ''}`
  const inner = (
    <>
      <div className={dotCls} aria-hidden="true">{state === 'done' ? '✓' : index}</div>
      <span>{label}</span>
    </>
  )
  return (
    <>
      {showLine && <li className={`ck-crumb-line${lineDone ? ' ck-crumb-line--done' : ''}`} aria-hidden="true" />}
      <li className="ck-step-item" aria-current={state === 'active' ? 'step' : undefined}>
        {href
          ? <Link href={href} className={crumbCls}>{inner}</Link>
          : <div className={crumbCls}>{inner}</div>}
      </li>
    </>
  )
}
