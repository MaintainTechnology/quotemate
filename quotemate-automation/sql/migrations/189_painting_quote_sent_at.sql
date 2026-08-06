-- Migration 189 · painting quote_sent_at — EVIDENCE that the customer was texted
--
-- Spec painting-auto-send R3. released_at means "the customer MAY see prices";
-- it has never meant "the customer received the quote". Three surfaces conflated
-- the two and reported a send that never happened:
--   • a dashboard save (app/api/painting/save) stamps released_at and sends NO
--     SMS at all, yet /p rendered "✓ Sent to customer";
--   • the release endpoint stamped, deferred the SMS to after(), and answered
--     ok:true regardless — 3 of 8 live releases texted nobody (2026-08-06);
--   • an auto-send whose revert write fails leaves a released row behind.
--
-- quote_sent_at is written ONLY after a carrier accepts the message, so /p can
-- key its "Sent" state off delivery evidence instead of the publish gate.
--
-- NO BACKFILL — every existing row lands NULL, deliberately.
--
-- An earlier draft backfilled quote_sent_at = released_at for SMS/self-serve
-- leads (created_by IS NULL). That predicate matches EXACTLY the 8 rows named
-- above — the same 8 of which 3 were verified to have texted nobody. Stamping
-- them would have written "delivered" onto 3 undelivered quotes and shown "✓
-- Sent to customer" for customers who received nothing: the precise conflation
-- of ATTEMPTED with ACCEPTED this column exists to end.
--
-- There is no corroborating evidence to salvage them with, either:
-- sendPaintingQuoteToCustomer calls sendSms directly and never writes an
-- sms_messages row, so the thread cannot distinguish the 5 from the 3.
--
-- The two failure modes are not symmetric. Backfilling risks 3 customers being
-- silently never followed up; not backfilling risks up to 5 tradies re-texting
-- a customer who already has the quote — a duplicate SMS. A duplicate is
-- recoverable; a silent drop is what this whole spec exists to stop.
--
-- Additive + idempotent, and writes NO data: only the column is added.

alter table public.painting_measurements
  add column if not exists quote_sent_at timestamptz;

comment on column public.painting_measurements.quote_sent_at is
  'When a carrier ACCEPTED the customer quote SMS/MMS. Evidence of delivery — '
  'distinct from released_at (the price-visibility gate). Never set optimistically, '
  'and never backfilled: an attempted send is not an accepted one.';

-- Refresh PostgREST's cache so supabase-js sees the new column immediately.
notify pgrst, 'reload schema';

do $$
declare
  has_col boolean;
  total_rows integer;
  sent_count integer;
begin
  select exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'painting_measurements'
       and column_name = 'quote_sent_at'
  ) into has_col;
  if not has_col then
    raise exception 'migration 189 failed: quote_sent_at missing';
  end if;

  select count(*), count(*) filter (where quote_sent_at is not null)
    into total_rows, sent_count
    from public.painting_measurements;

  raise notice 'migration 189: quote_sent_at added over % row(s); % carry send evidence '
               '(non-zero only on a re-run after real sends — this migration writes none)',
    total_rows, sent_count;
end $$;
