-- ══════════════════════════════════════════════════════════════
-- 5 Pahadi Roots — Vendor Orders Migration
-- Based on ACTUAL schema confirmed from Supabase export
-- Run AFTER vendor_migration.sql
-- ══════════════════════════════════════════════════════════════

-- CONFIRMED actual order_items columns:
--   id, order_id, product_id, quantity, price_at_time, created_at, variant_id
-- No price/mrp/gst_rate/size columns exist.

-- 1. Add vendor_id to order_items
ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS vendor_id bigint REFERENCES vendors(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_order_items_vendor ON order_items(vendor_id);

-- ══════════════════════════════════════════════════════════════
-- VERIFY
-- SELECT column_name, data_type, is_nullable
-- FROM information_schema.columns
-- WHERE table_name = 'order_items' AND table_schema = 'public'
-- ORDER BY ordinal_position;
-- ══════════════════════════════════════════════════════════════
