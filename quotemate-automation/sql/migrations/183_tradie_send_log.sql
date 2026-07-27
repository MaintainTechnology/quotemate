-- 183 · make sms_messages able to hold a TRADIE alert, not just customer turns.
--
-- Every message on a customer thread is recorded. Tradie alerts — "roofing
-- quote sent", "job BOOKED", "a customer asked something I could not answer" —
-- were recorded nowhere: dispatchQuoteMessage writes nothing, and the callers
-- only persist customer turns. So "did the tradie actually get told?" was
-- answerable only by re-reading the code path, and a silent Twilio reject was
-- undetectable. Found 2026-07-27 chasing a paid, booked roofing job whose
-- tradie heard nothing (token ff6f67ce…).
--
-- A tradie alert has no conversation: it is not part of the customer thread,
-- and it MUST NOT be, because app/api/sms/inbound feeds that thread to the
-- receptionist model as history — an alert in there would corrupt the model's
-- context and echo owner_mobile back at the customer. Hence a nullable
-- conversation_id rather than reusing the customer's row.
--
-- Safe by inspection: every existing reader of sms_messages filters by
-- conversation_id with .eq or .in (app/api/sms/inbound, intake/structure,
-- cron/followup-2h, tenant/me, tenant/chats, tenant/followups/messages), so
-- rows with a null conversation are invisible to all of them. Existing rows are
-- unaffected — audience defaults to 'customer'.

alter table public.sms_messages
  alter column conversation_id drop not null;

alter table public.sms_messages
  add column if not exists audience text not null default 'customer';

alter table public.sms_messages
  add column if not exists to_number text;

alter table public.sms_messages
  add column if not exists tenant_id uuid references public.tenants(id) on delete set null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'sms_messages_audience_chk'
  ) then
    alter table public.sms_messages
      add constraint sms_messages_audience_chk check (audience in ('customer', 'tradie'));
  end if;
end $$;

-- A conversation-less row is only legitimate for a tradie alert; a customer
-- turn without its thread would silently vanish from every history read.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'sms_messages_customer_needs_conversation_chk'
  ) then
    alter table public.sms_messages
      add constraint sms_messages_customer_needs_conversation_chk
      check (audience = 'tradie' or conversation_id is not null);
  end if;
end $$;

create index if not exists sms_messages_tradie_idx
  on public.sms_messages (tenant_id, created_at desc)
  where audience = 'tradie';

comment on column public.sms_messages.audience is
  'customer = a turn on the customer thread (conversation_id required). tradie = an alert to the tenant owner, deliberately outside every conversation so it never enters the receptionist model history.';

comment on column public.sms_messages.to_number is
  'Recipient. Only set on audience=tradie rows; customer turns take theirs from sms_conversations.';
