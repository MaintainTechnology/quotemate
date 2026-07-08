-- ════════════════════════════════════════════════════════════════════
-- Migration 166 · CRM connection data-centre metadata (Zoho multi-DC)
--
-- Zoho is region-partitioned: an authorization code is issued by the user's
-- data centre (US / EU / IN / AU / …) and can ONLY be exchanged + queried
-- against that DC's hosts. Before this, the OAuth callback always exchanged
-- against the global .com host, so a non-US (e.g. Australian) tradie's connect
-- failed. We now capture the DC on connect (accounts-server + api_domain) and
-- persist it here so later token refreshes and contact syncs hit the right DC.
--
-- Additive + nullable → safe on existing rows (there are none in prod yet).
--
-- Apply with:
--   node --env-file=.env.local scripts/run-migration-166.mjs
-- ════════════════════════════════════════════════════════════════════

begin;

alter table public.crm_connections
  add column if not exists provider_metadata jsonb not null default '{}'::jsonb;

comment on column public.crm_connections.provider_metadata is
  'Provider-specific connection metadata. Zoho multi-DC: { accounts_server, api_domain }. Mig 166.';

notify pgrst, 'reload schema';

commit;
