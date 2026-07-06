-- 161_full_quote_document.sql
--
-- Living-document quote editor (spec 2026-07-06-full-quote-editing-v2-design.md).
--
--   report_doc    the tradie-authored quote DOCUMENT as block JSON (title,
--                 prose, headings, lists, a locked pricing node). Content +
--                 structure only — NEVER prices. The pricing node renders from
--                 good/better/best, which stays the single source of truth.
--   report_style  per-quote branding override (allow-listed): logo path,
--                 accent colour, font family, heading style. NULL falls back to
--                 the tenant's global brand and never affects other quotes.
--
-- Both nullable, additive + idempotent — no data change, safe to re-run. Dormant
-- until Phase 1 wires them into the editor + render path.

alter table quotes add column if not exists report_doc   jsonb;
alter table quotes add column if not exists report_style jsonb;

comment on column quotes.report_doc is
  'Quote document block JSON (content + structure, no prices). Pricing node renders from good/better/best.';
comment on column quotes.report_style is
  'Per-quote branding override (allow-listed). NULL = tenant global brand. Never affects other quotes.';
