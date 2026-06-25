-- Migration 146 · Cache signature for the customer quote PDF
--
-- Adds quotes.pdf_signature — a fingerprint of WHAT a cached PDF was rendered
-- from: the report template version + the tenant's resolved tier mode + the
-- visible tier keys + the recommended tier (lib/quote/pdf.ts quotePdfSignature).
--
-- WHY: the quote PDF is cached in quotes.pdf_path and, once set, was served
-- forever. A tradie flipping the Pricing-settings tier mode (pricing_book.
-- quote_tier_mode, mig 142) — or a report-template change — left every already-
-- cached PDF stale, still printing Good/Better/Best to a single-price customer.
-- With a stored signature, ensureQuotePdf regenerates lazily on the next
-- download/send whenever the freshly-computed signature differs (self-heal).
--
-- Nullable, NO default: an existing cached PDF has NULL here, which is treated
-- as "stale" (NULL != any fresh signature) so it regenerates on next access.
-- New generations stamp the signature. No backfill needed — NULL is exactly the
-- "force regenerate once" state we want for every pre-existing cached PDF, and
-- regeneration is lazy (on download/send) so untouched/test quotes cost nothing.
--
-- NOT auto-applied. Apply with:
--   node --env-file=.env.local scripts/run-migration-146.mjs

begin;

alter table public.quotes
  add column if not exists pdf_signature text;

commit;
