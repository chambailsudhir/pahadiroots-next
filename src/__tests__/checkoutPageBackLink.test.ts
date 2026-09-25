// ── src/__tests__/checkoutPageBackLink.test.ts ───────────────────────────────
// The Checkout page's "Cart" breadcrumb step was already a real link (a
// prior fix), but as a checkmark bubble it reads as a status indicator first
// and a link second — easy to miss it's clickable. This adds an explicit,
// unmistakable "← Back to Cart" link alongside the breadcrumb.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Checkout page — explicit back-to-cart link', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'app', 'checkout', 'CheckoutClient.tsx'), 'utf8');

  it('renders an explicit Link back to the cart inside the breadcrumb nav', () => {
    const navBlock = src.match(/<nav className="ck-nav">[\s\S]*?<\/nav>/);
    expect(navBlock).toBeTruthy();
    expect(navBlock![0]).toMatch(/<Link href="\/cart" className="ck-nav-back">/);
    expect(navBlock![0]).toMatch(/Back/);
  });

  it('still keeps the "Cart" breadcrumb step itself as a real link (regression guard)', () => {
    expect(src).toMatch(/<Link href="\/cart" className="ck-crumb ck-crumb--done ck-crumb--link">/);
  });
});
