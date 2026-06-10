-- Migration 092 · Studios — real-location fields
--
-- Lets HQ add real studios (via address autocomplete or CSV import) instead
-- of the demo seed rows, and supports a Google Street View storefront image
-- derived from the address. Additive + idempotent.

alter table public.studios
  add column if not exists address   text,
  add column if not exists state     text,
  add column if not exists postcode  text,
  add column if not exists street_view_url text;

notify pgrst, 'reload schema';

do $$
declare n int;
begin
  select count(*) into n from information_schema.columns
   where table_schema='public' and table_name='studios' and column_name in ('address','state','postcode','street_view_url');
  raise notice 'Migration 092: studios location columns present = % / 4', n;
end $$;
