/**
 * pendingRemovalsRegistry — module-level singleton that lets CartDrawer
 * synchronously flush pending removals before navigating to /checkout.
 *
 * Problem: CartDrawer is rendered in the root layout (a server component).
 * It cannot receive a flushPendingRemovals prop from useCartPage, which
 * lives only on the /cart page. Without this, a user who clicks Remove in
 * the cart page and then taps "Proceed to Checkout" inside the drawer —
 * within the 4-second undo window — sends the ghost item into the order.
 *
 * Solution: useCartPage registers its flushPendingRemovals callback here
 * on mount and deregisters on unmount. CartDrawer reads it when the
 * checkout CTA is tapped. When the user is not on the cart page (no
 * callback registered), the registry is a no-op — pendingRemovals is
 * only possible on the cart page where the hook runs.
 */

type FlushFn = () => void

let _flush: FlushFn | null = null

export const pendingRemovalsRegistry = {
  register(fn: FlushFn): void {
    _flush = fn
  },
  deregister(): void {
    _flush = null
  },
  flush(): void {
    _flush?.()
  },
}
