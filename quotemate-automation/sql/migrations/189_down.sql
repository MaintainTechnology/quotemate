-- Rollback for 189 — painting quote_sent_at.
--
-- DESTRUCTIVE: discards the delivery evidence. /p falls back to keying "Sent"
-- off released_at, which is exactly the false-positive this migration removed.
-- Back it up first:
--   create table painting_measurements_backup_mig189 as
--     select id, public_token, quote_sent_at from public.painting_measurements
--      where quote_sent_at is not null;

alter table public.painting_measurements drop column if exists quote_sent_at;

notify pgrst, 'reload schema';
