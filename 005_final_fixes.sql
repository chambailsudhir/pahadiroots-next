-- ══════════════════════════════════════════════════════════════════════════════
-- Pahadi Roots — Final DB Migration (fixes all partial issues)
-- Run in: Supabase Dashboard → SQL Editor
-- Safe to re-run — uses IF NOT EXISTS / IF EXISTS / ON CONFLICT DO NOTHING
-- ══════════════════════════════════════════════════════════════════════════════


-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- ISSUE #7 / #22 — Atomic inventory sync trigger
-- products.available_stock = SUM of active variant stocks
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE OR REPLACE FUNCTION sync_product_stock()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_pid bigint;
BEGIN
  v_pid := CASE WHEN TG_OP = 'DELETE' THEN OLD.product_id ELSE NEW.product_id END;
  UPDATE products
  SET available_stock = (
    SELECT COALESCE(SUM(available_stock),0)
    FROM product_variants
    WHERE product_id = v_pid AND is_active = true
  )
  WHERE id = v_pid;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_sync_product_stock ON product_variants;
CREATE TRIGGER trg_sync_product_stock
  AFTER INSERT OR UPDATE OF available_stock, is_active OR DELETE
  ON product_variants FOR EACH ROW EXECUTE FUNCTION sync_product_stock();

-- Backfill existing products
UPDATE products p SET available_stock = (
  SELECT COALESCE(SUM(v.available_stock),0)
  FROM product_variants v WHERE v.product_id = p.id AND v.is_active = true
);


-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- ISSUE #24 — numeric(12,2) precision on all money columns
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

ALTER TABLE products
  ALTER COLUMN price             TYPE numeric(12,2) USING price::numeric(12,2),
  ALTER COLUMN selling_price     TYPE numeric(12,2) USING selling_price::numeric(12,2),
  ALTER COLUMN mrp               TYPE numeric(12,2) USING mrp::numeric(12,2),
  ALTER COLUMN compare_at_price  TYPE numeric(12,2) USING compare_at_price::numeric(12,2),
  ALTER COLUMN cost_price        TYPE numeric(12,2) USING cost_price::numeric(12,2);

ALTER TABLE product_variants
  ALTER COLUMN price             TYPE numeric(12,2) USING price::numeric(12,2),
  ALTER COLUMN original_price    TYPE numeric(12,2) USING original_price::numeric(12,2);

ALTER TABLE order_items
  ALTER COLUMN price             TYPE numeric(12,2) USING price::numeric(12,2),
  ALTER COLUMN mrp_snapshot      TYPE numeric(12,2) USING mrp_snapshot::numeric(12,2),
  ALTER COLUMN cost_price_snapshot TYPE numeric(12,2) USING cost_price_snapshot::numeric(12,2);


-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- ISSUE #26 — Row Level Security policies
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- Enable RLS on all sensitive tables
ALTER TABLE products          ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders            ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items       ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers         ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_variants  ENABLE ROW LEVEL SECURITY;
ALTER TABLE coupons           ENABLE ROW LEVEL SECURITY;
ALTER TABLE coupon_usage      ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_movements   ENABLE ROW LEVEL SECURITY;
ALTER TABLE pricing_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_channel_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE return_rate_config     ENABLE ROW LEVEL SECURITY;

-- Service role bypasses RLS — used by admin API (SECURITY DEFINER functions)
-- The admin backend uses service_role key which bypasses RLS entirely.
-- These policies protect the tables from direct anon/user access.

-- Public storefront: read active products only
DROP POLICY IF EXISTS products_public_read ON products;
CREATE POLICY products_public_read ON products
  FOR SELECT TO anon, authenticated
  USING (is_deleted = false AND status = 'active');

-- No direct DML from browser on sensitive tables (all writes go via API → service_role)
DROP POLICY IF EXISTS orders_no_direct ON orders;
CREATE POLICY orders_no_direct ON orders FOR ALL TO anon USING (false);

DROP POLICY IF EXISTS customers_no_direct ON customers;
CREATE POLICY customers_no_direct ON customers FOR ALL TO anon USING (false);

DROP POLICY IF EXISTS coupons_no_direct ON coupons;
CREATE POLICY coupons_no_direct ON coupons FOR ALL TO anon USING (false);

-- Variants readable by public (for storefront)
DROP POLICY IF EXISTS variants_public_read ON product_variants;
CREATE POLICY variants_public_read ON product_variants
  FOR SELECT TO anon, authenticated USING (is_active = true);


-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- ISSUE #27 — Missing UNIQUE constraints
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- UNIQUE(coupon_code) — prevent duplicate coupon codes
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'coupons_code_key'
  ) THEN
    ALTER TABLE coupons ADD CONSTRAINT coupons_code_key UNIQUE (code);
  END IF;
END $$;

-- UNIQUE(sku) on product_variants — already done in 003 but safe to re-run
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'product_variants_sku_key'
  ) THEN
    ALTER TABLE product_variants ADD CONSTRAINT product_variants_sku_key UNIQUE (sku);
  END IF;
