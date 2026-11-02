-- ─────────────────────────────────────────────────────────────────────────────
-- v18 — private bucket for return-evidence photos (account audit, Nov 2026, ACC-051)
--
-- Return photos used to be uploaded to the shared PUBLIC `pahadi-images` bucket (100 MB limit, video / PDF allowed), whose
-- storage.objects policies also let anyone LIST every file name. A customer's damaged-item photo (often their kitchen, hands,
-- sometimes a label with a name) was therefore readable by anyone who could guess or enumerate the path.
--
-- `return-evidence` is PRIVATE (no storage.objects policy at all → only the service role can read or write), limited to
-- 5 MB and to JPEG / PNG / WebP at the storage layer (the API already enforced this; the bucket now does too).
-- The API signs a 1-year read link when the return is submitted and stores THAT in returns.photo_urls, so the admin panel — which
-- renders photo_urls as plain links — keeps working with no change, while the files are no longer public or listable.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('return-evidence', 'return-evidence', false, 5242880, ARRAY['image/jpeg','image/png','image/webp'])
ON CONFLICT (id) DO UPDATE
  SET public = false, file_size_limit = 5242880, allowed_mime_types = ARRAY['image/jpeg','image/png','image/webp'];
