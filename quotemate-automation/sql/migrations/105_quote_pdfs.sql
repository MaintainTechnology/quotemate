-- Migration 105 · Quote PDFs (Gotenberg)
--
-- The full customer quote (electrical + plumbing G/B/B via the estimate
-- pipeline, roofing via the SMS roofing flow) now ships with a Gotenberg-
-- rendered PDF: a download link in the quote SMS + on-demand regeneration
-- via /api/q/[token]/pdf and /api/q/roof/[token]/pdf, plus a best-effort
-- MMS attachment of the document.
--
--   quotes.pdf_path                — storage path of the rendered quote PDF
--                                    (quote-pdfs bucket), null until first
--                                    generated; regenerated on edit-resend.
--   roofing_measurements.pdf_path  — same for the roofing quote.
--
-- Bucket `quote-pdfs` is created by scripts/create-quote-pdfs-bucket.mjs
-- (storage buckets aren't SQL-migratable the same way).
--
-- Idempotent. Apply with:
--   node --env-file=.env.local scripts/run-migration-105.mjs

alter table public.quotes
  add column if not exists pdf_path text;

alter table public.roofing_measurements
  add column if not exists pdf_path text;

notify pgrst, 'reload schema';

-- ── Verification ─────────────────────────────────────────────────────
do $$
declare
  quotes_ok boolean;
  roof_ok   boolean;
begin
  select exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='quotes'
                    and column_name='pdf_path') into quotes_ok;
  select exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='roofing_measurements'
                    and column_name='pdf_path') into roof_ok;
  raise notice 'Migration 105: quotes.pdf_path=% roofing_measurements.pdf_path=%',
    quotes_ok, roof_ok;
end $$;
