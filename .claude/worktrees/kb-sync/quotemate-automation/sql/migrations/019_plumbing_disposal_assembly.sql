-- Migration 019 — seed a "Disposal and site cleanup" assembly for plumbing.
--
-- Rationale: the toilet_replace + hot_water + tap_replace flows naturally
-- produce a "remove old + dispose" cost that wasn't represented in the
-- catalogue. Opus would invent a "Disposal of old toilet $50" line
-- which had no matching shared_assemblies / shared_materials row, so
-- the validator rejected the whole quote and downgraded it to a $199
-- inspection. Seeding this row gives Opus a legitimate place to land
-- disposal costs that the validator can recognise.
--
-- Categorisation note: the assembly name contains "disposal" which the
-- validator's categorise() picks up as 'sundry'. Line descriptions like
-- "Disposal of old toilet" also categorise as 'sundry' (via the same
-- "disposal" pattern) so semantic matching works.
--
-- Idempotent — `on conflict do nothing` so re-running is a no-op.

insert into shared_assemblies (
  trade, name, description, default_unit, default_unit_price_ex_gst,
  default_labour_hours, default_exclusions
) values (
  'plumbing',
  'Disposal and site cleanup',
  'Removal and offsite disposal of the replaced fixture (toilet, HWS, tap, drain debris) plus site cleanup at end of job. Flat fee per fixture; labour reflects handling time only.',
  'each',
  50.00,
  0.25,
  'Excludes asbestos-containing waste, tip-fee surcharges, and disposal of multiple bulky items beyond the primary fixture'
)
on conflict do nothing;
