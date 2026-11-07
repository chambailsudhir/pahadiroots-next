-- db_migration_v40 — a coin balance can only change together with the coin ledger (Nov 2026 security round 5).
--
-- Found 7 Nov 2026: 15 pre-launch customer rows held 22,678 coins that no loyalty_transactions row explained (up to 8,821 on
-- one row; created Mar–Apr 2026 by direct edits / an older points scheme). Nothing stopped this: the admin generic proxy lets
-- owner/manager PATCH any customers column, including loyalty_points, and no database rule tied the balance to the ledger.
-- Coins are worth Rs 1 each, never expire when unbacked, and can be spent by whoever controls the account.
--
-- 1) Reconcile: every customer's balance is set to its ledger total (owner confirmed these are test records). Each change is
--    written to admin_audit_log.
-- 2) Guard: a deferred constraint trigger checks, at COMMIT, that customers.loyalty_points equals SUM(loyalty_transactions.points)
--    for every customer row whose balance was inserted/changed in the transaction. The five functions that move coins
--    (award / redeem / reverse / expire / referral) already update the balance and insert the matching ledger row in one
--    transaction, so they pass; a bare balance edit (admin proxy, SQL editor, a future bug) is rolled back with an error.
--    To adjust coins on purpose, insert an 'adjustment' ledger row and update the balance in the same transaction.

BEGIN;

-- 1) Reconcile -------------------------------------------------------------------------------------------------------
WITH l AS (SELECT customer_id, COALESCE(SUM(points), 0)::integer s FROM loyalty_transactions GROUP BY customer_id),
fix AS (
  SELECT c.id, COALESCE(c.loyalty_points, 0) AS old_balance, COALESCE(l.s, 0) AS new_balance
    FROM customers c LEFT JOIN l ON l.customer_id = c.id
   WHERE COALESCE(c.loyalty_points, 0) <> COALESCE(l.s, 0)
), upd AS (
  UPDATE customers c SET loyalty_points = fix.new_balance FROM fix WHERE c.id = fix.id RETURNING fix.*
)
INSERT INTO admin_audit_log (admin_id, event, metadata)
SELECT 'system:migration_v40', 'coin_balance_reconciled',
       jsonb_build_object('customer_id', id, 'old_balance', old_balance, 'new_balance', new_balance,
                          'reason', 'balance not backed by the coin ledger (pre-launch test record)')
  FROM upd;

-- 2) Guard -----------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_coin_balance_matches_ledger()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $f$
DECLARE v_now integer; v_ledger integer;
BEGIN
  -- Re-read at commit time: several statements in one transaction may have moved the balance and the ledger.
  SELECT COALESCE(loyalty_points, 0) INTO v_now FROM customers WHERE id = NEW.id;
  IF NOT FOUND THEN RETURN NULL; END IF;                                  -- row deleted later in the transaction
  SELECT COALESCE(SUM(points), 0)::integer INTO v_ledger FROM loyalty_transactions WHERE customer_id = NEW.id;
  IF v_now <> v_ledger THEN
    RAISE EXCEPTION 'Coin balance of customer % (%) does not match the coin ledger (%). Change coins only together with a loyalty_transactions row.',
      NEW.id, v_now, v_ledger USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END $f$;
REVOKE EXECUTE ON FUNCTION public.trg_coin_balance_matches_ledger() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS coin_balance_matches_ledger ON public.customers;
CREATE CONSTRAINT TRIGGER coin_balance_matches_ledger
  AFTER INSERT OR UPDATE OF loyalty_points ON public.customers
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_coin_balance_matches_ledger();

COMMIT;
