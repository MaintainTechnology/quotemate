-- ════════════════════════════════════════════════════════════════════
-- Migration 129 — supplier_price_refs (R12 AU price-calibration provenance).
--
-- WHY: R12 calibrates shared_materials.default_unit_price_ex_gst to real
-- Q2-2026 AU trade-counter buy prices (Reece/Tradelink for plumbing;
-- L&H/MMEM/Middys for electrical — NOT Bunnings RRP, which over-prices).
-- This table stores the per-material source reference behind each calibrated
-- price (supplier, SKU, buy price ex-GST, source URL, capture date) so the
-- quarterly re-calibration / drift-alert pass (R26) can diff a live source
-- against a stored one rather than re-deriving from scratch.
--
-- ⚠ INTENTIONALLY EMPTY ON CREATE — FLAG, NEVER FABRICATE (spec R12 + the
-- flag-not-fabricate constraint). This migration creates the table ONLY; it
-- seeds ZERO rows. The real prices are populated later by a SEPARATE
-- calibration pass that requires VERIFIED AU sources (real SKUs / trade-
-- counter quotes from the pilot tradie's own supplier accounts). No price is
-- invented here: an unverifiable value is left absent (a missing row), not
-- guessed. price_ex_gst is stored EX-GST per the project currency convention.
--
-- DDL-ONLY: creates one empty table and mutates no existing data rows, so the
-- runner intentionally SKIPS the pre-apply data snapshot (the spec backup
-- rule applies to data-correction migrations only — see 122 / 126 / 128).
--
-- Idempotent: CREATE TABLE IF NOT EXISTS — re-running is a clean no-op.
-- NOT auto-applied to prod. Apply with:
--   node --env-file=.env.local scripts/run-migration-129.mjs
-- Rollback with:
--   node --env-file=.env.local scripts/run-migration-129.mjs --rollback
-- ════════════════════════════════════════════════════════════════════

create table if not exists public.supplier_price_refs (
  id            uuid primary key default gen_random_uuid(),
  material_id   uuid,
  item          text,
  supplier      text,
  sku           text,
  price_ex_gst  numeric(10,2),
  source_url    text,
  captured_at   timestamptz,
  updated_at    timestamptz default now()
);

comment on table public.supplier_price_refs is
  'R12 calibration provenance: the real AU trade-counter buy-price source behind each calibrated shared_materials price. Empty on create — populated later by a separate verified-source calibration pass (flag-not-fabricate). price_ex_gst is stored EX-GST. R26 diffs live sources against these stored rows for drift alerts.';

comment on column public.supplier_price_refs.material_id is
  'Optional FK-by-convention to shared_materials.id (the row this reference prices). Nullable: a reference may be captured before it is linked to a catalogue row.';
comment on column public.supplier_price_refs.price_ex_gst is
  'Real AU trade-counter buy price, EX-GST (project currency convention). Trade-counter, NOT retail RRP.';
comment on column public.supplier_price_refs.source_url is
  'Source URL / quote reference the price was captured from (provenance). Use a clear note like "flagged - needs tradie input" when no verifiable source exists rather than fabricating one.';

-- Keep PostgREST's schema cache fresh (the new table is now exposed).
notify pgrst, 'reload schema';
