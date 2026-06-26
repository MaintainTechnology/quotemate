-- Down migration 150 — drop Flyer Designer table.
-- Storage bucket 'flyer-assets' is left in place (dropping a bucket with
-- objects fails); remove it manually if truly needed.
begin;
drop table if exists public.flyers;
commit;
