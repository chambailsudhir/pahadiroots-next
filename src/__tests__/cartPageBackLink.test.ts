// ── src/__tests__/cartPageBackLink.test.ts ───────────────────────────────────
// The checkout-progress step tracker on the Cart page previously had no way
// back to the store other than a "Continue Shopping" link buried at the
// bottom of the order-summary sidebar (easy to miss, especially on mobile,
// above the fold). This adds a clear "← Continue Shopping" link right next
// to the step tracker at the top of the page.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Cart page — back link next to the step tracker', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'app', 'cart', 'page.tsx'), 'utf8');

  it('renders a Link back to the store inside the checkout progress nav', () => {
    const navBlock = src.match(/<nav className="cp-steps"[\s\S]*?<\/nav>/);
    expect(navBlock).toBeTruthy();
    expect(navBlock![0]).toMatch(/<Link href="\/" className="cp-steps-back">/);
    expect(navBlock![0]).toMatch(/Continue Shopping/);
  });
});
