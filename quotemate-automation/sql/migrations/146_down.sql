-- Down-migration for 146 · drop quotes.pdf_signature.
--
-- Safe: the column is a regeneratable cache fingerprint, not source data.
-- After dropping it, ensureQuotePdf falls back to the pdf_path-presence check
-- (a cached PDF is reused until explicitly regenerated).

begin;

alter table public.quotes
  drop column if exists pdf_signature;

commit;
