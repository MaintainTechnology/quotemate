-- ═══════════════════════════════════════════════════════════════════
-- Migration 194 DOWN — remove the post-visit money chain.
--
-- Drops in dependency order: the partial unique index first (it is keyed on
-- both chain columns), then the CHECK, then the columns themselves.
--
-- ⚠ Dropping quote_kind and parent_quote_id discards the links between a job's
-- initial / final / balance rows. The rows themselves — and the money recorded
-- on them — survive, but the chain that related them does not. Roll back only
-- before any final or balance quote has been issued.
--
-- Re-applying 194 afterwards is safe: every statement in the up migration is
-- add-if-missing.
-- ═══════════════════════════════════════════════════════════════════

drop index if exists public.quotes_open_child_uniq;

alter table public.quotes drop constraint if exists quotes_quote_kind_check;

alter table public.quotes drop column if exists quote_kind;

alter table public.quotes drop column if exists parent_quote_id;

notify pgrst, 'reload schema';
