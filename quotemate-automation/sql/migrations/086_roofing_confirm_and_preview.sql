-- Migration 086 · Roofing customer confirmation + AI "after" preview
--
-- Additive only. Idempotent.
--
--   confirmed_at        — when the customer confirmed "this is my roof" over
--                         SMS. NULL = not yet confirmed; the public quote page
--                         renders a PRICE-FREE picker until this is set, so
--                         prices are never shown before the customer picks
--                         their building (fixes the "the link already shows
--                         every price" confirm-step leak).
--   confirmed_structure — 1-based index of the single structure the customer
--                         picked at confirm time. NULL = all structures.
--   preview_image_path  — storage path (intake-photos bucket) of the Gemini
--                         "after re-roof" preview generated FROM the Google
--                         satellite aerial. Served via the token-gated
--                         /api/roofing/q/[token]/after-image proxy.
--   preview_status      — idle | generating | ready | failed (CAS guard so two
--                         concurrent page loads don't both generate).
--
-- See migration 085 for why the PostgREST reload at the end is mandatory.

alter table public.roofing_measurements
  add column if not exists confirmed_at        timestamptz,
  add column if not exists confirmed_structure int,
  add column if not exists preview_image_path  text,
  add column if not exists preview_status      text;

-- CRITICAL: refresh PostgREST's schema cache so the API layer (supabase-js,
-- which every route uses) can immediately read/write the new columns. Without
-- this, writes to the new columns are silently rejected (PGRST204) — the exact
-- failure that made the SMS receptionist lose its memory (see migration 085).
notify pgrst, 'reload schema';

do $$
declare
  has_confirmed boolean;
  has_preview   boolean;
begin
  select exists (
    select 1 from information_schema.columns
     where table_schema='public' and table_name='roofing_measurements' and column_name='confirmed_at'
  ) into has_confirmed;
  select exists (
    select 1 from information_schema.columns
     where table_schema='public' and table_name='roofing_measurements' and column_name='preview_image_path'
  ) into has_preview;
  raise notice 'Migration 086: confirmed_at=%, preview_image_path=%', has_confirmed, has_preview;
end $$;
