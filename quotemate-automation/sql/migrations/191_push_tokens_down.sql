-- DESTRUCTIVE rollback for migration 191. Back up push token/ticket rows first.
alter table public.sms_conversations drop column if exists lead_push_sent_at;
drop function if exists public.release_push_event(uuid, uuid, text, timestamptz);
drop function if exists public.complete_push_event(uuid, uuid, timestamptz);
drop function if exists public.claim_push_event(uuid, uuid, timestamptz);
drop index if exists public.push_events_due_idx;
drop table if exists public.push_events;
drop index if exists public.push_tickets_due_idx;
drop table if exists public.push_tickets;
drop index if exists public.push_tokens_tenant_idx;
drop table if exists public.push_tokens;
notify pgrst, 'reload schema';
