-- Migration 111 · Solar Felt tab (spec 2026-06-13-solar-felt-tab-design.md)
--
-- The Felt path produces ordinary solar_estimates rows through the ordinary
-- deterministic engine; these columns only record which quote layout the
-- row renders and the Felt map provisioning state. Idempotent.
--
--   quote_variant — 'instant' (default, existing behaviour) | 'felt'
--   felt          — provisioning record:
--                   { map_id, map_url, embed_url, thumbnail_url,
--                     status: 'pending'|'provisioning'|'ready'|'partial'|'failed',
--                     layers: { panels|flux|dsm|planes: {id, status} },
--                     error, provisioned_at }
--   ai_brief      — Anthropic roof-intelligence brief (grounded prose only):
--                   { headline, layout_rationale, best_plane_note,
--                     seasonal_note, caveats[], model, input_hash, generated_at }

alter table public.solar_estimates
  add column if not exists quote_variant text not null default 'instant',
  add column if not exists felt jsonb,
  add column if not exists ai_brief jsonb;

-- Listing the Felt sub-tab filters by tenant + variant.
create index if not exists solar_estimates_quote_variant_idx
  on public.solar_estimates (tenant_id, quote_variant);

do $$
declare
  variant_ok boolean;
  felt_ok boolean;
  brief_ok boolean;
begin
  select exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='solar_estimates'
                    and column_name='quote_variant') into variant_ok;
  select exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='solar_estimates'
                    and column_name='felt') into felt_ok;
  select exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='solar_estimates'
                    and column_name='ai_brief') into brief_ok;
  if not (variant_ok and felt_ok and brief_ok) then
    raise exception 'migration 111 verification failed (quote_variant=%, felt=%, ai_brief=%)',
      variant_ok, felt_ok, brief_ok;
  end if;
end $$;
