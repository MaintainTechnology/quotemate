-- 228: a takeoff run's numbered roof areas (TKO-30, DEC-048).
--
-- A roof plan can dimension nothing and leave the roofs beside a hip roof
-- unread, as Whittaker's does, though it fills each with sheeting ribs. The
-- calibrate stage finds each rib-filled area joined to the hip roof, numbers
-- it on a copy of the sheet (kept in the run's folder as regions/plan.pdf),
-- and asks the reader which roof each is. The operator confirms or changes
-- that on the run page, and the drawing measures what the operator confirms,
-- as the run's correction.
--
-- regions holds what the stage found (the sheet, its scale, the hip roofs'
-- outlines and the areas' polygons, in sheet points), the roofs an area may
-- join, the reader's suggestion, the operator's answer, and the takeoff as it
-- was before that answer, as the reading's own rows hold one. It is null for
-- a run with no such areas, which is every run before this one.

alter table public.roof_takeoff_runs add column if not exists regions jsonb;

notify pgrst, 'reload schema';
