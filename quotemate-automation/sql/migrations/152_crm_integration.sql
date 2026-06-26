-- ════════════════════════════════════════════════════════════════════
-- Migration 152 · CRM integration + lead-list announcement email blast
--
-- Lets a tradie connect a third-party CRM (HubSpot / Zoho), import their
-- contact list, and send a re-sendable "I'm now on QuoteMax" announcement
-- email to that list. See specs/crm-email-blast.md.
--
-- Five tables, all tenant-scoped + RLS-on (service role bypasses; the API
-- routes filter by tenant_id in app code, consistent with the rest of the
-- codebase). OAuth tokens are stored ENCRYPTED at the app layer
-- (lib/crypto/encrypt.ts) — the columns hold ciphertext, never plaintext.
--
-- Apply with:
--   node --env-file=.env.local scripts/run-migration-152.mjs
-- ════════════════════════════════════════════════════════════════════

begin;

-- ── CRM connection (one active per tenant+provider) ───────────────────
create table if not exists public.crm_connections (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants(id) on delete cascade,
  provider          text not null check (provider in ('hubspot', 'zoho')),
  access_token_enc  text,                     -- AES-256-GCM ciphertext
  refresh_token_enc text,                     -- AES-256-GCM ciphertext
  expires_at        timestamptz,
  status            text not null default 'connected'
                      check (status in ('connected', 'error', 'disconnected')),
  connected_at      timestamptz not null default now(),
  last_synced_at    timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- At most one connection row per tenant+provider.
create unique index if not exists crm_connections_tenant_provider_uniq
  on public.crm_connections (tenant_id, provider);

comment on table public.crm_connections is
  'Per-tenant CRM OAuth connection. Tokens stored AES-256-GCM encrypted. Mig 152.';

-- ── Imported contacts (deduped by email per tenant) ───────────────────
create table if not exists public.crm_contacts (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  connection_id uuid references public.crm_connections(id) on delete set null,
  email         text not null,
  first_name    text,
  last_name     text,
  external_id   text,
  imported_at   timestamptz not null default now()
);

-- One row per (tenant, email); re-syncs upsert on this key. Emails are stored
-- already-normalised (trimmed + lowercased) by the app, so a plain composite
-- unique index is correct and is targetable by an upsert onConflict clause.
create unique index if not exists crm_contacts_tenant_email_uniq
  on public.crm_contacts (tenant_id, email);

comment on table public.crm_contacts is
  'Contacts imported from a tenant CRM connection, deduped by lower(email). Mig 152.';

-- ── Email campaigns (the re-sendable announcement) ────────────────────
create table if not exists public.email_campaigns (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  type            text not null default 'announcement'
                    check (type in ('announcement')),
  subject         text,
  status          text not null default 'draft'
                    check (status in ('draft', 'sending', 'sent', 'failed')),
  recipient_count integer not null default 0,
  sent_count      integer not null default 0,
  failed_count    integer not null default 0,
  created_at      timestamptz not null default now(),
  last_sent_at    timestamptz
);

create index if not exists email_campaigns_tenant_idx
  on public.email_campaigns (tenant_id, created_at desc);

-- One campaign row per (tenant, type). `type` is constrained to a single value
-- ('announcement'), so this enforces exactly one announcement campaign per tenant
-- and backs the atomic get-or-create upsert (onConflict tenant_id,type) — without
-- it, two concurrent sends could insert duplicate rows and break .maybeSingle().
create unique index if not exists email_campaigns_tenant_type_uniq
  on public.email_campaigns (tenant_id, type);

comment on table public.email_campaigns is
  'Tenant email campaigns. v1 = re-sendable QuoteMax announcement. Mig 152.';

-- ── Per-recipient send log (status + idempotency for re-send) ─────────
create table if not exists public.email_sends (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  campaign_id uuid not null references public.email_campaigns(id) on delete cascade,
  contact_id  uuid references public.crm_contacts(id) on delete set null,
  email       text not null,
  status      text not null default 'queued'
                check (status in ('queued', 'sent', 'failed', 'suppressed')),
  message_id  text,
  error       text,
  created_at  timestamptz not null default now(),
  sent_at     timestamptz
);

-- One send row per (campaign, email). Lets 'unsent' re-sends skip prior
-- successes and gives per-recipient status (R12). Email stored normalised.
create unique index if not exists email_sends_campaign_email_uniq
  on public.email_sends (campaign_id, email);
create index if not exists email_sends_tenant_idx
  on public.email_sends (tenant_id, created_at desc);

comment on table public.email_sends is
  'Per-recipient send status for a campaign; unique on (campaign, email). Mig 152.';

-- ── Unsubscribes (per tenant, honoured on every send) ─────────────────
create table if not exists public.email_unsubscribes (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  email           text not null,
  unsubscribed_at timestamptz not null default now()
);

create unique index if not exists email_unsubscribes_tenant_email_uniq
  on public.email_unsubscribes (tenant_id, email);

comment on table public.email_unsubscribes is
  'Per-tenant email unsubscribes; suppressed on every send. Mig 152.';

-- ── RLS (enabled; service-role bypasses, app filters by tenant_id) ────
alter table public.crm_connections   enable row level security;
alter table public.crm_contacts      enable row level security;
alter table public.email_campaigns   enable row level security;
alter table public.email_sends       enable row level security;
alter table public.email_unsubscribes enable row level security;

grant select, insert, update, delete on public.crm_connections    to service_role;
grant select, insert, update, delete on public.crm_contacts       to service_role;
grant select, insert, update, delete on public.email_campaigns    to service_role;
grant select, insert, update, delete on public.email_sends        to service_role;
grant select, insert, update, delete on public.email_unsubscribes to service_role;

notify pgrst, 'reload schema';

commit;
