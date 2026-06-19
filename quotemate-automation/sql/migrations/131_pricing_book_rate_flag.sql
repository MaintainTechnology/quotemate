-- ════════════════════════════════════════════════════════════════════
-- Migration 131 — pricing_book.rate_review_flag (spec R13).
--
-- WHY: R13 says tenant-entered rates that fall outside a documented, sane
-- AU band must be FLAGGED for the tradie to confirm in the dashboard — and
-- the out-of-band tenant's quotes forced to tradie_review until confirmed —
-- but NEVER silently overwritten. Migration 119 already audited prod and
-- named the outliers (Oakcrest $200/hr + 42.8% markup; Atomic Electrical
-- 14% markup) and intentionally left their values untouched. This migration
-- materialises that flag as a queryable column so the routing layer and the
-- dashboard can read "this tenant's rate needs confirmation" off the row,
-- instead of re-deriving it each time.
--
-- WHAT IT DOES:
--   1. Adds an ADDITIVE, nullable text column public.pricing_book.rate_review_flag.
--      NULL = in-band / not reviewed-as-outlier. A non-null marker
--      ('rate_out_of_band: confirm') = the row's hourly_rate or
--      default_markup_pct is outside the documented band below.
--   2. Sets the marker ONLY on out-of-band rows. It NEVER changes
--      hourly_rate, default_markup_pct, min_labour_hours, or any other
--      tenant-entered pricing value — flag only (R13 + project constraint
--      "never overwrite tenant-entered values").
--
-- DOCUMENTED SANE AU BAND (the only thing this migration encodes; the
-- derivation method — loaded-cost build: base award + super + leave/LSL +
-- tool/vehicle + overhead + margin — is written up in
-- docs/markdown/pricing-book-audit-rates.md):
--   • electrical (NSW, NECA/AS3000):  hourly_rate $95-$150/hr  & markup 25-40%
--   • plumbing  (QLD, QBCC/AS3500):   hourly_rate $100-$150/hr & markup 12-25%
-- A row is flagged if hourly_rate OR default_markup_pct is outside its
-- trade's band. Only electrical + plumbing are live trades; any other trade
-- value is left UNFLAGGED here (no documented band yet — do not guess).
--
-- ⚠ FLAG-NOT-FABRICATE: no rate/markup is invented or corrected. The band
-- edges are documented engineering bounds, not tradie-verified per-tenant
-- rates. Which specific tenant rows get flagged is decided AT APPLY TIME by
-- the UPDATE below against whatever values are live in prod — see the audit
-- doc for the expected set (Oakcrest, Atomic) carried over from migration
-- 119's read-only audit; the actual flagged set is whatever the runner
-- reports after apply.
--
-- DATA MIGRATION (mutates existing pricing_book rows) -> the runner takes a
-- pre-apply snapshot pricing_book_backup_mig131 BEFORE applying (see
-- scripts/run-migration-131.mjs). down: drop the column.
--
-- Idempotent: add-column IF NOT EXISTS; the UPDATE's WHERE matches only
-- out-of-band rows that are not already flagged, so a second run affects 0
-- rows and never double-stamps.
-- NOT auto-applied to prod. Apply with:
--   node --env-file=.env.local scripts/run-migration-131.mjs
--   node --env-file=.env.local scripts/run-migration-131.mjs --rollback
-- ════════════════════════════════════════════════════════════════════

-- 1. Additive, nullable marker column.
alter table public.pricing_book
  add column if not exists rate_review_flag text;

comment on column public.pricing_book.rate_review_flag is
  'R13 outlier marker. NULL = in-band / not reviewed. Non-null (e.g. ''rate_out_of_band: confirm'') = tenant-entered hourly_rate or default_markup_pct is outside the documented AU band (electrical $95-150/hr & 25-40%; plumbing $100-150/hr & 12-25%). FLAG ONLY - the rate value itself is never overwritten; routing forces these tenants to tradie_review until the tradie confirms. Band derivation: docs/markdown/pricing-book-audit-rates.md.';

-- 2. Flag out-of-band rows. FLAG ONLY — hourly_rate / default_markup_pct
--    are NOT touched. Guarded by rate_review_flag IS NULL so a re-run is a
--    no-op and a manually-cleared flag is not silently re-stamped.

-- electrical (NSW, NECA/AS3000): $95-150/hr & 25-40% markup.
update public.pricing_book
   set rate_review_flag = 'rate_out_of_band: confirm'
 where trade = 'electrical'
   and rate_review_flag is null
   and (
        hourly_rate is null
     or hourly_rate < 95
     or hourly_rate > 150
     or default_markup_pct is null
     or default_markup_pct < 25
     or default_markup_pct > 40
   );

-- plumbing (QLD, QBCC/AS3500): $100-150/hr & 12-25% markup.
update public.pricing_book
   set rate_review_flag = 'rate_out_of_band: confirm'
 where trade = 'plumbing'
   and rate_review_flag is null
   and (
        hourly_rate is null
     or hourly_rate < 100
     or hourly_rate > 150
     or default_markup_pct is null
     or default_markup_pct < 12
     or default_markup_pct > 25
   );

notify pgrst, 'reload schema';
