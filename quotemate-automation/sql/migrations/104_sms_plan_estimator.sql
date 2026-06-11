-- Migration 104 · SMS Electrical Estimator
--
-- Lets a customer text "can you quote my electrical plan?" to a tenant whose
-- toggle is on, receive a tokenised upload link, and get the AI take-off back
-- as a public results link (+ a Gotenberg-rendered PDF). Pieces:
--
--   tenants.sms_estimator_enabled  — per-tenant opt-in (Account tab toggle).
--   plan_upload_requests           — one row per upload link the SMS agent
--                                    hands out: token, phone numbers for the
--                                    reply, lifecycle status, error, and FKs
--                                    to the plan_uploads/plan_extractions the
--                                    submission produced.
--   plan_uploads.source            — 'dashboard' | 'sms' provenance.
--   plan_uploads.pdf_path          — storage path when the PDF is retained
--                                    (SMS flow only; dashboard stays no-store).
--   plan_extractions.share_token   — public read-only results page key.
--   plan_extractions.report_pdf_path — Gotenberg report in storage.
--
-- Idempotent. Apply with:
--   node --env-file=.env.local scripts/run-migration-104.mjs

alter table public.tenants
  add column if not exists sms_estimator_enabled boolean not null default false;

create table if not exists public.plan_upload_requests (
  id                  uuid primary key default gen_random_uuid(),
  token               text not null unique,
  tenant_id           uuid not null references tenants(id) on delete cascade,
  sms_conversation_id uuid references sms_conversations(id) on delete set null,

  -- Who to SMS when the analysis lands, and which number to send from
  -- (the tenant number the customer originally texted).
  customer_phone      text not null,
  twilio_number       text,

  -- awaiting_upload → analysing → complete | failed
  -- (failed keeps the token live so the customer can retry the same link)
  status              text not null default 'awaiting_upload',
  error               text,

  plan_upload_id      uuid references plan_uploads(id) on delete set null,
  plan_extraction_id  uuid references plan_extractions(id) on delete set null,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  expires_at          timestamptz not null default now() + interval '7 days'
);

create index if not exists plan_upload_requests_tenant_idx
  on public.plan_upload_requests (tenant_id, created_at desc);

alter table public.plan_uploads
  add column if not exists source   text not null default 'dashboard',
  add column if not exists pdf_path text;

alter table public.plan_extractions
  add column if not exists share_token     text unique,
  add column if not exists report_pdf_path text;

-- RLS posture matches 099: service-role only, nothing readable by anon.
alter table public.plan_upload_requests enable row level security;
grant select, insert, update, delete on public.plan_upload_requests to service_role;

notify pgrst, 'reload schema';

-- ── Verification ─────────────────────────────────────────────────────
do $$
declare
  toggle_ok  boolean;
  table_ok   boolean;
  source_ok  boolean;
  share_ok   boolean;
begin
  select exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='tenants'
                    and column_name='sms_estimator_enabled') into toggle_ok;
  select exists (select 1 from information_schema.tables
                  where table_schema='public' and table_name='plan_upload_requests') into table_ok;
  select exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='plan_uploads'
                    and column_name='pdf_path') into source_ok;
  select exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='plan_extractions'
                    and column_name='share_token') into share_ok;
  raise notice 'Migration 104: toggle=% requests=% pdf_path=% share_token=%',
    toggle_ok, table_ok, source_ok, share_ok;
end $$;
