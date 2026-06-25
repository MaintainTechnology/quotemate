-- Migration 148 · Refresh cached roofing quote PDFs for the tier-mode fix
--
-- The roofing quote PDF now honours the tenant's quote_tier_mode (dashboard
-- Pricing settings): a single-price roofer's PDF shows one option and drops the
-- "Roofing quote · Good / Better / Best" header (lib/roofing/report-html.ts +
-- lib/quote/pdf.ts ensureRoofQuotePdf, mirroring the electrical/plumbing fix in
-- mig 146). Roofing PDFs cached before this change still render all three tiers
-- with the G/B/B header.
--
-- Null their pdf_path so each regenerates lazily (on the next download/send)
-- with the corrected, mode-aware layout. The stored `quote` is untouched, and
-- the orphaned PDF objects in the quote-pdfs bucket are simply overwritten on
-- regeneration (roofs/<token>.pdf). Safe + idempotent.
--
-- NOT auto-applied. Apply with:
--   node --env-file=.env.local scripts/run-migration-148.mjs

begin;

update public.roofing_measurements
  set pdf_path = null
  where pdf_path is not null;

commit;
