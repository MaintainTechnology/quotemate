-- Migration 067 · Row-level assumption + inspection flags on assemblies
--
-- Context (2026-05-26, post Jon's downlight-gap conversation): the
-- catalogue can't currently carry per-row structured rules like
-- "switch must be within 5m" or "single-storey only" — those live
-- either in code (lib/sms/assumptions.ts ASSUMPTION_RULES, per job_type)
-- or as freeform text (shared_assemblies.default_exclusions). For the
-- planned "Install LED downlight (new install)" row to escalate raked-
-- ceiling / multi-storey jobs correctly, we need structured rules ON
-- the row itself.
--
-- Schema additions in this migration:
--
--   shared_assemblies +
--     row_assumptions      jsonb default '{}' — structured rules
--     always_inspection    boolean default false — mirrors the column
--                          already on tenant_custom_assemblies; when
--                          true, lookupAssembly filters the row OUT so
--                          the AI can never produce an auto-quote that
--                          grounds on it
--     inspection_triggers  text[] default '{}' — list of customer-side
--                          trigger phrases (e.g. "raked ceiling",
--                          "two storey") that should escalate to
--                          inspection even when the row itself would
--                          otherwise be quotable
--
--   tenant_custom_assemblies +
--     row_assumptions      jsonb default '{}' — same shape so custom
--                          rows can carry per-row rules too
--
-- All additions are additive with safe defaults. Existing rows get
-- default {} / false / {} so behaviour is unchanged until rows are
-- explicitly populated (migration 068 for gas HWS, 069 for new rows).
--
-- Idempotent: all `if not exists` clauses.

alter table shared_assemblies
  add column if not exists row_assumptions jsonb default '{}'::jsonb,
  add column if not exists always_inspection boolean default false,
  add column if not exists inspection_triggers text[] default '{}'::text[];

alter table tenant_custom_assemblies
  add column if not exists row_assumptions jsonb default '{}'::jsonb;

comment on column shared_assemblies.row_assumptions is
  'Structured per-row pricing assumptions (e.g. {"switch_within_metres":5,"max_storeys":1,"roof_access_required":true}). Used by the SMS dialog + estimator to know when a row applies and when to escalate. Added migration 067.';

comment on column shared_assemblies.always_inspection is
  'When true, lookupAssembly filters this row OUT so the AI cannot produce an auto-quote grounded on it. Mirrors tenant_custom_assemblies.always_inspection. Set true on rows where the work is too risky to quote sight-unseen even though the row name is recognisable. Added migration 067.';

comment on column shared_assemblies.inspection_triggers is
  'Customer-side trigger phrases that should escalate THIS row to inspection (e.g. "raked ceiling" on the new-install downlight row). Distinct from the universal inspection triggers in lib/sms/assumptions.ts which are cross-row. Added migration 067.';

comment on column tenant_custom_assemblies.row_assumptions is
  'Same shape as shared_assemblies.row_assumptions; lets tenant-authored custom services carry their own per-row rules. Added migration 067.';
