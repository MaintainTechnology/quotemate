-- Migration 018 — per-trade licence storage.
--
-- Multi-trade tradies hold separate regulator licences for each trade
-- (e.g. a NSW NECA electrical licence AND a NSW Fair Trading plumbing
-- licence). Pre-018 the schema only had one set of fields on `tenants`
-- (licence_type, licence_number, licence_expiry) — fine for a single
-- trade, lossy for two.
--
-- Strategy:
--   • New `tenant_licences` table keyed by (tenant_id, trade).
--   • Backfill the table from each tenant's primary trade so existing
--     accounts keep their displayed licence.
--   • Keep `tenants.licence_*` columns in place. New code reads from
--     `tenant_licences`; legacy code paths that haven't been ported yet
--     still see the primary-trade licence on the tenant row.
--
-- Idempotent — `if not exists` everywhere.

-- ── 1. Create the table ────────────────────────────────────────────
create table if not exists tenant_licences (
  tenant_id uuid references tenants(id) on delete cascade,
  trade text not null check (trade in ('electrical','plumbing')),
  licence_type text,        -- e.g. "NECA NSW", "QBCC"
  licence_number text,
  licence_state text,       -- defaults to tenant.state but can differ
                            -- (rare: a cross-state tradie)
  licence_expiry date,
  created_at timestamptz default now(),
  primary key (tenant_id, trade)
);

create index if not exists tenant_licences_trade_idx
  on tenant_licences (trade);

-- ── 2. Backfill primary-trade licences from tenants.licence_* ──────
-- For every existing tenant that already has a licence number recorded,
-- copy that row into tenant_licences against their primary trade
-- (tenants.trade is the scalar back-compat column, synced to trades[0]).
-- Idempotent via `on conflict do nothing` so re-running the migration
-- doesn't clobber later edits from the dashboard.
insert into tenant_licences (
  tenant_id, trade, licence_type, licence_number, licence_state, licence_expiry
)
select
  t.id,
  t.trade,
  t.licence_type,
  t.licence_number,
  coalesce(t.state, null),
  t.licence_expiry
from tenants t
where t.trade is not null
  and (t.licence_number is not null or t.licence_type is not null)
on conflict (tenant_id, trade) do nothing;
