-- ════════════════════════════════════════════════════════════════════
-- Migration 176 — tenants.owner_mobile becomes nullable
-- (spec specs/onboarding-wizard-refresh.md, addendum A2).
--
-- The onboarding wizard's trade-step inputs are all optional now. Mobile
-- is normally carried verified from /signup, but a degraded activation
-- without one must still succeed: the activate route inserts null and
-- runProvisioning skips the welcome SMS. Purely permissive — existing
-- rows and inserts are unaffected.
-- ════════════════════════════════════════════════════════════════════

alter table tenants alter column owner_mobile drop not null;
