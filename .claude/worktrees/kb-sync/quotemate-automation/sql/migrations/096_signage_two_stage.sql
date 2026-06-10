-- Migration 096 · Signage two-stage assessment
--
-- The signage assessment is now a TWO-STAGE check:
--   Step 1 — Claude vision vs the Supabase `signage_rules` (grounding backstop).
--   Step 2 — the brand's Gemini File Search store(s) re-look at the photo and
--            may correct/supplement Step 1; a deterministic merge compiles the
--            final per-rule verdict (any disagreement → HQ review).
--
-- `signage_assessments.verdicts` now holds the MERGED authoritative verdicts.
-- This column persists the full two-stage breakdown for the HQ side-by-side
-- and the franchisee's sourced report:
--   two_stage = {
--     step1:      RuleVerdict[],     -- the grounded Step-1 verdicts
--     kb:         KbRuleVerdict[],   -- Step-2 per-rule verdicts
--     provenance: RuleProvenance[],  -- how each rule was decided + citation
--     advisory:   AdvisoryFinding[], -- Step-2-only findings (no DB rule)
--     stores:     text[],            -- the brand stores queried
--     kb_degraded:boolean            -- true if Step 2 was meant to run but failed
--   }
--
-- The legacy `kb_supplement` column (migration 094) is left in place but is no
-- longer written. Additive + idempotent. Highest applied migration before this
-- is 095.

alter table public.signage_assessments
  add column if not exists two_stage jsonb;

-- refresh PostgREST schema cache so supabase-js sees the new column immediately
notify pgrst, 'reload schema';

do $$
declare has_col boolean;
begin
  select exists (
    select 1 from information_schema.columns
     where table_schema='public' and table_name='signage_assessments' and column_name='two_stage'
  ) into has_col;
  raise notice 'Migration 096: signage_assessments.two_stage=%', has_col;
end $$;
