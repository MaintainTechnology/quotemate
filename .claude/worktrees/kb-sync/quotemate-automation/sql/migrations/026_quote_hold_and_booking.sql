-- QuoteMate · migration 026 — WP6: price-hold / urgency + booking state
--
-- Adds two nullable columns to `quotes`:
--   price_hold_until  — when the quoted price stops being held (urgency).
--                       Backfilled for existing rows from created_at + 7d
--                       so the customer quote page can show a real
--                       "held until" countdown immediately.
--   booking_state     — null | 'reserved' | 'booked'. Set to 'reserved'
--                       by the Stripe webhook when the deposit is paid,
--                       and 'booked' once a slot is chosen. Makes the
--                       deposit -> reserved -> booked handoff explicit
--                       instead of inferred from paid_at + scheduled_at.
--
-- Idempotent (IF NOT EXISTS) so re-running is safe. NOT auto-applied to
-- production — apply with: node --env-file=.env.local scripts/run-migration-026.mjs --apply
-- (run only after human approval, per the WP6 brief constraint).

alter table quotes add column if not exists price_hold_until timestamptz;
alter table quotes add column if not exists booking_state text;

-- Backfill existing draft/sent quotes so the urgency countdown has data.
-- Already-paid/booked rows are left null for price_hold_until (the hold
-- is moot once they have committed) but we seed their booking_state from
-- the existing paid_at / scheduled_at signals so the new column is
-- consistent with reality on day one.
update quotes
   set price_hold_until = created_at + interval '7 days'
 where price_hold_until is null
   and created_at is not null
   and paid_at is null;

update quotes
   set booking_state = case
     when scheduled_at is not null then 'booked'
     when paid_at is not null then 'reserved'
     else booking_state
   end
 where booking_state is null;

-- Keep PostgREST's schema cache fresh so supabase-js sees the new
-- columns immediately (mirrors the pattern in migration 024).
notify pgrst, 'reload schema';
