-- 228 down: the numbered roof areas go. First deploy a service that neither
-- writes nor reads roof_takeoff_runs.regions, or every calibrate stage and
-- every run read fails. Each run's regions/plan.pdf stays in its folder and
-- goes with the run.

alter table public.roof_takeoff_runs drop column if exists regions;

notify pgrst, 'reload schema';
