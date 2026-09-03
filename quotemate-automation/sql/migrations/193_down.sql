-- ═══════════════════════════════════════════════════════════════════
-- Migration 193 DOWN — drop the inspection_cause column and its CHECK.
--
-- Safe: the column is additive metadata. Readers treat NULL/missing as
-- 'site_conditions', which is exactly the pre-193 behaviour, so rolling
-- back restores the old copy for every quote without touching a row.
-- ═══════════════════════════════════════════════════════════════════

alter table public.quotes
  drop constraint if exists quotes_inspection_cause_check;

alter table public.quotes
  drop column if exists inspection_cause;

notify pgrst, 'reload schema';
