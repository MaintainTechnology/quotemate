-- Migration 064 · Heal + purge tenant-orphan rows (Phase 3 of cleanup)
--
-- Audit 2026-05-26 against prod found 520 rows with tenant_id IS NULL
-- across 5 tables. Lineage analysis classified them:
--
--   • 518 pure orphans (historical test traffic) — DELETE
--   • 2 sms_conversations of conversation_type='tradie_registration'
--       — PRESERVE (NULL by design until activation)
--   • 1 customer ("Sam", +61489083371, Coogee, 158 conversations linked)
--       has a non-orphan intake AND a non-orphan SMS conversation, both
--       carrying tenant_id = '6dca084c-…' (Sparky). She's a LIVE customer
--       whose customer-row predates the 2026-05-20 lookup.ts tenant_id
--       fix — HEAL her tenant_id from her referencing rows; do not delete.
--
-- Execution order:
--   0. HEAL orphan customers that have a non-orphan referrer with a
--      tenant_id (any of intakes / sms_conversations / calls). Pick the
--      first non-null tenant_id encountered. This converts "Sam" into a
--      non-orphan and saves her row from the customer-purge below.
--   1. DELETE orphan quotes (108 expected). Cascade: quote_followup_events.
--   2. DELETE orphan intakes (128 expected). Cascade: quotes (already gone).
--   3. DELETE orphan calls (50 expected). Cascade: intakes (already gone).
--   4. DELETE orphan customer_quote sms_conversations (229 expected).
--      Cascade: sms_messages. Filter explicitly EXCLUDES tradie_registration.
--   5. DELETE remaining orphan customers (2 expected, post-heal).
--
-- The DO block prints row counts via RAISE NOTICE so the runner can echo
-- them. Wrapped in BEGIN/COMMIT in the runner so any failure rolls back.

do $$
declare
  healed_count int;
  pre_quotes  int;
  pre_intakes int;
  pre_calls   int;
  pre_smsc    int;
  pre_cust    int;
begin
  select count(*) into pre_quotes  from quotes where tenant_id is null;
  select count(*) into pre_intakes from intakes where tenant_id is null;
  select count(*) into pre_calls   from calls where tenant_id is null;
  select count(*) into pre_smsc    from sms_conversations
    where tenant_id is null and conversation_type = 'customer_quote';
  select count(*) into pre_cust    from customers where tenant_id is null;

  raise notice 'pre: quotes=%, intakes=%, calls=%, sms_customer_quote=%, customers=%',
    pre_quotes, pre_intakes, pre_calls, pre_smsc, pre_cust;

  -- 0) HEAL orphan customers with a non-orphan referrer.
  --    Coalesce from intakes → sms_conversations → calls; first non-null wins.
  with healed as (
    update customers cu
       set tenant_id = coalesce(
         (select tenant_id from intakes           where customer_id = cu.id and tenant_id is not null limit 1),
         (select tenant_id from sms_conversations where customer_id = cu.id and tenant_id is not null limit 1),
         (select tenant_id from calls             where customer_id = cu.id and tenant_id is not null limit 1)
       ),
         updated_at = now()
     where cu.tenant_id is null
       and (
         exists (select 1 from intakes           where customer_id = cu.id and tenant_id is not null) or
         exists (select 1 from sms_conversations where customer_id = cu.id and tenant_id is not null) or
         exists (select 1 from calls             where customer_id = cu.id and tenant_id is not null)
       )
    returning cu.id
  )
  select count(*) into healed_count from healed;
  raise notice 'healed % orphan customer(s) by backfilling tenant_id from non-orphan referrers', healed_count;

  -- 1) Orphan quotes.
  delete from quotes where tenant_id is null;

  -- 2) Orphan intakes.
  delete from intakes where tenant_id is null;

  -- 3) Orphan calls.
  delete from calls where tenant_id is null;

  -- 4) Orphan customer_quote SMS conversations (preserve tradie_registration).
  delete from sms_conversations
    where tenant_id is null
      and conversation_type = 'customer_quote';

  -- 5) Remaining orphan customers (the pure ones, post-heal).
  delete from customers where tenant_id is null;

  raise notice 'orphan purge complete';
end $$;
