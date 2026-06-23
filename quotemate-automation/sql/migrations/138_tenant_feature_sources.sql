-- ════════════════════════════════════════════════════════════════════
-- Migration 138 — tenant_feature_sources (per-tenant feature toggles)
--
-- Per-tenant feature access is gated by tenants.trades[] (the catalog is
-- lib/admin/trades.ts KNOWN_TRADES). This table records the PROVENANCE of
-- each enabled slug so the plan-tier seeding layer (lib/features/plan.ts)
-- can tell which slugs it may strip on a downgrade:
--   • 'manual'     — an admin granted it via /admin/customers/[id]
--   • 'onboarding' — the tenant signed up with this trade
--   • 'plan'       — auto-granted by the subscription plan map
-- Only 'plan' slugs are removed on a downgrade; 'manual'/'onboarding' stick.
--
-- BACKFILL: every slug a tenant currently has in trades[] is recorded as
-- 'manual' (sticky) — no current grant may ever be stripped by a later plan
-- change. trades[] itself is unchanged; this is additive provenance only.
--
-- Idempotent: create-if-not-exists + on-conflict-do-nothing backfill.
-- Apply with: node --env-file=.env.local scripts/run-migration-138.mjs
-- ════════════════════════════════════════════════════════════════════

create table if not exists tenant_feature_sources (
  tenant_id  uuid not null references tenants(id) on delete cascade,
  feature    text not null,                       -- a tenants.trades[] slug
  source     text not null check (source in ('manual', 'plan', 'onboarding')),
  updated_by uuid,                                -- admin auth user id when source='manual'
  updated_at timestamptz not null default now(),
  primary key (tenant_id, feature)
);

create index if not exists tenant_feature_sources_tenant_idx
  on tenant_feature_sources (tenant_id);

-- Backfill existing tenants: treat every current trades[] slug as a sticky
-- manual grant so plan downgrades never remove a feature a tenant relies on.
insert into tenant_feature_sources (tenant_id, feature, source, updated_at)
select t.id, slug, 'manual', now()
  from tenants t,
       lateral unnest(coalesce(t.trades, array[]::text[])) as slug
on conflict (tenant_id, feature) do nothing;

notify pgrst, 'reload schema';
