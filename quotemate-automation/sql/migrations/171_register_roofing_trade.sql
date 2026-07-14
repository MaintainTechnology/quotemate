-- ════════════════════════════════════════════════════════════════════
-- Migration 171 · Register the roofing trade
--
-- The bug this fixes (a tradie hit it on the final onboarding step):
--
--   insert or update on table "tenants" violates foreign key
--   constraint "tenants_trade_fk"
--
-- tenants.trade is FK → trades(name). The /onboard wizard offers every
-- trade in ONBOARDING_TRADES (lib/onboard/schema.ts) = electrical,
-- plumbing, painting, ROOFING — and roofing passes the trade-readiness
-- gate via the deterministic-trade exemption (it prices from a per-m²
-- rate card, lib/roofing/pricing.ts, so it needs no assembly catalogue
-- or estimator prompt). But roofing was never given a `trades` registry
-- row: 046 seeded electrical+plumbing, 097 aircon, 149 painting, 155 the
-- five dashboard-activatable trades. 155 fixed the DASHBOARD path and
-- left the ONBOARDING path broken.
--
-- Result: pick roofing as your first trade and activation sets
-- tenants.trade = 'roofing' → FK violation → the wizard dies at step 04
-- with the auth user already created. (Nothing else blocks: pricing_book
-- .trade has no FK, and tenants.trades[] is a plain text[].)
--
-- The pricing-defaults row mirrors migration 155's rationale: roofing's
-- money path is the rate card in pricing_book.overlays.roofing_rate_card,
-- so these labour numbers only satisfy the NOT NULL shape that
-- activate_trade_for_tenant() (migration 055) hard-requires and that
-- GET /api/tenant/trades/available filters on. Values match
-- defaultsForTrade('roofing') in lib/onboard/schema.ts, and
-- call_out_minimum matches DEFAULT_ROOFING_RATE_CARD.call_out_minimum_ex_gst
-- ($550) in lib/roofing/pricing.ts.
--
-- Additive + idempotent: on-conflict-do-nothing + a name-scoped UPDATE.
-- Apply with: node --env-file=.env.local scripts/run-migration-171.mjs
-- Rollback:   sql/migrations/171_down.sql
-- ════════════════════════════════════════════════════════════════════

-- ── 1. Registry row ─────────────────────────────────────────────────
insert into trades (name, display_name, is_job_based, active) values
  ('roofing', 'Roofing', true, true)
on conflict (name) do nothing;

-- A pre-existing roofing row registered inactive / non-job-based could not
-- be activated. Force the flags on (scoped by name — no other trade touched).
update trades
   set active = true, is_job_based = true
 where name = 'roofing';

-- ── 2. Pricing defaults (keystone for activate_trade_for_tenant) ────
-- hourly_rate is inert for roofing (the rate card prices the job) but the
-- column is NOT NULL, so it carries a neutral labour shape.
insert into trade_pricing_defaults (
  trade_id, hourly_rate, call_out_minimum, apprentice_rate, senior_rate,
  default_markup_pct, risk_buffer_pct, min_labour_hours, gst_registered, licence_label
)
select t.id, 120, 550, 65, 160, 0, 15, 0, true, null
  from trades t
 where t.name = 'roofing'
on conflict (trade_id) do nothing;

-- Keep PostgREST's schema cache fresh (mirrors 046/048/149/155).
notify pgrst, 'reload schema';

-- ── 3. Sanity check (read-only diagnostic echo) ────────────────────
do $$
declare
  rec record;
begin
  for rec in
    select t.name,
           t.active,
           t.is_job_based,
           exists(select 1 from trade_pricing_defaults d where d.trade_id = t.id) as has_defaults
      from trades t
     where t.name = 'roofing'
  loop
    raise notice 'Migration 171: % active=% job_based=% has_defaults=%',
      rec.name, rec.active, rec.is_job_based, rec.has_defaults;
  end loop;
end $$;
