-- ═══════════════════════════════════════════════════════════════════
-- Migration 223 rollback — removes roof plan takeoff runs.
--
-- Takeoff uploads go first; their extractions follow by cascade. Storage
-- objects under plan-pdfs/roofing/ are not touched by SQL: remove them
-- separately if the takeoff is being withdrawn for good.
-- ═══════════════════════════════════════════════════════════════════

delete from public.plan_uploads where takeoff_run_id is not null;

drop index if exists public.plan_extractions_takeoff_run_idx;
drop index if exists public.plan_uploads_takeoff_run_idx;
alter table public.plan_extractions drop column if exists takeoff_run_id;
alter table public.plan_uploads drop column if exists takeoff_run_id;

drop table if exists public.roof_takeoff_runs;

-- Back to 32 MB = 33554432 bytes.
update storage.buckets set file_size_limit = 33554432 where id = 'plan-pdfs';

notify pgrst, 'reload schema';
