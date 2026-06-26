-- ════════════════════════════════════════════════════════════════════
-- Migration 155 · Register the dashboard-activatable job trades
--
-- Makes every trade the Account-tab Trades section offers — electrical,
-- plumbing, painting, solar, commercial_painting — a registered, ACTIVE,
-- JOB-BASED trade that carries a trade_pricing_defaults row. That defaults
-- row is the keystone activate_trade_for_tenant() (migration 055) hard-
-- requires, and the predicate GET /api/tenant/trades/available filters on.
--
-- Why this was needed (the bug the user hit — those trades not activatable):
--   • solar had a trades row (migration 100) but NO trade_pricing_defaults,
--     so it was filtered out of the activatable list and activation raised
--     'trade "solar" has no trade_pricing_defaults row'.
--   • commercial_painting had NO trades registry row at all (migration 107
--     only built its catalogue/engine), so it never appeared.
--   • painting (149) + electrical/plumbing (046/048) were already complete.
--
-- Additive + idempotent: on-conflict-do-nothing inserts plus a guarded
-- UPDATE that only flips the five target trades to active + job-based.
--
-- Apply with: node --env-file=.env.local scripts/run-migration-155.mjs
-- Rollback:   sql/migrations/155_down.sql
-- ════════════════════════════════════════════════════════════════════

-- ── 1. Registry rows ────────────────────────────────────────────────
insert into trades (name, display_name, is_job_based, active) values
  ('electrical',          'Electrical',          true, true),
  ('plumbing',            'Plumbing',            true, true),
  ('painting',            'Painting',            true, true),
  ('solar',               'Solar',               true, true),
  ('commercial_painting', 'Commercial painting', true, true)
on conflict (name) do nothing;

-- A pre-existing row that was registered inactive or non-job-based can't be
-- activated — force the five target trades on. Scoped by name so no other
-- trade's flags are touched.
update trades
   set active = true, is_job_based = true
 where name in ('electrical', 'plumbing', 'painting', 'solar', 'commercial_painting');

-- ── 2. Pricing defaults (keystone for activate_trade_for_tenant) ────
-- Labour-shape numbers only. Painting / solar / commercial painting price
-- the real job from their own engines (rate cards / kW pricing); these rows
-- exist solely to satisfy the function's hard requirement and seed a
-- pricing_book labour shape. Joined on the trades row so it works whether
-- the trade was just inserted above or already existed.
insert into trade_pricing_defaults (
  trade_id, hourly_rate, call_out_minimum, apprentice_rate, senior_rate,
  default_markup_pct, risk_buffer_pct, min_labour_hours, gst_registered, licence_label
)
select t.id, d.hourly_rate, d.call_out_minimum, d.apprentice_rate, d.senior_rate,
       d.default_markup_pct, d.risk_buffer_pct, d.min_labour_hours, d.gst_registered, d.licence_label
  from (values
    ('electrical',          110::numeric, 120::numeric, 35::numeric, 55::numeric, 30::numeric, 10::numeric, 0.5::numeric, true, null::text),
    ('plumbing',            120::numeric, 150::numeric, 40::numeric, 60::numeric, 18::numeric, 10::numeric, 0.5::numeric, true, null::text),
    ('painting',             90::numeric, 450::numeric, 55::numeric, 75::numeric,  0::numeric, 10::numeric,   0::numeric, true, null::text),
    ('solar',               100::numeric,   0::numeric, 45::numeric, 70::numeric,  0::numeric, 10::numeric,   0::numeric, true, null::text),
    ('commercial_painting',  95::numeric, 600::numeric, 55::numeric, 80::numeric,  0::numeric, 10::numeric,   0::numeric, true, null::text)
  ) as d(trade, hourly_rate, call_out_minimum, apprentice_rate, senior_rate,
         default_markup_pct, risk_buffer_pct, min_labour_hours, gst_registered, licence_label)
  join trades t on t.name = d.trade
on conflict (trade_id) do nothing;

-- Keep PostgREST's schema cache fresh (mirrors migrations 046/048/149).
notify pgrst, 'reload schema';

-- ── 3. Sanity check (read-only diagnostic echo) ────────────────────
do $$
declare
  rec  record;
begin
  for rec in
    select t.name,
           t.active,
           t.is_job_based,
           exists(select 1 from trade_pricing_defaults d where d.trade_id = t.id) as has_defaults
      from trades t
     where t.name in ('electrical', 'plumbing', 'painting', 'solar', 'commercial_painting')
     order by t.name
  loop
    raise notice 'Migration 155: % active=% job_based=% has_defaults=%',
      rec.name, rec.active, rec.is_job_based, rec.has_defaults;
  end loop;
end $$;
