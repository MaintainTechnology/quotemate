-- ════════════════════════════════════════════════════════════════════
-- Migration 060 — RLS Phase 1 extension: lock down 10 tables that
--                  landed AFTER migration 040 and were never RLS-enabled.
--
-- Background: migration 040 (2026-05-20) closed 13 leaking tables by
-- enabling RLS without policies — service-role traffic continued to
-- work because it bypasses RLS, and anon traffic was deny-by-default.
-- Ten more tables shipped after 040 and inherited Supabase's default
-- RLS-off state, showing as "Unrestricted" in the dashboard.
--
-- Anon-key probe (scripts/check-anon-rls-leak.mjs, 2026-05-26):
--   admin_users               2 rows visible to anon  ← operator allow-list
--   categories               24
--   trade_prompts             2  ← LLM system prompts (IP + jailbreak surface)
--   supplier_catalogue       50
--   trade_pricing_defaults    2
--   trades                    2
--   tenant_tier_ladder        1
--   (3 empty tables also exposed but no rows yet)
--
-- Grep of the codebase confirms zero anon-keyed reads of any of these
-- tables. All access is via server routes/components using the
-- service-role key, which bypasses RLS. Enabling RLS with no policies
-- therefore changes nothing for the running app while closing the leak
-- for any outsider with the public anon key.
--
-- Out of scope for this migration:
--   • Tenant-scoped positive policies for the per-tenant tables
--     (tenant_tier_ladder.tenant_id, quote_followup_events.tenant_id,
--     supplier_catalogue.created_by_tenant_id). That's RLS Phase 2 —
--     requires modelling the auth path end-to-end and is deferred
--     per quotemate-automation/docs/rls-design.md.
--
-- Idempotent: `enable row level security` on an already-enabled table
-- is a no-op success. Safe to re-run.
--
-- Apply with:
--   node --env-file=.env.local scripts/run-migration-060.mjs
-- ════════════════════════════════════════════════════════════════════

begin;

alter table admin_users               enable row level security;
alter table categories                enable row level security;
alter table import_batches            enable row level security;
alter table import_staged_rows        enable row level security;
alter table quote_followup_events     enable row level security;
alter table supplier_catalogue        enable row level security;
alter table tenant_tier_ladder        enable row level security;
alter table trade_pricing_defaults    enable row level security;
alter table trade_prompts             enable row level security;
alter table trades                    enable row level security;

-- Keep PostgREST's schema cache fresh (mirrors migrations 024/026/028/034/038/040/058/059).
notify pgrst, 'reload schema';

commit;
