-- ════════════════════════════════════════════════════════════════════
-- Migration 025 — WP1: make pricing_book.tenant_id REQUIRED.
--
-- The bug (see docs/deliverables/build-brief-2026-05-18.html, WP1):
--   pricing_book.tenant_id was nullable. Orphan rows with a NULL tenant
--   meant the estimator's lookup found nothing for a tradie and then
--   silently grabbed another tradie's book. We removed that code-level
--   fallback; this migration closes the schema-level hole so an orphan
--   row can never be created again.
--
-- Safety:
--   • Migration 024 already created a NON-partial unique index on
--     (tenant_id, trade). Combined with tenant_id NOT NULL that index
--     guarantees AT MOST one pricing_book row per (tenant, trade).
--   • This migration REFUSES to run while any NULL-tenant row exists.
--     It does NOT auto-guess an owner or auto-delete — auto-guessing the
--     owner is exactly the silent-mispricing failure WP1 exists to kill.
--     Resolve orphans first with scripts/wp1-pricing-book-audit.mjs
--     (attach each to the right tradie, or delete dead rows), then re-run.
--
-- Idempotent: if tenant_id is already NOT NULL the guard sees 0 NULLs and
--   ALTER ... SET NOT NULL is a no-op success. Safe to re-run.
-- ════════════════════════════════════════════════════════════════════

do $$
declare
  orphan_count int;
begin
  select count(*) into orphan_count
  from pricing_book
  where tenant_id is null;

  if orphan_count > 0 then
    raise exception
      'WP1 / migration 025: % pricing_book row(s) have tenant_id IS NULL. Refusing to SET NOT NULL while orphans exist. Run scripts/wp1-pricing-book-audit.mjs, attach each orphan to its tradie (or delete dead rows), then re-run this migration. Auto-guessing the owner is the exact silent-mispricing bug WP1 fixes.',
      orphan_count;
  end if;
end $$;

alter table pricing_book
  alter column tenant_id set not null;

comment on column pricing_book.tenant_id is
  'WP1 (migration 025): REQUIRED. Every pricing_book row is owned by exactly one tenant. The estimator only ever uses the row whose tenant_id matches the intake; it never falls back to another tradie''s book.';
