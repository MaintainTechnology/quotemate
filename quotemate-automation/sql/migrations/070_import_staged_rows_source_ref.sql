-- Migration 070 · Add source_ref + source_document to import_staged_rows
--
-- Context: the trade-book extraction pipeline (spike at
-- public/docs/trade-book-pipeline-spike.html) produces catalogue rows
-- by extracting them from a tradie's indexed PDF in mt-filestore-kb.
-- Each row needs an audit trail back to:
--   • the PDF document it came from (source_document)
--   • the page / section where the AI found it (source_ref)
--
-- The operator review UI shows these alongside each staged row so the
-- approver can click through to the original document and verify the
-- extraction matches.
--
-- For CSV-uploaded rows, source_ref stays NULL (existing behaviour
-- unchanged). For trade-book extractions, the api route writes the
-- section/page string returned by Gemini and the source store/document
-- id pair.
--
-- Idempotent: `add column if not exists`.

alter table import_staged_rows
  add column if not exists source_ref text,
  add column if not exists source_document text;

comment on column import_staged_rows.source_ref is
  'Human-readable citation back to the source — e.g. "Page 12, Section 4.2 Standard Downlight Procedure". Populated for trade-book extractions, NULL for CSV uploads. Added migration 070.';

comment on column import_staged_rows.source_document is
  'Identifier of the source document inside mt-filestore-kb (typically the document displayName or document resource name). Lets the review UI open the original PDF. NULL for CSV uploads. Added migration 070.';

-- Index on (batch_id, source_document) so the review UI can group rows
-- by source document quickly when a batch spans multiple PDFs.
create index if not exists import_staged_rows_batch_source_idx
  on import_staged_rows (batch_id, source_document)
  where source_document is not null;