END $$;

-- UNIQUE(slug) on products
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'products_slug_key'
  ) THEN
    ALTER TABLE products ADD CONSTRAINT products_slug_key UNIQUE (slug);
  END IF;
END $$;

-- UNIQUE(email) on customers
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'customers_email_key'
  ) THEN
    ALTER TABLE customers ADD CONSTRAINT customers_email_key UNIQUE (email);
  END IF;
END $$;


-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- ISSUE #30 — Composite indexes for production-scale queries
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE INDEX IF NOT EXISTS idx_products_active_category
  ON products(category_id) WHERE is_deleted = false AND status = 'active';

CREATE INDEX IF NOT EXISTS idx_products_active_state
  ON products(state_id) WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS idx_products_status_deleted
  ON products(status, is_deleted);

CREATE INDEX IF NOT EXISTS idx_orders_status_created
  ON orders(order_status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_orders_customer
  ON orders(customer_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_order_items_product
  ON order_items(product_id, order_id);

CREATE INDEX IF NOT EXISTS idx_order_items_variant
  ON order_items(variant_id);

CREATE INDEX IF NOT EXISTS idx_variants_product_active
  ON product_variants(product_id, is_active) WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_stock_movements_variant
  ON stock_movements(variant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_stock_movements_order
  ON stock_movements(order_id) WHERE order_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_price_history_product
  ON product_price_history(product_id, changed_at DESC);

CREATE INDEX IF NOT EXISTS idx_coupons_code
  ON coupons(code) WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_coupon_usage_customer
  ON coupon_usage(customer_id, coupon_id);


-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- ISSUE #47 — AI content in separate table
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE TABLE IF NOT EXISTS product_ai_content (
  id              bigserial     PRIMARY KEY,
  product_id      bigint        NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  field_name      text          NOT NULL,  -- 'description' | 'short_description' | 'tags' | 'badges'
  content         text          NOT NULL,
  provider        text          NOT NULL DEFAULT 'gemini',  -- 'gemini' | 'claude' | 'openai'
  model           text,
  prompt_version  text,
  approved        boolean       NOT NULL DEFAULT false,
  approved_by     text,
  approved_at     timestamptz,
  generated_at    timestamptz   NOT NULL DEFAULT now(),
  tokens_used     int,
  UNIQUE (product_id, field_name)  -- one active AI content per field per product
);

CREATE INDEX IF NOT EXISTS idx_ai_content_product ON product_ai_content(product_id);
CREATE INDEX IF NOT EXISTS idx_ai_content_approved ON product_ai_content(approved) WHERE approved = false;

-- Migrate existing AI content from products table (safe — runs only if column exists)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name = 'products' AND column_name = 'ai_description') THEN
    INSERT INTO product_ai_content (product_id, field_name, content, provider, approved)
    SELECT id, 'description', ai_description, COALESCE(ai_provider,'gemini'), true
    FROM products
    WHERE ai_description IS NOT NULL AND ai_description != ''
    ON CONFLICT (product_id, field_name) DO NOTHING;
  END IF;
END $$;

GRANT ALL ON product_ai_content TO service_role;


-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- ISSUE #48 — jsonb columns for structured data
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- Convert variant_snapshot from text → jsonb (order_items)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name = 'order_items' AND column_name = 'variant_snapshot'
    AND data_type = 'text') THEN
    ALTER TABLE order_items
      ALTER COLUMN variant_snapshot TYPE jsonb
      USING CASE
        WHEN variant_snapshot IS NULL OR variant_snapshot = '' THEN NULL
        ELSE variant_snapshot::jsonb
      END;
  END IF;
END $$;

-- Convert tags from text → jsonb on products (if stored as JSON string)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name = 'products' AND column_name = 'tags'
    AND data_type = 'text') THEN
    ALTER TABLE products
      ALTER COLUMN tags TYPE jsonb
      USING CASE
        WHEN tags IS NULL OR tags = '' OR tags = '[]' THEN '[]'::jsonb
        WHEN tags LIKE '[%' THEN tags::jsonb
        ELSE ('["' || tags || '"]')::jsonb
      END;
  END IF;
END $$;

-- Convert badges from text → jsonb on products
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name = 'products' AND column_name = 'badges'
    AND data_type = 'text') THEN
    ALTER TABLE products
      ALTER COLUMN badges TYPE jsonb
      USING CASE
        WHEN badges IS NULL OR badges = '' OR badges = '[]' THEN '[]'::jsonb
        WHEN badges LIKE '[%' THEN badges::jsonb
        ELSE ('["' || badges || '"]')::jsonb
      END;
  END IF;
END $$;


-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- Verify
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

SELECT 'trigger'  AS type, tgname          AS name FROM pg_trigger
  WHERE tgname IN ('trg_sync_product_stock')
UNION ALL
SELECT 'index',   indexname FROM pg_indexes
  WHERE schemaname = 'public'
  AND indexname LIKE 'idx_%'
  ORDER BY type, name;
