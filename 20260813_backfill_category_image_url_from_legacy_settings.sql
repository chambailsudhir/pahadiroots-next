-- Already applied to production (2026-08-13). Kept here for version control /
-- so this repo has a record of every migration, matching your Supabase project's
-- migration history.
--
-- Backfill categories.image_url (the proper, FK-anchored column — already existed,
-- already used by the admin Catalogue tab, but never populated) from the legacy
-- coll_img_<slug> site_settings keys that the storefront's imgFor() string-matching
-- fallback chain was reading instead.
--
-- Mapping verified by exact slug match for 8/9 categories. Himalayan Honey's entry
-- (coll_img_Himalayan-honey, capital H) was uploaded in the identical ~95s admin
-- batch session (upload timestamps 1777631916601-1777632012074) as the other 8
-- current-slug-keyed images, confirming it is the intended current image, just
-- saved under a mis-cased settings key that the case-sensitive lookup never matched.
--
-- Legacy site_settings rows are left untouched (not deleted) for rollback safety;
-- a follow-up cleanup migration can remove them once this is confirmed stable in prod.

update categories set image_url = 'https://ulyrhnpoiypuvaurlqqi.supabase.co/storage/v1/object/public/pahadi-images/collection/Himalayan-honey/1777631939738-52hj1.jpg' where slug = 'himalayan-honey';
update categories set image_url = 'https://ulyrhnpoiypuvaurlqqi.supabase.co/storage/v1/object/public/pahadi-images/collection/shilajit/1776843378167-a8yq2.jpg' where slug = 'shilajit';
update categories set image_url = 'https://ulyrhnpoiypuvaurlqqi.supabase.co/storage/v1/object/public/pahadi-images/collection/pulses-and-dal/1777631982963-4rri7.jpg' where slug = 'pulses-and-dal';
update categories set image_url = 'https://ulyrhnpoiypuvaurlqqi.supabase.co/storage/v1/object/public/pahadi-images/collection/mountain-juices/1777631967308-v1esh.jpg' where slug = 'mountain-juices';
update categories set image_url = 'https://ulyrhnpoiypuvaurlqqi.supabase.co/storage/v1/object/public/pahadi-images/collection/himalayan-tea/1777631953799-x6e5n.jpg' where slug = 'himalayan-tea';
update categories set image_url = 'https://ulyrhnpoiypuvaurlqqi.supabase.co/storage/v1/object/public/pahadi-images/collection/herbs-and-spices/1777631916601-ptruk.jpg' where slug = 'herbs-and-spices';
update categories set image_url = 'https://ulyrhnpoiypuvaurlqqi.supabase.co/storage/v1/object/public/pahadi-images/collection/heritage-rice/1777631927837-4trjl.jpg' where slug = 'heritage-rice';
update categories set image_url = 'https://ulyrhnpoiypuvaurlqqi.supabase.co/storage/v1/object/public/pahadi-images/collection/natural-oils/1777632012074-yi4ic.jpg' where slug = 'natural-oils';
update categories set image_url = 'https://ulyrhnpoiypuvaurlqqi.supabase.co/storage/v1/object/public/pahadi-images/collection/jams-and-preserves/1777632006137-rmwys.jpg' where slug = 'jams-and-preserves';
