-- Migration 090 · Signage rules — verdict_mode
--
-- Adds a per-rule `verdict_mode` that drives how the AI is allowed to act
-- on a rule, replacing the coarse "only auto_vision rules are scored"
-- gate. Four modes:
--   pass_fail        — the AI may CONFIRM and DENY (presence/layout/ratio/
--                      ordinal/coverage/OCR/colour-family)
--   detect_only      — the AI may FLAG a violation but never certify
--                      compliance (exact paint SKU, LED-backlit, etc.);
--                      a "compliant" verdict is downgraded to review
--   needs_reference  — decidable only with a tape/known object in frame
--                      (absolute measurements) → review until Phase 2
--   review           — not photo-checkable / legal → always human review
--
-- This roughly triples the rules the AI engages with WITHOUT ever allowing
-- a false "compliant". Additive + idempotent. (087 is signage; 088/089 are
-- the painting workstream — signage continues at 090.)

alter table public.signage_rules
  add column if not exists verdict_mode text not null default 'review';

-- Sensible pre-reseed default: the old mvp_core slice becomes pass_fail so
-- the column is reasonable even before the re-seed overwrites every row.
update public.signage_rules
   set verdict_mode = 'pass_fail'
 where mvp_tier = 'mvp_core'
   and verdict_mode = 'review';

notify pgrst, 'reload schema';

do $$
declare r record;
begin
  raise notice 'Migration 090: signage_rules.verdict_mode added. Distribution:';
  for r in
    select verdict_mode, count(*) as n from public.signage_rules group by verdict_mode order by verdict_mode
  loop
    raise notice '  % = %', r.verdict_mode, r.n;
  end loop;
end $$;
