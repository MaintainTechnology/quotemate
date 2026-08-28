-- DESTRUCTIVE rollback for migration 191. Back up push token/ticket rows first.
alter table public.sms_conversations drop column if exists lead_push_sent_at;
drop index if exists public.push_tickets_due_idx;
drop table if exists public.push_tickets;
drop index if exists public.push_tokens_tenant_idx;
drop table if exists public.push_tokens;
notify pgrst, 'reload schema';
