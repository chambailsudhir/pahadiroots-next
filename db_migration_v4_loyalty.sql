-- ============================================================
-- PAHADI ROOTS — DB MIGRATION v4: LOYALTY / COINS SYSTEM
-- Run in Supabase SQL Editor AFTER v3 (dpdp-notifications)
-- ============================================================

-- ─── 1. Loyalty points column on customers ───────────────────
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS loyalty_points INTEGER NOT NULL DEFAULT 0;

-- Referral code per customer (8-char uppercase, unique)
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS referral_code  TEXT UNIQUE;

-- Who referred this customer (optional FK)
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS referred_by    UUID REFERENCES customers(id) ON DELETE SET NULL;

-- ─── 2. Loyalty transactions audit log ───────────────────────
CREATE TABLE IF NOT EXISTS loyalty_transactions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id     UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  order_id        UUID REFERENCES orders(id) ON DELETE SET NULL,
  type            TEXT NOT NULL CHECK (type IN ('earn', 'redeem', 'expire', 'referral', 'bonus', 'adjustment')),
  points          INTEGER NOT NULL,               -- positive = earn, negative = redeem/expire
  balance_after   INTEGER NOT NULL DEFAULT 0,
  note            TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_loyalty_customer    ON loyalty_transactions(customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_loyalty_order       ON loyalty_transactions(order_id);

-- ─── 3. Track redeemed points on orders ──────────────────────
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS loyalty_points_redeemed INTEGER NOT NULL DEFAULT 0;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS loyalty_points_earned   INTEGER NOT NULL DEFAULT 0;

-- ─── 4. Atomic earn-points RPC ───────────────────────────────
-- Called after order confirmed/paid. Awards points and logs the transaction.
CREATE OR REPLACE FUNCTION award_loyalty_points(
  p_customer_id UUID,
  p_order_id    UUID,
  p_points      INTEGER,
  p_note        TEXT DEFAULT 'Order reward'
) RETURNS INTEGER AS $$
DECLARE
  v_new_balance INTEGER;
BEGIN
  UPDATE customers
  SET    loyalty_points = loyalty_points + p_points
  WHERE  id = p_customer_id
  RETURNING loyalty_points INTO v_new_balance;

  INSERT INTO loyalty_transactions (customer_id, order_id, type, points, balance_after, note)
  VALUES (p_customer_id, p_order_id, 'earn', p_points, v_new_balance, p_note);

  -- Update earned column on order for reference
  UPDATE orders SET loyalty_points_earned = p_points WHERE id = p_order_id;

  RETURN v_new_balance;
END;
$$ LANGUAGE plpgsql;

-- ─── 5. Atomic redeem-points RPC ─────────────────────────────
-- Called at checkout. Returns false if insufficient balance.
CREATE OR REPLACE FUNCTION redeem_loyalty_points(
  p_customer_id UUID,
  p_order_id    UUID,
  p_points      INTEGER,
  p_note        TEXT DEFAULT 'Redeemed at checkout'
) RETURNS BOOLEAN AS $$
DECLARE
  v_new_balance  INTEGER;
  rows_updated   INTEGER;
BEGIN
  UPDATE customers
  SET    loyalty_points = loyalty_points - p_points
  WHERE  id = p_customer_id
    AND  loyalty_points >= p_points
  RETURNING loyalty_points INTO v_new_balance;

  GET DIAGNOSTICS rows_updated = ROW_COUNT;
  IF rows_updated = 0 THEN RETURN FALSE; END IF;

  INSERT INTO loyalty_transactions (customer_id, order_id, type, points, balance_after, note)
  VALUES (p_customer_id, p_order_id, 'redeem', -p_points, v_new_balance, p_note);

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- ─── 6. Generate unique referral codes for existing customers ─
-- Run once after migration. Generates 8-char codes like "PAH3XK9M"
UPDATE customers
SET referral_code = UPPER(SUBSTRING(MD5(id::TEXT || 'pahadi'), 1, 8))
WHERE referral_code IS NULL;

-- Function to auto-assign referral code on insert
CREATE OR REPLACE FUNCTION assign_referral_code()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.referral_code IS NULL THEN
    NEW.referral_code := UPPER(SUBSTRING(MD5(NEW.id::TEXT || 'pahadi' || EXTRACT(EPOCH FROM NOW())::TEXT), 1, 8));
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_assign_referral_code ON customers;
CREATE TRIGGER trg_assign_referral_code
  BEFORE INSERT ON customers
  FOR EACH ROW EXECUTE FUNCTION assign_referral_code();

-- ─── 7. get_customer_order_stats RPC (add loyalty_points) ─────
-- Extend existing RPC to also return points balance
CREATE OR REPLACE FUNCTION get_customer_order_stats(p_customer_id UUID)
RETURNS TABLE (
  delivered       BIGINT,
  active          BIGINT,
  cancelled       BIGINT,
  spent           NUMERIC,
  loyalty_points  INTEGER
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    COUNT(*)  FILTER (WHERE order_status = 'delivered')          AS delivered,
    COUNT(*)  FILTER (WHERE order_status IN ('pending','confirmed','packed','shipped')) AS active,
    COUNT(*)  FILTER (WHERE order_status = 'cancelled')          AS cancelled,
    COALESCE(SUM(total_amount) FILTER (WHERE payment_status = 'paid'), 0) AS spent,
    (SELECT COALESCE(lp.loyalty_points, 0) FROM customers lp WHERE lp.id = p_customer_id) AS loyalty_points
  FROM orders
  WHERE customer_id = p_customer_id;
END;
$$ LANGUAGE plpgsql;

-- ─── 8. Site settings for loyalty ────────────────────────────
INSERT INTO site_settings (key, value) VALUES
  ('loyalty_enabled',            'true'),
  ('loyalty_points_per_rupee',   '1'),       -- earn 1 point per ₹1 spent
  ('loyalty_points_value',       '0.25'),    -- 1 point = ₹0.25 discount
  ('loyalty_max_redeem_pct',     '20'),      -- max 20% of order payable with coins
  ('loyalty_points_label',       'Pahadi Coins'),
  ('loyalty_min_redeem',         '40'),      -- minimum 40 points to redeem
  ('referral_bonus_points',      '100')      -- bonus points for both referrer + referee
ON CONFLICT (key) DO NOTHING;

-- ─── 9. RLS for loyalty_transactions ─────────────────────────
ALTER TABLE loyalty_transactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Loyalty no public access" ON loyalty_transactions;
CREATE POLICY "Loyalty no public access" ON loyalty_transactions USING (false);
