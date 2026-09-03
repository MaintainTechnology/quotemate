-- ═══════════════════════════════════════════════════════════════════
-- Migration 195 DOWN — remove the estimate number column, its sequence and
-- its assignment function.
--
-- Dropping the column discards any numbers already assigned. That is the
-- intended rollback: the number is presentational (it appears on the EV
-- estimate document and nowhere else), nothing joins on it, and the renderer
-- falls back to the 8-character quote reference when it is absent.
--
-- ⚠ Re-running 195 afterwards starts the sequence again at 1, so a
-- rollback-then-reapply can hand a NEW document the number an OLD one already
-- printed. Do not roll back after estimates have been sent unless that is
-- acceptable.
-- ═══════════════════════════════════════════════════════════════════

drop function if exists public.next_quote_estimate_number(uuid);

drop index if exists public.quotes_estimate_number_idx;

alter table public.quotes drop column if exists estimate_number;

drop sequence if exists public.quote_estimate_number_seq;

notify pgrst, 'reload schema';
