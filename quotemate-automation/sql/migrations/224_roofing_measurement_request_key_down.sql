-- ═══════════════════════════════════════════════════════════════════
-- Migration 224 rollback — removes the takeoff save's request key.
--
-- Only while migration 201 isn't applied: 201 owns the same column and
-- index, and the SMS quote contract reads them. Dropping the column loses
-- every saved takeoff's key, so saving the same run again makes a new row.
-- ═══════════════════════════════════════════════════════════════════

drop index if exists public.roofing_sms_request_key;
alter table public.roofing_measurements drop column if exists source_request_key;

notify pgrst, 'reload schema';
