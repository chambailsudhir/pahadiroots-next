-- Nov 2026 checkout audit — already applied to production (project pahadi-roots) on 2026-11-02.
-- 1. Supabase security advisor WARN function_search_path_mutable: pin the search_path of the certificates updated_at trigger.
alter function public.trg_certificates_set_updated_at() set search_path = pg_catalog, public;

-- 2. The placeholder "Test" product (id 28, ₹2) was live on the shop. Retired with the project's archive convention.
--    Reversible: update products set status = 'active' where id = 28;   (it has 17 historical order_items — do NOT delete the row)
update products set status = 'archived' where id = 28 and slug = 'test';
