-- ══════════════════════════════════════════════════════════════
-- 5 Pahadi Roots — Vendor / Marketplace Schema
-- Run this in Supabase SQL Editor
-- ══════════════════════════════════════════════════════════════

-- 1. VENDORS table
CREATE TABLE IF NOT EXISTS vendors (
  id              bigserial PRIMARY KEY,
  name            text        NOT NULL,
  business_name   text        NOT NULL,
  email           text        UNIQUE,
  phone           text,
  state_id        bigint      REFERENCES states(id) ON DELETE SET NULL,
  region          text,                          -- specific village/area within state
  gstin           text,                          -- GST registration number
  pan             text,                          -- PAN number
  bank_name       text,
  bank_account    text,
  bank_ifsc       text,
  bank_holder     text,
  default_commission_pct numeric(5,2) DEFAULT 10, -- e.g. 10.00 = 10%
  status          text        NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','pending')),
  notes           text,
  joined_at       timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- 2. VENDOR_PRODUCTS — many-to-many with per-product commission override
CREATE TABLE IF NOT EXISTS vendor_products (
  id                  bigserial PRIMARY KEY,
  vendor_id           bigint      NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  product_id          bigint      NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  commission_pct      numeric(5,2),              -- NULL = use vendor.default_commission_pct
  supply_price        numeric(12,2),             -- what vendor charges per unit
  is_primary          boolean     NOT NULL DEFAULT false,   -- primary supplier for this product
  status              text        NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (vendor_id, product_id)
);

-- 3. Add primary vendor shortcut to products table
ALTER TABLE products ADD COLUMN IF NOT EXISTS vendor_id bigint REFERENCES vendors(id) ON DELETE SET NULL;

-- 4. Add video_url if not already there (from previous session)
ALTER TABLE products ADD COLUMN IF NOT EXISTS video_url text;

-- 5. Indexes for performance
CREATE INDEX IF NOT EXISTS idx_vendor_products_vendor   ON vendor_products(vendor_id);
CREATE INDEX IF NOT EXISTS idx_vendor_products_product  ON vendor_products(product_id);
CREATE INDEX IF NOT EXISTS idx_products_vendor          ON products(vendor_id);

-- 6. Auto-update updated_at on vendors
CREATE OR REPLACE FUNCTION trg_vendors_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_vendors_updated_at ON vendors;
CREATE TRIGGER trg_vendors_updated_at
  BEFORE UPDATE ON vendors
  FOR EACH ROW EXECUTE FUNCTION trg_vendors_updated_at();

-- ══════════════════════════════════════════════════════════════
-- VERIFICATION — run after migration to confirm tables exist
-- ══════════════════════════════════════════════════════════════
-- SELECT table_name FROM information_schema.tables
-- WHERE table_schema = 'public'
-- AND table_name IN ('vendors','vendor_products');
