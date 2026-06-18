-- ════════════════════════════════════════════════════════════════════
-- Migration 122 — first-message conversation-create race backstop (R43).
--
-- Background: app/api/sms/inbound/route.ts creates a NEW sms_conversations
-- row when no reusable prior exists for a from_number. Two webhooks for a
-- brand-new from_number that arrive within the same instant BOTH take the
-- NEW branch and each does a plain INSERT — producing TWO active
-- conversations for the same (from_number, to_number). Each row then wins
-- its OWN per-conversation lock (the lock is per-row), so BOTH webhooks run
-- the dialog and the customer gets duplicate replies (split-brain).
--
-- This partial unique index lets the route switch its NEW insert to an
-- idempotent `INSERT ... ON CONFLICT DO NOTHING`: only ONE *active*
-- customer_quote conversation can exist per (from_number, to_number) at a
-- time. The loser of the race gets no row back, re-selects the winner's
-- row, persists its inbound there, and the existing lock coalesces the two
-- webhooks onto a single dialog turn.
--
-- Why partial (status in 'open','structuring')  AND conversation_type =
-- 'customer_quote':
--   • Returning customers legitimately get a fresh row for each new job —
--     but only AFTER the prior conversation has moved to 'done'/'abandoned'.
--     Scoping the uniqueness to ACTIVE statuses keeps that behaviour: a
--     done conversation no longer occupies the slot, so the next job inserts
--     cleanly.
--   • tradie_registration / converted threads are managed by a separate
--     branch (maybeHandleTradieRegistration) and must NOT collide with a
--     customer_quote thread on the same number, so they're excluded.
--
-- NOTE on historical data: if a from_number already has >1 active
-- customer_quote row (possible from the very race this fixes, before the
-- index existed), creating a UNIQUE index would fail. The run script
-- (scripts/run-migration-122.mjs) reports any such duplicates BEFORE
-- attempting the index so they can be reconciled; the index uses
-- CREATE UNIQUE INDEX (not CONCURRENTLY) inside the migration tx.
--
-- Idempotent — `if not exists`.
-- ════════════════════════════════════════════════════════════════════

create unique index if not exists sms_conversations_active_customer_quote_unique
  on public.sms_conversations (from_number, to_number)
  where status in ('open', 'structuring')
    and conversation_type = 'customer_quote';

comment on index public.sms_conversations_active_customer_quote_unique is
  'R43 race backstop: at most one ACTIVE (open|structuring) customer_quote conversation per (from_number, to_number). Enables ON CONFLICT DO NOTHING on the inbound NEW-conversation insert so two concurrent first-messages cannot create split-brain duplicate conversations. Done/abandoned rows free the slot so returning customers still get a fresh row per job.';

-- ── Idempotent-create RPC ─────────────────────────────────────────────
-- supabase-js's .upsert({onConflict}) can only emit a bare column list, but
-- inferring a PARTIAL unique index requires the index predicate in the
-- ON CONFLICT clause (verified: bare `ON CONFLICT (from_number,to_number)`
-- is rejected against the partial index with "no unique or exclusion
-- constraint matching the ON CONFLICT specification"). So the predicate-
-- qualified insert lives in SQL and the route calls it via supabase.rpc().
--
-- Returns the row it inserted; on a lost race (the active row already
-- exists) ON CONFLICT DO NOTHING yields nothing and the function returns
-- the EXISTING active row instead — so the caller always gets exactly one
-- canonical conversation to adopt, and never fabricates a duplicate.
--
-- SECURITY DEFINER so it runs with the table owner's rights (the route uses
-- the service-role key already, but this keeps the function self-contained
-- if RLS policies tighten later). search_path pinned for safety.
create or replace function public.create_sms_conversation_idempotent(
  p_from_number       text,
  p_to_number         text,
  p_status            text,
  p_customer_id       uuid,
  p_tenant_id         uuid,
  p_photo_request_token text,
  p_conversation_state  jsonb
)
returns public.sms_conversations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.sms_conversations;
begin
  insert into public.sms_conversations (
    from_number, to_number, status, customer_id, tenant_id,
    photo_request_token, conversation_state, conversation_type
  )
  values (
    p_from_number, p_to_number, coalesce(p_status, 'open'), p_customer_id, p_tenant_id,
    p_photo_request_token, coalesce(p_conversation_state, '{}'::jsonb), 'customer_quote'
  )
  on conflict (from_number, to_number)
    where status in ('open', 'structuring') and conversation_type = 'customer_quote'
  do nothing
  returning * into v_row;

  if v_row.id is null then
    -- Lost the race — return the active row a concurrent webhook created.
    select * into v_row
      from public.sms_conversations
     where from_number = p_from_number
       and to_number = p_to_number
       and conversation_type = 'customer_quote'
       and status in ('open', 'structuring')
     order by last_message_at desc nulls last
     limit 1;
  end if;

  return v_row;
end;
$$;

comment on function public.create_sms_conversation_idempotent is
  'R43 — idempotent first-message conversation create. Predicate-qualified ON CONFLICT DO NOTHING on the partial unique index sms_conversations_active_customer_quote_unique; on a lost race returns the existing active row so the caller adopts one canonical conversation instead of fabricating a duplicate.';
