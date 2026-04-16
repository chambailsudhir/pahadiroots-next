-- ============================================================
-- PAHADI ROOTS — DB MIGRATION
-- Run in Supabase SQL Editor BEFORE deploying Next.js site
-- ============================================================

-- ─── 1. Indexes for performance (Audit #B8) ─────────────────
CREATE INDEX IF NOT EXISTS idx_products_slug        ON products(slug);
CREATE INDEX IF NOT EXISTS idx_products_category    ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_state       ON products(state_id);
CREATE INDEX IF NOT EXISTS idx_products_status      ON products(status);
CREATE INDEX IF NOT EXISTS idx_products_deleted     ON products(is_deleted);
CREATE INDEX IF NOT EXISTS idx_order_items_product  ON order_items(product_id);
CREATE INDEX IF NOT EXISTS idx_orders_phone         ON orders(customer_phone);
CREATE INDEX IF NOT EXISTS idx_orders_idem_key      ON orders(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_orders_status        ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_rzp_order_id  ON orders(razorpay_order_id);

-- ─── 2. Add idempotency_key to orders (Audit #A5) ───────────
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS idempotency_key UUID UNIQUE;

-- ─── 3. Reviews table ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reviews (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id     UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  customer_name  TEXT NOT NULL,
  rating         SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment        TEXT,
  is_approved    BOOLEAN NOT NULL DEFAULT false,
  order_id       UUID REFERENCES orders(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reviews_product ON reviews(product_id);
CREATE INDEX IF NOT EXISTS idx_reviews_approved ON reviews(is_approved);

-- ─── 4. Wishlist table ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS wishlist (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID,
  session_id  TEXT,
  product_id  UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(customer_id, product_id),
  UNIQUE(session_id, product_id)
);

-- ─── 5. Webhook logs (Audit #6) ──────────────────────────────
CREATE TABLE IF NOT EXISTS webhook_logs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider     TEXT NOT NULL,
  event        TEXT NOT NULL,
  payload      JSONB,
  status       TEXT NOT NULL DEFAULT 'received',
  processed_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webhook_logs_event ON webhook_logs(event);
CREATE INDEX IF NOT EXISTS idx_webhook_logs_status ON webhook_logs(status);

-- ─── 6. Event logs (Audit #C16) ──────────────────────────────
CREATE TABLE IF NOT EXISTS event_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type TEXT NOT NULL,
  entity_id   UUID NOT NULL,
  event       TEXT NOT NULL,
  actor       TEXT,
  metadata    JSONB DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_event_logs_entity  ON event_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_event_logs_created ON event_logs(created_at DESC);

-- ─── 7. Blog posts (Phase 2) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS blog_posts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title               TEXT NOT NULL,
  slug                TEXT NOT NULL UNIQUE,
  content             TEXT,
  cover_image         TEXT,
  excerpt             TEXT,
  published_at        TIMESTAMPTZ,
  is_published        BOOLEAN NOT NULL DEFAULT false,
  related_product_id  UUID REFERENCES products(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── 8. Orders archive (Phase 2 — Audit #C14) ───────────────
CREATE TABLE IF NOT EXISTS orders_archive (
  LIKE orders INCLUDING ALL
);

-- ─── 9. Atomic stock deduction RPC (Audit #A4) ───────────────
-- Safe atomic stock deduction — prevents race conditions
CREATE OR REPLACE FUNCTION deduct_stock_atomic(
  p_variant_id UUID,
  p_qty        INTEGER
) RETURNS BOOLEAN AS $$
DECLARE
  rows_updated INTEGER;
BEGIN
  UPDATE product_variants
  SET    available_stock = available_stock - p_qty
  WHERE  id = p_variant_id
    AND  available_stock >= p_qty
    AND  is_active = true;

  GET DIAGNOSTICS rows_updated = ROW_COUNT;
  RETURN rows_updated > 0;
END;
$$ LANGUAGE plpgsql;

-- Restore stock on cancellation
CREATE OR REPLACE FUNCTION restore_stock(
  p_variant_id UUID,
  p_qty        INTEGER
) RETURNS VOID AS $$
BEGIN
  UPDATE product_variants
  SET    available_stock = available_stock + p_qty
  WHERE  id = p_variant_id;
END;
$$ LANGUAGE plpgsql;

-- ─── 10. Atomic order creation RPC (Audit #A3) ───────────────
-- Creates order + order_items in a single transaction
CREATE OR REPLACE FUNCTION create_order_atomic(
  p_customer_name    TEXT,
  p_customer_phone   TEXT,
  p_customer_email   TEXT,
  p_customer_id      UUID,
  p_payment_method   TEXT,
  p_address          JSONB,
  p_subtotal         NUMERIC,
  p_discount         NUMERIC,
  p_shipping         NUMERIC,
  p_gst_total        NUMERIC,
  p_total            NUMERIC,
  p_coupon_code      TEXT,
  p_idempotency_key  UUID,
  p_items            JSONB
) RETURNS orders AS $$
DECLARE
  v_order   orders;
  v_item    JSONB;
BEGIN
  -- Insert order
  INSERT INTO orders (
    customer_name, customer_phone, customer_email, customer_id,
    payment_method, address, subtotal, discount, shipping,
    gst_total, total, coupon_code, idempotency_key, status, payment_status
  ) VALUES (
    p_customer_name, p_customer_phone, p_customer_email, p_customer_id,
    p_payment_method, p_address, p_subtotal, p_discount, p_shipping,
    p_gst_total, p_total, p_coupon_code, p_idempotency_key,
    CASE WHEN p_payment_method = 'cod' THEN 'confirmed' ELSE 'pending_payment' END,
    'pending'
  )
  RETURNING * INTO v_order;

  -- Insert order items
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    INSERT INTO order_items (
      order_id, product_id, variant_id, quantity, price, mrp, gst_rate, size
    ) VALUES (
      v_order.id,
      (v_item->>'product_id')::UUID,
      (v_item->>'variant_id')::UUID,
      (v_item->>'quantity')::INTEGER,
      (v_item->>'price')::NUMERIC,
      (v_item->>'mrp')::NUMERIC,
      (v_item->>'gst_rate')::NUMERIC,
      v_item->>'size'
    );
  END LOOP;

  -- Increment coupon usage if applicable
  IF p_coupon_code IS NOT NULL THEN
    UPDATE coupons
    SET uses_count = uses_count + 1
    WHERE code = p_coupon_code;
  END IF;

  RETURN v_order;
END;
$$ LANGUAGE plpgsql;

-- ─── 11. RLS Policies ────────────────────────────────────────
-- Products: public read, no public write
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Products public read" ON products;
CREATE POLICY "Products public read" ON products
  FOR SELECT USING (is_deleted = false AND status = 'active');

-- Categories: public read
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Categories public read" ON categories;
CREATE POLICY "Categories public read" ON categories
  FOR SELECT USING (is_active = true);

-- States: public read
ALTER TABLE states ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "States public read" ON states;
CREATE POLICY "States public read" ON states FOR SELECT USING (true);

-- Site settings: public read
ALTER TABLE site_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Settings public read" ON site_settings;
CREATE POLICY "Settings public read" ON site_settings FOR SELECT USING (true);

-- Reviews: public read (approved only)
ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Reviews public read" ON reviews;
CREATE POLICY "Reviews public read" ON reviews
  FOR SELECT USING (is_approved = true);

-- Orders: NO public access — service key only
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Orders no public access" ON orders;
CREATE POLICY "Orders no public access" ON orders USING (false);

-- ─── 12. New site_settings keys ──────────────────────────────
-- Run these INSERT statements to add new section toggle settings
-- Only inserts if key doesn't already exist

INSERT INTO site_settings (key, value) VALUES
  ('show_trust_bar',          'true'),
  ('show_best_sellers',       'true'),
  ('show_new_arrivals',       'true'),
  ('show_state_stories',      'true'),
  ('show_reviews_section',    'true'),
  ('show_newsletter_bar',     'true'),
  ('show_blog_section',       'false'),
  ('show_wishlist',           'true'),
  ('show_reviews_on_pdp',     'true'),
  ('show_related_products',   'true'),
  ('show_track_order_page',   'true'),
  ('show_blog',               'false'),
  ('catalogue_visible',       'true'),
  ('featured_collection_slug', ''),
  ('prepaid_discount_pct',    '5'),
  ('cod_enabled',             'true'),
  ('cod_max_value',           '3000'),
  ('cod_max_active_orders',   '3')
ON CONFLICT (key) DO NOTHING;
