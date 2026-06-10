-- Migration 101 · Solar estimates app-contract columns
--
-- Migration 100 created the solar foundation tables, but the shipped app
-- contract also writes/reads a full `estimate` jsonb payload and a
-- satellite image URL. Add those columns idempotently so existing databases
-- and fresh migration chains match the app.

alter table public.solar_estimates
  add column if not exists estimate jsonb,
  add column if not exists satellite_image_url text;

grant all on table public.solar_estimates to service_role;
grant all on table public.solar_config to service_role;

-- Keep PostgREST/Supabase Data API in sync for immediate local dev writes.
notify pgrst, 'reload schema';

do $$
declare
  has_estimate boolean;
  has_sat_url  boolean;
begin
  select exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'solar_estimates'
       and column_name = 'estimate'
  ) into has_estimate;

  select exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'solar_estimates'
       and column_name = 'satellite_image_url'
  ) into has_sat_url;

  raise notice 'Migration 101: solar_estimates.estimate=%, satellite_image_url=%',
    has_estimate, has_sat_url;
end $$;
