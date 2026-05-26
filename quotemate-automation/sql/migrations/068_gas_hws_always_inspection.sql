-- Migration 068 · Mark "Install gas HWS" as always-inspection
--
-- Context: per project memory project_plumbing_routing_rules, gas hot-
-- water-system installs must always escalate to a $99 site inspection
-- per AS/NZS 5601 — gas-line work, certified compliance, sight-unseen
-- pricing is unsafe. The row currently sits in shared_assemblies as a
-- normal quotable entry ($60 × 3.50 hr) with NULL clarifying_questions
-- before mig 065 lifted them. The routing-to-inspection guarantee
-- relied entirely on the universal inspection-trigger word list in
-- lib/sms/assumptions.ts catching emergency wording — fragile for a
-- clean "install new gas HWS" request that doesn't include the
-- universal trigger phrases.
--
-- This migration sets shared_assemblies.always_inspection = true on
-- THAT specific row, so the lookupAssembly tool filters it out from
-- candidate sets entirely. With no quotable gas-HWS row visible, the
-- estimator falls through to the "no matching assembly → inspection"
-- safety path. Paired code change in lib/estimate/tools.ts adds the
-- .eq('always_inspection', false) filter to the shared_assemblies
-- lookup (same gate pattern already existing on tenant_custom_assemblies).
--
-- row_assumptions also populated with the human-readable reason so
-- operators reading the row know why it's marked always-inspection.
--
-- Idempotent: WHERE clause includes the current state (always_inspection
-- is false) so a re-run is a no-op.

update shared_assemblies
  set always_inspection = true,
      row_assumptions = jsonb_build_object(
        'always_inspection_reason', 'AS/NZS 5601 gas work — certified compliance + sight required',
        'requires', jsonb_build_array(
          'gas certification on-site',
          'visual inspection of existing gas connection',
          'verification of meter capacity for new appliance load'
        )
      )
  where trade = 'plumbing'
    and name = 'Install gas HWS'
    and always_inspection = false;
