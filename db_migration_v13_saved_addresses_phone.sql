-- v13: Add phone column to saved_addresses (per-address contact number)
--
-- The "Edit Address" form (account page + /account/addresses) never had a
-- phone field, and the saved_addresses table never had a phone column
-- either — this isn't a UI oversight on top of a fine schema, the column
-- simply doesn't exist yet (confirmed against the API route's explicit
-- `select=id,label,name,addr,city,state,pin` list and insert-row shape,
-- and against the "single source of truth" SavedAddress type comment in
-- src/lib/account/utils.ts, which listed the same six columns).
--
-- Effect of the gap: useCheckoutPage.ts already had a defensive fallback
-- — `phone: saved.phone || cleanPhone` — because saved.phone was always
-- undefined. In practice this meant every saved address (Home, Office,
-- Parents, Friends, Others) silently used the ACCOUNT HOLDER'S phone at
-- checkout, so a courier delivering to "Parents" would call the account
-- owner instead of the parents. This migration + the matching app changes
-- (route.ts, useAddresses.ts, AddressSection.tsx, addresses/page.tsx)
-- let each saved address carry its own contact number, same as
-- Amazon/Flipkart-style saved-address UX.
--
-- Nullable so existing rows (all captured without a phone) don't break;
-- the storefront now requires it going forward for new saves/edits.
--
-- Safe to run more than once.

ALTER TABLE saved_addresses
  ADD COLUMN IF NOT EXISTS phone text;
