-- Reverse 183. Tradie alert rows must go before conversation_id can be NOT
-- NULL again — they are the only rows allowed to have a null conversation.

delete from public.sms_messages where audience = 'tradie';

drop index if exists public.sms_messages_tradie_idx;

alter table public.sms_messages
  drop constraint if exists sms_messages_customer_needs_conversation_chk;

alter table public.sms_messages
  drop constraint if exists sms_messages_audience_chk;

alter table public.sms_messages drop column if exists tenant_id;
alter table public.sms_messages drop column if exists to_number;
alter table public.sms_messages drop column if exists audience;

alter table public.sms_messages
  alter column conversation_id set not null;
