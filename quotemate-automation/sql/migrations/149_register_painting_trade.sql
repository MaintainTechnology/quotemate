-- ════════════════════════════════════════════════════════════════════
-- Migration 149 · Register the painting trade in the trades registry
--
-- Context: residential painting (lib/painting/*) becomes a self-serve
-- onboardable trade alongside electrical + plumbing. Its catalogue
-- (shared_assemblies / shared_materials at trade='painting') was seeded
-- by migration 088. What was missing — and what this migration adds — is
-- the REGISTRY ROW, so the trade FK on tenants.trade and
-- tenant_licences.trade (the CHECK→FK swap of migration 051) validates
-- when a painter onboards with painting as a (primary) trade.
--
-- Two inserts, both additive + idempotent:
--   1. trades('painting') — makes the FK valid. Job-based (it quotes a
--      discrete Good/Better/Best job), active.
--   2. trade_pricing_defaults('painting') — the keystone row that
--      activate_trade_for_tenant() (migration 055) hard-requires before
--      it will seed a pricing_book for a newly-activated trade. Without
--      it, the dashboard's POST /api/tenant/trades/activate('painting')
--      raises 'trade "painting" has no trade_pricing_defaults row'.
--      These labour columns are NOT what prices a painting job — painting
--      prices from the per-m² rate card (lib/painting/pricing.ts,
--      pricing_book.overlays.painting_rate_card). They only populate the
--      pricing_book row's labour shape so it satisfies the table.
--
-- Idempotent: on-conflict-do-nothing on both inserts.
-- Apply with: node --env-file=.env.local scripts/run-migration-149.mjs
-- ════════════════════════════════════════════════════════════════════

-- ── 1. Registry row ────────────────────────────────────────────────
insert into trades (name, display_name, is_job_based, active)
values ('painting', 'Painting', true, true)
on conflict (name) do nothing;

-- ── 2. Pricing defaults (keystone for activate_trade_for_tenant) ────
-- Joined on the trades row so it works whether painting was just
-- inserted above or already existed.
insert into trade_pricing_defaults (
  trade_id, hourly_rate, call_out_minimum, apprentice_rate, senior_rate,
  default_markup_pct, risk_buffer_pct, min_labour_hours, gst_registered, licence_label
)
select t.id, 90, 450, 55, 75, 0, 10, 0, true, null
  from trades t
 where t.name = 'painting'
on conflict (trade_id) do nothing;

-- Keep PostgREST's schema cache fresh (mirrors migrations 046/048/051).
notify pgrst, 'reload schema';

-- ── 3. Sanity check (read-only diagnostic echo) ────────────────────
do $$
declare
  trade_ok   boolean;
  defaults_ok boolean;
begin
  select exists(select 1 from trades where name = 'painting' and active) into trade_ok;
  select exists(
    select 1 from trade_pricing_defaults tpd
      join trades t on t.id = tpd.trade_id
     where t.name = 'painting'
  ) into defaults_ok;
  raise notice 'Migration 149: painting registered = %, pricing_defaults = %', trade_ok, defaults_ok;
end $$;
