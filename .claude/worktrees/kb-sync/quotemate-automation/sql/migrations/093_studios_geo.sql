-- Migration 093 · Studios — geo coordinates + Google place id
--
-- Lets studios be located via the Google Places API and shown on a Maps
-- Static thumbnail (lat/lng), and de-duplicated by place_id. Additive +
-- idempotent. (092 added address/state/postcode/street_view_url.)

alter table public.studios
  add column if not exists lat       double precision,
  add column if not exists lng       double precision,
  add column if not exists place_id  text;

notify pgrst, 'reload schema';

do $$
declare n int;
begin
  select count(*) into n from information_schema.columns
   where table_schema='public' and table_name='studios' and column_name in ('lat','lng','place_id');
  raise notice 'Migration 093: studios geo columns present = % / 3', n;
end $$;
