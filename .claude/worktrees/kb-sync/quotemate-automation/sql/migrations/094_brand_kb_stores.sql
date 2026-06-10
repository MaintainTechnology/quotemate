-- Migration 094 · Brand → Gemini file-search stores + KB supplement column
--
-- Adds the data-driven brand→store routing the signage KB supplement reads,
-- seeds the two live brands, registers the Anytime Fitness brand, and adds a
-- column to persist the supplement on an assessment.
--
--   brands.kb_store_ids            text[]  — the brand's Gemini File Search
--                                            store(s) for the rule supplement
--   signage_assessments.kb_supplement jsonb — { stores, shots, concerns }
--
-- Additive + idempotent. Highest applied migration before this is 093.

-- ── 1. brand → store routing column ──────────────────────────────────
alter table public.brands
  add column if not exists kb_store_ids text[] not null default '{}'::text[];

-- ── 2. seed F45 store (the F45 brand row already exists, migration 091) ──
update public.brands
   set kb_store_ids = array['fileSearchStores/mtf45protocols-vvluxy2im0iu']
 where slug = 'f45';

-- ── 3. register Anytime Fitness as a brand + its two stores ───────────
insert into public.brands (slug, name, location_noun, location_noun_plural, hq_name, vision_persona, shots, kb_store_ids, active)
values (
  'anytime-fitness',
  'Anytime Fitness',
  'club',
  'clubs',
  'Anytime Fitness HQ',
  'Anytime Fitness 24/7 gyms',
  '[
    {"slot":"storefront","label":"Storefront","instruction":"Stand across the entrance and capture the full storefront, signage and door decals."},
    {"slot":"logo_wall","label":"Logo Wall","instruction":"Photograph the main branded logo wall straight-on, filling the frame."},
    {"slot":"v_design","label":"V-Design","instruction":"Capture the V-design feature wall/graphic clearly and square-on."},
    {"slot":"reception","label":"Reception / Desk","instruction":"Photograph the reception desk and the area behind it."},
    {"slot":"workout_walls","label":"Workout Walls","instruction":"Capture the workout-floor walls and any zone/wall graphics."}
  ]'::jsonb,
  array[
    'fileSearchStores/mtanytimefitnessprotocols-inpscusi5qnz',
    'fileSearchStores/mtanytimefitnessdigitalaudi-tnub48excg48'
  ],
  true
)
on conflict (slug) do update
   set kb_store_ids = excluded.kb_store_ids,
       name         = excluded.name,
       location_noun = excluded.location_noun,
       location_noun_plural = excluded.location_noun_plural,
       hq_name      = excluded.hq_name,
       vision_persona = excluded.vision_persona,
       -- only seed shots if the existing row has none (don't clobber edits)
       shots = case when public.brands.shots = '[]'::jsonb then excluded.shots else public.brands.shots end;

-- ── 4. persist the supplement on an assessment ───────────────────────
alter table public.signage_assessments
  add column if not exists kb_supplement jsonb;

-- ── refresh PostgREST schema cache (supabase-js reads new columns) ────
notify pgrst, 'reload schema';

do $$
declare
  has_kb_col   boolean;
  has_supp_col boolean;
  af_present   int;
begin
  select exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='brands' and column_name='kb_store_ids')
    into has_kb_col;
  select exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='signage_assessments' and column_name='kb_supplement')
    into has_supp_col;
  select count(*) into af_present from public.brands where slug='anytime-fitness';
  raise notice 'Migration 094: brands.kb_store_ids=% · signage_assessments.kb_supplement=% · anytime-fitness brand rows=%',
    has_kb_col, has_supp_col, af_present;
end $$;
