-- Migration 095 · Signage brand scoping — multi-brand tabs (F45 + Anytime Fitness)
--
-- Until now the whole /dashboard/signage surface was effectively single-brand:
-- the brand was derived from the org (orgs.brand_slug) and studios/sweeps had
-- no brand of their own. To run F45 and Anytime Fitness as switchable TABS in
-- the same workspace, brand becomes a first-class column on the per-row data
-- so each tab strictly scopes its own studios, sweeps, requests and
-- assessments. The brand also selects that brand's rules + shots + Gemini
-- file store on the assessment path (lib/signage/kb-supplement.ts already
-- routes the store by brand slug — this makes the rest of the pipeline agree).
--
-- Additive + idempotent. Highest applied migration before this is 094.

-- ── 1. brand_slug on the per-row signage data ────────────────────────
alter table public.studios             add column if not exists brand_slug text not null default 'f45';
alter table public.signage_sweeps      add column if not exists brand_slug text not null default 'f45';
alter table public.signage_requests    add column if not exists brand_slug text not null default 'f45';
alter table public.signage_assessments add column if not exists brand_slug text not null default 'f45';

create index if not exists studios_org_brand_idx
  on public.studios (org_id, brand_slug);
create index if not exists signage_sweeps_org_brand_idx
  on public.signage_sweeps (org_id, brand_slug);
create index if not exists signage_assessments_org_brand_idx
  on public.signage_assessments (org_id, brand_slug);

-- ── 2. retire the stray demo brand so only F45 + Anytime Fitness tab ──
update public.brands set active = false where slug = 'gelatissimo';

-- ── refresh PostgREST schema cache (supabase-js reads the new columns) ─
notify pgrst, 'reload schema';

do $$
declare
  studios_col   boolean;
  sweeps_col    boolean;
  requests_col  boolean;
  assess_col    boolean;
  live_brands   int;
begin
  select exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='studios' and column_name='brand_slug') into studios_col;
  select exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='signage_sweeps' and column_name='brand_slug') into sweeps_col;
  select exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='signage_requests' and column_name='brand_slug') into requests_col;
  select exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='signage_assessments' and column_name='brand_slug') into assess_col;
  select count(*) into live_brands from public.brands where active;
  raise notice 'Migration 095: studios.brand_slug=% sweeps.brand_slug=% requests.brand_slug=% assessments.brand_slug=% · active brands=%',
    studios_col, sweeps_col, requests_col, assess_col, live_brands;
end $$;
